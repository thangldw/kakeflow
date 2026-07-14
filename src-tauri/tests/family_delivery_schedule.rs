#[path = "../src/family_delivery_schedule.rs"]
#[allow(dead_code)]
mod schedule;

use rusqlite::Connection;
use schedule::{
    assert_active_lease, claim_all_due, claim_due, claim_next_due, complete, configure, disable,
    fail, release_claim, request_now, status, suspend_terminal, suspend_terminal_claimed,
    FamilyDeliveryScheduleError,
};

fn database() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE family_delivery_connections(household_id TEXT PRIMARY KEY NOT NULL) STRICT; INSERT INTO family_delivery_connections VALUES('home'),('other');").unwrap();
    connection
        .execute_batch(include_str!(
            "../migrations/0050_family_delivery_schedule.sql"
        ))
        .unwrap();
    connection
}

fn make_due(connection: &Connection, household_id: &str) {
    connection
        .execute(
            "UPDATE family_delivery_schedules SET
                 next_due_at='2000-01-01T00:00:00.000Z',suspended_until=NULL,
                 suspension_reason=NULL
             WHERE household_id=?1",
            [household_id],
        )
        .unwrap();
}

#[test]
fn migration_enforces_opt_in_interval_and_lease_invariants() {
    let connection = database();
    connection
        .execute(
            "INSERT INTO family_delivery_schedules(household_id) VALUES('home')",
            [],
        )
        .unwrap();
    let initial = status(&connection, "home").unwrap();
    assert!(!initial.enabled);
    assert_eq!(initial.interval_minutes, 30);
    assert_eq!(initial.last_result, "NEVER");
    assert!(initial.next_due_at.is_none());

    assert!(connection
        .execute(
            "UPDATE family_delivery_schedules SET interval_minutes=10 WHERE household_id='home'",
            []
        )
        .is_err());
    assert!(connection
        .execute(
            "UPDATE family_delivery_schedules SET enabled=1 WHERE household_id='home'",
            []
        )
        .is_err());
    assert!(connection
        .execute(
            "UPDATE family_delivery_schedules SET lease_token='bad' WHERE household_id='home'",
            []
        )
        .is_err());
}

#[test]
fn configure_is_explicit_scoped_and_accepts_only_supported_intervals() {
    let connection = database();
    for interval in [15, 30, 60] {
        let configured = configure(&connection, "home", true, interval).unwrap();
        assert!(configured.enabled);
        assert_eq!(configured.interval_minutes, interval);
        assert!(configured.next_due_at.is_some());
    }
    assert!(matches!(
        configure(&connection, "home", true, 45),
        Err(FamilyDeliveryScheduleError::InvalidInput)
    ));
    assert!(matches!(
        configure(&connection, "missing", true, 30),
        Err(FamilyDeliveryScheduleError::NotConfigured)
    ));
    assert!(matches!(
        status(&connection, "other"),
        Err(FamilyDeliveryScheduleError::NotConfigured)
    ));
}

#[test]
fn due_schedule_has_one_lease_and_success_reschedules_it() {
    let connection = database();
    configure(&connection, "home", true, 15).unwrap();
    let lease = claim_due(&connection, "home").unwrap().unwrap();
    assert_eq!(lease.lease_token.len(), 64);
    assert_eq!(lease.interval_minutes, 15);
    assert!(claim_due(&connection, "home").unwrap().is_none());

    let completed = complete(&connection, "home", &lease.lease_token, 4).unwrap();
    assert!(!completed.running);
    assert_eq!(completed.last_result, "DISCOVERED");
    assert_eq!(completed.last_discovered_count, 4);
    assert_eq!(completed.consecutive_failures, 0);
    assert!(completed.last_attempt_at.is_some());
    assert!(completed.last_success_at.is_some());
    assert!(claim_due(&connection, "home").unwrap().is_none());

    make_due(&connection, "home");
    let next = claim_due(&connection, "home").unwrap().unwrap();
    let completed = complete(&connection, "home", &next.lease_token, 0).unwrap();
    assert_eq!(completed.last_result, "NO_CHANGES");
    assert_eq!(completed.last_discovered_count, 0);
}

#[test]
fn stale_or_invalid_completion_and_failure_tokens_are_rejected() {
    let connection = database();
    configure(&connection, "home", true, 30).unwrap();
    let lease = claim_due(&connection, "home").unwrap().unwrap();
    assert!(matches!(
        complete(&connection, "home", &"0".repeat(64), 1),
        Err(FamilyDeliveryScheduleError::StaleLease)
    ));
    assert!(matches!(
        fail(&connection, "home", "bad", "NETWORK"),
        Err(FamilyDeliveryScheduleError::InvalidInput)
    ));
    complete(&connection, "home", &lease.lease_token, 0).unwrap();
    assert!(matches!(
        complete(&connection, "home", &lease.lease_token, 0),
        Err(FamilyDeliveryScheduleError::StaleLease)
    ));
}

#[test]
fn failures_use_bounded_backoff_and_suspend_after_five_attempts() {
    let connection = database();
    configure(&connection, "home", true, 15).unwrap();
    for expected in 1..=5 {
        make_due(&connection, "home");
        let lease = claim_due(&connection, "home").unwrap().unwrap();
        let failed = fail(&connection, "home", &lease.lease_token, "RELAY_UNAVAILABLE").unwrap();
        assert_eq!(failed.last_result, "FAILED_RETRYABLE");
        assert_eq!(failed.consecutive_failures, expected);
        assert_eq!(failed.last_error_code.as_deref(), Some("RELAY_UNAVAILABLE"));
        assert_eq!(failed.suspended_until.is_some(), expected >= 5);
        assert_eq!(
            failed.suspension_reason.as_deref(),
            (expected >= 5).then_some("RETRY_BACKOFF")
        );
    }

    let delay: f64 = connection
        .query_row(
            "SELECT (julianday(next_due_at)-julianday('now'))*24*60
         FROM family_delivery_schedules WHERE household_id='home'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    // 15 * 2^4 = 240 minutes. Allow timestamp/query rounding.
    assert!((239.0..=241.0).contains(&delay), "delay={delay}");
    assert!(claim_due(&connection, "home").unwrap().is_none());
}

#[test]
fn failure_counter_and_retry_delay_are_bounded() {
    let connection = database();
    configure(&connection, "home", true, 60).unwrap();
    for _ in 0..12 {
        make_due(&connection, "home");
        let lease = claim_due(&connection, "home").unwrap().unwrap();
        fail(&connection, "home", &lease.lease_token, "OFFLINE").unwrap();
    }
    let state = status(&connection, "home").unwrap();
    assert_eq!(state.consecutive_failures, 10);
    let delay: f64 = connection
        .query_row(
            "SELECT (julianday(next_due_at)-julianday('now'))*24*60
         FROM family_delivery_schedules WHERE household_id='home'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!((359.0..=361.0).contains(&delay), "delay={delay}");
}

#[test]
fn expired_lease_is_recovered_durably_after_restart() {
    let connection = database();
    configure(&connection, "home", true, 30).unwrap();
    let lease = claim_due(&connection, "home").unwrap().unwrap();
    connection.execute("UPDATE family_delivery_schedules SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE household_id='home'", []).unwrap();

    let recovered = status(&connection, "home").unwrap();
    assert!(!recovered.running);
    assert_eq!(recovered.last_result, "LEASE_EXPIRED");
    assert_eq!(recovered.consecutive_failures, 1);
    assert_eq!(recovered.last_error_code.as_deref(), Some("LEASE_EXPIRED"));
    assert!(claim_due(&connection, "home").unwrap().is_none());
    assert!(matches!(
        complete(&connection, "home", &lease.lease_token, 0),
        Err(FamilyDeliveryScheduleError::StaleLease)
    ));

    // A second status read does not count the same expired lease twice.
    assert_eq!(status(&connection, "home").unwrap().consecutive_failures, 1);
}

#[test]
fn disable_cancels_a_lease_and_reconfigure_resets_failure_state() {
    let connection = database();
    configure(&connection, "home", true, 15).unwrap();
    let lease = claim_due(&connection, "home").unwrap().unwrap();
    let disabled = disable(&connection, "home").unwrap();
    assert!(!disabled.enabled);
    assert_eq!(disabled.last_result, "DISABLED");
    assert!(disabled.next_due_at.is_none());
    assert!(matches!(
        complete(&connection, "home", &lease.lease_token, 1),
        Err(FamilyDeliveryScheduleError::StaleLease)
    ));

    let enabled = configure(&connection, "home", true, 60).unwrap();
    assert!(enabled.enabled);
    assert_eq!(enabled.interval_minutes, 60);
    assert_eq!(enabled.consecutive_failures, 0);
    assert!(claim_due(&connection, "home").unwrap().is_some());
}

#[test]
fn terminal_failures_never_auto_retry_and_require_reconfiguration() {
    let connection = database();
    configure(&connection, "home", true, 15).unwrap();
    let lease = claim_due(&connection, "home").unwrap().unwrap();
    assert!(matches!(
        fail(&connection, "home", &lease.lease_token, "AUTH_EXPIRED"),
        Err(FamilyDeliveryScheduleError::InvalidInput)
    ));
    let suspended = suspend_terminal(&connection, "home", "AUTH_EXPIRED").unwrap();
    assert_eq!(suspended.last_result, "TERMINAL_SUSPENDED");
    assert_eq!(suspended.suspension_reason.as_deref(), Some("AUTH_EXPIRED"));
    assert!(suspended.suspended_until.is_none());
    // Time passage cannot bypass the terminal reason.
    connection.execute("UPDATE family_delivery_schedules SET next_due_at='2000-01-01T00:00:00.000Z' WHERE household_id='home'", []).unwrap();
    assert!(claim_due(&connection, "home").unwrap().is_none());

    for reason in ["MEMBERSHIP_REVOKED", "MISSING_CREDENTIAL"] {
        let state = suspend_terminal(&connection, "home", reason).unwrap();
        assert_eq!(state.suspension_reason.as_deref(), Some(reason));
    }
    assert!(matches!(
        suspend_terminal(&connection, "home", "NETWORK"),
        Err(FamilyDeliveryScheduleError::InvalidInput)
    ));

    let restored = configure(&connection, "home", true, 30).unwrap();
    assert!(restored.suspension_reason.is_none());
    assert!(claim_due(&connection, "home").unwrap().is_some());
}

#[test]
fn supervisor_claims_a_bounded_due_batch_across_households() {
    let connection = database();
    configure(&connection, "home", true, 15).unwrap();
    configure(&connection, "other", true, 60).unwrap();
    let first = claim_all_due(&connection, 1).unwrap();
    assert_eq!(first.len(), 1);
    let second = claim_all_due(&connection, 100).unwrap();
    assert_eq!(second.len(), 1);
    assert_ne!(first[0].household_id, second[0].household_id);
    assert!(claim_all_due(&connection, 100).unwrap().is_empty());
    assert!(matches!(
        claim_all_due(&connection, 0),
        Err(FamilyDeliveryScheduleError::InvalidInput)
    ));

    // Terminally suspended rows are excluded from the supervisor batch.
    disable(&connection, &first[0].household_id).unwrap();
    configure(&connection, &first[0].household_id, true, 15).unwrap();
    suspend_terminal(&connection, &first[0].household_id, "MISSING_CREDENTIAL").unwrap();
    assert!(claim_all_due(&connection, 100).unwrap().is_empty());
}

#[test]
fn supervisor_claims_only_one_global_due_lease_at_a_time() {
    let connection = database();
    configure(&connection, "home", true, 15).unwrap();
    configure(&connection, "other", true, 15).unwrap();

    let first = claim_next_due(&connection).unwrap().unwrap();
    assert_active_lease(&connection, &first.household_id, &first.lease_token).unwrap();
    let second = claim_next_due(&connection).unwrap().unwrap();
    assert_ne!(first.household_id, second.household_id);
    assert!(claim_next_due(&connection).unwrap().is_none());
}

#[test]
fn terminal_and_shutdown_mutations_are_fenced_by_lease_generation() {
    let connection = database();
    configure(&connection, "home", true, 15).unwrap();
    let stale = claim_due(&connection, "home").unwrap().unwrap();
    disable(&connection, "home").unwrap();
    configure(&connection, "home", true, 15).unwrap();
    let current = claim_due(&connection, "home").unwrap().unwrap();

    assert!(matches!(
        suspend_terminal_claimed(&connection, "home", &stale.lease_token, "AUTH_EXPIRED"),
        Err(FamilyDeliveryScheduleError::StaleLease)
    ));
    assert!(matches!(
        release_claim(&connection, "home", &stale.lease_token),
        Err(FamilyDeliveryScheduleError::StaleLease)
    ));
    assert_active_lease(&connection, "home", &current.lease_token).unwrap();

    let released = release_claim(&connection, "home", &current.lease_token).unwrap();
    assert_eq!(released.last_result, "FAILED_RETRYABLE");
    assert_eq!(released.last_error_code.as_deref(), Some("APP_SHUTDOWN"));
    assert!(!released.running);
    assert!(claim_next_due(&connection).unwrap().is_some());
}

#[test]
fn run_now_overrides_backoff_but_preserves_history_and_not_terminal_state() {
    let connection = database();
    configure(&connection, "home", true, 15).unwrap();
    let lease = claim_due(&connection, "home").unwrap().unwrap();
    let failed = fail(&connection, "home", &lease.lease_token, "OFFLINE").unwrap();
    assert_eq!(failed.consecutive_failures, 1);
    assert!(claim_due(&connection, "home").unwrap().is_none());

    let requested = request_now(&connection, "home").unwrap();
    assert_eq!(requested.consecutive_failures, 1);
    assert_eq!(requested.last_result, "FAILED_RETRYABLE");
    assert_eq!(requested.last_error_code.as_deref(), Some("OFFLINE"));
    assert!(claim_due(&connection, "home").unwrap().is_some());

    configure(&connection, "home", true, 15).unwrap();
    suspend_terminal(&connection, "home", "AUTH_EXPIRED").unwrap();
    assert!(matches!(
        request_now(&connection, "home"),
        Err(FamilyDeliveryScheduleError::TerminalSuspended)
    ));
    disable(&connection, "home").unwrap();
    assert!(matches!(
        request_now(&connection, "home"),
        Err(FamilyDeliveryScheduleError::Disabled)
    ));
}

#[test]
fn schedule_is_deleted_with_its_family_connection() {
    let connection = database();
    configure(&connection, "home", true, 30).unwrap();
    connection
        .execute(
            "DELETE FROM family_delivery_connections WHERE household_id='home'",
            [],
        )
        .unwrap();
    let rows: u64 = connection
        .query_row(
            "SELECT count(*) FROM family_delivery_schedules WHERE household_id='home'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(rows, 0);
}
