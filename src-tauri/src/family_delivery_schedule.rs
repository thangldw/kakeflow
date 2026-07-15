use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use thiserror::Error;

const LEASE_MINUTES: u32 = 2;
const MAX_FAILURES: u32 = 10;
const SUSPEND_AFTER_FAILURES: u32 = 5;
const MAX_BACKOFF_MINUTES: u32 = 360;

#[derive(Debug, Error)]
pub enum FamilyDeliveryScheduleError {
    #[error("family delivery schedule database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("family delivery schedule input is invalid")]
    InvalidInput,
    #[error("family delivery schedule was not configured")]
    NotConfigured,
    #[error("family delivery schedule is disabled")]
    Disabled,
    #[error("family delivery schedule requires user action")]
    TerminalSuspended,
    #[error("family delivery schedule lease is stale")]
    StaleLease,
}

pub type Result<T> = std::result::Result<T, FamilyDeliveryScheduleError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FamilyDeliveryScheduleStatusDto {
    pub household_id: String,
    pub enabled: bool,
    pub interval_minutes: u32,
    pub next_due_at: Option<String>,
    pub running: bool,
    pub lease_expires_at: Option<String>,
    pub last_attempt_at: Option<String>,
    pub last_success_at: Option<String>,
    pub last_result: String,
    pub last_discovered_count: u64,
    pub consecutive_failures: u32,
    pub suspended_until: Option<String>,
    pub suspension_reason: Option<String>,
    pub last_error_code: Option<String>,
    pub intake_enabled: bool,
    pub last_intake_result: String,
    pub last_staged_count: u32,
    pub last_intake_error_code: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FamilyDeliveryScheduleLeaseDto {
    pub household_id: String,
    pub lease_token: String,
    pub lease_expires_at: String,
    pub interval_minutes: u32,
}

/// Creates or replaces the opt-in schedule. Reconfiguration intentionally
/// clears an old failure suspension and makes an enabled schedule due now.
pub fn configure(
    connection: &Connection,
    household_id: &str,
    enabled: bool,
    interval_minutes: u32,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    configure_with_intake(connection, household_id, enabled, interval_minutes, false)
}

pub fn configure_with_intake(
    connection: &Connection,
    household_id: &str,
    enabled: bool,
    interval_minutes: u32,
    intake_enabled: bool,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    validate_household_id(household_id)?;
    validate_interval(interval_minutes)?;
    let transaction = connection.unchecked_transaction()?;
    let exists = transaction
        .query_row(
            "SELECT 1 FROM family_delivery_connections WHERE household_id=?1",
            [household_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !exists {
        return Err(FamilyDeliveryScheduleError::NotConfigured);
    }
    transaction.execute(
        "INSERT INTO family_delivery_schedules(
             household_id,enabled,interval_minutes,next_due_at,last_result,
             last_discovered_count,consecutive_failures,intake_enabled,
             last_intake_result,last_staged_count,updated_at
         ) VALUES(
             ?1,?2,?3,CASE WHEN ?2=1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') END,
             CASE WHEN ?2=1 THEN 'NEVER' ELSE 'DISABLED' END,0,0,
             ?4,CASE WHEN ?2=1 AND ?4=1 THEN 'NEVER' ELSE 'DISABLED' END,0,
             strftime('%Y-%m-%dT%H:%M:%fZ','now')
         )
         ON CONFLICT(household_id) DO UPDATE SET
             enabled=excluded.enabled,
             interval_minutes=excluded.interval_minutes,
             next_due_at=excluded.next_due_at,
             lease_token=NULL,
             lease_expires_at=NULL,
             last_result=excluded.last_result,
             last_discovered_count=0,
             consecutive_failures=0,
             suspended_until=NULL,
             suspension_reason=NULL,
             last_error_code=NULL,
             intake_enabled=excluded.intake_enabled,
             last_intake_result=excluded.last_intake_result,
             last_staged_count=0,last_intake_error_code=NULL,
             updated_at=excluded.updated_at",
        params![household_id, enabled, interval_minutes, intake_enabled],
    )?;
    let result = read_status(&transaction, household_id)?;
    transaction.commit()?;
    Ok(result)
}

pub fn disable(
    connection: &Connection,
    household_id: &str,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    validate_household_id(household_id)?;
    let changed = connection.execute(
        "UPDATE family_delivery_schedules SET
             enabled=0,next_due_at=NULL,lease_token=NULL,lease_expires_at=NULL,
             last_result='DISABLED',suspended_until=NULL,last_error_code=NULL,
             suspension_reason=NULL,
             intake_enabled=0,last_intake_result='DISABLED',last_staged_count=0,
             last_intake_error_code=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1",
        [household_id],
    )?;
    if changed == 0 {
        return Err(FamilyDeliveryScheduleError::NotConfigured);
    }
    read_status(connection, household_id)
}

/// Makes an enabled schedule due immediately without erasing attempt history.
/// A manual run can override retry backoff, but never a terminal suspension
/// which requires reauthorization or explicit reconfiguration.
pub fn request_now(
    connection: &Connection,
    household_id: &str,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    validate_household_id(household_id)?;
    let state: Option<(bool, Option<String>)> = connection
        .query_row(
            "SELECT enabled,suspension_reason FROM family_delivery_schedules
             WHERE household_id=?1",
            [household_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((enabled, reason)) = state else {
        return Err(FamilyDeliveryScheduleError::NotConfigured);
    };
    if !enabled {
        return Err(FamilyDeliveryScheduleError::Disabled);
    }
    if reason.as_deref().is_some_and(is_terminal_reason) {
        return Err(FamilyDeliveryScheduleError::TerminalSuspended);
    }
    connection.execute(
        "UPDATE family_delivery_schedules SET
             next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             suspended_until=NULL,suspension_reason=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND enabled=1",
        [household_id],
    )?;
    read_status(connection, household_id)
}

/// Returns persisted status after recovering a lease that expired while the
/// app was closed. Recovery is durable and applies the same bounded retry
/// policy as an explicit failed attempt.
pub fn status(
    connection: &Connection,
    household_id: &str,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    validate_household_id(household_id)?;
    let transaction = connection.unchecked_transaction()?;
    recover_expired_lease(&transaction, household_id)?;
    let result = read_status(&transaction, household_id)?;
    transaction.commit()?;
    Ok(result)
}

/// Atomically claims the schedule only when it is enabled, due, unsuspended,
/// and not already leased. A `None` result is an expected idle state.
pub fn claim_due(
    connection: &Connection,
    household_id: &str,
) -> Result<Option<FamilyDeliveryScheduleLeaseDto>> {
    validate_household_id(household_id)?;
    let transaction = connection.unchecked_transaction()?;
    recover_expired_lease(&transaction, household_id)?;
    let lease = claim_due_in(&transaction, household_id)?;
    if lease.is_none() {
        // Distinguish an unconfigured household from a configured idle one.
        let configured = transaction
            .query_row(
                "SELECT 1 FROM family_delivery_schedules WHERE household_id=?1",
                [household_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !configured {
            return Err(FamilyDeliveryScheduleError::NotConfigured);
        }
    }
    transaction.commit()?;
    Ok(lease)
}

/// Claims a bounded batch across households for the background supervisor.
/// Every returned row owns an independent lease; idle or terminally suspended
/// schedules are omitted.
pub fn claim_all_due(
    connection: &Connection,
    limit: u32,
) -> Result<Vec<FamilyDeliveryScheduleLeaseDto>> {
    if !(1..=100).contains(&limit) {
        return Err(FamilyDeliveryScheduleError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    recover_all_expired_leases(&transaction)?;
    let household_ids = {
        let mut statement = transaction.prepare(
            "SELECT household_id FROM family_delivery_schedules
             WHERE enabled=1 AND lease_token IS NULL
               AND next_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
               AND (suspension_reason IS NULL OR (
                    suspension_reason='RETRY_BACKOFF'
                    AND suspended_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))
             ORDER BY next_due_at,household_id LIMIT ?1",
        )?;
        let rows = statement
            .query_map([limit], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows
    };
    let mut leases = Vec::with_capacity(household_ids.len());
    for household_id in household_ids {
        if let Some(lease) = claim_due_in(&transaction, &household_id)? {
            leases.push(lease);
        }
    }
    transaction.commit()?;
    Ok(leases)
}

/// Claims at most one due household. The supervisor deliberately uses this
/// instead of holding a batch of leases while earlier network work runs.
pub fn claim_next_due(connection: &Connection) -> Result<Option<FamilyDeliveryScheduleLeaseDto>> {
    let transaction = connection.unchecked_transaction()?;
    recover_all_expired_leases(&transaction)?;
    let household_id = transaction
        .query_row(
            "SELECT household_id FROM family_delivery_schedules
             WHERE enabled=1 AND lease_token IS NULL
               AND next_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
               AND (suspension_reason IS NULL OR (
                    suspension_reason='RETRY_BACKOFF'
                    AND suspended_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))
             ORDER BY next_due_at,household_id LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let lease = household_id
        .as_deref()
        .map(|household_id| claim_due_in(&transaction, household_id))
        .transpose()?
        .flatten();
    transaction.commit()?;
    Ok(lease)
}

/// Verifies that a lease generation still owns the enabled schedule. Every
/// discovery side effect uses this fence before it mutates local state.
pub fn assert_active_lease(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
) -> Result<()> {
    validate_household_id(household_id)?;
    validate_lease_token(lease_token)?;
    let active = connection
        .query_row(
            "SELECT 1 FROM family_delivery_schedules
             WHERE household_id=?1 AND enabled=1 AND lease_token=?2
               AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![household_id, lease_token],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !active {
        return Err(FamilyDeliveryScheduleError::StaleLease);
    }
    Ok(())
}

/// Renews only the currently active lease generation. Discovery calls this
/// before each bounded relay request so an earlier generation cannot resume
/// after a replacement worker has taken ownership.
pub fn heartbeat_lease(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
) -> Result<()> {
    validate_household_id(household_id)?;
    validate_lease_token(lease_token)?;
    let changed = connection.execute(
        "UPDATE family_delivery_schedules SET
             lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?3),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND enabled=1 AND lease_token=?2
           AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![
            household_id,
            lease_token,
            format!("+{LEASE_MINUTES} minutes")
        ],
    )?;
    if changed == 0 {
        return Err(FamilyDeliveryScheduleError::StaleLease);
    }
    Ok(())
}

fn claim_due_in(
    transaction: &Transaction<'_>,
    household_id: &str,
) -> Result<Option<FamilyDeliveryScheduleLeaseDto>> {
    let claimed = transaction.execute(
        "UPDATE family_delivery_schedules SET
             lease_token=lower(hex(randomblob(32))),
             lease_expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?2),
             last_attempt_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             last_result='RUNNING',last_error_code=NULL,
             suspended_until=CASE
                 WHEN suspended_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN NULL
                 ELSE suspended_until END,
             suspension_reason=CASE
                 WHEN suspension_reason='RETRY_BACKOFF'
                      AND suspended_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN NULL
                 ELSE suspension_reason END,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND enabled=1 AND lease_token IS NULL
           AND next_due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           AND (suspension_reason IS NULL OR (
                suspension_reason='RETRY_BACKOFF'
                AND suspended_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
        params![household_id, format!("+{LEASE_MINUTES} minutes")],
    )?;
    if claimed == 1 {
        Ok(Some(transaction.query_row(
            "SELECT household_id,lease_token,lease_expires_at,interval_minutes
             FROM family_delivery_schedules WHERE household_id=?1",
            [household_id],
            |row| {
                Ok(FamilyDeliveryScheduleLeaseDto {
                    household_id: row.get(0)?,
                    lease_token: row.get(1)?,
                    lease_expires_at: row.get(2)?,
                    interval_minutes: row.get::<_, u32>(3)?,
                })
            },
        )?))
    } else {
        Ok(None)
    }
}

pub fn complete(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
    discovered_count: u64,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    validate_household_id(household_id)?;
    validate_lease_token(lease_token)?;
    let discovered_count =
        i64::try_from(discovered_count).map_err(|_| FamilyDeliveryScheduleError::InvalidInput)?;
    let changed = connection.execute(
        "UPDATE family_delivery_schedules SET
             lease_token=NULL,lease_expires_at=NULL,
             last_success_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             last_result=CASE WHEN ?3=0 THEN 'NO_CHANGES' ELSE 'DISCOVERED' END,
             last_discovered_count=?3,consecutive_failures=0,suspended_until=NULL,
             suspension_reason=NULL,
             last_error_code=NULL,
             next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+' || interval_minutes || ' minutes'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND enabled=1 AND lease_token=?2
           AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![household_id, lease_token, discovered_count],
    )?;
    if changed == 0 {
        return Err(FamilyDeliveryScheduleError::StaleLease);
    }
    read_status(connection, household_id)
}

/// Persists bounded, redacted intake telemetry only while this lease still
/// owns the schedule. Artifact identifiers and financial data are never stored.
pub fn record_intake_result(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
    result: &str,
    staged_count: u32,
    error_code: Option<&str>,
) -> Result<()> {
    if !matches!(
        result,
        "NO_AVAILABLE"
            | "REVIEW_PENDING"
            | "STAGED_FOR_REVIEW"
            | "FAILED_RETRYABLE"
            | "REJECTED_INVALID"
            | "AUDIENCE_DENIED"
    ) || staged_count > 1
        || error_code.is_some_and(|value| validate_error_code(value).is_err())
    {
        return Err(FamilyDeliveryScheduleError::InvalidInput);
    }
    let changed = connection.execute(
        "UPDATE family_delivery_schedules SET
             last_intake_result=?3,last_staged_count=?4,last_intake_error_code=?5,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND enabled=1 AND intake_enabled=1
           AND lease_token=?2
           AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![household_id, lease_token, result, staged_count, error_code],
    )?;
    if changed == 0 {
        return Err(FamilyDeliveryScheduleError::StaleLease);
    }
    Ok(())
}

pub fn intake_enabled(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
) -> Result<bool> {
    assert_active_lease(connection, household_id, lease_token)?;
    connection
        .query_row(
            "SELECT intake_enabled FROM family_delivery_schedules WHERE household_id=?1",
            [household_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

/// Records a retryable discovery failure. Retry delay grows exponentially from
/// the configured interval and is capped at six hours. After five consecutive
/// failures the status is explicitly suspended until that bounded retry time.
pub fn fail(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
    error_code: &str,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    let transaction = connection.unchecked_transaction()?;
    let result = fail_claimed_in_transaction(&transaction, household_id, lease_token, error_code)?;
    transaction.commit()?;
    Ok(result)
}

pub(crate) fn fail_claimed_in_transaction(
    transaction: &Transaction<'_>,
    household_id: &str,
    lease_token: &str,
    error_code: &str,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    validate_household_id(household_id)?;
    validate_lease_token(lease_token)?;
    validate_error_code(error_code)?;
    if is_terminal_reason(error_code) {
        return Err(FamilyDeliveryScheduleError::InvalidInput);
    }
    let (interval, failures): (u32, u32) = transaction
        .query_row(
            "SELECT interval_minutes,consecutive_failures
             FROM family_delivery_schedules
             WHERE household_id=?1 AND enabled=1 AND lease_token=?2
               AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![household_id, lease_token],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(FamilyDeliveryScheduleError::StaleLease)?;
    apply_failure(
        transaction,
        household_id,
        interval,
        failures,
        "FAILED_RETRYABLE",
        Some(error_code),
    )?;
    read_status(transaction, household_id)
}

/// Stops automatic retries for failures which require an explicit user action.
/// Calling `configure` after reauthorization clears this terminal suspension.
pub fn suspend_terminal(
    connection: &Connection,
    household_id: &str,
    reason: &str,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    validate_household_id(household_id)?;
    if !is_terminal_reason(reason) {
        return Err(FamilyDeliveryScheduleError::InvalidInput);
    }
    let changed = connection.execute(
        "UPDATE family_delivery_schedules SET
             lease_token=NULL,lease_expires_at=NULL,last_result='TERMINAL_SUSPENDED',
             suspended_until=NULL,suspension_reason=?2,last_error_code=?2,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND enabled=1",
        params![household_id, reason],
    )?;
    if changed == 0 {
        return Err(FamilyDeliveryScheduleError::NotConfigured);
    }
    read_status(connection, household_id)
}

/// Terminal suspension for a claimed discovery generation. Unlike the
/// administrative helper above, a stale worker cannot suspend a newer run.
pub fn suspend_terminal_claimed(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
    reason: &str,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    validate_household_id(household_id)?;
    validate_lease_token(lease_token)?;
    if !is_terminal_reason(reason) {
        return Err(FamilyDeliveryScheduleError::InvalidInput);
    }
    let changed = connection.execute(
        "UPDATE family_delivery_schedules SET
             lease_token=NULL,lease_expires_at=NULL,last_result='TERMINAL_SUSPENDED',
             suspended_until=NULL,suspension_reason=?3,last_error_code=?3,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND enabled=1 AND lease_token=?2
           AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![household_id, lease_token, reason],
    )?;
    if changed == 0 {
        return Err(FamilyDeliveryScheduleError::StaleLease);
    }
    read_status(connection, household_id)
}

/// Releases a still-current lease when the app is shutting down. The schedule
/// remains due, so the next app process can retry without waiting for expiry.
pub fn release_claim(
    connection: &Connection,
    household_id: &str,
    lease_token: &str,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    validate_household_id(household_id)?;
    validate_lease_token(lease_token)?;
    let changed = connection.execute(
        "UPDATE family_delivery_schedules SET
             lease_token=NULL,lease_expires_at=NULL,last_result='FAILED_RETRYABLE',
             last_discovered_count=0,last_error_code='APP_SHUTDOWN',
             next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1 AND enabled=1 AND lease_token=?2
           AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![household_id, lease_token],
    )?;
    if changed == 0 {
        return Err(FamilyDeliveryScheduleError::StaleLease);
    }
    read_status(connection, household_id)
}

fn recover_expired_lease(transaction: &Transaction<'_>, household_id: &str) -> Result<()> {
    let expired: Option<(u32, u32)> = transaction
        .query_row(
            "SELECT interval_minutes,consecutive_failures
             FROM family_delivery_schedules
             WHERE household_id=?1 AND enabled=1 AND lease_token IS NOT NULL
               AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            [household_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((interval, failures)) = expired {
        apply_failure(
            transaction,
            household_id,
            interval,
            failures,
            "LEASE_EXPIRED",
            Some("LEASE_EXPIRED"),
        )?;
    }
    Ok(())
}

fn recover_all_expired_leases(transaction: &Transaction<'_>) -> Result<()> {
    let expired = {
        let mut statement = transaction.prepare(
            "SELECT household_id,interval_minutes,consecutive_failures
             FROM family_delivery_schedules
             WHERE enabled=1 AND lease_token IS NOT NULL
               AND lease_expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, u32>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        rows
    };
    for (household_id, interval, failures) in expired {
        apply_failure(
            transaction,
            &household_id,
            interval,
            failures,
            "LEASE_EXPIRED",
            Some("LEASE_EXPIRED"),
        )?;
    }
    Ok(())
}

fn apply_failure(
    transaction: &Transaction<'_>,
    household_id: &str,
    interval_minutes: u32,
    previous_failures: u32,
    result: &str,
    error_code: Option<&str>,
) -> Result<()> {
    let failures = previous_failures.saturating_add(1).min(MAX_FAILURES);
    let backoff = backoff_minutes(interval_minutes, failures);
    let suspend = failures >= SUSPEND_AFTER_FAILURES;
    transaction.execute(
        "UPDATE family_delivery_schedules SET
             lease_token=NULL,lease_expires_at=NULL,last_result=?2,
             last_discovered_count=0,consecutive_failures=?3,
             next_due_at=strftime('%Y-%m-%dT%H:%M:%fZ','now',?4),
             suspended_until=CASE WHEN ?5=1
                 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now',?4) ELSE NULL END,
             suspension_reason=CASE WHEN ?5=1 THEN 'RETRY_BACKOFF' ELSE NULL END,
             last_error_code=?6,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?1",
        params![
            household_id,
            result,
            failures,
            format!("+{backoff} minutes"),
            suspend,
            error_code
        ],
    )?;
    Ok(())
}

fn backoff_minutes(interval_minutes: u32, failures: u32) -> u32 {
    let exponent = failures.saturating_sub(1).min(10);
    interval_minutes
        .saturating_mul(1_u32 << exponent)
        .min(MAX_BACKOFF_MINUTES)
}

fn read_status(
    connection: &Connection,
    household_id: &str,
) -> Result<FamilyDeliveryScheduleStatusDto> {
    connection
        .query_row(
            "SELECT household_id,enabled,interval_minutes,next_due_at,
                    lease_token IS NOT NULL,lease_expires_at,last_attempt_at,
                    last_success_at,last_result,last_discovered_count,
                    consecutive_failures,suspended_until,suspension_reason,
                    last_error_code,intake_enabled,last_intake_result,last_staged_count,
                    last_intake_error_code,updated_at
             FROM family_delivery_schedules WHERE household_id=?1",
            [household_id],
            |row| {
                Ok(FamilyDeliveryScheduleStatusDto {
                    household_id: row.get(0)?,
                    enabled: row.get(1)?,
                    interval_minutes: row.get(2)?,
                    next_due_at: row.get(3)?,
                    running: row.get(4)?,
                    lease_expires_at: row.get(5)?,
                    last_attempt_at: row.get(6)?,
                    last_success_at: row.get(7)?,
                    last_result: row.get(8)?,
                    last_discovered_count: row.get::<_, u64>(9)?,
                    consecutive_failures: row.get(10)?,
                    suspended_until: row.get(11)?,
                    suspension_reason: row.get(12)?,
                    last_error_code: row.get(13)?,
                    intake_enabled: row.get(14)?,
                    last_intake_result: row.get(15)?,
                    last_staged_count: row.get(16)?,
                    last_intake_error_code: row.get(17)?,
                    updated_at: row.get(18)?,
                })
            },
        )
        .optional()?
        .ok_or(FamilyDeliveryScheduleError::NotConfigured)
}

fn validate_household_id(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > 128 || value.trim() != value {
        return Err(FamilyDeliveryScheduleError::InvalidInput);
    }
    Ok(())
}

fn validate_interval(value: u32) -> Result<()> {
    if !matches!(value, 15 | 30 | 60) {
        return Err(FamilyDeliveryScheduleError::InvalidInput);
    }
    Ok(())
}

fn validate_lease_token(value: &str) -> Result<()> {
    if value.len() != 64
        || value
            .bytes()
            .any(|byte| !byte.is_ascii_hexdigit() || byte.is_ascii_uppercase())
    {
        return Err(FamilyDeliveryScheduleError::InvalidInput);
    }
    Ok(())
}

fn validate_error_code(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > 64 || value.trim() != value {
        return Err(FamilyDeliveryScheduleError::InvalidInput);
    }
    Ok(())
}

fn is_terminal_reason(value: &str) -> bool {
    matches!(
        value,
        "AUTH_EXPIRED" | "MEMBERSHIP_REVOKED" | "MISSING_CREDENTIAL"
    )
}
