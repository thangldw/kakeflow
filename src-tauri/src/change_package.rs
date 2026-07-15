use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

use crate::sync_foundation::{canonical_json, get_local_status, sha256_hex};

pub const PACKAGE_SCHEMA_VERSION: u32 = 5;
pub const PACKAGE_MODE: &str = "FULL_CURRENT_STATE";
pub const LEGACY_COVERED_KINDS: [&str; 11] = [
    "HOUSEHOLD",
    "HOUSEHOLD_MEMBER",
    "ACCOUNT",
    "TRANSACTION",
    "MONTHLY_BUDGET_PLAN",
    "SAVINGS_GOAL",
    "CLASSIFICATION_RULE",
    "ACCOUNT_GROUP",
    "CARD_SETTLEMENT_MAPPING",
    "DASHBOARD_PREFERENCES",
    "DELIMITED_PARSER_PROFILE",
];
pub const V2_COVERED_KINDS: [&str; 13] = [
    "HOUSEHOLD",
    "HOUSEHOLD_MEMBER",
    "ACCOUNT",
    "TRANSACTION",
    "CARD_STATEMENT",
    "CARD_PAYMENT",
    "MONTHLY_BUDGET_PLAN",
    "SAVINGS_GOAL",
    "CLASSIFICATION_RULE",
    "ACCOUNT_GROUP",
    "CARD_SETTLEMENT_MAPPING",
    "DASHBOARD_PREFERENCES",
    "DELIMITED_PARSER_PROFILE",
];
pub const V3_COVERED_KINDS: [&str; 18] = [
    "HOUSEHOLD",
    "HOUSEHOLD_MEMBER",
    "ACCOUNT",
    "TRANSACTION",
    "CARD_STATEMENT",
    "CARD_PAYMENT",
    "PORTFOLIO_SNAPSHOT",
    "BROKERAGE_EVENT",
    "INVESTMENT_FX_RATE",
    "INVESTMENT_MARKET_PRICE",
    "AGGREGATE_ASSET_SNAPSHOT",
    "MONTHLY_BUDGET_PLAN",
    "SAVINGS_GOAL",
    "CLASSIFICATION_RULE",
    "ACCOUNT_GROUP",
    "CARD_SETTLEMENT_MAPPING",
    "DASHBOARD_PREFERENCES",
    "DELIMITED_PARSER_PROFILE",
];
pub const V4_COVERED_KINDS: [&str; 18] = V3_COVERED_KINDS;
pub const COVERED_KINDS: [&str; 19] = [
    "HOUSEHOLD",
    "HOUSEHOLD_MEMBER",
    "ACCOUNT",
    "TRANSACTION",
    "CARD_STATEMENT",
    "CARD_PAYMENT",
    "PORTFOLIO_SNAPSHOT",
    "BROKERAGE_EVENT",
    "INVESTMENT_FX_RATE",
    "INVESTMENT_MARKET_PRICE",
    "AGGREGATE_ASSET_SNAPSHOT",
    "MONTHLY_BUDGET_PLAN",
    "SAVINGS_GOAL",
    "CLASSIFICATION_RULE",
    "ACCOUNT_GROUP",
    "CARD_SETTLEMENT_MAPPING",
    "DASHBOARD_PREFERENCES",
    "DELIMITED_PARSER_PROFILE",
    "RECURRING_SERIES_PREFERENCES",
];

const MAX_PACKAGE_RECORDS: usize = 100_000;
const MAX_RECURRING_SERIES_PREFERENCES: usize = 10_000;

fn covered_kinds_for(schema_version: u32) -> Option<&'static [&'static str]> {
    match schema_version {
        1 => Some(&LEGACY_COVERED_KINDS),
        2 => Some(&V2_COVERED_KINDS),
        3 => Some(&V3_COVERED_KINDS),
        4 => Some(&V4_COVERED_KINDS),
        5 => Some(&COVERED_KINDS),
        _ => None,
    }
}

#[derive(Debug, Error)]
pub enum ChangePackageError {
    #[error("change package database operation failed")]
    Database(#[from] rusqlite::Error),
    #[error("change package input is invalid")]
    InvalidInput,
    #[error("change package is too large")]
    LimitExceeded,
    #[error("change package encoding failed")]
    Encoding,
    #[error("change package household was not found")]
    NotFound,
    #[error("another change package is awaiting review")]
    ReviewPending,
    #[error("change package conflicts with existing lineage")]
    Conflict,
    #[error("change package revision is stale")]
    Stale,
}

pub type Result<T> = std::result::Result<T, ChangePackageError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangePackageRecordDto {
    pub entity_kind: String,
    pub entity_id: String,
    pub operation: String,
    pub canonical_payload_json: String,
    pub payload_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalChangePackageDto {
    pub package_id: String,
    pub schema_version: u32,
    pub mode: String,
    pub source_installation_id: String,
    pub source_principal_id: String,
    pub source_revision: u64,
    pub household_id: String,
    pub created_at: String,
    pub covered_kinds: Vec<String>,
    pub counts_by_kind: BTreeMap<String, u64>,
    pub snapshot_sha256: String,
    pub package_sha256: String,
    pub records: Vec<ChangePackageRecordDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangePackageRecordReviewDto {
    pub record_order: u64,
    pub entity_kind: String,
    pub entity_id: String,
    pub operation: String,
    #[serde(skip_serializing)]
    pub canonical_payload_json: String,
    pub payload_sha256: String,
    pub review_state: String,
    pub resolution: String,
    pub current_payload_sha256: Option<String>,
    pub conflict_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChangePackageReviewDto {
    pub package_id: String,
    pub schema_version: u32,
    pub target_household_id: String,
    pub source_installation_id: String,
    pub source_revision: u64,
    pub source_created_at: String,
    pub state: String,
    pub record_count: u64,
    pub create_count: u64,
    pub update_count: u64,
    pub unchanged_count: u64,
    pub delete_count: u64,
    pub conflict_count: u64,
    pub records: Vec<ChangePackageRecordReviewDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangePackageResolutionInput {
    pub entity_kind: String,
    pub entity_id: String,
    pub resolution: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotIdentity<'a> {
    schema_version: u32,
    mode: &'a str,
    source_installation_id: &'a str,
    source_principal_id: &'a str,
    source_revision: u64,
    household_id: &'a str,
    created_at: &'a str,
    covered_kinds: &'a [String],
    counts_by_kind: &'a BTreeMap<String, u64>,
    records: &'a [ChangePackageRecordDto],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DashboardPreferencesV4Payload {
    record_kind: String,
    household_id: String,
    dashboard_template: String,
    theme: String,
    density: String,
    template_layouts: Vec<DashboardTemplateLayoutV4Payload>,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DashboardTemplateLayoutV4Payload {
    dashboard_template: String,
    widget_order: Vec<String>,
    hidden_widgets: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecurringSeriesPreferencesV5Payload {
    record_kind: String,
    household_id: String,
    preferences: Vec<RecurringSeriesPreferenceV5Payload>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecurringSeriesPreferenceV5Payload {
    normalized_payee: String,
    decision: String,
}

const DASHBOARD_TEMPLATES: [&str; 5] = [
    "FINANCIAL_OVERVIEW",
    "HOUSEHOLD_LEDGER",
    "ASSETS_LIABILITIES",
    "CARD_RECONCILIATION",
    "CASH_FLOW",
];
const DASHBOARD_WIDGETS: [&str; 4] = ["TREND", "SPENDING", "RECENT", "CARDS"];

fn valid_dashboard_preferences_v4(payload: &Value, household_id: &str) -> bool {
    let Ok(payload) = serde_json::from_value::<DashboardPreferencesV4Payload>(payload.clone())
    else {
        return false;
    };
    if payload.record_kind != "DASHBOARD_PREFERENCES"
        || payload.household_id != household_id
        || !DASHBOARD_TEMPLATES.contains(&payload.dashboard_template.as_str())
        || !matches!(payload.theme.as_str(), "SYSTEM" | "LIGHT" | "DARK")
        || !matches!(payload.density.as_str(), "COMFORTABLE" | "COMPACT")
        || payload.created_at.is_empty()
        || payload.updated_at.is_empty()
        || payload.template_layouts.len() != DASHBOARD_TEMPLATES.len()
    {
        return false;
    }
    for (index, layout) in payload.template_layouts.iter().enumerate() {
        if layout.dashboard_template != DASHBOARD_TEMPLATES[index]
            || layout.widget_order.len() != DASHBOARD_WIDGETS.len()
            || layout
                .widget_order
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
                != DASHBOARD_WIDGETS.into_iter().collect::<BTreeSet<_>>()
        {
            return false;
        }
        let eligible = if layout.dashboard_template == "CASH_FLOW" {
            ["TREND", "RECENT", "CARDS"].as_slice()
        } else {
            DASHBOARD_WIDGETS.as_slice()
        };
        let hidden = layout
            .hidden_widgets
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        if hidden.len() != layout.hidden_widgets.len()
            || hidden.len() >= eligible.len()
            || !hidden.iter().all(|widget| eligible.contains(widget))
        {
            return false;
        }
    }
    true
}

pub(crate) fn valid_recurring_series_preferences_v5(payload: &Value, household_id: &str) -> bool {
    let Ok(payload) =
        serde_json::from_value::<RecurringSeriesPreferencesV5Payload>(payload.clone())
    else {
        return false;
    };
    if payload.record_kind != "RECURRING_SERIES_PREFERENCES"
        || payload.household_id != household_id
        || payload.preferences.len() > MAX_RECURRING_SERIES_PREFERENCES
    {
        return false;
    }
    let mut payees = BTreeSet::new();
    let mut previous_payee: Option<&str> = None;
    payload.preferences.iter().all(|preference| {
        let ordered =
            previous_payee.is_none_or(|previous| previous < preference.normalized_payee.as_str());
        previous_payee = Some(preference.normalized_payee.as_str());
        ordered
            && !preference.normalized_payee.is_empty()
            && preference.normalized_payee.len() <= 512
            && !preference.normalized_payee.chars().any(char::is_control)
            && crate::recurring_analytics::normalize_payee(&preference.normalized_payee)
                == preference.normalized_payee
            && matches!(preference.decision.as_str(), "CONFIRMED" | "IGNORED")
            && payees.insert(preference.normalized_payee.as_str())
    })
}

pub fn export_current_state(
    connection: &Connection,
    household_id: &str,
) -> Result<LocalChangePackageDto> {
    build_current_state(connection, household_id, true, PACKAGE_SCHEMA_VERSION)
}

fn current_state_for_comparison(
    connection: &Connection,
    household_id: &str,
    schema_version: u32,
) -> Result<LocalChangePackageDto> {
    build_current_state(connection, household_id, false, schema_version)
}

fn build_current_state(
    connection: &Connection,
    household_id: &str,
    allocate_revision: bool,
    schema_version: u32,
) -> Result<LocalChangePackageDto> {
    if household_id.is_empty() || household_id.len() > 128 {
        return Err(ChangePackageError::InvalidInput);
    }
    let status =
        get_local_status(connection, household_id).map_err(|_| ChangePackageError::NotFound)?;
    let transaction = connection.unchecked_transaction()?;
    let exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM households WHERE id=?1)",
        [household_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(ChangePackageError::NotFound);
    }

    if allocate_revision {
        transaction.execute(
            "UPDATE local_change_package_revisions SET revision=revision+1,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1",
            [household_id],
        )?;
    }
    let source_revision: i64 = transaction.query_row(
        "SELECT revision FROM local_change_package_revisions WHERE household_id=?1",
        [household_id],
        |row| row.get(0),
    )?;
    let created_at: String = transaction.query_row(
        "SELECT CASE WHEN ?2 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now')
                     ELSE updated_at END
         FROM households WHERE id=?1",
        params![household_id, allocate_revision],
        |row| row.get(0),
    )?;

    let mut records = Vec::new();
    push_query_records(
        &transaction,
        &mut records,
        "HOUSEHOLD",
        "SELECT id,json(json_object(
           'recordKind','HOUSEHOLD','id',id,'name',name,'baseCurrency',base_currency,
           'createdAt',created_at,'updatedAt',updated_at))
         FROM households WHERE id=?1",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "RECURRING_SERIES_PREFERENCES",
        "SELECT household_id,payload_json FROM sync_recurring_series_preferences_payloads
         WHERE household_id=?1",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "HOUSEHOLD_MEMBER",
        "SELECT id,json(json_object(
           'recordKind','HOUSEHOLD_MEMBER','displayName',display_name,
           'householdId',household_id,'id',id,'relationshipLabel',relationship_label,
           'sortOrder',sort_order,'status',status,'createdAt',created_at,'updatedAt',updated_at))
         FROM household_members WHERE household_id=?1 ORDER BY sort_order,id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "ACCOUNT",
        "SELECT id,json(json_object(
           'recordKind','ACCOUNT','accountKind',account_kind,'accountSubtype',account_subtype,
           'householdId',household_id,'id',id,'name',name,'currency',currency,
           'institutionName',institution_name,'maskedIdentifier',masked_identifier,
           'isArchived',is_archived,'ownerMemberId',owner_member_id,
           'ownershipKind',ownership_kind,'visibility',visibility,
           'createdAt',created_at,'updatedAt',updated_at))
         FROM accounts WHERE household_id=?1 ORDER BY id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "TRANSACTION",
        "SELECT transaction_id,payload_json FROM sync_transaction_aggregate_payloads
         WHERE household_id=?1 ORDER BY transaction_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "CARD_STATEMENT",
        "SELECT statement_id,payload_json FROM sync_card_statement_aggregate_payloads
         WHERE household_id=?1 ORDER BY statement_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "CARD_PAYMENT",
        "SELECT payment_id,payload_json FROM sync_card_payment_payloads
         WHERE household_id=?1 ORDER BY payment_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "PORTFOLIO_SNAPSHOT",
        "SELECT snapshot_id,payload_json FROM sync_portfolio_snapshot_payloads
         WHERE household_id=?1 ORDER BY snapshot_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "BROKERAGE_EVENT",
        "SELECT event_id,payload_json FROM sync_brokerage_event_payloads
         WHERE household_id=?1 ORDER BY event_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "INVESTMENT_FX_RATE",
        "SELECT rate_id,payload_json FROM sync_investment_fx_rate_payloads
         WHERE household_id=?1 ORDER BY rate_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "INVESTMENT_MARKET_PRICE",
        "SELECT price_id,payload_json FROM sync_investment_market_price_payloads
         WHERE household_id=?1 ORDER BY price_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "AGGREGATE_ASSET_SNAPSHOT",
        "SELECT snapshot_id,payload_json FROM sync_aggregate_asset_snapshot_payloads
         WHERE household_id=?1 ORDER BY snapshot_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "MONTHLY_BUDGET_PLAN",
        "SELECT household_id,payload_json FROM sync_monthly_budget_plan_payloads
         WHERE household_id=?1",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "SAVINGS_GOAL",
        "SELECT id,json(json_object(
           'recordKind','SAVINGS_GOAL','id',id,'householdId',household_id,'name',name,
           'targetJpy',target_jpy,'savedJpy',saved_jpy,'targetDate',target_date,
           'status',status,'createdAt',created_at,'updatedAt',updated_at))
         FROM savings_goals WHERE household_id=?1 ORDER BY id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "CLASSIFICATION_RULE",
        "SELECT rule_id,payload_json FROM sync_classification_rule_payloads
         WHERE household_id=?1 ORDER BY rule_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "ACCOUNT_GROUP",
        "SELECT group_id,payload_json FROM sync_account_group_payloads
         WHERE household_id=?1 ORDER BY group_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "CARD_SETTLEMENT_MAPPING",
        "SELECT card_account_id,json(json_object(
           'recordKind','CARD_SETTLEMENT_MAPPING','householdId',household_id,
           'cardAccountId',card_account_id,'bankAccountId',bank_account_id,
           'createdAt',created_at,'updatedAt',updated_at))
         FROM card_settlement_bank_mappings WHERE household_id=?1 ORDER BY card_account_id",
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "DASHBOARD_PREFERENCES",
        if schema_version >= 4 {
            "SELECT household_id,payload_json FROM sync_dashboard_preferences_v4_payloads
             WHERE household_id=?1"
        } else {
            "SELECT household_id,json(json_object(
               'recordKind','DASHBOARD_PREFERENCES','householdId',household_id,
               'dashboardTemplate',dashboard_template,'theme',theme,'density',density,
               'createdAt',created_at,'updatedAt',updated_at))
             FROM dashboard_preferences WHERE household_id=?1"
        },
        household_id,
    )?;
    push_query_records(
        &transaction,
        &mut records,
        "DELIMITED_PARSER_PROFILE",
        "SELECT profile_id,payload_json FROM sync_parser_profile_payloads
         WHERE household_id=?1 ORDER BY profile_id",
        household_id,
    )?;

    let covered_kind_slice =
        covered_kinds_for(schema_version).ok_or(ChangePackageError::InvalidInput)?;
    records.retain(|record| covered_kind_slice.contains(&record.entity_kind.as_str()));
    if records.len() > MAX_PACKAGE_RECORDS {
        return Err(ChangePackageError::LimitExceeded);
    }
    let identities = records
        .iter()
        .map(|record| (&record.entity_kind, &record.entity_id))
        .collect::<BTreeSet<_>>();
    if identities.len() != records.len() {
        return Err(ChangePackageError::Encoding);
    }
    let covered_kinds = covered_kind_slice
        .iter()
        .map(|kind| (*kind).to_owned())
        .collect::<Vec<_>>();
    let mut counts_by_kind = covered_kinds
        .iter()
        .map(|kind| (kind.clone(), 0_u64))
        .collect::<BTreeMap<_, _>>();
    for record in &records {
        *counts_by_kind
            .get_mut(&record.entity_kind)
            .ok_or(ChangePackageError::Encoding)? += 1;
    }
    if counts_by_kind.get("HOUSEHOLD") != Some(&1)
        || counts_by_kind.get("MONTHLY_BUDGET_PLAN") != Some(&1)
        || (schema_version >= 5 && counts_by_kind.get("RECURRING_SERIES_PREFERENCES") != Some(&1))
    {
        return Err(ChangePackageError::Encoding);
    }
    let source_revision =
        u64::try_from(source_revision).map_err(|_| ChangePackageError::Encoding)?;
    let identity = SnapshotIdentity {
        schema_version,
        mode: PACKAGE_MODE,
        source_installation_id: &status.device.id,
        source_principal_id: &status.principal.id,
        source_revision,
        household_id,
        created_at: &created_at,
        covered_kinds: &covered_kinds,
        counts_by_kind: &counts_by_kind,
        records: &records,
    };
    let identity_value =
        serde_json::to_value(&identity).map_err(|_| ChangePackageError::Encoding)?;
    let canonical_identity =
        canonical_json(&identity_value).map_err(|_| ChangePackageError::Encoding)?;
    let snapshot_sha256 = sha256_hex(canonical_identity.as_bytes());
    let package_id = format!("change-package-{snapshot_sha256}");
    let package_value = json!({
        "packageId": package_id,
        "schemaVersion": schema_version,
        "mode": PACKAGE_MODE,
        "sourceInstallationId": status.device.id,
        "sourcePrincipalId": status.principal.id,
        "sourceRevision": source_revision,
        "householdId": household_id,
        "createdAt": created_at,
        "coveredKinds": covered_kinds,
        "countsByKind": counts_by_kind,
        "snapshotSha256": snapshot_sha256,
        "records": records,
    });
    let canonical_package =
        canonical_json(&package_value).map_err(|_| ChangePackageError::Encoding)?;
    let package_sha256 = sha256_hex(canonical_package.as_bytes());
    transaction.commit()?;
    Ok(LocalChangePackageDto {
        package_id,
        schema_version,
        mode: PACKAGE_MODE.to_owned(),
        source_installation_id: status.device.id,
        source_principal_id: status.principal.id,
        source_revision,
        household_id: household_id.to_owned(),
        created_at,
        covered_kinds,
        counts_by_kind,
        snapshot_sha256,
        package_sha256,
        records,
    })
}

pub fn encode_pretty(package: &LocalChangePackageDto) -> Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(package).map_err(|_| ChangePackageError::Encoding)?;
    bytes.push(b'\n');
    Ok(bytes)
}

pub fn decode_and_validate(bytes: &[u8]) -> Result<LocalChangePackageDto> {
    let package: LocalChangePackageDto =
        serde_json::from_slice(bytes).map_err(|_| ChangePackageError::InvalidInput)?;
    validate_package(&package)?;
    Ok(package)
}

pub fn validate_package(package: &LocalChangePackageDto) -> Result<()> {
    if !matches!(
        package.schema_version,
        1 | 2 | 3 | 4 | PACKAGE_SCHEMA_VERSION
    ) || package.mode != PACKAGE_MODE
        || package.source_installation_id.is_empty()
        || package.source_installation_id.len() > 128
        || package.source_principal_id.is_empty()
        || package.source_principal_id.len() > 128
        || package.household_id.is_empty()
        || package.household_id.len() > 128
        || package.source_revision == 0
        || package.records.len() > MAX_PACKAGE_RECORDS
    {
        return Err(ChangePackageError::InvalidInput);
    }
    let expected_kind_slice =
        covered_kinds_for(package.schema_version).ok_or(ChangePackageError::InvalidInput)?;
    let expected_kinds = expected_kind_slice
        .iter()
        .map(|kind| (*kind).to_owned())
        .collect::<Vec<_>>();
    if package.covered_kinds != expected_kinds
        || package.counts_by_kind.len() != expected_kind_slice.len()
    {
        return Err(ChangePackageError::InvalidInput);
    }
    let mut actual_counts = expected_kind_slice
        .iter()
        .map(|kind| ((*kind).to_owned(), 0_u64))
        .collect::<BTreeMap<_, _>>();
    let mut identities = BTreeSet::new();
    for record in &package.records {
        if record.operation != "UPSERT"
            || record.entity_id.is_empty()
            || record.entity_id.len() > 128
            || !actual_counts.contains_key(&record.entity_kind)
            || !identities.insert((record.entity_kind.as_str(), record.entity_id.as_str()))
        {
            return Err(ChangePackageError::InvalidInput);
        }
        let payload: Value = serde_json::from_str(&record.canonical_payload_json)
            .map_err(|_| ChangePackageError::InvalidInput)?;
        let canonical = canonical_json(&payload).map_err(|_| ChangePackageError::InvalidInput)?;
        if canonical != record.canonical_payload_json
            || sha256_hex(canonical.as_bytes()) != record.payload_sha256
            || !payload_identity_matches(record, &payload, &package.household_id)
            || (package.schema_version >= 4
                && record.entity_kind == "DASHBOARD_PREFERENCES"
                && !valid_dashboard_preferences_v4(&payload, &package.household_id))
            || (package.schema_version >= 5
                && record.entity_kind == "RECURRING_SERIES_PREFERENCES"
                && !valid_recurring_series_preferences_v5(&payload, &package.household_id))
        {
            return Err(ChangePackageError::InvalidInput);
        }
        *actual_counts
            .get_mut(&record.entity_kind)
            .ok_or(ChangePackageError::InvalidInput)? += 1;
    }
    if actual_counts != package.counts_by_kind
        || actual_counts.get("HOUSEHOLD") != Some(&1)
        || actual_counts.get("MONTHLY_BUDGET_PLAN") != Some(&1)
        || (package.schema_version >= 5
            && actual_counts.get("RECURRING_SERIES_PREFERENCES") != Some(&1))
    {
        return Err(ChangePackageError::InvalidInput);
    }
    let identity = SnapshotIdentity {
        schema_version: package.schema_version,
        mode: &package.mode,
        source_installation_id: &package.source_installation_id,
        source_principal_id: &package.source_principal_id,
        source_revision: package.source_revision,
        household_id: &package.household_id,
        created_at: &package.created_at,
        covered_kinds: &package.covered_kinds,
        counts_by_kind: &package.counts_by_kind,
        records: &package.records,
    };
    let identity_value =
        serde_json::to_value(&identity).map_err(|_| ChangePackageError::Encoding)?;
    let canonical_identity =
        canonical_json(&identity_value).map_err(|_| ChangePackageError::Encoding)?;
    let snapshot_sha256 = sha256_hex(canonical_identity.as_bytes());
    if snapshot_sha256 != package.snapshot_sha256
        || package.package_id != format!("change-package-{snapshot_sha256}")
    {
        return Err(ChangePackageError::InvalidInput);
    }
    let package_value = json!({
        "packageId": package.package_id,
        "schemaVersion": package.schema_version,
        "mode": package.mode,
        "sourceInstallationId": package.source_installation_id,
        "sourcePrincipalId": package.source_principal_id,
        "sourceRevision": package.source_revision,
        "householdId": package.household_id,
        "createdAt": package.created_at,
        "coveredKinds": package.covered_kinds,
        "countsByKind": package.counts_by_kind,
        "snapshotSha256": package.snapshot_sha256,
        "records": package.records,
    });
    let canonical_package =
        canonical_json(&package_value).map_err(|_| ChangePackageError::Encoding)?;
    if sha256_hex(canonical_package.as_bytes()) != package.package_sha256 {
        return Err(ChangePackageError::InvalidInput);
    }
    Ok(())
}

pub fn stage_package(
    connection: &Connection,
    target_household_id: &str,
    bytes: &[u8],
) -> Result<ChangePackageReviewDto> {
    let package = decode_and_validate(bytes)?;
    if package.household_id != target_household_id {
        return Err(ChangePackageError::InvalidInput);
    }
    if let Some(existing) = load_package_by_id(connection, &package.package_id)? {
        let stored_hash: String = connection.query_row(
            "SELECT package_sha256 FROM change_packages WHERE package_id=?1",
            [&package.package_id],
            |row| row.get(0),
        )?;
        if stored_hash != package.package_sha256 {
            return Err(ChangePackageError::Conflict);
        }
        if existing.state != "REJECTED" {
            return Ok(existing);
        }
        connection.execute(
            "DELETE FROM change_packages WHERE package_id=?1 AND state='REJECTED'",
            [&package.package_id],
        )?;
    }
    let active: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM change_packages
         WHERE target_household_id=?1 AND state IN ('STAGED','REVIEW_REQUIRED','READY'))",
        [target_household_id],
        |row| row.get(0),
    )?;
    if active {
        return Err(ChangePackageError::ReviewPending);
    }

    let current =
        current_state_for_comparison(connection, target_household_id, package.schema_version)?;
    if current.source_installation_id == package.source_installation_id {
        return Err(ChangePackageError::InvalidInput);
    }
    let latest_source: Option<(i64, String)> = connection
        .query_row(
            "SELECT source_revision,snapshot_sha256 FROM applied_change_packages
             WHERE household_id=?1 AND source_installation_id=?2
             ORDER BY source_revision DESC LIMIT 1",
            params![target_household_id, package.source_installation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((revision, digest)) = latest_source {
        let incoming =
            i64::try_from(package.source_revision).map_err(|_| ChangePackageError::InvalidInput)?;
        if incoming < revision {
            return Err(ChangePackageError::Stale);
        }
        if incoming == revision {
            return if digest == package.snapshot_sha256 {
                Err(ChangePackageError::Stale)
            } else {
                Err(ChangePackageError::Conflict)
            };
        }
    }

    let current_records = current
        .records
        .into_iter()
        .map(|record| {
            (
                (record.entity_kind.clone(), record.entity_id.clone()),
                record,
            )
        })
        .collect::<BTreeMap<_, _>>();
    let incoming_keys = package
        .records
        .iter()
        .map(|record| (record.entity_kind.clone(), record.entity_id.clone()))
        .collect::<BTreeSet<_>>();
    let heads = load_replica_heads(connection, target_household_id)?;
    let mut actions = Vec::new();
    for record in &package.records {
        if entity_belongs_to_other_household(
            connection,
            &record.entity_kind,
            &record.entity_id,
            target_household_id,
        )? {
            return Err(ChangePackageError::Conflict);
        }
        let key = (record.entity_kind.clone(), record.entity_id.clone());
        let current_record = current_records.get(&key);
        let head = heads.get(&key);
        let (review_state, resolution, current_hash, conflict_reason) = match current_record {
            None => ("CREATE", "APPLY_INCOMING", None, None),
            Some(current_record) if current_record.payload_sha256 == record.payload_sha256 => (
                "UNCHANGED",
                "SKIP",
                Some(current_record.payload_sha256.clone()),
                None,
            ),
            Some(current_record)
                if head.is_some_and(|head| {
                    head.source_installation_id == package.source_installation_id
                        && head.payload_sha256 == current_record.payload_sha256
                }) =>
            {
                (
                    "UPDATE",
                    "APPLY_INCOMING",
                    Some(current_record.payload_sha256.clone()),
                    None,
                )
            }
            Some(current_record) => (
                "CONFLICT",
                "PENDING",
                Some(current_record.payload_sha256.clone()),
                Some(if head.is_some() {
                    "LOCAL_DIVERGENCE"
                } else {
                    "SAME_ID_DIFFERENT_CONTENT"
                }),
            ),
        };
        actions.push(StagedAction {
            entity_kind: record.entity_kind.clone(),
            entity_id: record.entity_id.clone(),
            operation: "UPSERT".to_owned(),
            canonical_payload_json: record.canonical_payload_json.clone(),
            payload_sha256: record.payload_sha256.clone(),
            review_state: review_state.to_owned(),
            resolution: resolution.to_owned(),
            current_payload_sha256: current_hash,
            conflict_reason: conflict_reason.map(str::to_owned),
        });
    }
    for (key, current_record) in &current_records {
        if incoming_keys.contains(key)
            || !package.covered_kinds.iter().any(|kind| kind == &key.0)
            || !kind_supports_absence_delete(&key.0)
        {
            continue;
        }
        let head = heads.get(key);
        let (review_state, reason) = if head.is_some_and(|head| {
            head.source_installation_id == package.source_installation_id
                && head.payload_sha256 == current_record.payload_sha256
        }) {
            ("DELETE", None)
        } else if head.is_some() {
            ("CONFLICT", Some("LOCAL_DIVERGENCE"))
        } else {
            ("DELETE", None)
        };
        actions.push(StagedAction {
            entity_kind: key.0.clone(),
            entity_id: key.1.clone(),
            operation: "DELETE".to_owned(),
            canonical_payload_json: current_record.canonical_payload_json.clone(),
            payload_sha256: current_record.payload_sha256.clone(),
            review_state: review_state.to_owned(),
            resolution: "PENDING".to_owned(),
            current_payload_sha256: Some(current_record.payload_sha256.clone()),
            conflict_reason: reason.map(str::to_owned),
        });
    }
    actions.sort_by(|left, right| {
        dependency_rank(&left.entity_kind)
            .cmp(&dependency_rank(&right.entity_kind))
            .then_with(|| left.entity_id.cmp(&right.entity_id))
            .then_with(|| left.operation.cmp(&right.operation))
    });
    if actions.len() > MAX_PACKAGE_RECORDS {
        return Err(ChangePackageError::LimitExceeded);
    }

    let counts = ActionCounts::from_actions(&actions);
    let state = if counts.conflict_count > 0 || counts.delete_count > 0 {
        "REVIEW_REQUIRED"
    } else {
        "READY"
    };
    let reviewed_at = (state == "READY").then_some("strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    let manifest = serde_json::to_value(&package).map_err(|_| ChangePackageError::Encoding)?;
    let manifest_json = canonical_json(&manifest).map_err(|_| ChangePackageError::Encoding)?;
    let transaction = connection.unchecked_transaction()?;
    transaction.execute(
        &format!(
            "INSERT INTO change_packages(
               package_id,schema_version,target_household_id,source_installation_id,
               source_principal_id,source_revision,snapshot_sha256,manifest_json,package_sha256,
               state,record_count,create_count,update_count,unchanged_count,delete_count,
               conflict_count,source_created_at,reviewed_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,{})",
            reviewed_at.unwrap_or("NULL")
        ),
        params![
            package.package_id,
            package.schema_version,
            target_household_id,
            package.source_installation_id,
            package.source_principal_id,
            package.source_revision,
            package.snapshot_sha256,
            manifest_json,
            package.package_sha256,
            state,
            counts.total(),
            counts.create_count,
            counts.update_count,
            counts.unchanged_count,
            counts.delete_count,
            counts.conflict_count,
            package.created_at,
        ],
    )?;
    for (index, action) in actions.iter().enumerate() {
        transaction.execute(
            "INSERT INTO change_package_records(
               package_id,record_order,entity_kind,entity_id,operation,
               canonical_payload_json,payload_sha256,review_state,resolution,
               current_payload_sha256,conflict_reason)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                package.package_id,
                i64::try_from(index).map_err(|_| ChangePackageError::LimitExceeded)?,
                action.entity_kind,
                action.entity_id,
                action.operation,
                action.canonical_payload_json,
                action.payload_sha256,
                action.review_state,
                action.resolution,
                action.current_payload_sha256,
                action.conflict_reason,
            ],
        )?;
    }
    transaction.commit()?;
    load_package_by_id(connection, &package.package_id)?.ok_or(ChangePackageError::NotFound)
}

pub fn resolve_package(
    connection: &Connection,
    package_id: &str,
    resolutions: &[ChangePackageResolutionInput],
) -> Result<ChangePackageReviewDto> {
    if resolutions.is_empty() {
        return Err(ChangePackageError::InvalidInput);
    }
    let transaction = connection.unchecked_transaction()?;
    let state: String = transaction
        .query_row(
            "SELECT state FROM change_packages WHERE package_id=?1",
            [package_id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(ChangePackageError::NotFound)?;
    if !matches!(state.as_str(), "STAGED" | "REVIEW_REQUIRED") {
        return Err(ChangePackageError::InvalidInput);
    }
    let mut seen = BTreeSet::new();
    for resolution in resolutions {
        if !matches!(
            resolution.resolution.as_str(),
            "APPLY_INCOMING" | "KEEP_LOCAL"
        ) || !seen.insert((&resolution.entity_kind, &resolution.entity_id))
        {
            return Err(ChangePackageError::InvalidInput);
        }
        let changed = transaction.execute(
            "UPDATE change_package_records SET resolution=?1
             WHERE package_id=?2 AND entity_kind=?3 AND entity_id=?4
               AND review_state IN ('DELETE','CONFLICT') AND resolution='PENDING'",
            params![
                resolution.resolution,
                package_id,
                resolution.entity_kind,
                resolution.entity_id
            ],
        )?;
        if changed != 1 {
            return Err(ChangePackageError::InvalidInput);
        }
    }
    let pending: i64 = transaction.query_row(
        "SELECT count(*) FROM change_package_records
         WHERE package_id=?1 AND resolution='PENDING'",
        [package_id],
        |row| row.get(0),
    )?;
    transaction.execute(
        "UPDATE change_packages SET state=?1,
           reviewed_at=CASE WHEN ?1='READY' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE reviewed_at END,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE package_id=?2",
        params![if pending == 0 { "READY" } else { "REVIEW_REQUIRED" }, package_id],
    )?;
    transaction.commit()?;
    load_package_by_id(connection, package_id)?.ok_or(ChangePackageError::NotFound)
}

pub fn discard_package(connection: &Connection, package_id: &str) -> Result<()> {
    let affected = connection.execute(
        "UPDATE change_packages SET state='REJECTED',
           reviewed_at=COALESCE(reviewed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE package_id=?1 AND state IN ('STAGED','REVIEW_REQUIRED','READY')",
        [package_id],
    )?;
    if affected == 1 {
        Ok(())
    } else {
        Err(ChangePackageError::NotFound)
    }
}

pub fn get_active_review(
    connection: &Connection,
    household_id: &str,
) -> Result<Option<ChangePackageReviewDto>> {
    let package_id = connection
        .query_row(
            "SELECT package_id FROM change_packages
             WHERE target_household_id=?1 AND state IN ('STAGED','REVIEW_REQUIRED','READY')
             ORDER BY staged_at DESC LIMIT 1",
            [household_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    package_id
        .map(|package_id| load_package_by_id(connection, &package_id))
        .transpose()
        .map(Option::flatten)
}

pub fn apply_package(connection: &Connection, package_id: &str) -> Result<ChangePackageReviewDto> {
    let review = load_package_by_id(connection, package_id)?.ok_or(ChangePackageError::NotFound)?;
    if review.state == "APPLIED" {
        return Ok(review);
    }
    if review.state != "READY"
        || review
            .records
            .iter()
            .any(|record| record.resolution == "PENDING")
    {
        return Err(ChangePackageError::ReviewPending);
    }

    let manifest_json: String = connection.query_row(
        "SELECT manifest_json FROM change_packages WHERE package_id=?1",
        [package_id],
        |row| row.get(0),
    )?;
    let package: LocalChangePackageDto =
        serde_json::from_str(&manifest_json).map_err(|_| ChangePackageError::Encoding)?;
    validate_package(&package)?;

    // Re-read the destination immediately before opening the write transaction.
    // Production calls serialize access through AppState's connection mutex.
    let current = current_state_for_comparison(
        connection,
        &review.target_household_id,
        package.schema_version,
    )?;
    let current_hashes = current
        .records
        .into_iter()
        .map(|record| {
            (
                (record.entity_kind, record.entity_id),
                record.payload_sha256,
            )
        })
        .collect::<BTreeMap<_, _>>();
    for record in &review.records {
        if record.resolution == "KEEP_LOCAL" {
            continue;
        }
        let current_hash =
            current_hashes.get(&(record.entity_kind.clone(), record.entity_id.clone()));
        if current_hash != record.current_payload_sha256.as_ref() {
            return Err(ChangePackageError::Conflict);
        }
    }

    let transaction = connection.unchecked_transaction()?;
    let already_applied: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM applied_change_packages WHERE package_id=?1)",
        [package_id],
        |row| row.get(0),
    )?;
    if already_applied {
        transaction.commit()?;
        return load_package_by_id(connection, package_id)?.ok_or(ChangePackageError::NotFound);
    }
    transaction.execute(
        "INSERT INTO sync_apply_guard(household_id,package_id) VALUES(?1,?2)",
        params![review.target_household_id, package_id],
    )?;

    // Confirmed payment rows are intentionally immutable during ordinary use.
    // Package replacement is validated and atomic, so remove every accepted
    // payment target before inserting the incoming graph.
    for record in review.records.iter().filter(|record| {
        record.resolution == "APPLY_INCOMING" && record.entity_kind == "CARD_PAYMENT"
    }) {
        transaction.execute(
            "DELETE FROM card_payments WHERE household_id=?1 AND id=?2",
            params![review.target_household_id, record.entity_id],
        )?;
    }

    for record in review
        .records
        .iter()
        .filter(|record| record.resolution == "APPLY_INCOMING" && record.operation == "UPSERT")
    {
        materialize_upsert(
            &transaction,
            &record.entity_kind,
            &record.canonical_payload_json,
            package.schema_version,
        )?;
    }
    for record in review
        .records
        .iter()
        .rev()
        .filter(|record| record.resolution == "APPLY_INCOMING" && record.operation == "DELETE")
    {
        materialize_delete(
            &transaction,
            &review.target_household_id,
            &record.entity_kind,
            &record.entity_id,
            package.schema_version,
        )?;
    }

    validate_card_reconciliation_graph(&transaction, &review.target_household_id)?;
    validate_investment_graph(&transaction, &review.target_household_id)?;

    for record in review
        .records
        .iter()
        .filter(|record| record.resolution == "APPLY_INCOMING")
    {
        let actual = load_entity_payload(
            &transaction,
            &review.target_household_id,
            &record.entity_kind,
            &record.entity_id,
            package.schema_version,
        )?;
        match record.operation.as_str() {
            "UPSERT" => {
                let actual = actual.ok_or(ChangePackageError::Conflict)?;
                let value: Value =
                    serde_json::from_str(&actual).map_err(|_| ChangePackageError::Encoding)?;
                let canonical = canonical_json(&value).map_err(|_| ChangePackageError::Encoding)?;
                if sha256_hex(canonical.as_bytes()) != record.payload_sha256 {
                    return Err(ChangePackageError::Conflict);
                }
            }
            "DELETE" if actual.is_some() => return Err(ChangePackageError::Conflict),
            "DELETE" => {}
            _ => return Err(ChangePackageError::InvalidInput),
        }
    }

    for record in &review.records {
        if matches!(record.resolution.as_str(), "APPLY_INCOMING" | "SKIP") {
            transaction.execute(
                "INSERT INTO sync_replica_entity_heads(
                   household_id,entity_kind,entity_id,source_installation_id,
                   package_id,source_revision,operation,payload_sha256)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
                 ON CONFLICT(household_id,entity_kind,entity_id) DO UPDATE SET
                   source_installation_id=excluded.source_installation_id,
                   package_id=excluded.package_id,
                   source_revision=excluded.source_revision,operation=excluded.operation,
                   payload_sha256=excluded.payload_sha256,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                params![
                    review.target_household_id,
                    record.entity_kind,
                    record.entity_id,
                    review.source_installation_id,
                    package_id,
                    review.source_revision,
                    record.operation,
                    record.payload_sha256,
                ],
            )?;
        }
    }
    transaction.execute(
        "INSERT INTO applied_change_packages(
           package_id,household_id,source_installation_id,source_revision,snapshot_sha256)
         VALUES(?1,?2,?3,?4,?5)",
        params![
            package_id,
            review.target_household_id,
            review.source_installation_id,
            review.source_revision,
            package.snapshot_sha256,
        ],
    )?;
    let guard_removed = transaction.execute(
        "DELETE FROM sync_apply_guard WHERE household_id=?1 AND package_id=?2",
        params![review.target_household_id, package_id],
    )?;
    if guard_removed != 1 {
        return Err(ChangePackageError::Conflict);
    }
    transaction.execute(
        "UPDATE change_packages SET state='APPLIED',
           applied_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE package_id=?1",
        [package_id],
    )?;
    transaction.commit()?;
    load_package_by_id(connection, package_id)?.ok_or(ChangePackageError::NotFound)
}

pub(crate) fn materialize_upsert(
    connection: &Connection,
    kind: &str,
    payload: &str,
    schema_version: u32,
) -> Result<()> {
    match kind {
        "HOUSEHOLD" => {
            connection.execute(
                "INSERT INTO households(id,name,base_currency,created_at,updated_at)
             VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.name'),
                    json_extract(?1,'$.baseCurrency'),json_extract(?1,'$.createdAt'),
                    json_extract(?1,'$.updatedAt'))
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,
               base_currency=excluded.base_currency,created_at=excluded.created_at,
               updated_at=excluded.updated_at",
                [payload],
            )?;
        }
        "HOUSEHOLD_MEMBER" => {
            connection.execute(
            "INSERT INTO household_members(
               id,household_id,display_name,relationship_label,status,sort_order,created_at,updated_at)
             VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
               json_extract(?1,'$.displayName'),json_extract(?1,'$.relationshipLabel'),
               json_extract(?1,'$.status'),json_extract(?1,'$.sortOrder'),
               json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
             ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,
               relationship_label=excluded.relationship_label,status=excluded.status,
               sort_order=excluded.sort_order,created_at=excluded.created_at,
               updated_at=excluded.updated_at",
            [payload],
            )?;
        }
        "ACCOUNT" => {
            connection.execute(
            "INSERT INTO accounts(
               id,household_id,name,account_kind,account_subtype,currency,institution_name,
               masked_identifier,is_archived,owner_member_id,ownership_kind,visibility,
               created_at,updated_at)
             VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
               json_extract(?1,'$.name'),json_extract(?1,'$.accountKind'),
               json_extract(?1,'$.accountSubtype'),json_extract(?1,'$.currency'),
               json_extract(?1,'$.institutionName'),json_extract(?1,'$.maskedIdentifier'),
               json_extract(?1,'$.isArchived'),json_extract(?1,'$.ownerMemberId'),
               json_extract(?1,'$.ownershipKind'),json_extract(?1,'$.visibility'),
               json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,account_kind=excluded.account_kind,
               account_subtype=excluded.account_subtype,currency=excluded.currency,
               institution_name=excluded.institution_name,masked_identifier=excluded.masked_identifier,
               is_archived=excluded.is_archived,owner_member_id=excluded.owner_member_id,
               ownership_kind=excluded.ownership_kind,visibility=excluded.visibility,
               created_at=excluded.created_at,updated_at=excluded.updated_at",
            [payload],
            )?;
        }
        "TRANSACTION" => materialize_transaction(connection, payload)?,
        "CARD_STATEMENT" => materialize_card_statement(connection, payload)?,
        "CARD_PAYMENT" => materialize_card_payment(connection, payload)?,
        "PORTFOLIO_SNAPSHOT" => materialize_portfolio_snapshot(connection, payload)?,
        "BROKERAGE_EVENT" => materialize_brokerage_event(connection, payload)?,
        "INVESTMENT_FX_RATE" => materialize_investment_fx_rate(connection, payload)?,
        "INVESTMENT_MARKET_PRICE" => materialize_investment_market_price(connection, payload)?,
        "AGGREGATE_ASSET_SNAPSHOT" => materialize_aggregate_asset_snapshot(connection, payload)?,
        "MONTHLY_BUDGET_PLAN" => {
            connection.execute(
                "DELETE FROM monthly_category_budgets WHERE household_id=json_extract(?1,'$.householdId')",
                [payload],
            )?;
            connection.execute(
                "INSERT INTO monthly_category_budgets(
                   household_id,month,category_account_id,budget_jpy,created_at,updated_at)
                 SELECT json_extract(value,'$.householdId'),json_extract(value,'$.month'),
                   json_extract(value,'$.categoryAccountId'),json_extract(value,'$.budgetJpy'),
                   json_extract(value,'$.createdAt'),json_extract(value,'$.updatedAt')
                 FROM json_each(?1,'$.budgets')",
                [payload],
            )?;
        }
        "SAVINGS_GOAL" => {
            connection.execute(
            "INSERT INTO savings_goals(
               id,household_id,name,target_jpy,saved_jpy,target_date,status,created_at,updated_at)
             VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
               json_extract(?1,'$.name'),json_extract(?1,'$.targetJpy'),
               json_extract(?1,'$.savedJpy'),json_extract(?1,'$.targetDate'),
               json_extract(?1,'$.status'),json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,target_jpy=excluded.target_jpy,
               saved_jpy=excluded.saved_jpy,target_date=excluded.target_date,status=excluded.status,
               created_at=excluded.created_at,updated_at=excluded.updated_at",
            [payload],
            )?;
        }
        "CLASSIFICATION_RULE" => materialize_rule(connection, payload)?,
        "ACCOUNT_GROUP" => materialize_group(connection, payload)?,
        "CARD_SETTLEMENT_MAPPING" => {
            connection.execute(
                "INSERT INTO card_settlement_bank_mappings(
               household_id,card_account_id,bank_account_id,created_at,updated_at)
             VALUES(json_extract(?1,'$.householdId'),json_extract(?1,'$.cardAccountId'),
               json_extract(?1,'$.bankAccountId'),json_extract(?1,'$.createdAt'),
               json_extract(?1,'$.updatedAt'))
             ON CONFLICT(household_id,card_account_id) DO UPDATE SET
               bank_account_id=excluded.bank_account_id,created_at=excluded.created_at,
               updated_at=excluded.updated_at",
                [payload],
            )?;
        }
        "DASHBOARD_PREFERENCES" => {
            if schema_version < 4 {
                connection.execute(
                    "INSERT INTO dashboard_preferences(
               household_id,dashboard_template,theme,density,created_at,updated_at)
             VALUES(json_extract(?1,'$.householdId'),json_extract(?1,'$.dashboardTemplate'),
               json_extract(?1,'$.theme'),json_extract(?1,'$.density'),
               json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
             ON CONFLICT(household_id) DO UPDATE SET dashboard_template=excluded.dashboard_template,
               theme=excluded.theme,density=excluded.density,created_at=excluded.created_at,
               updated_at=excluded.updated_at",
                    [payload],
                )?;
            } else {
                connection.execute(
                    "INSERT INTO dashboard_preferences(
                       household_id,dashboard_template,theme,density,widget_order,hidden_widgets,
                       created_at,updated_at)
                     SELECT json_extract(?1,'$.householdId'),json_extract(?1,'$.dashboardTemplate'),
                       json_extract(?1,'$.theme'),json_extract(?1,'$.density'),
                       json_extract(layout.value,'$.widgetOrder'),
                       json_extract(layout.value,'$.hiddenWidgets'),
                       json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt')
                     FROM json_each(?1,'$.templateLayouts') layout
                     WHERE json_extract(layout.value,'$.dashboardTemplate')=
                           json_extract(?1,'$.dashboardTemplate')
                     ON CONFLICT(household_id) DO UPDATE SET
                       dashboard_template=excluded.dashboard_template,theme=excluded.theme,
                       density=excluded.density,widget_order=excluded.widget_order,
                       hidden_widgets=excluded.hidden_widgets,created_at=excluded.created_at,
                       updated_at=excluded.updated_at",
                    [payload],
                )?;
                connection.execute(
                    "DELETE FROM dashboard_template_layouts
                     WHERE household_id=json_extract(?1,'$.householdId')",
                    [payload],
                )?;
                connection.execute(
                    "INSERT INTO dashboard_template_layouts(
                       household_id,dashboard_template,widget_order,hidden_widgets,
                       created_at,updated_at)
                     SELECT json_extract(?1,'$.householdId'),
                       json_extract(layout.value,'$.dashboardTemplate'),
                       json_extract(layout.value,'$.widgetOrder'),
                       json_extract(layout.value,'$.hiddenWidgets'),
                       json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt')
                     FROM json_each(?1,'$.templateLayouts') layout",
                    [payload],
                )?;
            }
        }
        "RECURRING_SERIES_PREFERENCES" => {
            connection.execute(
                "DELETE FROM recurring_series_preferences
                 WHERE household_id=json_extract(?1,'$.householdId')
                   AND normalized_payee NOT IN (
                     SELECT json_extract(value,'$.normalizedPayee')
                     FROM json_each(?1,'$.preferences'))",
                [payload],
            )?;
            connection.execute(
                "INSERT INTO recurring_series_preferences(
                   household_id,normalized_payee,decision)
                 SELECT json_extract(?1,'$.householdId'),
                        json_extract(value,'$.normalizedPayee'),
                        json_extract(value,'$.decision')
                 FROM json_each(?1,'$.preferences') WHERE 1
                 ON CONFLICT(household_id,normalized_payee) DO UPDATE SET
                   decision=excluded.decision,
                   version=recurring_series_preferences.version+1,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                [payload],
            )?;
        }
        "DELIMITED_PARSER_PROFILE" => materialize_parser_profile(connection, payload)?,
        _ => return Err(ChangePackageError::InvalidInput),
    };
    Ok(())
}

fn materialize_transaction(connection: &Connection, payload: &str) -> Result<()> {
    let unrepresented_actual_links: i64 = connection.query_row(
        "SELECT count(*) FROM transaction_sources actual
         WHERE actual.transaction_id=json_extract(?1,'$.id')
           AND NOT EXISTS (
             SELECT 1 FROM json_each(?1,'$.sourceLinks') incoming
             WHERE json_extract(incoming.value,'$.sourceRecordId')=actual.source_record_id
           )",
        [payload],
        |row| row.get(0),
    )?;
    if unrepresented_actual_links != 0 {
        return Err(ChangePackageError::Conflict);
    }
    connection.execute(
        "INSERT INTO transactions(
           id,household_id,occurred_on,posted_on,transaction_type,payee,description,status,
           calculation_target,attribution_kind,attributed_member_id,audience_visibility,
           audience_member_id,created_at,updated_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
           json_extract(?1,'$.occurredOn'),json_extract(?1,'$.postedOn'),
           json_extract(?1,'$.transactionType'),json_extract(?1,'$.payee'),
           json_extract(?1,'$.description'),json_extract(?1,'$.status'),
           json_extract(?1,'$.calculationTarget'),json_extract(?1,'$.attributionKind'),
           json_extract(?1,'$.attributedMemberId'),json_extract(?1,'$.audienceVisibility'),
           json_extract(?1,'$.audienceMemberId'),json_extract(?1,'$.createdAt'),
           json_extract(?1,'$.updatedAt'))
         ON CONFLICT(id) DO UPDATE SET occurred_on=excluded.occurred_on,posted_on=excluded.posted_on,
           transaction_type=excluded.transaction_type,payee=excluded.payee,
           description=excluded.description,status=excluded.status,
           calculation_target=excluded.calculation_target,attribution_kind=excluded.attribution_kind,
           attributed_member_id=excluded.attributed_member_id,
           audience_visibility=excluded.audience_visibility,audience_member_id=excluded.audience_member_id,
           created_at=excluded.created_at,updated_at=excluded.updated_at",
        [payload],
    )?;
    for table in [
        "journal_entries",
        "transaction_labels",
        "transaction_tags",
        "transaction_portable_source_links",
        "transaction_external_keys",
    ] {
        connection.execute(
            &format!("DELETE FROM {table} WHERE transaction_id=json_extract(?1,'$.id')"),
            [payload],
        )?;
    }
    connection.execute(
        "INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number,created_at)
         SELECT json_extract(value,'$.id'),json_extract(value,'$.transactionId'),
           json_extract(value,'$.accountId'),json_extract(value,'$.entrySide'),
           json_extract(value,'$.amountJpy'),json_extract(value,'$.lineNumber'),
           json_extract(value,'$.createdAt') FROM json_each(?1,'$.journalEntries')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO transaction_labels(transaction_id,label)
         SELECT json_extract(?1,'$.id'),value FROM json_each(?1,'$.labels')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO transaction_tags(transaction_id,tag)
         SELECT json_extract(?1,'$.id'),value FROM json_each(?1,'$.tags')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO transaction_portable_source_links(transaction_id,source_record_id,candidate_id)
         SELECT json_extract(value,'$.transactionId'),json_extract(value,'$.sourceRecordId'),
           json_extract(value,'$.candidateId') FROM json_each(?1,'$.sourceLinks')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO transaction_external_keys(
           household_id,external_source,external_id,fact_hash,transaction_id,created_at)
         SELECT json_extract(value,'$.householdId'),json_extract(value,'$.externalSource'),
           json_extract(value,'$.externalId'),json_extract(value,'$.factHash'),
           json_extract(value,'$.transactionId'),json_extract(value,'$.createdAt')
         FROM json_each(?1,'$.externalKeys')",
        [payload],
    )?;
    Ok(())
}

fn materialize_card_statement(connection: &Connection, payload: &str) -> Result<()> {
    let (household_id, statement_id, incoming_source, explicit_origin): (
        String,
        String,
        Option<String>,
        Option<String>,
    ) = connection.query_row(
        "SELECT json_extract(?1,'$.householdId'),json_extract(?1,'$.id'),
                json_extract(?1,'$.sourceDocumentId'),
                json_extract(?1,'$.sourceOriginInstallationId')",
        [payload],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let incoming_origin = match incoming_source.as_deref() {
        None if explicit_origin.is_none() => None,
        None => return Err(ChangePackageError::Conflict),
        Some(_) => Some(
            explicit_origin
                .or_else(|| {
                    apply_source_installation(connection, &household_id)
                        .ok()
                        .flatten()
                })
                .ok_or(ChangePackageError::Conflict)?,
        ),
    };
    let existing_portable: Option<(String, String)> = connection
        .query_row(
            "SELECT origin_installation_id,source_document_id
             FROM card_statement_portable_source_refs
             WHERE household_id=?1 AND statement_id=?2",
            params![household_id, statement_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if existing_portable.as_ref().is_some_and(|existing| {
        incoming_origin.as_deref() != Some(existing.0.as_str())
            || incoming_source.as_deref() != Some(existing.1.as_str())
    }) || (existing_portable.is_some() && incoming_source.is_none())
    {
        return Err(ChangePackageError::Conflict);
    }
    let local_source = match (incoming_origin.as_deref(), incoming_source.as_deref()) {
        (Some(origin), Some(document)) => lookup_source_document_alias_under_apply_guard(
            connection,
            &household_id,
            origin,
            document,
        )?,
        (None, None) => None,
        _ => return Err(ChangePackageError::Conflict),
    };
    let existing_local: Option<String> = connection
        .query_row(
            "SELECT source_document_id FROM card_statements
             WHERE household_id=?1 AND id=?2",
            params![household_id, statement_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    if existing_local.is_some() && existing_local != local_source {
        return Err(ChangePackageError::Conflict);
    }
    connection.execute(
        "INSERT INTO card_statements(
           id,household_id,card_account_id,period_start,period_end,payment_due_on,
           statement_amount_jpy,reconciliation_status,created_at,source_document_id)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
           json_extract(?1,'$.cardAccountId'),json_extract(?1,'$.periodStart'),
           json_extract(?1,'$.periodEnd'),json_extract(?1,'$.paymentDueOn'),
           json_extract(?1,'$.statementAmountJpy'),json_extract(?1,'$.reconciliationStatus'),
           json_extract(?1,'$.createdAt'),?2)
         ON CONFLICT(id) DO UPDATE SET card_account_id=excluded.card_account_id,
           period_start=excluded.period_start,period_end=excluded.period_end,
           payment_due_on=excluded.payment_due_on,
           statement_amount_jpy=excluded.statement_amount_jpy,
           reconciliation_status=excluded.reconciliation_status,
           created_at=excluded.created_at,source_document_id=excluded.source_document_id",
        params![payload, local_source.as_deref()],
    )?;
    connection.execute(
        "DELETE FROM card_statement_transactions WHERE statement_id=json_extract(?1,'$.id')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO card_statement_transactions(
           statement_id,transaction_id,statement_line_number,billed_amount_jpy)
         SELECT json_extract(value,'$.statementId'),json_extract(value,'$.transactionId'),
           json_extract(value,'$.statementLineNumber'),json_extract(value,'$.billedAmountJpy')
         FROM json_each(?1,'$.lines')",
        [payload],
    )?;
    if let (Some(origin), Some(source_id)) = (incoming_origin, incoming_source) {
        connection.execute(
            "INSERT INTO card_statement_portable_source_refs(
               statement_id,household_id,origin_installation_id,source_document_id)
             VALUES(?1,?2,?3,?4) ON CONFLICT(statement_id) DO NOTHING",
            params![statement_id, household_id, origin, source_id],
        )?;
    }
    Ok(())
}

fn materialize_card_payment(connection: &Connection, payload: &str) -> Result<()> {
    connection.execute(
        "INSERT INTO card_payments(
           id,household_id,statement_id,bank_transaction_id,card_account_id,
           payment_amount_jpy,payment_on,match_score_bps,reconciliation_status,
           created_at,confirmed_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
           json_extract(?1,'$.statementId'),json_extract(?1,'$.bankTransactionId'),
           json_extract(?1,'$.cardAccountId'),json_extract(?1,'$.paymentAmountJpy'),
           json_extract(?1,'$.paymentOn'),json_extract(?1,'$.matchScoreBps'),
           json_extract(?1,'$.reconciliationStatus'),json_extract(?1,'$.createdAt'),
           json_extract(?1,'$.confirmedAt'))
         ON CONFLICT(id) DO UPDATE SET
           household_id=excluded.household_id,statement_id=excluded.statement_id,
           bank_transaction_id=excluded.bank_transaction_id,
           card_account_id=excluded.card_account_id,
           payment_amount_jpy=excluded.payment_amount_jpy,payment_on=excluded.payment_on,
           match_score_bps=excluded.match_score_bps,
           reconciliation_status=excluded.reconciliation_status,
           created_at=excluded.created_at,confirmed_at=excluded.confirmed_at",
        [payload],
    )?;
    Ok(())
}

fn apply_source_installation(
    connection: &Connection,
    household_id: &str,
) -> Result<Option<String>> {
    let value = connection
        .query_row(
            "SELECT COALESCE(
               (SELECT p.source_installation_id FROM change_packages p
                WHERE p.package_id=guard.package_id
                  AND p.target_household_id=guard.household_id),
               (SELECT s.source_installation_id FROM family_snapshot_sets s
                WHERE s.snapshot_set_id=guard.package_id
                  AND s.target_household_id=guard.household_id))
             FROM sync_apply_guard guard WHERE guard.household_id=?1",
            [household_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?;
    Ok(value.flatten())
}

fn resolve_source_document_alias_under_apply_guard(
    connection: &Connection,
    household_id: &str,
    origin_installation_id: &str,
    portable_document_id: &str,
) -> Result<String> {
    lookup_source_document_alias_under_apply_guard(
        connection,
        household_id,
        origin_installation_id,
        portable_document_id,
    )?
    .ok_or(ChangePackageError::Conflict)
}

fn lookup_source_document_alias_under_apply_guard(
    connection: &Connection,
    household_id: &str,
    origin_installation_id: &str,
    portable_document_id: &str,
) -> Result<Option<String>> {
    connection
        .query_row(
            "SELECT alias.local_document_id
             FROM sync_apply_guard guard
             JOIN evidence_source_document_aliases alias
               ON alias.household_id=guard.household_id
              AND alias.origin_installation_id=?2
              AND alias.portable_document_id=?3
             WHERE guard.household_id=?1 AND (
               EXISTS(SELECT 1 FROM change_packages p
                 WHERE p.package_id=guard.package_id
                   AND p.target_household_id=guard.household_id)
               OR EXISTS(SELECT 1 FROM family_snapshot_sets s
                 WHERE s.snapshot_set_id=guard.package_id
                   AND s.target_household_id=guard.household_id)
             )",
            params![household_id, origin_installation_id, portable_document_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(ChangePackageError::from)
}

fn resolve_investment_source(
    connection: &Connection,
    payload: &str,
    require_row: bool,
) -> Result<(Option<String>, Option<i64>)> {
    let (
        household_id,
        entity_kind,
        entity_id,
        portable_document_id,
        origin_installation_id,
        source_row,
    ): (
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<i64>,
    ) = connection.query_row(
        "SELECT json_extract(?1,'$.householdId'),json_extract(?1,'$.recordKind'),
                    json_extract(?1,'$.id'),json_extract(?1,'$.sourceDocumentId'),
                    json_extract(?1,'$.sourceOriginInstallationId'),
                    json_extract(?1,'$.sourceRow')",
        [payload],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        },
    )?;
    let Some(portable_document_id) = portable_document_id else {
        if source_row.is_some() || require_row {
            return Err(ChangePackageError::Conflict);
        }
        return Ok((None, None));
    };
    if require_row && source_row.is_none() {
        return Err(ChangePackageError::Conflict);
    }
    let origin_installation_id = origin_installation_id.ok_or(ChangePackageError::Conflict)?;
    let exact_ref: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM investment_portable_source_refs
         WHERE household_id=?1 AND entity_kind=?2 AND entity_id=?3
           AND origin_installation_id=?4 AND source_document_id=?5 AND source_row IS ?6)",
        params![
            household_id,
            entity_kind,
            entity_id,
            origin_installation_id,
            portable_document_id,
            source_row
        ],
        |row| row.get(0),
    )?;
    if !exact_ref {
        return Err(ChangePackageError::Conflict);
    }
    let local_document_id = resolve_source_document_alias_under_apply_guard(
        connection,
        &household_id,
        &origin_installation_id,
        &portable_document_id,
    )?;
    if let Some(row_number) = source_row {
        let row_exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM source_records
             WHERE source_document_id=?1 AND row_number=?2)",
            params![local_document_id, row_number],
            |row| row.get(0),
        )?;
        if !row_exists {
            return Err(ChangePackageError::Conflict);
        }
    }
    Ok((Some(local_document_id), source_row))
}

fn replace_investment_portable_ref(connection: &Connection, payload: &str) -> Result<()> {
    let valid: bool = connection.query_row(
        "SELECT CASE WHEN json_extract(?1,'$.sourceDocumentId') IS NULL THEN
           NOT EXISTS(SELECT 1 FROM investment_portable_source_refs
             WHERE household_id=json_extract(?1,'$.householdId')
               AND entity_kind=json_extract(?1,'$.recordKind')
               AND entity_id=json_extract(?1,'$.id'))
         ELSE EXISTS(SELECT 1 FROM investment_portable_source_refs
             WHERE household_id=json_extract(?1,'$.householdId')
               AND entity_kind=json_extract(?1,'$.recordKind')
               AND entity_id=json_extract(?1,'$.id')
               AND origin_installation_id=json_extract(?1,'$.sourceOriginInstallationId')
               AND source_document_id=json_extract(?1,'$.sourceDocumentId')
               AND source_row IS json_extract(?1,'$.sourceRow')) END",
        [payload],
        |row| row.get(0),
    )?;
    if !valid {
        return Err(ChangePackageError::Conflict);
    }
    Ok(())
}

fn materialize_portfolio_snapshot(connection: &Connection, payload: &str) -> Result<()> {
    let (local_document_id, _) = resolve_investment_source(connection, payload, false)?;
    let local_document_id = local_document_id.ok_or(ChangePackageError::Conflict)?;
    validate_portfolio_source_rows(connection, payload, &local_document_id)?;
    connection.execute(
        "INSERT INTO portfolio_snapshots(
           id,household_id,account_id,source_document_id,as_of,market_value_jpy,
           cash_value_jpy,unrealized_pnl_jpy,realized_pnl_jpy,created_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
           json_extract(?1,'$.accountId'),?2,json_extract(?1,'$.asOf'),
           json_extract(?1,'$.marketValueJpy'),json_extract(?1,'$.cashValueJpy'),
           json_extract(?1,'$.unrealizedPnlJpy'),json_extract(?1,'$.realizedPnlJpy'),
           json_extract(?1,'$.createdAt'))
         ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,
           source_document_id=excluded.source_document_id,as_of=excluded.as_of,
           market_value_jpy=excluded.market_value_jpy,cash_value_jpy=excluded.cash_value_jpy,
           unrealized_pnl_jpy=excluded.unrealized_pnl_jpy,
           realized_pnl_jpy=excluded.realized_pnl_jpy,created_at=excluded.created_at",
        params![payload, local_document_id],
    )?;
    for table in [
        "portfolio_asset_classes",
        "position_snapshots",
        "portfolio_fx_rates",
    ] {
        connection.execute(
            &format!("DELETE FROM {table} WHERE portfolio_snapshot_id=json_extract(?1,'$.id')"),
            [payload],
        )?;
    }
    connection.execute(
        "INSERT INTO portfolio_asset_classes(
           id,portfolio_snapshot_id,name,market_value_jpy,unrealized_pnl_jpy,source_row)
         SELECT json_extract(value,'$.id'),json_extract(value,'$.portfolioSnapshotId'),
           json_extract(value,'$.name'),json_extract(value,'$.marketValueJpy'),
           json_extract(value,'$.unrealizedPnlJpy'),json_extract(value,'$.sourceRow')
         FROM json_each(?1,'$.assetClasses')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO position_snapshots(
           id,portfolio_snapshot_id,product_type,account_type,instrument_code,instrument_name,
           quantity,average_cost,market_price,market_value_jpy,unrealized_pnl_jpy,
           realized_pnl_jpy,currency,source_row)
         SELECT json_extract(value,'$.id'),json_extract(value,'$.portfolioSnapshotId'),
           json_extract(value,'$.productType'),json_extract(value,'$.accountType'),
           json_extract(value,'$.instrumentCode'),json_extract(value,'$.instrumentName'),
           json_extract(value,'$.quantity'),json_extract(value,'$.averageCost'),
           json_extract(value,'$.marketPrice'),json_extract(value,'$.marketValueJpy'),
           json_extract(value,'$.unrealizedPnlJpy'),json_extract(value,'$.realizedPnlJpy'),
           json_extract(value,'$.currency'),json_extract(value,'$.sourceRow')
         FROM json_each(?1,'$.positions')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO portfolio_fx_rates(
           id,portfolio_snapshot_id,base_currency,quote_currency,rate,source_row)
         SELECT json_extract(value,'$.id'),json_extract(value,'$.portfolioSnapshotId'),
           json_extract(value,'$.baseCurrency'),json_extract(value,'$.quoteCurrency'),
           json_extract(value,'$.rate'),json_extract(value,'$.sourceRow')
         FROM json_each(?1,'$.fxRates')",
        [payload],
    )?;
    replace_investment_portable_ref(connection, payload)
}

fn validate_portfolio_source_rows(
    connection: &Connection,
    payload: &str,
    local_document_id: &str,
) -> Result<()> {
    let missing_source_row: bool = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM (
             SELECT json_extract(value,'$.sourceRow') AS source_row
             FROM json_each(?1,'$.assetClasses')
             UNION ALL
             SELECT json_extract(value,'$.sourceRow') FROM json_each(?1,'$.positions')
             UNION ALL
             SELECT json_extract(value,'$.sourceRow') FROM json_each(?1,'$.fxRates')
           ) child
           WHERE child.source_row IS NULL OR child.source_row<=0 OR NOT EXISTS(
             SELECT 1 FROM source_records record
             WHERE record.source_document_id=?2 AND record.row_number=child.source_row)
           LIMIT 1)",
        params![payload, local_document_id],
        |row| row.get(0),
    )?;
    if missing_source_row {
        Err(ChangePackageError::Conflict)
    } else {
        Ok(())
    }
}

fn materialize_brokerage_event(connection: &Connection, payload: &str) -> Result<()> {
    let (local_document_id, _) = resolve_investment_source(connection, payload, true)?;
    let local_document_id = local_document_id.ok_or(ChangePackageError::Conflict)?;
    connection.execute(
        "INSERT INTO brokerage_events(
           id,household_id,account_id,source_document_id,source_row,event_type,trade_date,
           settlement_date,instrument_code,instrument_name,brokerage_account_type,currency,
           quantity,unit_price,gross_amount,fee_amount,tax_amount,settlement_amount,
           reconciliation_status,reconciliation_difference,affects_household_expense,
           raw_transaction_type,corporate_action_ratio,target_instrument_code,
           target_instrument_name,target_currency,cost_basis_allocation_ratio,
           subscription_amount,cash_in_lieu_amount,cash_in_lieu_quantity,merger_cash_amount,
           merger_cash_currency,merger_stock_cost_basis_ratio,source_to_target_fx_rate,
           source_to_cash_fx_rate,created_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
           json_extract(?1,'$.accountId'),?2,json_extract(?1,'$.sourceRow'),
           json_extract(?1,'$.eventType'),json_extract(?1,'$.tradeDate'),
           json_extract(?1,'$.settlementDate'),json_extract(?1,'$.instrumentCode'),
           json_extract(?1,'$.instrumentName'),json_extract(?1,'$.brokerageAccountType'),
           json_extract(?1,'$.currency'),json_extract(?1,'$.quantity'),
           json_extract(?1,'$.unitPrice'),json_extract(?1,'$.grossAmount'),
           json_extract(?1,'$.feeAmount'),json_extract(?1,'$.taxAmount'),
           json_extract(?1,'$.settlementAmount'),json_extract(?1,'$.reconciliationStatus'),
           json_extract(?1,'$.reconciliationDifference'),json_extract(?1,'$.affectsHouseholdExpense'),
           json_extract(?1,'$.rawTransactionType'),json_extract(?1,'$.corporateActionRatio'),
           json_extract(?1,'$.targetInstrumentCode'),json_extract(?1,'$.targetInstrumentName'),
           json_extract(?1,'$.targetCurrency'),json_extract(?1,'$.costBasisAllocationRatio'),
           json_extract(?1,'$.subscriptionAmount'),json_extract(?1,'$.cashInLieuAmount'),
           json_extract(?1,'$.cashInLieuQuantity'),json_extract(?1,'$.mergerCashAmount'),
           json_extract(?1,'$.mergerCashCurrency'),json_extract(?1,'$.mergerStockCostBasisRatio'),
           json_extract(?1,'$.sourceToTargetFxRate'),json_extract(?1,'$.sourceToCashFxRate'),
           json_extract(?1,'$.createdAt'))
         ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,
           source_document_id=excluded.source_document_id,source_row=excluded.source_row,
           event_type=excluded.event_type,trade_date=excluded.trade_date,
           settlement_date=excluded.settlement_date,instrument_code=excluded.instrument_code,
           instrument_name=excluded.instrument_name,brokerage_account_type=excluded.brokerage_account_type,
           currency=excluded.currency,quantity=excluded.quantity,unit_price=excluded.unit_price,
           gross_amount=excluded.gross_amount,fee_amount=excluded.fee_amount,tax_amount=excluded.tax_amount,
           settlement_amount=excluded.settlement_amount,reconciliation_status=excluded.reconciliation_status,
           reconciliation_difference=excluded.reconciliation_difference,
           affects_household_expense=excluded.affects_household_expense,
           raw_transaction_type=excluded.raw_transaction_type,
           corporate_action_ratio=excluded.corporate_action_ratio,
           target_instrument_code=excluded.target_instrument_code,
           target_instrument_name=excluded.target_instrument_name,target_currency=excluded.target_currency,
           cost_basis_allocation_ratio=excluded.cost_basis_allocation_ratio,
           subscription_amount=excluded.subscription_amount,cash_in_lieu_amount=excluded.cash_in_lieu_amount,
           cash_in_lieu_quantity=excluded.cash_in_lieu_quantity,merger_cash_amount=excluded.merger_cash_amount,
           merger_cash_currency=excluded.merger_cash_currency,
           merger_stock_cost_basis_ratio=excluded.merger_stock_cost_basis_ratio,
           source_to_target_fx_rate=excluded.source_to_target_fx_rate,
           source_to_cash_fx_rate=excluded.source_to_cash_fx_rate,created_at=excluded.created_at",
        params![payload, local_document_id],
    )?;
    connection.execute(
        "DELETE FROM brokerage_event_legs WHERE brokerage_event_id=json_extract(?1,'$.id')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO brokerage_event_legs(
           id,brokerage_event_id,line_number,leg_kind,signed_amount,currency,
           instrument_code,instrument_name,signed_quantity,description)
         SELECT json_extract(value,'$.id'),json_extract(value,'$.brokerageEventId'),
           json_extract(value,'$.lineNumber'),json_extract(value,'$.legKind'),
           json_extract(value,'$.signedAmount'),json_extract(value,'$.currency'),
           json_extract(value,'$.instrumentCode'),json_extract(value,'$.instrumentName'),
           json_extract(value,'$.signedQuantity'),json_extract(value,'$.description')
         FROM json_each(?1,'$.legs')",
        [payload],
    )?;
    replace_investment_portable_ref(connection, payload)
}

fn materialize_investment_fx_rate(connection: &Connection, payload: &str) -> Result<()> {
    let (local_document_id, source_row) = resolve_investment_source(connection, payload, false)?;
    connection.execute(
        "INSERT INTO investment_fx_rates(
           id,household_id,rate_date,base_currency,quote_currency,rate,source_kind,
           provider,source_document_id,source_row,observed_at,created_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
           json_extract(?1,'$.rateDate'),json_extract(?1,'$.baseCurrency'),
           json_extract(?1,'$.quoteCurrency'),json_extract(?1,'$.rate'),
           json_extract(?1,'$.sourceKind'),json_extract(?1,'$.provider'),?2,?3,
           json_extract(?1,'$.observedAt'),json_extract(?1,'$.createdAt'))
         ON CONFLICT(id) DO UPDATE SET rate_date=excluded.rate_date,
           base_currency=excluded.base_currency,quote_currency=excluded.quote_currency,
           rate=excluded.rate,source_kind=excluded.source_kind,provider=excluded.provider,
           source_document_id=excluded.source_document_id,source_row=excluded.source_row,
           observed_at=excluded.observed_at,created_at=excluded.created_at",
        params![payload, local_document_id, source_row],
    )?;
    replace_investment_portable_ref(connection, payload)
}

fn materialize_investment_market_price(connection: &Connection, payload: &str) -> Result<()> {
    let (local_document_id, source_row) = resolve_investment_source(connection, payload, false)?;
    connection.execute(
        "INSERT INTO investment_market_prices(
           id,household_id,price_date,instrument_code,instrument_name,currency,unit_price,
           source_kind,provider,source_document_id,source_row,observed_at,created_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),
           json_extract(?1,'$.priceDate'),json_extract(?1,'$.instrumentCode'),
           json_extract(?1,'$.instrumentName'),json_extract(?1,'$.currency'),
           json_extract(?1,'$.unitPrice'),json_extract(?1,'$.sourceKind'),
           json_extract(?1,'$.provider'),?2,?3,json_extract(?1,'$.observedAt'),
           json_extract(?1,'$.createdAt'))
         ON CONFLICT(id) DO UPDATE SET price_date=excluded.price_date,
           instrument_code=excluded.instrument_code,instrument_name=excluded.instrument_name,
           currency=excluded.currency,unit_price=excluded.unit_price,
           source_kind=excluded.source_kind,provider=excluded.provider,
           source_document_id=excluded.source_document_id,source_row=excluded.source_row,
           observed_at=excluded.observed_at,created_at=excluded.created_at",
        params![payload, local_document_id, source_row],
    )?;
    replace_investment_portable_ref(connection, payload)
}

fn materialize_aggregate_asset_snapshot(connection: &Connection, payload: &str) -> Result<()> {
    let (local_document_id, source_row) = resolve_investment_source(connection, payload, true)?;
    connection.execute(
        "INSERT INTO aggregate_asset_snapshots(
           id,household_id,source_document_id,source_row,as_of,total_assets_jpy,created_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),?2,?3,
           json_extract(?1,'$.asOf'),json_extract(?1,'$.totalAssetsJpy'),
           json_extract(?1,'$.createdAt'))
         ON CONFLICT(id) DO UPDATE SET source_document_id=excluded.source_document_id,
           source_row=excluded.source_row,as_of=excluded.as_of,
           total_assets_jpy=excluded.total_assets_jpy,created_at=excluded.created_at",
        params![payload, local_document_id, source_row],
    )?;
    connection.execute(
        "DELETE FROM aggregate_asset_components
         WHERE aggregate_asset_snapshot_id=json_extract(?1,'$.id')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO aggregate_asset_components(
           aggregate_asset_snapshot_id,asset_class,official_header,value_jpy)
         SELECT json_extract(value,'$.aggregateAssetSnapshotId'),
           json_extract(value,'$.assetClass'),json_extract(value,'$.officialHeader'),
           json_extract(value,'$.valueJpy') FROM json_each(?1,'$.components')",
        [payload],
    )?;
    replace_investment_portable_ref(connection, payload)
}

fn validate_card_reconciliation_graph(connection: &Connection, household_id: &str) -> Result<()> {
    let invalid: bool = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM card_statements cs
           LEFT JOIN accounts a ON a.id=cs.card_account_id
           WHERE cs.household_id=?1 AND (
             a.id IS NULL OR a.household_id!=cs.household_id
             OR a.account_kind!='LIABILITY' OR a.account_subtype!='CREDIT_CARD'
             OR cs.reconciliation_status != CASE
               WHEN (SELECT COALESCE(SUM(cp.payment_amount_jpy),0) FROM card_payments cp
                     WHERE cp.statement_id=cs.id AND cp.confirmed_at IS NOT NULL)=0
                 THEN 'UNMATCHED'
               WHEN (SELECT COALESCE(SUM(cp.payment_amount_jpy),0) FROM card_payments cp
                     WHERE cp.statement_id=cs.id AND cp.confirmed_at IS NOT NULL)<cs.statement_amount_jpy
                 THEN 'PARTIALLY_RECONCILED'
               WHEN (SELECT COALESCE(SUM(cp.payment_amount_jpy),0) FROM card_payments cp
                     WHERE cp.statement_id=cs.id AND cp.confirmed_at IS NOT NULL)=cs.statement_amount_jpy
                 THEN 'FULLY_RECONCILED'
               ELSE 'OVERPAID' END)
           UNION ALL
           SELECT 1 FROM card_statement_transactions line
           JOIN card_statements cs ON cs.id=line.statement_id
           LEFT JOIN transactions t ON t.id=line.transaction_id
           WHERE cs.household_id=?1 AND (t.id IS NULL OR t.household_id!=cs.household_id)
           UNION ALL
           SELECT 1 FROM card_payments cp
           LEFT JOIN accounts a ON a.id=cp.card_account_id
           LEFT JOIN transactions t ON t.id=cp.bank_transaction_id
           LEFT JOIN card_statements cs ON cs.id=cp.statement_id
           WHERE cp.household_id=?1 AND (
             a.id IS NULL OR a.household_id!=cp.household_id
             OR a.account_kind!='LIABILITY' OR a.account_subtype!='CREDIT_CARD'
             OR t.id IS NULL OR t.household_id!=cp.household_id
             OR (cs.id IS NOT NULL AND (
               cs.household_id!=cp.household_id OR cs.card_account_id!=cp.card_account_id))
             OR (cp.confirmed_at IS NOT NULL AND (
               cs.id IS NULL OR cp.confirmed_at NOT GLOB '????-??-??T??:??:??*Z'
               OR t.status!='POSTED' OR t.transaction_type!='CARD_PAYMENT'
               OR cp.reconciliation_status!='FULLY_RECONCILED'
               OR cp.payment_on<cs.period_end OR cp.payment_on>date(cs.period_end,'+120 days')
               OR cp.payment_amount_jpy!=(
                 SELECT COALESCE(SUM(je.amount_jpy),0) FROM journal_entries je
                 WHERE je.transaction_id=t.id AND je.account_id=cs.card_account_id
                   AND je.entry_side='DEBIT')
               OR 1!=(
                 SELECT COUNT(DISTINCT je.account_id)
                 FROM journal_entries je JOIN accounts debit_account ON debit_account.id=je.account_id
                 WHERE je.transaction_id=t.id AND je.entry_side='DEBIT'
                   AND debit_account.account_kind='LIABILITY'
                   AND debit_account.account_subtype='CREDIT_CARD'))))
           LIMIT 1)",
        [household_id],
        |row| row.get(0),
    )?;
    if invalid {
        Err(ChangePackageError::Conflict)
    } else {
        Ok(())
    }
}

fn validate_investment_graph(connection: &Connection, household_id: &str) -> Result<()> {
    let invalid_scope: bool = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM portfolio_snapshots snapshot
           LEFT JOIN accounts account ON account.id=snapshot.account_id
           WHERE snapshot.household_id=?1 AND (
             account.id IS NULL OR account.household_id!=snapshot.household_id
             OR account.account_kind!='ASSET' OR account.account_subtype!='SECURITIES'
           )
           UNION ALL
           SELECT 1 FROM brokerage_events event
           LEFT JOIN accounts account ON account.id=event.account_id
           WHERE event.household_id=?1 AND (
             account.id IS NULL OR account.household_id!=event.household_id
             OR account.account_subtype!='SECURITIES')
           LIMIT 1)",
        [household_id],
        |row| row.get(0),
    )?;
    if invalid_scope {
        return Err(ChangePackageError::Conflict);
    }

    let mut statement = connection
        .prepare("SELECT payload_json FROM sync_brokerage_event_payloads WHERE household_id=?1")?;
    let rows = statement.query_map([household_id], |row| row.get::<_, String>(0))?;
    for row in rows {
        let mut value: Value =
            serde_json::from_str(&row?).map_err(|_| ChangePackageError::Encoding)?;
        let object = value.as_object_mut().ok_or(ChangePackageError::Encoding)?;
        for key in [
            "recordKind",
            "householdId",
            "accountId",
            "sourceDocumentId",
            "sourceOriginInstallationId",
            "createdAt",
        ] {
            object.remove(key);
        }
        if let Some(account_type) = object.remove("brokerageAccountType") {
            object.insert("accountType".to_owned(), account_type);
        }
        if let Some(integer) = object
            .get("affectsHouseholdExpense")
            .and_then(Value::as_i64)
        {
            object.insert(
                "affectsHouseholdExpense".to_owned(),
                Value::Bool(integer != 0),
            );
        }
        let legs = object
            .get_mut("legs")
            .and_then(Value::as_array_mut)
            .ok_or(ChangePackageError::Encoding)?;
        for leg in legs {
            let leg = leg.as_object_mut().ok_or(ChangePackageError::Encoding)?;
            leg.remove("brokerageEventId");
            leg.remove("lineNumber");
            if let Some(kind) = leg.remove("legKind") {
                leg.insert("kind".to_owned(), kind);
            }
        }
        let event: crate::brokerage::ImportBrokerageEventInput =
            serde_json::from_value(value).map_err(|_| ChangePackageError::Conflict)?;
        if !crate::brokerage::validate_event(&event) {
            return Err(ChangePackageError::Conflict);
        }
    }
    Ok(())
}

fn materialize_rule(connection: &Connection, payload: &str) -> Result<()> {
    connection.execute(
        "INSERT INTO classification_rules(
           id,household_id,name,priority,is_enabled,merchant_contains,description_contains,
           category_account_id,created_at,updated_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),json_extract(?1,'$.name'),
           json_extract(?1,'$.priority'),json_extract(?1,'$.isEnabled'),
           json_extract(?1,'$.merchantContains'),json_extract(?1,'$.descriptionContains'),
           json_extract(?1,'$.categoryAccountId'),json_extract(?1,'$.createdAt'),
           json_extract(?1,'$.updatedAt'))
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,priority=excluded.priority,
           is_enabled=excluded.is_enabled,merchant_contains=excluded.merchant_contains,
           description_contains=excluded.description_contains,category_account_id=excluded.category_account_id,
           created_at=excluded.created_at,updated_at=excluded.updated_at",
        [payload],
    )?;
    connection.execute(
        "DELETE FROM classification_rule_labels WHERE rule_id=json_extract(?1,'$.id')",
        [payload],
    )?;
    connection.execute(
        "DELETE FROM classification_rule_tags WHERE rule_id=json_extract(?1,'$.id')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO classification_rule_labels(rule_id,label)
         SELECT json_extract(?1,'$.id'),value FROM json_each(?1,'$.labels')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO classification_rule_tags(rule_id,tag)
         SELECT json_extract(?1,'$.id'),value FROM json_each(?1,'$.tags')",
        [payload],
    )?;
    Ok(())
}

fn materialize_group(connection: &Connection, payload: &str) -> Result<()> {
    connection.execute(
        "INSERT INTO account_groups(id,household_id,name,group_kind,sort_order,created_at,updated_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),json_extract(?1,'$.name'),
           json_extract(?1,'$.groupKind'),json_extract(?1,'$.sortOrder'),
           json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,group_kind=excluded.group_kind,
           sort_order=excluded.sort_order,created_at=excluded.created_at,updated_at=excluded.updated_at",
        [payload],
    )?;
    connection.execute(
        "DELETE FROM account_group_members WHERE account_group_id=json_extract(?1,'$.id')",
        [payload],
    )?;
    connection.execute(
        "INSERT INTO account_group_members(household_id,account_group_id,account_id,sort_order)
         SELECT json_extract(value,'$.householdId'),json_extract(value,'$.accountGroupId'),
           json_extract(value,'$.accountId'),json_extract(value,'$.sortOrder')
         FROM json_each(?1,'$.members')",
        [payload],
    )?;
    Ok(())
}

fn materialize_parser_profile(connection: &Connection, payload: &str) -> Result<()> {
    connection.execute(
        "INSERT INTO delimited_parser_profiles(
           id,household_id,name,delimiter,encoding,header_row,date_column,date_format,
           description_column,payee_column,amount_mode,signed_positive_direction,
           signed_amount_column,debit_column,credit_column,external_id_column,
           account_hint_column,is_enabled,priority,version,created_at,updated_at)
         VALUES(json_extract(?1,'$.id'),json_extract(?1,'$.householdId'),json_extract(?1,'$.name'),
           json_extract(?1,'$.delimiter'),json_extract(?1,'$.encoding'),json_extract(?1,'$.headerRow'),
           json_extract(?1,'$.dateColumn'),json_extract(?1,'$.dateFormat'),
           json_extract(?1,'$.descriptionColumn'),json_extract(?1,'$.payeeColumn'),
           json_extract(?1,'$.amountMode'),json_extract(?1,'$.signedPositiveDirection'),
           json_extract(?1,'$.signedAmountColumn'),json_extract(?1,'$.debitColumn'),
           json_extract(?1,'$.creditColumn'),json_extract(?1,'$.externalIdColumn'),
           json_extract(?1,'$.accountHintColumn'),json_extract(?1,'$.isEnabled'),
           json_extract(?1,'$.priority'),json_extract(?1,'$.version'),
           json_extract(?1,'$.createdAt'),json_extract(?1,'$.updatedAt'))
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,delimiter=excluded.delimiter,
           encoding=excluded.encoding,header_row=excluded.header_row,date_column=excluded.date_column,
           date_format=excluded.date_format,description_column=excluded.description_column,
           payee_column=excluded.payee_column,amount_mode=excluded.amount_mode,
           signed_positive_direction=excluded.signed_positive_direction,
           signed_amount_column=excluded.signed_amount_column,debit_column=excluded.debit_column,
           credit_column=excluded.credit_column,external_id_column=excluded.external_id_column,
           account_hint_column=excluded.account_hint_column,is_enabled=excluded.is_enabled,
           priority=excluded.priority,version=excluded.version,created_at=excluded.created_at,
           updated_at=excluded.updated_at",
        [payload],
    )?;
    Ok(())
}

pub(crate) fn materialize_delete(
    connection: &Connection,
    household_id: &str,
    kind: &str,
    entity_id: &str,
    schema_version: u32,
) -> Result<()> {
    if kind == "DASHBOARD_PREFERENCES" && schema_version >= 4 {
        connection.execute(
            "DELETE FROM dashboard_template_layouts WHERE household_id=?1",
            [household_id],
        )?;
    }
    let (table, key) = match kind {
        "ACCOUNT" => ("accounts", "id"),
        "TRANSACTION" => ("transactions", "id"),
        "CARD_STATEMENT" => ("card_statements", "id"),
        "CARD_PAYMENT" => ("card_payments", "id"),
        "PORTFOLIO_SNAPSHOT" => ("portfolio_snapshots", "id"),
        "BROKERAGE_EVENT" => ("brokerage_events", "id"),
        "INVESTMENT_FX_RATE" => ("investment_fx_rates", "id"),
        "INVESTMENT_MARKET_PRICE" => ("investment_market_prices", "id"),
        "AGGREGATE_ASSET_SNAPSHOT" => ("aggregate_asset_snapshots", "id"),
        "SAVINGS_GOAL" => ("savings_goals", "id"),
        "CLASSIFICATION_RULE" => ("classification_rules", "id"),
        "ACCOUNT_GROUP" => ("account_groups", "id"),
        "CARD_SETTLEMENT_MAPPING" => ("card_settlement_bank_mappings", "card_account_id"),
        "DASHBOARD_PREFERENCES" => ("dashboard_preferences", "household_id"),
        "DELIMITED_PARSER_PROFILE" => ("delimited_parser_profiles", "id"),
        _ => return Err(ChangePackageError::InvalidInput),
    };
    let affected = connection.execute(
        &format!("DELETE FROM {table} WHERE {key}=?1 AND household_id=?2"),
        params![entity_id, household_id],
    )?;
    if affected > 1 {
        return Err(ChangePackageError::Conflict);
    }
    Ok(())
}

fn entity_belongs_to_other_household(
    connection: &Connection,
    kind: &str,
    entity_id: &str,
    household_id: &str,
) -> Result<bool> {
    let table = match kind {
        "HOUSEHOLD_MEMBER" => "household_members",
        "ACCOUNT" => "accounts",
        "TRANSACTION" => "transactions",
        "CARD_STATEMENT" => "card_statements",
        "CARD_PAYMENT" => "card_payments",
        "PORTFOLIO_SNAPSHOT" => "portfolio_snapshots",
        "BROKERAGE_EVENT" => "brokerage_events",
        "INVESTMENT_FX_RATE" => "investment_fx_rates",
        "INVESTMENT_MARKET_PRICE" => "investment_market_prices",
        "AGGREGATE_ASSET_SNAPSHOT" => "aggregate_asset_snapshots",
        "SAVINGS_GOAL" => "savings_goals",
        "CLASSIFICATION_RULE" => "classification_rules",
        "ACCOUNT_GROUP" => "account_groups",
        "DELIMITED_PARSER_PROFILE" => "delimited_parser_profiles",
        _ => return Ok(false),
    };
    connection
        .query_row(
            &format!("SELECT household_id!=?2 FROM {table} WHERE id=?1"),
            params![entity_id, household_id],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(ChangePackageError::from)
}

pub(crate) fn load_entity_payload(
    connection: &Connection,
    household_id: &str,
    kind: &str,
    entity_id: &str,
    schema_version: u32,
) -> Result<Option<String>> {
    let sql = match kind {
        "HOUSEHOLD" => {
            "SELECT json(json_object(
          'recordKind','HOUSEHOLD','id',id,'name',name,'baseCurrency',base_currency,
          'createdAt',created_at,'updatedAt',updated_at))
          FROM households WHERE id=?2 AND id=?1"
        }
        "HOUSEHOLD_MEMBER" => {
            "SELECT json(json_object(
          'recordKind','HOUSEHOLD_MEMBER','displayName',display_name,'householdId',household_id,
          'id',id,'relationshipLabel',relationship_label,'sortOrder',sort_order,'status',status,
          'createdAt',created_at,'updatedAt',updated_at))
          FROM household_members WHERE household_id=?1 AND id=?2"
        }
        "ACCOUNT" => {
            "SELECT json(json_object(
          'recordKind','ACCOUNT','accountKind',account_kind,'accountSubtype',account_subtype,
          'householdId',household_id,'id',id,'name',name,'currency',currency,
          'institutionName',institution_name,'maskedIdentifier',masked_identifier,
          'isArchived',is_archived,'ownerMemberId',owner_member_id,'ownershipKind',ownership_kind,
          'visibility',visibility,'createdAt',created_at,'updatedAt',updated_at))
          FROM accounts WHERE household_id=?1 AND id=?2"
        }
        "TRANSACTION" => {
            "SELECT payload_json FROM sync_transaction_aggregate_payloads
          WHERE household_id=?1 AND transaction_id=?2"
        }
        "CARD_STATEMENT" => {
            "SELECT payload_json FROM sync_card_statement_aggregate_payloads
          WHERE household_id=?1 AND statement_id=?2"
        }
        "CARD_PAYMENT" => {
            "SELECT payload_json FROM sync_card_payment_payloads
          WHERE household_id=?1 AND payment_id=?2"
        }
        "PORTFOLIO_SNAPSHOT" => {
            "SELECT payload_json FROM sync_portfolio_snapshot_payloads
          WHERE household_id=?1 AND snapshot_id=?2"
        }
        "BROKERAGE_EVENT" => {
            "SELECT payload_json FROM sync_brokerage_event_payloads
          WHERE household_id=?1 AND event_id=?2"
        }
        "INVESTMENT_FX_RATE" => {
            "SELECT payload_json FROM sync_investment_fx_rate_payloads
          WHERE household_id=?1 AND rate_id=?2"
        }
        "INVESTMENT_MARKET_PRICE" => {
            "SELECT payload_json FROM sync_investment_market_price_payloads
          WHERE household_id=?1 AND price_id=?2"
        }
        "AGGREGATE_ASSET_SNAPSHOT" => {
            "SELECT payload_json FROM sync_aggregate_asset_snapshot_payloads
          WHERE household_id=?1 AND snapshot_id=?2"
        }
        "MONTHLY_BUDGET_PLAN" => {
            "SELECT payload_json FROM sync_monthly_budget_plan_payloads
          WHERE household_id=?1 AND household_id=?2"
        }
        "SAVINGS_GOAL" => {
            "SELECT json(json_object(
          'recordKind','SAVINGS_GOAL','id',id,'householdId',household_id,'name',name,
          'targetJpy',target_jpy,'savedJpy',saved_jpy,'targetDate',target_date,
          'status',status,'createdAt',created_at,'updatedAt',updated_at))
          FROM savings_goals WHERE household_id=?1 AND id=?2"
        }
        "CLASSIFICATION_RULE" => {
            "SELECT payload_json FROM sync_classification_rule_payloads
          WHERE household_id=?1 AND rule_id=?2"
        }
        "ACCOUNT_GROUP" => {
            "SELECT payload_json FROM sync_account_group_payloads
          WHERE household_id=?1 AND group_id=?2"
        }
        "CARD_SETTLEMENT_MAPPING" => {
            "SELECT json(json_object(
          'recordKind','CARD_SETTLEMENT_MAPPING','householdId',household_id,
          'cardAccountId',card_account_id,'bankAccountId',bank_account_id,
          'createdAt',created_at,'updatedAt',updated_at))
          FROM card_settlement_bank_mappings WHERE household_id=?1 AND card_account_id=?2"
        }
        "DASHBOARD_PREFERENCES" if schema_version >= 4 => {
            "SELECT payload_json FROM sync_dashboard_preferences_v4_payloads
             WHERE household_id=?1 AND household_id=?2"
        }
        "RECURRING_SERIES_PREFERENCES" => {
            "SELECT payload_json FROM sync_recurring_series_preferences_payloads
             WHERE household_id=?1 AND household_id=?2"
        }
        "DASHBOARD_PREFERENCES" => {
            "SELECT json(json_object(
          'recordKind','DASHBOARD_PREFERENCES','householdId',household_id,
          'dashboardTemplate',dashboard_template,'theme',theme,'density',density,
          'createdAt',created_at,'updatedAt',updated_at))
          FROM dashboard_preferences WHERE household_id=?1 AND household_id=?2"
        }
        "DELIMITED_PARSER_PROFILE" => {
            "SELECT payload_json FROM sync_parser_profile_payloads
          WHERE household_id=?1 AND profile_id=?2"
        }
        _ => return Err(ChangePackageError::InvalidInput),
    };
    let parameters = if kind == "HOUSEHOLD" {
        params![entity_id, household_id]
    } else {
        params![household_id, entity_id]
    };
    connection
        .query_row(sql, parameters, |row| row.get(0))
        .optional()
        .map_err(ChangePackageError::from)
}

#[derive(Debug)]
struct StagedAction {
    entity_kind: String,
    entity_id: String,
    operation: String,
    canonical_payload_json: String,
    payload_sha256: String,
    review_state: String,
    resolution: String,
    current_payload_sha256: Option<String>,
    conflict_reason: Option<String>,
}

#[derive(Debug, Clone)]
struct ReplicaHead {
    source_installation_id: String,
    payload_sha256: String,
}

#[derive(Default)]
struct ActionCounts {
    create_count: u64,
    update_count: u64,
    unchanged_count: u64,
    delete_count: u64,
    conflict_count: u64,
}

impl ActionCounts {
    fn from_actions(actions: &[StagedAction]) -> Self {
        let mut counts = Self::default();
        for action in actions {
            match action.review_state.as_str() {
                "CREATE" => counts.create_count += 1,
                "UPDATE" => counts.update_count += 1,
                "UNCHANGED" => counts.unchanged_count += 1,
                "DELETE" => counts.delete_count += 1,
                "CONFLICT" => counts.conflict_count += 1,
                _ => {}
            }
        }
        counts
    }

    fn total(&self) -> u64 {
        self.create_count
            + self.update_count
            + self.unchanged_count
            + self.delete_count
            + self.conflict_count
    }
}

fn load_replica_heads(
    connection: &Connection,
    household_id: &str,
) -> Result<BTreeMap<(String, String), ReplicaHead>> {
    let mut statement = connection.prepare(
        "SELECT entity_kind,entity_id,source_installation_id,payload_sha256
         FROM sync_replica_entity_heads WHERE household_id=?1",
    )?;
    let rows = statement.query_map([household_id], |row| {
        Ok((
            (row.get::<_, String>(0)?, row.get::<_, String>(1)?),
            ReplicaHead {
                source_installation_id: row.get(2)?,
                payload_sha256: row.get(3)?,
            },
        ))
    })?;
    Ok(rows.collect::<std::result::Result<BTreeMap<_, _>, _>>()?)
}

fn load_package_by_id(
    connection: &Connection,
    package_id: &str,
) -> Result<Option<ChangePackageReviewDto>> {
    let header = connection
        .query_row(
            "SELECT package_id,schema_version,target_household_id,source_installation_id,source_revision,
                    source_created_at,state,record_count,create_count,update_count,
                    unchanged_count,delete_count,conflict_count
             FROM change_packages WHERE package_id=?1",
            [package_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, i64>(11)?,
                    row.get::<_, i64>(12)?,
                ))
            },
        )
        .optional()?;
    let Some(header) = header else {
        return Ok(None);
    };
    let mut statement = connection.prepare(
        "SELECT record_order,entity_kind,entity_id,operation,canonical_payload_json,
                payload_sha256,review_state,resolution,current_payload_sha256,conflict_reason
         FROM change_package_records WHERE package_id=?1 ORDER BY record_order",
    )?;
    let rows = statement.query_map([package_id], |row| {
        Ok(ChangePackageRecordReviewDto {
            record_order: u64::try_from(row.get::<_, i64>(0)?).unwrap_or(0),
            entity_kind: row.get(1)?,
            entity_id: row.get(2)?,
            operation: row.get(3)?,
            canonical_payload_json: row.get(4)?,
            payload_sha256: row.get(5)?,
            review_state: row.get(6)?,
            resolution: row.get(7)?,
            current_payload_sha256: row.get(8)?,
            conflict_reason: row.get(9)?,
        })
    })?;
    let records = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(Some(ChangePackageReviewDto {
        package_id: header.0,
        schema_version: as_u64(header.1)? as u32,
        target_household_id: header.2,
        source_installation_id: header.3,
        source_revision: u64::try_from(header.4).map_err(|_| ChangePackageError::Encoding)?,
        source_created_at: header.5,
        state: header.6,
        record_count: as_u64(header.7)?,
        create_count: as_u64(header.8)?,
        update_count: as_u64(header.9)?,
        unchanged_count: as_u64(header.10)?,
        delete_count: as_u64(header.11)?,
        conflict_count: as_u64(header.12)?,
        records,
    }))
}

fn as_u64(value: i64) -> Result<u64> {
    u64::try_from(value).map_err(|_| ChangePackageError::Encoding)
}

fn kind_supports_absence_delete(kind: &str) -> bool {
    matches!(
        kind,
        "ACCOUNT"
            | "TRANSACTION"
            | "CARD_STATEMENT"
            | "CARD_PAYMENT"
            | "PORTFOLIO_SNAPSHOT"
            | "BROKERAGE_EVENT"
            | "INVESTMENT_FX_RATE"
            | "INVESTMENT_MARKET_PRICE"
            | "AGGREGATE_ASSET_SNAPSHOT"
            | "SAVINGS_GOAL"
            | "CLASSIFICATION_RULE"
            | "ACCOUNT_GROUP"
            | "CARD_SETTLEMENT_MAPPING"
            | "DASHBOARD_PREFERENCES"
            | "DELIMITED_PARSER_PROFILE"
    )
}

fn dependency_rank(kind: &str) -> u8 {
    match kind {
        "HOUSEHOLD" => 0,
        "HOUSEHOLD_MEMBER" => 1,
        "ACCOUNT" => 2,
        "TRANSACTION"
        | "PORTFOLIO_SNAPSHOT"
        | "BROKERAGE_EVENT"
        | "INVESTMENT_FX_RATE"
        | "INVESTMENT_MARKET_PRICE"
        | "AGGREGATE_ASSET_SNAPSHOT" => 3,
        "CARD_STATEMENT" => 4,
        "CARD_PAYMENT" => 5,
        "SAVINGS_GOAL"
        | "DASHBOARD_PREFERENCES"
        | "DELIMITED_PARSER_PROFILE"
        | "RECURRING_SERIES_PREFERENCES" => 6,
        "MONTHLY_BUDGET_PLAN"
        | "CLASSIFICATION_RULE"
        | "ACCOUNT_GROUP"
        | "CARD_SETTLEMENT_MAPPING" => 7,
        _ => u8::MAX,
    }
}

fn payload_identity_matches(
    record: &ChangePackageRecordDto,
    payload: &Value,
    household_id: &str,
) -> bool {
    let string = |key: &str| payload.get(key).and_then(Value::as_str);
    let expected_record_kind = if record.entity_kind == "TRANSACTION" {
        "TRANSACTION_AGGREGATE"
    } else {
        record.entity_kind.as_str()
    };
    if string("recordKind") != Some(expected_record_kind) {
        return false;
    }
    match record.entity_kind.as_str() {
        "HOUSEHOLD" => {
            string("id") == Some(record.entity_id.as_str()) && record.entity_id == household_id
        }
        "MONTHLY_BUDGET_PLAN" | "DASHBOARD_PREFERENCES" | "RECURRING_SERIES_PREFERENCES" => {
            string("householdId") == Some(household_id) && record.entity_id == household_id
        }
        "CARD_SETTLEMENT_MAPPING" => {
            string("householdId") == Some(household_id)
                && string("cardAccountId") == Some(record.entity_id.as_str())
        }
        _ => {
            string("householdId") == Some(household_id)
                && string("id") == Some(record.entity_id.as_str())
        }
    }
}

fn push_query_records(
    connection: &Connection,
    output: &mut Vec<ChangePackageRecordDto>,
    entity_kind: &str,
    sql: &str,
    household_id: &str,
) -> Result<()> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map([household_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (entity_id, payload_json) = row?;
        let value: Value =
            serde_json::from_str(&payload_json).map_err(|_| ChangePackageError::Encoding)?;
        let canonical_payload_json =
            canonical_json(&value).map_err(|_| ChangePackageError::Encoding)?;
        output.push(ChangePackageRecordDto {
            entity_kind: entity_kind.to_owned(),
            entity_id,
            operation: "UPSERT".to_owned(),
            payload_sha256: sha256_hex(canonical_payload_json.as_bytes()),
            canonical_payload_json,
        });
    }
    Ok(())
}

/// Load the eight user-authored planning/configuration aggregates using the
/// exact canonical payload contracts used by local change packages. Family
/// delivery deliberately calls this instead of maintaining a second payload
/// representation.
pub(crate) fn load_planning_configuration_records(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<ChangePackageRecordDto>> {
    let mut records = Vec::new();
    push_query_records(
        connection,
        &mut records,
        "MONTHLY_BUDGET_PLAN",
        "SELECT household_id,payload_json FROM sync_monthly_budget_plan_payloads
         WHERE household_id=?1",
        household_id,
    )?;
    push_query_records(
        connection,
        &mut records,
        "SAVINGS_GOAL",
        "SELECT id,json(json_object(
           'recordKind','SAVINGS_GOAL','id',id,'householdId',household_id,'name',name,
           'targetJpy',target_jpy,'savedJpy',saved_jpy,'targetDate',target_date,
           'status',status,'createdAt',created_at,'updatedAt',updated_at))
         FROM savings_goals WHERE household_id=?1 ORDER BY id",
        household_id,
    )?;
    push_query_records(
        connection,
        &mut records,
        "CLASSIFICATION_RULE",
        "SELECT rule_id,payload_json FROM sync_classification_rule_payloads
         WHERE household_id=?1 ORDER BY rule_id",
        household_id,
    )?;
    push_query_records(
        connection,
        &mut records,
        "ACCOUNT_GROUP",
        "SELECT group_id,payload_json FROM sync_account_group_payloads
         WHERE household_id=?1 ORDER BY group_id",
        household_id,
    )?;
    push_query_records(
        connection,
        &mut records,
        "CARD_SETTLEMENT_MAPPING",
        "SELECT card_account_id,json(json_object(
           'recordKind','CARD_SETTLEMENT_MAPPING','householdId',household_id,
           'cardAccountId',card_account_id,'bankAccountId',bank_account_id,
           'createdAt',created_at,'updatedAt',updated_at))
         FROM card_settlement_bank_mappings WHERE household_id=?1 ORDER BY card_account_id",
        household_id,
    )?;
    push_query_records(
        connection,
        &mut records,
        "DASHBOARD_PREFERENCES",
        "SELECT household_id,payload_json FROM sync_dashboard_preferences_v4_payloads
         WHERE household_id=?1",
        household_id,
    )?;
    push_query_records(
        connection,
        &mut records,
        "RECURRING_SERIES_PREFERENCES",
        "SELECT household_id,payload_json FROM sync_recurring_series_preferences_payloads
         WHERE household_id=?1",
        household_id,
    )?;
    push_query_records(
        connection,
        &mut records,
        "DELIMITED_PARSER_PROFILE",
        "SELECT profile_id,payload_json FROM sync_parser_profile_payloads
         WHERE household_id=?1 ORDER BY profile_id",
        household_id,
    )?;
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::AppState;

    const TEST_KEY: &[u8] = b"change-package-test-key-material-32bytes";

    fn resign_package(package: &mut LocalChangePackageDto) {
        if package.schema_version < 4 {
            for record in &mut package.records {
                if record.entity_kind == "DASHBOARD_PREFERENCES" {
                    let mut value: Value = serde_json::from_str(&record.canonical_payload_json)
                        .expect("dashboard payload");
                    value
                        .as_object_mut()
                        .expect("dashboard object")
                        .remove("templateLayouts");
                    record.canonical_payload_json = canonical_json(&value).unwrap();
                    record.payload_sha256 = sha256_hex(record.canonical_payload_json.as_bytes());
                }
            }
        }
        let identity = SnapshotIdentity {
            schema_version: package.schema_version,
            mode: &package.mode,
            source_installation_id: &package.source_installation_id,
            source_principal_id: &package.source_principal_id,
            source_revision: package.source_revision,
            household_id: &package.household_id,
            created_at: &package.created_at,
            covered_kinds: &package.covered_kinds,
            counts_by_kind: &package.counts_by_kind,
            records: &package.records,
        };
        let canonical_identity = canonical_json(&serde_json::to_value(identity).unwrap()).unwrap();
        package.snapshot_sha256 = sha256_hex(canonical_identity.as_bytes());
        package.package_id = format!("change-package-{}", package.snapshot_sha256);
        let value = json!({
            "packageId": package.package_id,
            "schemaVersion": package.schema_version,
            "mode": package.mode,
            "sourceInstallationId": package.source_installation_id,
            "sourcePrincipalId": package.source_principal_id,
            "sourceRevision": package.source_revision,
            "householdId": package.household_id,
            "createdAt": package.created_at,
            "coveredKinds": package.covered_kinds,
            "countsByKind": package.counts_by_kind,
            "snapshotSha256": package.snapshot_sha256,
            "records": package.records,
        });
        package.package_sha256 = sha256_hex(canonical_json(&value).unwrap().as_bytes());
    }

    fn seed_complete_household(connection: &Connection) {
        connection
            .execute_batch(
                "INSERT INTO households(id,name) VALUES('family','Source family');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('bank','family','Bank','ASSET','BANK'),
                       ('card','family','Card','LIABILITY','CREDIT_CARD'),
                       ('food','family','Food','EXPENSE','OTHER');
                 INSERT INTO transactions(
                   id,household_id,occurred_on,transaction_type,payee,status)
                 VALUES('tx','family','2026-06-13','CARD_PURCHASE','Market','POSTED'),
                       ('payment-tx','family','2026-07-27','CARD_PAYMENT','Bank debit','POSTED'),
                       ('possible-payment-tx','family','2026-06-27','CARD_PAYMENT','Bank debit','POSTED');
                 INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                 VALUES('tx-d','tx','food','DEBIT',1200,1),('tx-c','tx','card','CREDIT',1200,2),
                       ('payment-d','payment-tx','card','DEBIT',1200,1),
                       ('payment-c','payment-tx','bank','CREDIT',1200,2),
                       ('possible-payment-d','possible-payment-tx','card','DEBIT',500,1),
                       ('possible-payment-c','possible-payment-tx','bank','CREDIT',500,2);
                 INSERT INTO transaction_labels VALUES('tx','Reviewed');
                 INSERT INTO transaction_tags VALUES('tx','weekly');
                 INSERT INTO transaction_portable_source_links VALUES('tx','source-row-1','candidate-1');
                 INSERT INTO card_statements(
                   id,household_id,card_account_id,period_start,period_end,payment_due_on,
                   statement_amount_jpy,reconciliation_status)
                 VALUES('statement-full','family','card','2026-06-01','2026-06-30','2026-07-27',
                          1200,'FULLY_RECONCILED'),
                       ('statement-unmatched','family','card','2026-05-01','2026-05-31','2026-06-27',
                          500,'UNMATCHED');
                 INSERT INTO card_statement_transactions(
                   statement_id,transaction_id,statement_line_number,billed_amount_jpy)
                 VALUES('statement-full','tx',1,1200);
                 INSERT INTO card_statement_portable_source_refs(
                   statement_id,household_id,origin_installation_id,source_document_id)
                 VALUES('statement-full','family','source-origin','portable-card-source');
                 INSERT INTO card_payments(
                   id,household_id,statement_id,bank_transaction_id,card_account_id,
                   payment_amount_jpy,payment_on,match_score_bps,reconciliation_status,confirmed_at)
                 VALUES('payment-full','family','statement-full','payment-tx','card',1200,
                          '2026-07-27',10000,'FULLY_RECONCILED','2026-07-27T00:00:00Z'),
                       ('payment-possible','family','statement-unmatched','possible-payment-tx','card',500,
                          '2026-06-27',9000,'POSSIBLE_MATCH',NULL);
                 INSERT INTO monthly_category_budgets(household_id,month,category_account_id,budget_jpy)
                 VALUES('family','2026-07','food',50000);
                 INSERT INTO savings_goals(id,household_id,name,target_jpy,saved_jpy,target_date,status)
                 VALUES('goal','family','Emergency',500000,100000,'2027-07-01','ACTIVE');
                 INSERT INTO classification_rules(
                   id,household_id,name,priority,is_enabled,merchant_contains,category_account_id)
                 VALUES('rule','family','Market',10,1,'MARKET','food');
                 INSERT INTO classification_rule_labels VALUES('rule','Recurring');
                 INSERT INTO classification_rule_tags VALUES('rule','family');
                 INSERT INTO account_groups(id,household_id,name,group_kind,sort_order)
                 VALUES('group','family','Daily','DAILY_SPENDING',0);
                 INSERT INTO account_group_members(household_id,account_group_id,account_id,sort_order)
                 VALUES('family','group','bank',0);
                 INSERT INTO card_settlement_bank_mappings(household_id,card_account_id,bank_account_id)
                 VALUES('family','card','bank');
                 INSERT INTO dashboard_preferences(household_id,dashboard_template,theme,density)
                 VALUES('family','CASH_FLOW','DARK','COMPACT');
                 INSERT INTO delimited_parser_profiles(
                   id,household_id,name,delimiter,encoding,header_row,date_column,date_format,
                   description_column,amount_mode,signed_positive_direction,signed_amount_column,
                   is_enabled,priority,version)
                 VALUES('profile','family','Bank CSV','COMMA','CP932',1,'Date','YYYY_MM_DD',
                   'Description','SIGNED','OUT','Amount',1,10,1);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO recurring_series_preferences(
                   household_id,normalized_payee,decision)
                 VALUES('family','netflix','IGNORED')",
                [],
            )
            .unwrap();
    }

    fn seed_investment_graph(connection: &Connection) {
        connection.execute_batch(
            "INSERT INTO accounts(id,household_id,name,account_kind,account_subtype,currency)
             VALUES('broker','family','Brokerage','ASSET','SECURITIES','JPY');
             INSERT INTO import_runs(id,household_id,status) VALUES('investment-run','family','POSTED');
             INSERT INTO source_documents(
               id,household_id,import_run_id,source_type,original_filename,media_type,
               byte_size,sha256,storage_path)
             VALUES('investment-doc','family','investment-run','OTHER','assetbalance.csv','text/csv',5,
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','documents/aa');
             INSERT INTO source_records(
               id,source_document_id,row_number,record_hash,raw_payload_json)
             VALUES
               ('investment-row-1','investment-doc',1,
                '1111111111111111111111111111111111111111111111111111111111111111','{\"row\":1}'),
               ('investment-row-2','investment-doc',2,
                '2222222222222222222222222222222222222222222222222222222222222222','{\"row\":2}'),
               ('investment-row-3','investment-doc',3,
                '3333333333333333333333333333333333333333333333333333333333333333','{\"row\":3}'),
               ('investment-row-4','investment-doc',4,
                '4444444444444444444444444444444444444444444444444444444444444444','{\"row\":4}'),
               ('investment-row-5','investment-doc',5,
                '5555555555555555555555555555555555555555555555555555555555555555','{\"row\":5}');
             INSERT INTO portfolio_snapshots(
               id,household_id,account_id,source_document_id,as_of,market_value_jpy,
               cash_value_jpy,unrealized_pnl_jpy,realized_pnl_jpy)
             VALUES('portfolio','family','broker','investment-doc','2026-07-12T14:47:56+09:00',
                    120000,20000,10000,2000);
             INSERT INTO portfolio_asset_classes(
               id,portfolio_snapshot_id,name,market_value_jpy,unrealized_pnl_jpy,source_row)
             VALUES('asset-class','portfolio','国内株式',100000,10000,1);
             INSERT INTO position_snapshots(
               id,portfolio_snapshot_id,product_type,account_type,instrument_code,instrument_name,
               quantity,average_cost,market_price,market_value_jpy,unrealized_pnl_jpy,
               realized_pnl_jpy,currency,source_row)
             VALUES('position','portfolio','株式','特定','7203','トヨタ',10,9000,10000,
                    100000,10000,2000,'JPY',2);
             INSERT INTO portfolio_fx_rates(
               id,portfolio_snapshot_id,base_currency,quote_currency,rate,source_row)
             VALUES('snapshot-fx','portfolio','USD','JPY',150,3);
             INSERT INTO brokerage_events(
               id,household_id,account_id,source_document_id,source_row,event_type,trade_date,
               instrument_code,instrument_name,brokerage_account_type,currency,quantity,unit_price,
               gross_amount,fee_amount,tax_amount,settlement_amount,reconciliation_status,
               reconciliation_difference,raw_transaction_type)
             VALUES('buy','family','broker','investment-doc',2,'BUY','2026-07-01','7203','トヨタ',
                    '特定','JPY',1,1000,1000,0,0,1000,'BALANCED',0,'買付');
             INSERT INTO brokerage_event_legs(
               id,brokerage_event_id,line_number,leg_kind,signed_amount,currency,
               instrument_code,instrument_name,signed_quantity,description)
             VALUES('buy-security','buy',1,'SECURITY',1000,'JPY','7203','トヨタ',1,'買付'),
                   ('buy-cash','buy',2,'CASH',-1000,'JPY',NULL,NULL,NULL,'受渡');
             INSERT INTO investment_fx_rates(
               id,household_id,rate_date,base_currency,quote_currency,rate,source_kind,provider,
               source_document_id,source_row,observed_at)
             VALUES('fx-rate','family','2026-07-12','USD','JPY',150,'PORTFOLIO_SNAPSHOT',
                    'Money Forward','investment-doc',3,'2026-07-12T14:47:56+09:00');
             INSERT INTO investment_market_prices(
               id,household_id,price_date,instrument_code,instrument_name,currency,unit_price,
               source_kind,provider,source_document_id,source_row,observed_at)
             VALUES('market-price','family','2026-07-12','7203','トヨタ','JPY',10000,
                    'PORTFOLIO_SNAPSHOT','Money Forward','investment-doc',4,
                    '2026-07-12T14:47:56+09:00');
             INSERT INTO aggregate_asset_snapshots(
               id,household_id,source_document_id,source_row,as_of,total_assets_jpy)
             VALUES('aggregate-assets','family','investment-doc',5,'2026-07-12',120000);
             INSERT INTO aggregate_asset_components(
               aggregate_asset_snapshot_id,asset_class,official_header,value_jpy)
             VALUES('aggregate-assets','DEPOSITS_CASH_CRYPTO','預金・現金・暗号資産(円)',20000),
                   ('aggregate-assets','LISTED_STOCKS','株式(現物)(円)',100000);",
        ).unwrap();
    }

    fn replace_dashboard_layouts(connection: &Connection, household_id: &str) {
        connection
            .execute(
                "DELETE FROM dashboard_template_layouts WHERE household_id=?1",
                [household_id],
            )
            .unwrap();
        connection
            .execute_batch(&format!(
                "INSERT INTO dashboard_template_layouts(
                   household_id,dashboard_template,widget_order,hidden_widgets)
                 VALUES
                  ('{household_id}','FINANCIAL_OVERVIEW','[\"RECENT\",\"TREND\",\"SPENDING\",\"CARDS\"]','[\"CARDS\"]'),
                  ('{household_id}','HOUSEHOLD_LEDGER','[\"SPENDING\",\"TREND\",\"RECENT\",\"CARDS\"]','[\"TREND\"]'),
                  ('{household_id}','ASSETS_LIABILITIES','[\"CARDS\",\"TREND\",\"SPENDING\",\"RECENT\"]','[\"RECENT\"]'),
                  ('{household_id}','CARD_RECONCILIATION','[\"CARDS\",\"TREND\",\"RECENT\",\"SPENDING\"]','[\"SPENDING\"]'),
                  ('{household_id}','CASH_FLOW','[\"RECENT\",\"TREND\",\"CARDS\",\"SPENDING\"]','[\"CARDS\"]');"
            ))
            .unwrap();
    }

    #[test]
    fn complete_package_round_trips_all_covered_aggregates_without_echo() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        assert_eq!(package.covered_kinds, COVERED_KINDS);
        assert!(COVERED_KINDS
            .iter()
            .all(|kind| package.counts_by_kind.contains_key(*kind)));
        let bytes = encode_pretty(&package).unwrap();

        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Destination')",
                    [],
                )?;
                connection.execute_batch(
                    "INSERT INTO import_runs(id,household_id,status) VALUES('local-run','family','POSTED');
                     INSERT INTO source_documents(
                       id,household_id,import_run_id,source_type,original_filename,media_type,
                       byte_size,sha256,storage_path)
                     VALUES('portable-card-source','family','local-run','OTHER','different.csv',
                       'text/csv',1,
                       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                       'documents/different.csv');",
                )?;
                let destination_revision_before = export_current_state(connection, "family")
                    .unwrap()
                    .source_revision;
                let mut review = stage_package(connection, "family", &bytes).unwrap();
                let resolutions = review
                    .records
                    .iter()
                    .filter(|record| record.resolution == "PENDING")
                    .map(|record| ChangePackageResolutionInput {
                        entity_kind: record.entity_kind.clone(),
                        entity_id: record.entity_id.clone(),
                        resolution: "APPLY_INCOMING".to_owned(),
                    })
                    .collect::<Vec<_>>();
                if !resolutions.is_empty() {
                    review = resolve_package(connection, &review.package_id, &resolutions).unwrap();
                }
                assert_eq!(review.state, "READY");
                let capture_before: i64 = connection.query_row(
                    "SELECT count(*) FROM sync_local_change_capture",
                    [],
                    |row| row.get(0),
                )?;
                let applied = apply_package(connection, &review.package_id).unwrap();
                assert_eq!(applied.state, "APPLIED");
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM sync_local_change_capture",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    capture_before
                );
                let destination_package = export_current_state(connection, "family").unwrap();
                assert!(destination_package.source_revision > destination_revision_before);
                let source_hashes = package
                    .records
                    .iter()
                    .map(|record| {
                        (
                            (record.entity_kind.clone(), record.entity_id.clone()),
                            record.payload_sha256.clone(),
                        )
                    })
                    .collect::<BTreeMap<_, _>>();
                let destination_hashes = destination_package
                    .records
                    .iter()
                    .map(|record| {
                        (
                            (record.entity_kind.clone(), record.entity_id.clone()),
                            record.payload_sha256.clone(),
                        )
                    })
                    .collect::<BTreeMap<_, _>>();
                assert_eq!(destination_hashes, source_hashes);
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM transaction_portable_source_links
                         WHERE transaction_id='tx' AND source_record_id='source-row-1'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    1
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM card_statement_transactions
                         WHERE statement_id='statement-full' AND transaction_id='tx'
                           AND statement_line_number=1 AND billed_amount_jpy=1200",
                        [], |row| row.get::<_, i64>(0),
                    )?,
                    1
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM card_payments WHERE household_id='family'",
                        [], |row| row.get::<_, i64>(0),
                    )?,
                    2
                );
                assert!(
                    connection.query_row(
                        "SELECT source_document_id IS NULL FROM card_statements
                         WHERE id='statement-full'",
                        [], |row| row.get::<_, bool>(0),
                    )?
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT source_document_id FROM card_statement_portable_source_refs
                         WHERE statement_id='statement-full'",
                        [], |row| row.get::<_, String>(0),
                    )?,
                    "portable-card-source"
                );
                assert_eq!(
                    apply_package(connection, &review.package_id).unwrap().state,
                    "APPLIED"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn schema_five_exports_five_layouts_and_rejects_malformed_layout_graphs() {
        let state = AppState::in_memory(TEST_KEY).unwrap();
        let mut package = state
            .with_connection(|connection| {
                seed_complete_household(connection);
                replace_dashboard_layouts(connection, "family");
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        assert_eq!(package.schema_version, 5);
        assert_eq!(package.covered_kinds.len(), 19);
        let dashboard = package
            .records
            .iter()
            .find(|record| record.entity_kind == "DASHBOARD_PREFERENCES")
            .unwrap();
        let payload: Value = serde_json::from_str(&dashboard.canonical_payload_json).unwrap();
        let layouts = payload["templateLayouts"].as_array().unwrap();
        assert_eq!(layouts.len(), 5);
        assert_eq!(layouts[0]["dashboardTemplate"], "FINANCIAL_OVERVIEW");
        assert_eq!(layouts[4]["dashboardTemplate"], "CASH_FLOW");

        let dashboard = package
            .records
            .iter_mut()
            .find(|record| record.entity_kind == "DASHBOARD_PREFERENCES")
            .unwrap();
        let mut payload: Value = serde_json::from_str(&dashboard.canonical_payload_json).unwrap();
        payload["templateLayouts"].as_array_mut().unwrap().pop();
        dashboard.canonical_payload_json = canonical_json(&payload).unwrap();
        dashboard.payload_sha256 = sha256_hex(dashboard.canonical_payload_json.as_bytes());
        resign_package(&mut package);
        assert!(matches!(
            validate_package(&package),
            Err(ChangePackageError::InvalidInput)
        ));
    }

    #[test]
    fn schema_five_recurring_aggregate_is_canonical_and_rejects_invalid_decisions() {
        let state = AppState::in_memory(TEST_KEY).unwrap();
        let mut package = state
            .with_connection(|connection| {
                seed_complete_household(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        let recurring = package
            .records
            .iter()
            .find(|record| record.entity_kind == "RECURRING_SERIES_PREFERENCES")
            .unwrap();
        assert_eq!(recurring.entity_id, "family");
        let payload: Value = serde_json::from_str(&recurring.canonical_payload_json).unwrap();
        assert_eq!(payload["preferences"].as_array().unwrap().len(), 1);
        assert_eq!(payload["preferences"][0]["normalizedPayee"], "netflix");
        assert!(payload["preferences"][0].get("version").is_none());
        assert!(payload["preferences"][0].get("createdAt").is_none());
        assert!(payload["preferences"][0].get("updatedAt").is_none());
        assert!(!valid_recurring_series_preferences_v5(
            &json!({
                "recordKind": "RECURRING_SERIES_PREFERENCES",
                "householdId": "family",
                "preferences": [
                    { "normalizedPayee": "zeta", "decision": "CONFIRMED" },
                    { "normalizedPayee": "alpha", "decision": "IGNORED" }
                ]
            }),
            "family"
        ));
        assert!(!valid_recurring_series_preferences_v5(
            &json!({
                "recordKind": "RECURRING_SERIES_PREFERENCES",
                "householdId": "family",
                "preferences": [{
                    "normalizedPayee": "netflix",
                    "decision": "IGNORED",
                    "version": 1
                }]
            }),
            "family"
        ));

        let recurring = package
            .records
            .iter_mut()
            .find(|record| record.entity_kind == "RECURRING_SERIES_PREFERENCES")
            .unwrap();
        let mut payload: Value = serde_json::from_str(&recurring.canonical_payload_json).unwrap();
        payload["preferences"][0]["decision"] = Value::String("AUTO_DETECTED".into());
        recurring.canonical_payload_json = canonical_json(&payload).unwrap();
        recurring.payload_sha256 = sha256_hex(recurring.canonical_payload_json.as_bytes());
        resign_package(&mut package);
        assert!(matches!(
            validate_package(&package),
            Err(ChangePackageError::InvalidInput)
        ));
    }

    #[test]
    fn schema_five_apply_advances_local_version_without_capture_echo() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                seed_complete_household(connection);
                let local = crate::recurring_analytics::upsert_recurring_series_preference(
                    connection,
                    &crate::recurring_analytics::UpsertRecurringSeriesPreferenceInput {
                        household_id: "family".into(),
                        normalized_payee: "netflix".into(),
                        decision:
                            crate::recurring_analytics::RecurringPreferenceDecision::Confirmed,
                        expected_version: Some(1),
                    },
                )
                .unwrap();
                assert_eq!(local.version, 2);
                let bytes = encode_pretty(&package).unwrap();
                let review = stage_package(connection, "family", &bytes).unwrap();
                let resolutions = review
                    .records
                    .iter()
                    .filter(|record| record.resolution == "PENDING")
                    .map(|record| ChangePackageResolutionInput {
                        entity_kind: record.entity_kind.clone(),
                        entity_id: record.entity_id.clone(),
                        resolution: if record.entity_kind == "RECURRING_SERIES_PREFERENCES" {
                            "APPLY_INCOMING"
                        } else {
                            "KEEP_LOCAL"
                        }
                        .into(),
                    })
                    .collect::<Vec<_>>();
                let review = resolve_package(connection, &review.package_id, &resolutions).unwrap();
                let capture_before: i64 = connection.query_row(
                    "SELECT count(*) FROM sync_local_change_capture",
                    [],
                    |row| row.get(0),
                )?;
                apply_package(connection, &review.package_id).unwrap();
                let applied: (String, i64) = connection.query_row(
                    "SELECT decision,version FROM recurring_series_preferences
                     WHERE household_id='family' AND normalized_payee='netflix'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                assert_eq!(applied, ("IGNORED".into(), 3));
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM sync_local_change_capture",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    capture_before
                );
                assert!(
                    crate::recurring_analytics::upsert_recurring_series_preference(
                        connection,
                        &crate::recurring_analytics::UpsertRecurringSeriesPreferenceInput {
                            household_id: "family".into(),
                            normalized_payee: "netflix".into(),
                            decision:
                                crate::recurring_analytics::RecurringPreferenceDecision::Confirmed,
                            expected_version: Some(2),
                        },
                    )
                    .is_err()
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn recurring_aggregate_capture_tracks_complete_and_empty_state() {
        let state = AppState::in_memory(TEST_KEY).unwrap();
        state
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Family')",
                    [],
                )?;
                connection.execute("DELETE FROM sync_local_change_capture", [])?;
                connection.execute(
                    "INSERT INTO recurring_series_preferences(
                       household_id,normalized_payee,decision)
                     VALUES('family','netflix','CONFIRMED')",
                    [],
                )?;
                connection.execute(
                    "UPDATE recurring_series_preferences SET decision='IGNORED',version=2
                     WHERE household_id='family' AND normalized_payee='netflix'",
                    [],
                )?;
                connection.execute(
                    "DELETE FROM recurring_series_preferences
                     WHERE household_id='family' AND normalized_payee='netflix'",
                    [],
                )?;
                let captures: Vec<(String, String)> = {
                    let mut statement = connection.prepare(
                        "SELECT operation,payload_json FROM sync_local_change_capture
                         WHERE entity_kind='RECURRING_SERIES_PREFERENCES'
                         ORDER BY capture_sequence",
                    )?;
                    let captures = statement
                        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                        .collect::<std::result::Result<Vec<_>, _>>()?;
                    captures
                };
                assert_eq!(captures.len(), 3);
                assert!(captures.iter().all(|capture| capture.0 == "UPSERT"));
                let first: Value = serde_json::from_str(&captures[0].1).unwrap();
                let last: Value = serde_json::from_str(&captures[2].1).unwrap();
                assert_eq!(first["preferences"].as_array().unwrap().len(), 1);
                assert!(first["preferences"][0].get("version").is_none());
                assert!(first["preferences"][0].get("createdAt").is_none());
                assert!(first["preferences"][0].get("updatedAt").is_none());
                assert!(last["preferences"].as_array().unwrap().is_empty());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn schema_four_package_remains_valid_and_does_not_replace_recurring_preferences() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let mut package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        package.schema_version = 4;
        package.covered_kinds = V4_COVERED_KINDS.iter().map(|kind| (*kind).into()).collect();
        package
            .records
            .retain(|record| package.covered_kinds.contains(&record.entity_kind));
        package.counts_by_kind = package
            .covered_kinds
            .iter()
            .map(|kind| {
                (
                    kind.clone(),
                    package
                        .records
                        .iter()
                        .filter(|record| &record.entity_kind == kind)
                        .count() as u64,
                )
            })
            .collect();
        resign_package(&mut package);
        validate_package(&package).unwrap();

        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                seed_complete_household(connection);
                connection.execute(
                    "UPDATE recurring_series_preferences
                     SET decision='CONFIRMED',version=2 WHERE household_id='family'",
                    [],
                )?;
                let review =
                    stage_package(connection, "family", &encode_pretty(&package).unwrap()).unwrap();
                assert!(review
                    .records
                    .iter()
                    .all(|record| record.entity_kind != "RECURRING_SERIES_PREFERENCES"));
                assert_eq!(connection.query_row(
                    "SELECT decision FROM recurring_series_preferences WHERE household_id='family'",
                    [],
                    |row| row.get::<_, String>(0),
                )?, "CONFIRMED");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn family_snapshot_apply_guard_resolves_origin_qualified_evidence() {
        let state = AppState::in_memory(TEST_KEY).unwrap();
        state
            .with_connection(|connection| {
                connection.execute_batch(
                    "INSERT INTO households(id,name) VALUES('family','Family');
                     INSERT INTO import_runs(id,household_id,status)
                     VALUES('local-run','family','POSTED');
                     INSERT INTO source_documents(
                       id,household_id,import_run_id,source_type,original_filename,media_type,
                       byte_size,sha256,storage_path)
                     VALUES('local-doc','family','local-run','OTHER','portfolio.csv','text/csv',1,
                       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','a');
                     INSERT INTO evidence_import_run_aliases(
                       household_id,origin_installation_id,portable_import_run_id,local_import_run_id)
                     VALUES('family','origin-a','portable-run','local-run');
                     INSERT INTO evidence_source_document_aliases(
                       household_id,origin_installation_id,portable_document_id,
                       portable_import_run_id,local_document_id,content_sha256)
                     VALUES('family','origin-a','portable-doc','portable-run','local-doc',
                       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
                     INSERT INTO family_snapshot_sets(
                       snapshot_set_id,target_household_id,source_installation_id,
                       source_principal_id,publisher_member_id,source_revision,set_sha256,
                       manifest_json,state,record_count,conflict_count,delete_count,
                       source_created_at,reviewed_at,schema_version)
                     VALUES('family-set','family','origin-a','principal-a','member-a',1,
                       'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                       '{}','READY',0,0,0,'2026-07-14T00:00:00Z',
                       '2026-07-14T00:00:00Z',2);
                     INSERT INTO sync_apply_guard(household_id,package_id)
                     VALUES('family','family-set');",
                )?;
                assert_eq!(
                    resolve_source_document_alias_under_apply_guard(
                        connection,
                        "family",
                        "origin-a",
                        "portable-doc"
                    )
                    .unwrap(),
                    "local-doc"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn confirmed_card_payment_upsert_is_idempotent_and_immutable() {
        let state = AppState::in_memory(TEST_KEY).unwrap();
        state
            .with_connection(|connection| {
                seed_complete_household(connection);
                let payload: String = connection.query_row(
                    "SELECT payload_json FROM sync_card_payment_payloads
                     WHERE payment_id='payment-full'",
                    [],
                    |row| row.get(0),
                )?;
                materialize_card_payment(connection, &payload).unwrap();
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM card_payments WHERE id='payment-full'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    1
                );
                let mut changed: Value = serde_json::from_str(&payload).unwrap();
                changed["paymentAmountJpy"] = json!(1_300);
                assert!(
                    materialize_card_payment(connection, &canonical_json(&changed).unwrap())
                        .is_err()
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT payment_amount_jpy FROM card_payments WHERE id='payment-full'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    1_200
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn schema_three_apply_preserves_all_destination_template_layouts() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let mut package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                connection.execute(
                    "UPDATE dashboard_preferences SET theme='LIGHT' WHERE household_id='family'",
                    [],
                )?;
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        package.schema_version = 3;
        resign_package(&mut package);
        validate_package(&package).unwrap();

        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                seed_complete_household(connection);
                replace_dashboard_layouts(connection, "family");
                let before: String = connection.query_row(
                    "SELECT json_group_array(json_object(
                       'template',dashboard_template,'order',json(widget_order),
                       'hidden',json(hidden_widgets)))
                     FROM (SELECT * FROM dashboard_template_layouts
                           WHERE household_id='family' ORDER BY dashboard_template)",
                    [],
                    |row| row.get(0),
                )?;
                let review =
                    stage_package(connection, "family", &encode_pretty(&package).unwrap()).unwrap();
                let dashboard = review
                    .records
                    .iter()
                    .find(|record| record.entity_kind == "DASHBOARD_PREFERENCES")
                    .unwrap();
                assert_eq!(dashboard.review_state, "CONFLICT");
                let resolutions = review
                    .records
                    .iter()
                    .filter(|record| record.resolution == "PENDING")
                    .map(|record| ChangePackageResolutionInput {
                        entity_kind: record.entity_kind.clone(),
                        entity_id: record.entity_id.clone(),
                        resolution: if record.entity_kind == "DASHBOARD_PREFERENCES" {
                            "APPLY_INCOMING"
                        } else {
                            "KEEP_LOCAL"
                        }
                        .to_owned(),
                    })
                    .collect::<Vec<_>>();
                let review = if resolutions.is_empty() {
                    review
                } else {
                    resolve_package(connection, &review.package_id, &resolutions).unwrap()
                };
                assert_eq!(
                    apply_package(connection, &review.package_id).unwrap().state,
                    "APPLIED"
                );
                let after: String = connection.query_row(
                    "SELECT json_group_array(json_object(
                       'template',dashboard_template,'order',json(widget_order),
                       'hidden',json(hidden_widgets)))
                     FROM (SELECT * FROM dashboard_template_layouts
                           WHERE household_id='family' ORDER BY dashboard_template)",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(after, before);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn schema_four_layout_only_edit_is_captured_and_blocks_stale_apply_without_echo() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                replace_dashboard_layouts(connection, "family");
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                seed_complete_household(connection);
                replace_dashboard_layouts(connection, "family");
                let review =
                    stage_package(connection, "family", &encode_pretty(&package).unwrap()).unwrap();
                let resolutions = review
                    .records
                    .iter()
                    .filter(|record| record.resolution == "PENDING")
                    .map(|record| ChangePackageResolutionInput {
                        entity_kind: record.entity_kind.clone(),
                        entity_id: record.entity_id.clone(),
                        resolution: if record.entity_kind == "DASHBOARD_PREFERENCES" {
                            "APPLY_INCOMING"
                        } else {
                            "KEEP_LOCAL"
                        }
                        .to_owned(),
                    })
                    .collect::<Vec<_>>();
                let review = if resolutions.is_empty() {
                    review
                } else {
                    resolve_package(connection, &review.package_id, &resolutions).unwrap()
                };
                assert_eq!(review.state, "READY");
                let capture_before: i64 = connection.query_row(
                    "SELECT count(*) FROM sync_local_change_capture",
                    [],
                    |row| row.get(0),
                )?;
                connection.execute(
                    "UPDATE dashboard_template_layouts
                     SET hidden_widgets='[]' WHERE household_id='family'
                       AND dashboard_template='FINANCIAL_OVERVIEW'",
                    [],
                )?;
                let capture_after: i64 = connection.query_row(
                    "SELECT count(*) FROM sync_local_change_capture",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(capture_after, capture_before + 1);
                assert!(matches!(
                    apply_package(connection, &review.package_id),
                    Err(ChangePackageError::Conflict)
                ));
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn dashboard_layout_replacement_capture_finishes_complete_and_parent_delete_is_tombstone() {
        let state = AppState::in_memory(TEST_KEY).unwrap();
        state
            .with_connection(|connection| {
                seed_complete_household(connection);
                replace_dashboard_layouts(connection, "family");
                connection.execute("DELETE FROM sync_local_change_capture", [])?;
                connection.execute(
                    "DELETE FROM dashboard_template_layouts
                     WHERE household_id='family' AND dashboard_template='FINANCIAL_OVERVIEW'",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO dashboard_template_layouts(
                       household_id,dashboard_template,widget_order,hidden_widgets)
                     VALUES('family','FINANCIAL_OVERVIEW',
                       '[\"TREND\",\"SPENDING\",\"RECENT\",\"CARDS\"]','[\"RECENT\"]')",
                    [],
                )?;
                let latest_payload: String = connection.query_row(
                    "SELECT payload_json FROM sync_local_change_capture
                     WHERE entity_kind='DASHBOARD_PREFERENCES'
                     ORDER BY capture_sequence DESC LIMIT 1",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(
                    serde_json::from_str::<Value>(&latest_payload).unwrap()["templateLayouts"]
                        .as_array()
                        .unwrap()
                        .len(),
                    5
                );
                connection.execute("DELETE FROM sync_local_change_capture", [])?;
                connection.execute(
                    "DELETE FROM dashboard_preferences WHERE household_id='family'",
                    [],
                )?;
                assert_eq!(
                    connection.query_row(
                        "SELECT group_concat(operation,',') FROM sync_local_change_capture
                         WHERE entity_kind='DASHBOARD_PREFERENCES'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "DELETE"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn schema_one_packages_remain_valid_and_do_not_delete_card_graphs() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let mut package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        package.schema_version = 1;
        package.covered_kinds = LEGACY_COVERED_KINDS
            .iter()
            .map(|kind| (*kind).to_owned())
            .collect();
        package
            .records
            .retain(|record| package.covered_kinds.contains(&record.entity_kind));
        package.counts_by_kind = package
            .covered_kinds
            .iter()
            .map(|kind| {
                (
                    kind.clone(),
                    package
                        .records
                        .iter()
                        .filter(|record| &record.entity_kind == kind)
                        .count() as u64,
                )
            })
            .collect();
        resign_package(&mut package);
        validate_package(&package).unwrap();

        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                seed_complete_household(connection);
                let review =
                    stage_package(connection, "family", &encode_pretty(&package).unwrap()).unwrap();
                assert!(review.records.iter().all(|record| !matches!(
                    record.entity_kind.as_str(),
                    "CARD_STATEMENT" | "CARD_PAYMENT"
                )));
                assert_eq!(
                    connection
                        .query_row("SELECT count(*) FROM card_statements", [], |row| row
                            .get::<_, i64>(0))?,
                    2
                );
                assert_eq!(
                    connection.query_row("SELECT count(*) FROM card_payments", [], |row| row
                        .get::<_, i64>(0))?,
                    2
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn schema_two_packages_remain_valid_and_do_not_delete_investment_graphs() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let mut package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        package.schema_version = 2;
        package.covered_kinds = V2_COVERED_KINDS
            .iter()
            .map(|kind| (*kind).to_owned())
            .collect();
        package
            .records
            .retain(|record| package.covered_kinds.contains(&record.entity_kind));
        package.counts_by_kind = package
            .covered_kinds
            .iter()
            .map(|kind| {
                (
                    kind.clone(),
                    package
                        .records
                        .iter()
                        .filter(|record| &record.entity_kind == kind)
                        .count() as u64,
                )
            })
            .collect();
        resign_package(&mut package);
        validate_package(&package).unwrap();

        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                seed_complete_household(connection);
                seed_investment_graph(connection);
                let review =
                    stage_package(connection, "family", &encode_pretty(&package).unwrap()).unwrap();
                assert!(review.records.iter().all(|record| !matches!(
                    record.entity_kind.as_str(),
                    "PORTFOLIO_SNAPSHOT"
                        | "BROKERAGE_EVENT"
                        | "INVESTMENT_FX_RATE"
                        | "INVESTMENT_MARKET_PRICE"
                        | "AGGREGATE_ASSET_SNAPSHOT"
                )));
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM portfolio_snapshots",
                        [],
                        |row| { row.get::<_, i64>(0) }
                    )?,
                    1
                );
                assert_eq!(
                    connection.query_row("SELECT count(*) FROM brokerage_events", [], |row| {
                        row.get::<_, i64>(0)
                    })?,
                    1
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn mixed_card_conflict_choices_cannot_commit_a_stale_statement_status() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                connection.execute_batch(
                    "DELETE FROM card_payments WHERE id='payment-full';
                     UPDATE journal_entries SET amount_jpy=1300
                     WHERE transaction_id='payment-tx';
                     UPDATE card_statements SET statement_amount_jpy=1300
                     WHERE id='statement-full';
                     INSERT INTO card_payments(
                       id,household_id,statement_id,bank_transaction_id,card_account_id,
                       payment_amount_jpy,payment_on,match_score_bps,reconciliation_status,confirmed_at)
                     VALUES('payment-full','family','statement-full','payment-tx','card',1300,
                       '2026-07-27',10000,'FULLY_RECONCILED','2026-07-27T00:00:00Z');",
                )?;
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                seed_complete_household(connection);
                let review =
                    stage_package(connection, "family", &encode_pretty(&package).unwrap()).unwrap();
                let resolutions = review
                    .records
                    .iter()
                    .filter(|record| record.resolution == "PENDING")
                    .map(|record| ChangePackageResolutionInput {
                        entity_kind: record.entity_kind.clone(),
                        entity_id: record.entity_id.clone(),
                        resolution: if record.entity_kind == "CARD_STATEMENT"
                            && record.entity_id == "statement-full"
                        {
                            "KEEP_LOCAL"
                        } else {
                            "APPLY_INCOMING"
                        }
                        .to_owned(),
                    })
                    .collect::<Vec<_>>();
                let ready = resolve_package(connection, &review.package_id, &resolutions).unwrap();
                assert!(matches!(
                    apply_package(connection, &ready.package_id),
                    Err(ChangePackageError::Conflict)
                ));
                assert_eq!(
                    connection.query_row(
                        "SELECT payment_amount_jpy FROM card_payments WHERE id='payment-full'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    1200
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT state FROM change_packages WHERE package_id=?1",
                        [&ready.package_id],
                        |row| row.get::<_, String>(0),
                    )?,
                    "READY"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn confirmed_payment_with_two_card_liability_debits_rolls_back() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                connection.execute_batch(
                    "DELETE FROM card_payments WHERE id='payment-full';
                     INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                     VALUES('card-2','family','Second card','LIABILITY','CREDIT_CARD');
                     INSERT INTO journal_entries(
                       id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                     VALUES('extra-card-debit','payment-tx','card-2','DEBIT',100,3),
                           ('extra-bank-credit','payment-tx','bank','CREDIT',100,4);
                     INSERT INTO card_payments(
                       id,household_id,statement_id,bank_transaction_id,card_account_id,
                       payment_amount_jpy,payment_on,match_score_bps,reconciliation_status,confirmed_at)
                     VALUES('payment-full','family','statement-full','payment-tx','card',1200,
                       '2026-07-27',10000,'FULLY_RECONCILED','2026-07-27T00:00:00Z');",
                )?;
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Destination')",
                    [],
                )?;
                let review =
                    stage_package(connection, "family", &encode_pretty(&package).unwrap()).unwrap();
                let resolutions = review
                    .records
                    .iter()
                    .filter(|record| record.resolution == "PENDING")
                    .map(|record| ChangePackageResolutionInput {
                        entity_kind: record.entity_kind.clone(),
                        entity_id: record.entity_id.clone(),
                        resolution: "APPLY_INCOMING".to_owned(),
                    })
                    .collect::<Vec<_>>();
                let ready = if resolutions.is_empty() {
                    review
                } else {
                    resolve_package(connection, &review.package_id, &resolutions).unwrap()
                };
                assert!(matches!(
                    apply_package(connection, &ready.package_id),
                    Err(ChangePackageError::Conflict)
                ));
                assert_eq!(
                    connection.query_row("SELECT count(*) FROM accounts", [], |row| row
                        .get::<_, i64>(0))?,
                    0
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT state FROM change_packages WHERE package_id=?1",
                        [&ready.package_id],
                        |row| row.get::<_, String>(0),
                    )?,
                    "READY"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn tampering_and_post_stage_destination_edits_are_rejected() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        let mut tampered = package.clone();
        tampered.records[0].canonical_payload_json.push(' ');
        assert!(matches!(
            validate_package(&tampered),
            Err(ChangePackageError::InvalidInput)
        ));

        let bytes = encode_pretty(&package).unwrap();
        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Destination')",
                    [],
                )?;
                let review = stage_package(connection, "family", &bytes).unwrap();
                let resolutions = review
                    .records
                    .iter()
                    .filter(|record| record.resolution == "PENDING")
                    .map(|record| ChangePackageResolutionInput {
                        entity_kind: record.entity_kind.clone(),
                        entity_id: record.entity_id.clone(),
                        resolution: "APPLY_INCOMING".to_owned(),
                    })
                    .collect::<Vec<_>>();
                let ready = resolve_package(connection, &review.package_id, &resolutions).unwrap();
                connection.execute(
                    "UPDATE households SET name='Edited after review' WHERE id='family'",
                    [],
                )?;
                assert!(matches!(
                    apply_package(connection, &ready.package_id),
                    Err(ChangePackageError::Conflict)
                ));
                assert_eq!(
                    connection.query_row(
                        "SELECT state FROM change_packages WHERE package_id=?1",
                        [&ready.package_id],
                        |row| row.get::<_, String>(0)
                    )?,
                    "READY"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn failed_dependency_delete_rolls_back_the_whole_package() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Incoming')",
                    [],
                )?;
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        let bytes = encode_pretty(&package).unwrap();
        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination.with_connection(|connection| {
            connection.execute_batch(
                "INSERT INTO households(id,name) VALUES('family','Before apply');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('asset','family','Asset','ASSET','BANK'),
                       ('expense','family','Expense','EXPENSE','OTHER');
                 INSERT INTO transactions(id,household_id,occurred_on,transaction_type,status)
                 VALUES('local-tx','family','2026-07-13','EXPENSE','POSTED');
                 INSERT INTO journal_entries(id,transaction_id,account_id,entry_side,amount_jpy,line_number)
                 VALUES('local-d','local-tx','expense','DEBIT',500,1),
                       ('local-c','local-tx','asset','CREDIT',500,2);",
            )?;
            let review = stage_package(connection, "family", &bytes).unwrap();
            let resolutions = review.records.iter().filter(|record| record.resolution == "PENDING")
                .map(|record| ChangePackageResolutionInput {
                    entity_kind: record.entity_kind.clone(), entity_id: record.entity_id.clone(),
                    resolution: if record.entity_kind == "TRANSACTION" { "KEEP_LOCAL" } else { "APPLY_INCOMING" }.to_owned(),
                }).collect::<Vec<_>>();
            let ready = resolve_package(connection, &review.package_id, &resolutions).unwrap();
            assert!(matches!(apply_package(connection, &ready.package_id), Err(ChangePackageError::Database(_))));
            assert_eq!(connection.query_row("SELECT name FROM households WHERE id='family'", [], |row| row.get::<_, String>(0))?, "Before apply");
            assert_eq!(connection.query_row("SELECT count(*) FROM accounts WHERE household_id='family'", [], |row| row.get::<_, i64>(0))?, 2);
            assert_eq!(connection.query_row("SELECT state FROM change_packages WHERE package_id=?1", [&ready.package_id], |row| row.get::<_, String>(0))?, "READY");
            assert_eq!(connection.query_row("SELECT count(*) FROM sync_apply_guard", [], |row| row.get::<_, i64>(0))?, 0);
            Ok(())
        }).unwrap();
    }

    #[test]
    fn rejected_package_can_be_staged_again_and_cross_household_ids_are_blocked() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source.with_connection(|connection| {
            connection.execute("INSERT INTO households(id,name) VALUES('family','Incoming')", [])?;
            connection.execute("INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES('shared-id','family','Incoming bank','ASSET','BANK')", [])?;
            Ok(export_current_state(connection, "family").unwrap())
        }).unwrap();
        let bytes = encode_pretty(&package).unwrap();

        let retry_destination = AppState::in_memory(TEST_KEY).unwrap();
        retry_destination
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Destination')",
                    [],
                )?;
                let staged = stage_package(connection, "family", &bytes).unwrap();
                discard_package(connection, &staged.package_id).unwrap();
                let restaged = stage_package(connection, "family", &bytes).unwrap();
                assert_ne!(restaged.state, "REJECTED");
                Ok(())
            })
            .unwrap();

        let collision_destination = AppState::in_memory(TEST_KEY).unwrap();
        collision_destination
            .with_connection(|connection| {
                connection.execute_batch(
                "INSERT INTO households(id,name) VALUES('family','Destination'),('other','Other');
                 INSERT INTO accounts(id,household_id,name,account_kind,account_subtype)
                 VALUES('shared-id','other','Other bank','ASSET','BANK');",
            )?;
                assert!(matches!(
                    stage_package(connection, "family", &bytes),
                    Err(ChangePackageError::Conflict)
                ));
                assert_eq!(
                    connection.query_row(
                        "SELECT name FROM accounts WHERE id='shared-id'",
                        [],
                        |row| row.get::<_, String>(0)
                    )?,
                    "Other bank"
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn incoming_transaction_cannot_silently_drop_actual_local_source_links() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        let bytes = encode_pretty(&package).unwrap();
        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination.with_connection(|connection| {
            seed_complete_household(connection);
            connection.execute_batch(
                "INSERT INTO import_runs(id,household_id,status) VALUES('run','family','POSTED');
                 INSERT INTO source_documents(
                   id,household_id,import_run_id,source_type,original_filename,media_type,
                   byte_size,sha256,storage_path)
                 VALUES('doc','family','run','OTHER','local.csv','text/csv',0,
                   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','object');
                 INSERT INTO source_records(id,source_document_id,row_number,record_hash,raw_payload_json)
                 VALUES('actual-row','doc',1,
                   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','{}');
                 INSERT INTO transaction_sources(transaction_id,source_record_id)
                 VALUES('tx','actual-row');",
            )?;
            let review = stage_package(connection, "family", &bytes).unwrap();
            let resolutions = review.records.iter().filter(|record| record.resolution == "PENDING")
                .map(|record| ChangePackageResolutionInput {
                    entity_kind: record.entity_kind.clone(), entity_id: record.entity_id.clone(),
                    resolution: "APPLY_INCOMING".to_owned(),
                }).collect::<Vec<_>>();
            let ready = resolve_package(connection, &review.package_id, &resolutions).unwrap();
            assert!(matches!(apply_package(connection, &ready.package_id), Err(ChangePackageError::Conflict)));
            assert_eq!(connection.query_row(
                "SELECT count(*) FROM transaction_sources WHERE transaction_id='tx' AND source_record_id='actual-row'",
                [], |row| row.get::<_, i64>(0))?, 1);
            assert_eq!(connection.query_row("SELECT state FROM change_packages WHERE package_id=?1", [&ready.package_id], |row| row.get::<_, String>(0))?, "READY");
            Ok(())
        }).unwrap();
    }

    #[test]
    fn schema_three_round_trips_confirmed_investment_graph_after_evidence_hydration() {
        let source = AppState::in_memory(TEST_KEY).unwrap();
        let package = source
            .with_connection(|connection| {
                seed_complete_household(connection);
                seed_investment_graph(connection);
                Ok(export_current_state(connection, "family").unwrap())
            })
            .unwrap();
        for kind in [
            "PORTFOLIO_SNAPSHOT",
            "BROKERAGE_EVENT",
            "INVESTMENT_FX_RATE",
            "INVESTMENT_MARKET_PRICE",
            "AGGREGATE_ASSET_SNAPSHOT",
        ] {
            assert_eq!(package.counts_by_kind.get(kind), Some(&1));
        }
        let expected = package
            .records
            .iter()
            .filter(|record| {
                dependency_rank(&record.entity_kind) == 3 && record.entity_kind != "TRANSACTION"
            })
            .map(|record| {
                (
                    (record.entity_kind.clone(), record.entity_id.clone()),
                    record.payload_sha256.clone(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let bytes = encode_pretty(&package).unwrap();

        let destination = AppState::in_memory(TEST_KEY).unwrap();
        destination
            .with_connection(|connection| {
                connection.execute(
                    "INSERT INTO households(id,name) VALUES('family','Destination')",
                    [],
                )?;
                connection.execute_batch(
                    "INSERT INTO import_runs(id,household_id,status)
                     VALUES('hydrated-run','family','POSTED');
                     INSERT INTO source_documents(
                       id,household_id,import_run_id,source_type,original_filename,media_type,
                       byte_size,sha256,storage_path)
                     VALUES('hydrated-doc','family','hydrated-run','OTHER','assetbalance.csv',
                       'text/csv',5,
                       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                       'documents/hydrated');
                     INSERT INTO source_records(
                       id,source_document_id,row_number,record_hash,raw_payload_json)
                     VALUES
                       ('hydrated-row-1','hydrated-doc',1,
                        '1111111111111111111111111111111111111111111111111111111111111111','{\"row\":1}'),
                       ('hydrated-row-2','hydrated-doc',2,
                        '2222222222222222222222222222222222222222222222222222222222222222','{\"row\":2}'),
                       ('hydrated-row-3','hydrated-doc',3,
                        '3333333333333333333333333333333333333333333333333333333333333333','{\"row\":3}'),
                       ('hydrated-row-4','hydrated-doc',4,
                        '4444444444444444444444444444444444444444444444444444444444444444','{\"row\":4}'),
                       ('hydrated-row-5','hydrated-doc',5,
                        '5555555555555555555555555555555555555555555555555555555555555555','{\"row\":5}');",
                )?;
                connection.execute(
                    "INSERT INTO evidence_import_run_aliases(
                       household_id,origin_installation_id,portable_import_run_id,local_import_run_id)
                     VALUES('family',?1,'investment-run','hydrated-run')",
                    [&package.source_installation_id],
                )?;
                connection.execute(
                    "INSERT INTO evidence_source_document_aliases(
                       household_id,origin_installation_id,portable_document_id,
                       portable_import_run_id,local_document_id,content_sha256)
                     VALUES('family',?1,'investment-doc','investment-run','hydrated-doc',
                       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')",
                    [&package.source_installation_id],
                )?;
                for (kind, id, row) in [
                    ("PORTFOLIO_SNAPSHOT", "portfolio", None),
                    ("BROKERAGE_EVENT", "buy", Some(2_i64)),
                    ("INVESTMENT_FX_RATE", "fx-rate", Some(3_i64)),
                    ("INVESTMENT_MARKET_PRICE", "market-price", Some(4_i64)),
                    ("AGGREGATE_ASSET_SNAPSHOT", "aggregate-assets", Some(5_i64)),
                ] {
                    connection.execute(
                        "INSERT INTO investment_portable_source_refs(
                           household_id,entity_kind,entity_id,origin_installation_id,
                           source_document_id,source_row)
                         VALUES('family',?1,?2,?3,'investment-doc',?4)",
                        params![kind, id, package.source_installation_id, row],
                    )?;
                }
                let mut review = stage_package(connection, "family", &bytes).unwrap();
                let resolutions = review
                    .records
                    .iter()
                    .filter(|record| record.resolution == "PENDING")
                    .map(|record| ChangePackageResolutionInput {
                        entity_kind: record.entity_kind.clone(),
                        entity_id: record.entity_id.clone(),
                        resolution: "APPLY_INCOMING".to_owned(),
                    })
                    .collect::<Vec<_>>();
                if !resolutions.is_empty() {
                    review = resolve_package(connection, &review.package_id, &resolutions).unwrap();
                }
                assert_eq!(apply_package(connection, &review.package_id).unwrap().state, "APPLIED");
                let actual = export_current_state(connection, "family")
                    .unwrap()
                    .records
                    .into_iter()
                    .filter(|record| dependency_rank(&record.entity_kind) == 3
                        && record.entity_kind != "TRANSACTION")
                    .map(|record| {
                        ((record.entity_kind, record.entity_id), record.payload_sha256)
                    })
                    .collect::<BTreeMap<_, _>>();
                assert_eq!(actual, expected);
                assert_eq!(
                    connection.query_row(
                        "SELECT source_document_id FROM portfolio_snapshots WHERE id='portfolio'",
                        [],
                        |row| row.get::<_, String>(0),
                    )?,
                    "hydrated-doc"
                );
                assert_eq!(
                    connection.query_row(
                        "SELECT count(*) FROM brokerage_event_legs WHERE brokerage_event_id='buy'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )?,
                    2
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn investment_graph_validator_rejects_unbalanced_portable_brokerage_facts() {
        let state = AppState::in_memory(TEST_KEY).unwrap();
        state
            .with_connection(|connection| {
                seed_complete_household(connection);
                seed_investment_graph(connection);
                connection.execute("UPDATE accounts SET is_archived=1 WHERE id='broker'", [])?;
                validate_investment_graph(connection, "family").unwrap();
                let portfolio_payload: String = connection.query_row(
                    "SELECT payload_json FROM sync_portfolio_snapshot_payloads
                     WHERE snapshot_id='portfolio'",
                    [],
                    |row| row.get(0),
                )?;
                connection.execute(
                    "DELETE FROM source_records
                     WHERE source_document_id='investment-doc' AND row_number=1",
                    [],
                )?;
                assert!(matches!(
                    validate_portfolio_source_rows(
                        connection,
                        &portfolio_payload,
                        "investment-doc"
                    ),
                    Err(ChangePackageError::Conflict)
                ));
                connection.execute(
                    "UPDATE brokerage_event_legs SET signed_amount=-900 WHERE id='buy-cash'",
                    [],
                )?;
                assert!(matches!(
                    validate_investment_graph(connection, "family"),
                    Err(ChangePackageError::Conflict)
                ));
                Ok(())
            })
            .unwrap();
    }
}
