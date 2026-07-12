pub mod account_groups_export;
pub mod backup;
pub mod brokerage;
pub mod document_extract;
pub mod document_vault;
pub mod financial_calendar;
mod folder_discovery;
pub mod forecast_action;
pub mod import_workflow;
pub mod investment_fx;
pub mod investment_market;
pub mod investment_performance;
mod key_store;
pub mod ocr;
mod persistence;
pub mod portfolio;
mod private_fs;
mod read_model;
mod record_scope;
pub mod recurring_analytics;
pub mod restore;
pub mod source_pdf_preview;
pub mod source_preview;
mod source_viewer;
pub mod watched_folders;

use account_groups_export::{
    AccountGroupDto, CreateAccountGroupInput, ExportCsvDto, ExportCsvRequest, ExportSavedDto,
    ReorderAccountGroupsInput, UpdateAccountGroupInput,
};
use brokerage::{
    BrokerageHistoryDto, BrokerageHistoryRequest, BrokerageImportSummaryDto,
    ImportBrokerageEventsInput,
};
use document_vault::DocumentVault;
use import_workflow::{
    CardMatchConfirmation, CommitSummary, ImportPreview, ImportSummary, PostingDecision,
    StartImport,
};
use investment_fx::{
    ImportInvestmentFxRatesInput, InvestmentFxImportSummaryDto, InvestmentFxRateDto,
    InvestmentFxRatesRequest, InvestmentReportingDto, InvestmentReportingRequest,
};
use investment_market::{
    ImportInvestmentMarketPricesInput, InvestmentMarketPriceDto,
    InvestmentMarketPriceImportSummaryDto, InvestmentMarketPricesRequest, InvestmentValuationDto,
    InvestmentValuationRequest,
};
use investment_performance::{
    InvestmentHoldingsDto, InvestmentHoldingsRequest, InvestmentPerformanceDto,
    InvestmentPerformanceRequest,
};
use key_store::{OsDatabaseKeyProvider, OsRestoreCredentialStore};
use persistence::AppState;
use portfolio::{
    ImportPortfolioSnapshotInput, PortfolioSnapshotDetailDto, PortfolioSnapshotSummaryDto,
};
use read_model::{
    AccountDto, AccountingBasis, AppliedClassificationDto, ApplyClassificationRuleInput,
    ArchiveAccountInput, CardSettlementDto, ClassificationPreviewDto, ClassificationPreviewInput,
    ClassificationRuleDto, CreateAccountInput, CreateClassificationRuleInput, CreateHouseholdInput,
    CreateHouseholdMemberInput, CreateManualTransactionInput, CreateSavingsGoalInput,
    DashboardMonthlyTotalsDto, HouseholdDto, HouseholdMemberDto, ImportRunCountsDto,
    MonthlyCategoryBudgetDto, RenameAccountInput, SavingsGoalDto, TransactionDetailDto,
    TransactionPageDto, TransactionPageRequest, TransactionRowDto, UpdateAccountOwnershipInput,
    UpdateClassificationRuleInput, UpdateHouseholdMemberInput, UpdatePostedTransactionInput,
    UpdateSavingsGoalInput, UpsertMonthlyCategoryBudgetInput,
};
use record_scope::AttributionScope;
use recurring_analytics::{FinancialIntelligenceDto, FinancialIntelligenceRequest};
use serde::{Deserialize, Serialize};
use source_viewer::{
    SourceDocumentViewDto, SourceRecordPageDto, SourceRecordPageRequest, SourceRecordViewDto,
    UpdateSourceDocumentAudienceInput,
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use zeroize::Zeroizing;

struct BackupPaths {
    app_data_root: std::path::PathBuf,
    database: std::path::PathBuf,
    vault: std::path::PathBuf,
}

struct BackupMasterKey(Zeroizing<[u8; 32]>);

#[derive(Default)]
struct RestoreCommandAuthorization {
    operation_gate: std::sync::Mutex<()>,
    prepared_fingerprint: std::sync::Mutex<Option<[u8; 32]>>,
}

impl RestoreCommandAuthorization {
    fn clear(&self) -> Result<(), String> {
        *self
            .prepared_fingerprint
            .lock()
            .map_err(|_| "Restore authorization is unavailable".to_owned())? = None;
        Ok(())
    }

    fn authorize(&self, fingerprint: [u8; 32]) -> Result<(), String> {
        *self
            .prepared_fingerprint
            .lock()
            .map_err(|_| "Restore authorization is unavailable".to_owned())? = Some(fingerprint);
        Ok(())
    }

    fn consume_if_matches(&self, prepared: Option<[u8; 32]>) -> Result<bool, String> {
        let mut authorized = self
            .prepared_fingerprint
            .lock()
            .map_err(|_| "Restore authorization is unavailable".to_owned())?;
        if authorized.is_some() && *authorized == prepared {
            *authorized = None;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

struct OcrPaths {
    temporary_directory: std::path::PathBuf,
    bundled_executable: Option<std::path::PathBuf>,
    bundled_tessdata: Option<std::path::PathBuf>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupSummaryDto {
    format_version: u16,
    entry_count: u64,
    plaintext_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapResponse {
    application: &'static str,
    database: DatabaseStatus,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseStatus {
    healthy: bool,
    schema_version: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackagedSmokeBootstrap {
    application: String,
    database: DatabaseStatus,
    visual_evidence: PackagedSmokeVisualEvidence,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackagedSmokeVisualEvidence {
    onboarding_title: String,
    household_name: String,
    navigation_labels: Vec<String>,
    visited_pages: Vec<PackagedSmokePageEvidence>,
    interaction_count: u32,
    viewport_width: u32,
    viewport_height: u32,
    device_pixel_ratio: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PackagedSmokePageEvidence {
    navigation_label: String,
    page_title: String,
    active_navigation: bool,
    main_width: u32,
    main_height: u32,
    interactive_element_count: u32,
    rendered_text_length: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PackagedSmokeResult<'a> {
    status: &'static str,
    application: &'static str,
    window: &'static str,
    ipc: bool,
    database_healthy: bool,
    schema_version: i64,
    visual_evidence: &'a PackagedSmokeVisualEvidence,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    database: DatabaseStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    schema_version: i64,
    integrity: &'static str,
}

#[derive(Clone)]
struct PackagedSmokeConfig {
    root: std::path::PathBuf,
    result: std::path::PathBuf,
}

impl PackagedSmokeConfig {
    fn from_environment() -> Result<Option<Self>, std::io::Error> {
        if std::env::var_os("KAKEFLOW_PACKAGED_SMOKE").as_deref() != Some(std::ffi::OsStr::new("1"))
        {
            return Ok(None);
        }

        let root = std::env::var_os("KAKEFLOW_SMOKE_ROOT")
            .map(std::path::PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "KAKEFLOW_SMOKE_ROOT must be an absolute path",
                )
            })?;
        std::fs::create_dir_all(&root)?;
        let root = root.canonicalize()?;
        if root.parent().is_none() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "KAKEFLOW_SMOKE_ROOT cannot be a filesystem root",
            ));
        }

        Ok(Some(Self {
            result: root.join("packaged-smoke-result.json"),
            root,
        }))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DashboardRequest {
    household_id: String,
    account_group_id: Option<String>,
    #[serde(default)]
    attribution_scope: AttributionScope,
    month: String,
    accounting_basis: AccountingBasis,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportStartEnvelope {
    import: StartImport,
    file_bytes: Vec<u8>,
}

const MAX_IMPORT_FILE_BYTES: usize = 25 * 1024 * 1024;
const MAX_IMPORT_RECORDS: usize = 100_000;
const MAX_IMPORT_CANDIDATES: usize = 100_000;
const MAX_IMPORT_CARD_STATEMENTS: usize = 16;
const MAX_IMPORT_CARD_LINES: usize = 100_000;
const MAX_IMPORT_EVIDENCE_LINKS: usize = 200_000;
const MAX_IMPORT_RAW_PAYLOAD_BYTES: usize = 32 * 1024 * 1024;
const MAX_IMPORT_METADATA_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
struct ImportEnvelopeMetrics {
    file_bytes: usize,
    records: usize,
    candidates: usize,
    card_statements: usize,
    card_lines: usize,
    evidence_links: usize,
    raw_payload_bytes: usize,
    metadata_bytes: usize,
}

fn validate_import_envelope_bounds(request: &ImportStartEnvelope) -> Result<(), String> {
    let mut metadata_bytes = 0_usize;
    let mut raw_payload_bytes = 0_usize;
    let mut evidence_links = 0_usize;
    let mut card_lines = 0_usize;

    let mut charge = |bytes: usize| -> Result<(), String> {
        metadata_bytes = metadata_bytes
            .checked_add(bytes)
            .ok_or_else(|| "Import metadata is too large".to_owned())?;
        Ok(())
    };
    for value in [
        request.import.run_id.as_str(),
        request.import.document_id.as_str(),
        request.import.household_id.as_str(),
        request.import.source_type.as_str(),
        request.import.original_filename.as_str(),
        request.import.media_type.as_str(),
        request.import.sha256.as_str(),
    ] {
        charge(value.len())?;
    }
    for value in [
        request.import.source_modified_at.as_deref(),
        request.import.adapter_id.as_deref(),
        request.import.adapter_version.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        charge(value.len())?;
    }
    for record in &request.import.records {
        charge(record.id.len())?;
        charge(record.record_hash.len())?;
        charge(record.payload_json.len())?;
        raw_payload_bytes = raw_payload_bytes
            .checked_add(record.payload_json.len())
            .ok_or_else(|| "Import source payload is too large".to_owned())?;
    }
    for candidate in &request.import.candidates {
        charge(candidate.id.len())?;
        for value in [
            candidate.account_id.as_deref(),
            Some(candidate.occurred_on.as_str()),
            candidate.posted_on.as_deref(),
            Some(candidate.direction.as_str()),
            candidate.description_raw.as_deref(),
            candidate.merchant_raw.as_deref(),
            candidate.external_transaction_id.as_deref(),
            Some(candidate.review_status.as_str()),
        ]
        .into_iter()
        .flatten()
        {
            charge(value.len())?;
        }
        evidence_links = evidence_links
            .checked_add(candidate.evidence.len())
            .ok_or_else(|| "Import evidence is too large".to_owned())?;
        for evidence in &candidate.evidence {
            charge(evidence.source_record_id.len())?;
            charge(evidence.role.len())?;
        }
    }
    for statement in &request.import.card_statements {
        card_lines = card_lines
            .checked_add(statement.lines.len())
            .ok_or_else(|| "Import card statement is too large".to_owned())?;
        for value in [
            statement.id.as_str(),
            statement.card_account_id.as_str(),
            statement.issuer.as_str(),
            statement.period_start.as_str(),
            statement.period_end.as_str(),
        ] {
            charge(value.len())?;
        }
        if let Some(value) = statement.payment_due_on.as_deref() {
            charge(value.len())?;
        }
        for line in &statement.lines {
            charge(line.candidate_id.len())?;
        }
    }

    // Include conservative JSON/container overhead so aggregate validation does
    // not account only for attacker-controlled string bodies.
    for (count, overhead) in [
        (request.import.records.len(), 64_usize),
        (request.import.candidates.len(), 192),
        (evidence_links, 48),
        (request.import.card_statements.len(), 128),
        (card_lines, 48),
    ] {
        charge(
            count
                .checked_mul(overhead)
                .ok_or_else(|| "Import metadata is too large".to_owned())?,
        )?;
    }

    validate_import_metrics(ImportEnvelopeMetrics {
        file_bytes: request.file_bytes.len(),
        records: request.import.records.len(),
        candidates: request.import.candidates.len(),
        card_statements: request.import.card_statements.len(),
        card_lines,
        evidence_links,
        raw_payload_bytes,
        metadata_bytes,
    })
}

fn validate_import_metrics(metrics: ImportEnvelopeMetrics) -> Result<(), String> {
    if metrics.file_bytes == 0 || metrics.file_bytes > MAX_IMPORT_FILE_BYTES {
        return Err("Import file size is invalid".to_owned());
    }
    if metrics.records > MAX_IMPORT_RECORDS
        || metrics.candidates > MAX_IMPORT_CANDIDATES
        || metrics.card_statements > MAX_IMPORT_CARD_STATEMENTS
        || metrics.card_lines > MAX_IMPORT_CARD_LINES
        || metrics.evidence_links > MAX_IMPORT_EVIDENCE_LINKS
        || metrics.raw_payload_bytes > MAX_IMPORT_RAW_PAYLOAD_BYTES
        || metrics.metadata_bytes > MAX_IMPORT_METADATA_BYTES
    {
        return Err("Import request is too large".to_owned());
    }
    Ok(())
}

/// Initializes the frontend with non-sensitive application and database state.
#[tauri::command]
fn app_bootstrap(state: tauri::State<'_, AppState>) -> Result<BootstrapResponse, String> {
    let database = database_status(&state)?;
    Ok(BootstrapResponse {
        application: "KakeFlow",
        database,
    })
}

#[tauri::command]
fn app_health(state: tauri::State<'_, AppState>) -> Result<HealthResponse, String> {
    let database = database_status(&state)?;
    Ok(HealthResponse {
        status: if database.healthy { "ok" } else { "degraded" },
        database,
    })
}

#[tauri::command]
fn app_status(state: tauri::State<'_, AppState>) -> Result<StatusResponse, String> {
    state
        .with_connection(|connection| {
            let integrity = persistence::integrity_check(connection)?;
            let schema_version = persistence::schema_version(connection)?;
            Ok(StatusResponse {
                schema_version,
                integrity: if integrity { "ok" } else { "failed" },
            })
        })
        .map_err(|_| "Database status is unavailable".to_owned())
}

fn database_status(state: &AppState) -> Result<DatabaseStatus, String> {
    state
        .with_connection(|connection| {
            Ok(DatabaseStatus {
                healthy: persistence::integrity_check(connection)?,
                schema_version: persistence::schema_version(connection)?,
            })
        })
        // Never expose paths, SQL, keys, or financial data to the webview.
        .map_err(|_| "Database health check failed".to_owned())
}

/// Test-only IPC endpoint used by the packaged-app smoke harness. It is inert
/// unless startup explicitly enabled smoke mode with an isolated data root.
#[tauri::command]
fn packaged_smoke_complete(
    app: tauri::AppHandle,
    webview: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
    bootstrap: PackagedSmokeBootstrap,
) -> Result<(), String> {
    let config = PackagedSmokeConfig::from_environment()
        .map_err(|_| "Packaged smoke configuration is invalid".to_owned())?
        .ok_or_else(|| "Packaged smoke mode is disabled".to_owned())?;
    if webview.label() != "main" || bootstrap.application != "KakeFlow" {
        return Err("Packaged smoke request is invalid".to_owned());
    }
    validate_packaged_smoke_visual_evidence(&bootstrap.visual_evidence)?;

    let current = database_status(&state)?;
    if !bootstrap.database.healthy
        || !current.healthy
        || bootstrap.database.schema_version != current.schema_version
        || current.schema_version <= 0
    {
        return Err("Packaged smoke database validation failed".to_owned());
    }

    let database = config.root.join("database").join("kakeflow.db");
    if !database.is_file() {
        return Err("Packaged smoke database was not created".to_owned());
    }
    let household_persisted = state
        .with_connection(|connection| {
            Ok(connection.query_row(
                "SELECT count(*) FROM households WHERE name = ?1",
                [&bootstrap.visual_evidence.household_name],
                |row| row.get::<_, i64>(0),
            )?)
        })
        .map_err(|_| "Packaged smoke household validation failed".to_owned())?;
    if household_persisted != 1 {
        return Err("Packaged smoke UI write was not persisted".to_owned());
    }

    let result = PackagedSmokeResult {
        status: "ok",
        application: "KakeFlow",
        window: "main",
        ipc: true,
        database_healthy: true,
        schema_version: current.schema_version,
        visual_evidence: &bootstrap.visual_evidence,
    };
    let result = serde_json::to_vec_pretty(&result)
        .map_err(|_| "Packaged smoke result could not be encoded".to_owned())?;
    std::fs::write(&config.result, result)
        .map_err(|_| "Packaged smoke result could not be written".to_owned())?;

    app.exit(0);
    Ok(())
}

#[tauri::command]
fn packaged_smoke_failure(app: tauri::AppHandle, message: String) -> Result<(), String> {
    let config = PackagedSmokeConfig::from_environment()
        .map_err(|_| "Packaged smoke configuration is invalid".to_owned())?
        .ok_or_else(|| "Packaged smoke mode is disabled".to_owned())?;
    let message = message.chars().take(500).collect::<String>();
    let failure = serde_json::json!({ "status": "failed", "message": message });
    let encoded = serde_json::to_vec_pretty(&failure)
        .map_err(|_| "Packaged smoke failure could not be encoded".to_owned())?;
    std::fs::write(&config.result, encoded)
        .map_err(|_| "Packaged smoke failure could not be written".to_owned())?;
    eprintln!("Packaged smoke UI failed: {message}");
    app.exit(2);
    Ok(())
}

#[tauri::command]
fn packaged_smoke_progress(stage: String) -> Result<(), String> {
    let config = PackagedSmokeConfig::from_environment()
        .map_err(|_| "Packaged smoke configuration is invalid".to_owned())?
        .ok_or_else(|| "Packaged smoke mode is disabled".to_owned())?;
    if stage.is_empty()
        || stage.len() > 80
        || !stage
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Packaged smoke progress is invalid".to_owned());
    }
    use std::io::Write as _;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(config.root.join("packaged-smoke-progress.log"))
        .map_err(|_| "Packaged smoke progress could not be written".to_owned())?;
    writeln!(file, "{stage}").map_err(|_| "Packaged smoke progress could not be written".to_owned())
}

fn validate_packaged_smoke_visual_evidence(
    evidence: &PackagedSmokeVisualEvidence,
) -> Result<(), String> {
    const REQUIRED_NAVIGATION: [&str; 4] = ["ホーム", "取引", "インポート", "カレンダー・レポート"];
    const REQUIRED_PAGES: [(&str, &str); 1] = [("ホーム", "Packaged Smoke Householdの家計")];
    let navigation_complete = REQUIRED_NAVIGATION.iter().all(|required| {
        evidence
            .navigation_labels
            .iter()
            .any(|actual| actual == required)
    });
    let pages_complete = REQUIRED_PAGES.iter().all(|(navigation, title)| {
        evidence.visited_pages.iter().any(|page| {
            page.navigation_label == *navigation
                && page.page_title == *title
                && page.active_navigation
                && page.main_width >= 600
                && page.main_height > 0
                && page.interactive_element_count > 0
                && page.rendered_text_length >= 20
        })
    });
    if evidence.onboarding_title != "家計簿をはじめましょう"
        || evidence.household_name != "Packaged Smoke Household"
        || evidence.interaction_count < 1
        || evidence.viewport_width < 800
        || evidence.viewport_height < 600
        || !evidence.device_pixel_ratio.is_finite()
        || evidence.device_pixel_ratio <= 0.0
        || !navigation_complete
        || !pages_complete
    {
        return Err("Packaged smoke visual interaction evidence is invalid".to_owned());
    }
    Ok(())
}

#[cfg(test)]
mod packaged_smoke_visual_evidence_tests {
    use super::*;

    fn evidence() -> PackagedSmokeVisualEvidence {
        PackagedSmokeVisualEvidence {
            onboarding_title: "家計簿をはじめましょう".into(),
            household_name: "Packaged Smoke Household".into(),
            navigation_labels: vec![
                "ホーム".into(),
                "取引".into(),
                "インポート".into(),
                "カレンダー・レポート".into(),
            ],
            visited_pages: [("ホーム", "Packaged Smoke Householdの家計")]
                .into_iter()
                .map(|(navigation_label, page_title)| PackagedSmokePageEvidence {
                    navigation_label: navigation_label.into(),
                    page_title: page_title.into(),
                    active_navigation: true,
                    main_width: 1000,
                    main_height: 700,
                    interactive_element_count: 2,
                    rendered_text_length: 100,
                })
                .collect(),
            interaction_count: 1,
            viewport_width: 1280,
            viewport_height: 800,
            device_pixel_ratio: 2.0,
        }
    }

    #[test]
    fn accepts_complete_real_onboarding_and_home_evidence() {
        assert!(validate_packaged_smoke_visual_evidence(&evidence()).is_ok());
    }

    #[test]
    fn rejects_hidden_or_incomplete_home_evidence() {
        let mut evidence = evidence();
        evidence.visited_pages[0].main_width = 0;
        assert!(validate_packaged_smoke_visual_evidence(&evidence).is_err());
    }
}

fn repository_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> Result<T, read_model::RepositoryError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Database access failed".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

fn portfolio_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> Result<T, portfolio::PortfolioError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Portfolio database access failed".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

fn account_group_export_result<T>(
    state: &AppState,
    operation: impl FnOnce(
        &rusqlite::Connection,
    ) -> Result<T, account_groups_export::AccountGroupExportError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Account group database access failed".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

fn brokerage_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> Result<T, brokerage::BrokerageError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Brokerage database access failed".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

fn investment_performance_result<T>(
    state: &AppState,
    operation: impl FnOnce(
        &rusqlite::Connection,
    ) -> Result<T, investment_performance::InvestmentPerformanceError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Investment database access failed".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

fn investment_fx_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> Result<T, investment_fx::InvestmentFxError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Investment FX database access failed".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

fn investment_market_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> Result<T, investment_market::InvestmentMarketError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Investment market database access failed".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
fn households_list(state: tauri::State<'_, AppState>) -> Result<Vec<HouseholdDto>, String> {
    repository_result(&state, read_model::list_households)
}

#[tauri::command]
fn household_create(
    state: tauri::State<'_, AppState>,
    input: CreateHouseholdInput,
) -> Result<HouseholdDto, String> {
    repository_result(&state, |connection| {
        read_model::create_household(connection, &input)
    })
}

#[tauri::command]
fn household_members_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<HouseholdMemberDto>, String> {
    repository_result(&state, |connection| {
        read_model::list_household_members(connection, &household_id)
    })
}

#[tauri::command]
fn household_member_create(
    state: tauri::State<'_, AppState>,
    input: CreateHouseholdMemberInput,
) -> Result<HouseholdMemberDto, String> {
    repository_result(&state, |connection| {
        read_model::create_household_member(connection, &input)
    })
}

#[tauri::command]
fn household_member_update(
    state: tauri::State<'_, AppState>,
    input: UpdateHouseholdMemberInput,
) -> Result<HouseholdMemberDto, String> {
    repository_result(&state, |connection| {
        read_model::update_household_member(connection, &input)
    })
}

#[tauri::command]
fn household_member_archive(
    state: tauri::State<'_, AppState>,
    household_id: String,
    member_id: String,
) -> Result<(), String> {
    repository_result(&state, |connection| {
        read_model::archive_household_member(connection, &household_id, &member_id)
    })
}

#[tauri::command]
fn accounts_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<AccountDto>, String> {
    repository_result(&state, |connection| {
        read_model::list_accounts(connection, &household_id)
    })
}

#[tauri::command]
fn account_create(
    state: tauri::State<'_, AppState>,
    input: CreateAccountInput,
) -> Result<AccountDto, String> {
    repository_result(&state, |connection| {
        read_model::create_account(connection, &input)
    })
}

#[tauri::command]
fn account_ownership_update(
    state: tauri::State<'_, AppState>,
    input: UpdateAccountOwnershipInput,
) -> Result<AccountDto, String> {
    repository_result(&state, |connection| {
        read_model::update_account_ownership(connection, &input)
    })
}

#[tauri::command]
fn account_rename(
    state: tauri::State<'_, AppState>,
    input: RenameAccountInput,
) -> Result<AccountDto, String> {
    repository_result(&state, |connection| {
        read_model::rename_account(connection, &input)
    })
}

#[tauri::command]
fn account_archive(
    state: tauri::State<'_, AppState>,
    input: ArchiveAccountInput,
) -> Result<(), String> {
    repository_result(&state, |connection| {
        read_model::archive_account(connection, &input)
    })
}

#[tauri::command]
fn transactions_query(
    state: tauri::State<'_, AppState>,
    request: TransactionPageRequest,
) -> Result<TransactionPageDto, String> {
    repository_result(&state, |connection| {
        read_model::list_transactions(connection, &request)
    })
}

#[tauri::command]
fn transaction_manual_create(
    state: tauri::State<'_, AppState>,
    input: CreateManualTransactionInput,
) -> Result<TransactionRowDto, String> {
    repository_result(&state, |connection| {
        read_model::create_manual_transaction(connection, &input)
    })
}

#[tauri::command]
fn transaction_detail_get(
    state: tauri::State<'_, AppState>,
    household_id: String,
    transaction_id: String,
) -> Result<TransactionDetailDto, String> {
    repository_result(&state, |connection| {
        read_model::get_transaction_detail(connection, &household_id, &transaction_id)
    })
}

#[tauri::command]
fn source_document_get(
    state: tauri::State<'_, AppState>,
    household_id: String,
    source_document_id: String,
) -> Result<SourceDocumentViewDto, String> {
    repository_result(&state, |connection| {
        source_viewer::get_source_document(connection, &household_id, &source_document_id)
    })
}

#[tauri::command]
fn source_document_audience_update(
    state: tauri::State<'_, AppState>,
    input: UpdateSourceDocumentAudienceInput,
) -> Result<SourceDocumentViewDto, String> {
    repository_result(&state, |connection| {
        source_viewer::update_source_document_audience(connection, &input)
    })
}

#[tauri::command]
fn source_document_records_query(
    state: tauri::State<'_, AppState>,
    request: SourceRecordPageRequest,
) -> Result<SourceRecordPageDto, String> {
    repository_result(&state, |connection| {
        source_viewer::list_source_document_records(connection, &request)
    })
}

#[tauri::command]
fn source_image_preview_get(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    household_id: String,
    source_document_id: String,
) -> Result<source_preview::SourceImagePreviewDto, String> {
    state
        .with_connection(|connection| {
            Ok(source_preview::read_source_image_preview(
                connection,
                &vault,
                &household_id,
                &source_document_id,
            ))
        })
        .map_err(|_| "Source preview is temporarily unavailable".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
fn source_pdf_page_preview_get(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    household_id: String,
    source_document_id: String,
    page_number: u32,
) -> Result<source_pdf_preview::SourcePdfPagePreviewDto, String> {
    state
        .with_connection(|connection| {
            Ok(source_pdf_preview::render_source_pdf_page(
                connection,
                &vault,
                &household_id,
                &source_document_id,
                page_number,
            ))
        })
        .map_err(|_| "Source PDF preview is temporarily unavailable".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
fn source_pdf_page_preview_attempt(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    household_id: String,
    source_document_id: String,
    page_number: u32,
    password: Option<String>,
) -> Result<source_pdf_preview::SourcePdfPagePreviewAttemptDto, String> {
    let password = password.map(zeroize::Zeroizing::new);
    state
        .with_connection(|connection| {
            Ok(source_pdf_preview::attempt_source_pdf_page_preview(
                connection,
                &vault,
                &household_id,
                &source_document_id,
                page_number,
                password.as_ref().map(|value| value.as_str()),
            ))
        })
        .map_err(|_| "Source PDF preview is temporarily unavailable".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
fn transaction_source_records_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
    transaction_id: String,
) -> Result<Vec<SourceRecordViewDto>, String> {
    repository_result(&state, |connection| {
        source_viewer::list_transaction_source_records(connection, &household_id, &transaction_id)
    })
}

#[tauri::command]
fn transaction_update(
    state: tauri::State<'_, AppState>,
    input: UpdatePostedTransactionInput,
) -> Result<TransactionDetailDto, String> {
    repository_result(&state, |connection| {
        read_model::update_posted_transaction(connection, &input)
    })
}

#[tauri::command]
fn dashboard_query(
    state: tauri::State<'_, AppState>,
    request: DashboardRequest,
) -> Result<DashboardMonthlyTotalsDto, String> {
    repository_result(&state, |connection| {
        read_model::dashboard_monthly_totals(
            connection,
            &request.household_id,
            &request.month,
            request.accounting_basis,
            request.account_group_id.as_deref(),
            &request.attribution_scope,
        )
    })
}

#[tauri::command]
fn financial_intelligence_query(
    state: tauri::State<'_, AppState>,
    request: FinancialIntelligenceRequest,
) -> Result<FinancialIntelligenceDto, String> {
    state
        .with_connection(|connection| {
            Ok(recurring_analytics::query_financial_intelligence(
                connection, &request,
            ))
        })
        .map_err(|_| "Financial intelligence is temporarily unavailable".to_owned())?
}

#[tauri::command]
fn budgets_query(
    state: tauri::State<'_, AppState>,
    household_id: String,
    month: String,
) -> Result<Vec<MonthlyCategoryBudgetDto>, String> {
    repository_result(&state, |connection| {
        read_model::list_monthly_category_budgets(connection, &household_id, &month)
    })
}

#[tauri::command]
fn budget_upsert(
    state: tauri::State<'_, AppState>,
    input: UpsertMonthlyCategoryBudgetInput,
) -> Result<MonthlyCategoryBudgetDto, String> {
    repository_result(&state, |connection| {
        read_model::upsert_monthly_category_budget(connection, &input)
    })
}

#[tauri::command]
fn savings_goals_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<SavingsGoalDto>, String> {
    repository_result(&state, |connection| {
        read_model::list_savings_goals(connection, &household_id)
    })
}

#[tauri::command]
fn savings_goal_create(
    state: tauri::State<'_, AppState>,
    input: CreateSavingsGoalInput,
) -> Result<SavingsGoalDto, String> {
    repository_result(&state, |connection| {
        read_model::create_savings_goal(connection, &input)
    })
}

#[tauri::command]
fn savings_goal_update(
    state: tauri::State<'_, AppState>,
    input: UpdateSavingsGoalInput,
) -> Result<SavingsGoalDto, String> {
    repository_result(&state, |connection| {
        read_model::update_savings_goal(connection, &input)
    })
}

#[tauri::command]
fn savings_goal_delete(
    state: tauri::State<'_, AppState>,
    household_id: String,
    goal_id: String,
) -> Result<(), String> {
    repository_result(&state, |connection| {
        read_model::delete_savings_goal(connection, &household_id, &goal_id)
    })
}

#[tauri::command]
fn portfolio_snapshot_import(
    state: tauri::State<'_, AppState>,
    input: ImportPortfolioSnapshotInput,
) -> Result<PortfolioSnapshotDetailDto, String> {
    portfolio_result(&state, |connection| {
        portfolio::import_snapshot(connection, &input)
    })
}

#[tauri::command]
fn portfolio_snapshots_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<PortfolioSnapshotSummaryDto>, String> {
    portfolio_result(&state, |connection| {
        portfolio::list_snapshots(connection, &household_id)
    })
}

#[tauri::command]
fn portfolio_snapshot_get(
    state: tauri::State<'_, AppState>,
    household_id: String,
    snapshot_id: String,
) -> Result<PortfolioSnapshotDetailDto, String> {
    portfolio_result(&state, |connection| {
        portfolio::get_snapshot(connection, &household_id, &snapshot_id)
    })
}

#[tauri::command]
fn brokerage_events_import(
    state: tauri::State<'_, AppState>,
    input: ImportBrokerageEventsInput,
) -> Result<BrokerageImportSummaryDto, String> {
    brokerage_result(&state, |connection| {
        brokerage::import_events(connection, &input)
    })
}

#[tauri::command]
fn brokerage_history_query(
    state: tauri::State<'_, AppState>,
    request: BrokerageHistoryRequest,
) -> Result<BrokerageHistoryDto, String> {
    brokerage_result(&state, |connection| {
        brokerage::query_history(connection, &request)
    })
}

#[tauri::command]
fn investment_holdings_query(
    state: tauri::State<'_, AppState>,
    request: InvestmentHoldingsRequest,
) -> Result<InvestmentHoldingsDto, String> {
    investment_performance_result(&state, |connection| {
        investment_performance::query_holdings(connection, &request)
    })
}

#[tauri::command]
fn investment_performance_query(
    state: tauri::State<'_, AppState>,
    request: InvestmentPerformanceRequest,
) -> Result<InvestmentPerformanceDto, String> {
    investment_performance_result(&state, |connection| {
        investment_performance::query_performance(connection, &request)
    })
}

#[tauri::command]
fn investment_fx_rates_import(
    state: tauri::State<'_, AppState>,
    input: ImportInvestmentFxRatesInput,
) -> Result<InvestmentFxImportSummaryDto, String> {
    investment_fx_result(&state, |connection| {
        investment_fx::import_rates(connection, &input)
    })
}

#[tauri::command]
fn investment_fx_rates_query(
    state: tauri::State<'_, AppState>,
    request: InvestmentFxRatesRequest,
) -> Result<Vec<InvestmentFxRateDto>, String> {
    investment_fx_result(&state, |connection| {
        investment_fx::query_rates(connection, &request)
    })
}

#[tauri::command]
fn investment_reporting_query(
    state: tauri::State<'_, AppState>,
    request: InvestmentReportingRequest,
) -> Result<InvestmentReportingDto, String> {
    investment_fx_result(&state, |connection| {
        investment_fx::query_reporting(connection, &request)
    })
}

#[tauri::command]
fn investment_market_prices_import(
    state: tauri::State<'_, AppState>,
    input: ImportInvestmentMarketPricesInput,
) -> Result<InvestmentMarketPriceImportSummaryDto, String> {
    investment_market_result(&state, |connection| {
        investment_market::import_prices(connection, &input)
    })
}

#[tauri::command]
fn investment_market_prices_query(
    state: tauri::State<'_, AppState>,
    request: InvestmentMarketPricesRequest,
) -> Result<Vec<InvestmentMarketPriceDto>, String> {
    investment_market_result(&state, |connection| {
        investment_market::query_prices(connection, &request)
    })
}

#[tauri::command]
fn investment_valuation_query(
    state: tauri::State<'_, AppState>,
    request: InvestmentValuationRequest,
) -> Result<InvestmentValuationDto, String> {
    investment_market_result(&state, |connection| {
        investment_market::query_valuation(connection, &request)
    })
}

#[tauri::command]
fn account_groups_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<AccountGroupDto>, String> {
    account_group_export_result(&state, |connection| {
        account_groups_export::list_account_groups(connection, &household_id)
    })
}

#[tauri::command]
fn account_group_create(
    state: tauri::State<'_, AppState>,
    input: CreateAccountGroupInput,
) -> Result<AccountGroupDto, String> {
    account_group_export_result(&state, |connection| {
        account_groups_export::create_account_group(connection, &input)
    })
}

#[tauri::command]
fn account_group_update(
    state: tauri::State<'_, AppState>,
    input: UpdateAccountGroupInput,
) -> Result<AccountGroupDto, String> {
    account_group_export_result(&state, |connection| {
        account_groups_export::update_account_group(connection, &input)
    })
}

#[tauri::command]
fn account_group_delete(
    state: tauri::State<'_, AppState>,
    household_id: String,
    group_id: String,
) -> Result<(), String> {
    account_group_export_result(&state, |connection| {
        account_groups_export::delete_account_group(connection, &household_id, &group_id)
    })
}

#[tauri::command]
fn account_groups_reorder(
    state: tauri::State<'_, AppState>,
    input: ReorderAccountGroupsInput,
) -> Result<Vec<AccountGroupDto>, String> {
    account_group_export_result(&state, |connection| {
        account_groups_export::reorder_account_groups(connection, &input)
    })
}

#[tauri::command]
fn export_csv_generate(
    state: tauri::State<'_, AppState>,
    request: ExportCsvRequest,
) -> Result<ExportCsvDto, String> {
    account_group_export_result(&state, |connection| {
        account_groups_export::generate_csv(connection, &request)
    })
}

#[tauri::command]
async fn export_csv_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: ExportCsvRequest,
) -> Result<Option<ExportSavedDto>, String> {
    let export = account_group_export_result(&state, |connection| {
        account_groups_export::generate_csv(connection, &request)
    })?;
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("CSV", &["csv"])
        .set_file_name(&export.file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected export destination is unavailable".to_owned())?;
    std::fs::write(destination, export.utf8_bom_csv.as_bytes())
        .map_err(|_| "CSV export could not be saved".to_owned())?;
    Ok(Some(ExportSavedDto {
        file_name: export.file_name,
        row_count: export.row_count,
        byte_size: export.byte_size,
    }))
}

#[tauri::command]
fn classification_rules_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<ClassificationRuleDto>, String> {
    repository_result(&state, |connection| {
        read_model::list_classification_rules(connection, &household_id)
    })
}

#[tauri::command]
fn classification_rule_create(
    state: tauri::State<'_, AppState>,
    input: CreateClassificationRuleInput,
) -> Result<ClassificationRuleDto, String> {
    repository_result(&state, |connection| {
        read_model::create_classification_rule(connection, &input)
    })
}

#[tauri::command]
fn classification_rule_update(
    state: tauri::State<'_, AppState>,
    input: UpdateClassificationRuleInput,
) -> Result<ClassificationRuleDto, String> {
    repository_result(&state, |connection| {
        read_model::update_classification_rule(connection, &input)
    })
}

#[tauri::command]
fn classification_rule_delete(
    state: tauri::State<'_, AppState>,
    household_id: String,
    rule_id: String,
) -> Result<(), String> {
    repository_result(&state, |connection| {
        read_model::delete_classification_rule(connection, &household_id, &rule_id)
    })
}

#[tauri::command]
fn classification_rules_preview(
    state: tauri::State<'_, AppState>,
    input: ClassificationPreviewInput,
) -> Result<ClassificationPreviewDto, String> {
    repository_result(&state, |connection| {
        read_model::preview_classification_rules(connection, &input)
    })
}

#[tauri::command]
fn classification_rule_apply(
    state: tauri::State<'_, AppState>,
    input: ApplyClassificationRuleInput,
) -> Result<AppliedClassificationDto, String> {
    repository_result(&state, |connection| {
        read_model::apply_classification_rule(connection, &input)
    })
}

fn watched_folder_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> Result<T, watched_folders::WatchedFolderError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Watched folder database access failed".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
fn watched_folders_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<watched_folders::WatchedFolderDto>, String> {
    watched_folder_result(&state, |connection| {
        watched_folders::list(connection, &household_id)
    })
}

#[tauri::command]
async fn watched_folder_select(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    household_id: String,
    label: String,
) -> Result<Option<watched_folders::WatchedFolderDto>, String> {
    let Some(selected) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "Selected folder is unavailable".to_owned())?;
    watched_folder_result(&state, |connection| {
        watched_folders::register(connection, &household_id, &label, &path)
    })
    .map(Some)
}

#[tauri::command]
fn watched_folder_remove(
    state: tauri::State<'_, AppState>,
    household_id: String,
    watched_folder_id: String,
) -> Result<(), String> {
    watched_folder_result(&state, |connection| {
        watched_folders::remove(connection, &household_id, &watched_folder_id)
    })
}

#[tauri::command]
fn watched_folder_scan(
    state: tauri::State<'_, AppState>,
    household_id: String,
    watched_folder_id: String,
) -> Result<watched_folders::WatchedFolderScanDto, String> {
    watched_folder_result(&state, |connection| {
        watched_folders::scan_registered(connection, &household_id, &watched_folder_id)
    })
}

#[tauri::command]
fn watched_folder_file_read(
    state: tauri::State<'_, AppState>,
    household_id: String,
    watched_folder_id: String,
    relative_path: String,
) -> Result<watched_folders::WatchedFileDto, String> {
    watched_folder_result(&state, |connection| {
        watched_folders::read_registered_file(
            connection,
            &household_id,
            &watched_folder_id,
            &relative_path,
        )
    })
}

#[tauri::command]
fn import_summary(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<ImportRunCountsDto, String> {
    repository_result(&state, |connection| {
        read_model::import_run_counts(connection, &household_id)
    })
}

#[tauri::command]
fn cards_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<CardSettlementDto>, String> {
    repository_result(&state, |connection| {
        read_model::list_card_settlements(connection, &household_id)
    })
}

#[tauri::command]
fn card_match_confirm(
    state: tauri::State<'_, AppState>,
    household_id: String,
    statement_id: String,
    payment_id: String,
) -> Result<CardMatchConfirmation, String> {
    workflow_result(&state, |connection| {
        import_workflow::confirm_card_match(connection, &household_id, &statement_id, &payment_id)
    })
}

fn workflow_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> import_workflow::Result<T>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Import database access failed".to_owned())?
        .map_err(|error| {
            match error {
                import_workflow::ImportWorkflowError::RunNotFound => "Import run was not found",
                import_workflow::ImportWorkflowError::AlreadyPosted => {
                    "Import run is already posted"
                }
                import_workflow::ImportWorkflowError::CandidateOutsideRun(_) => {
                    "Import candidate is invalid"
                }
                import_workflow::ImportWorkflowError::UnbalancedJournal(_) => {
                    "Import journal is not balanced"
                }
                import_workflow::ImportWorkflowError::Validation(_) => "Import data is invalid",
                import_workflow::ImportWorkflowError::Database(_) => {
                    "Import database operation failed"
                }
            }
            .to_owned()
        })
}

#[tauri::command]
fn import_start(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    request: ImportStartEnvelope,
) -> Result<ImportSummary, String> {
    if request.import.byte_size < 0 || request.import.byte_size as usize != request.file_bytes.len()
    {
        return Err("Import file size is invalid".to_owned());
    }
    validate_import_envelope_bounds(&request)?;
    let stored = vault
        .put(&request.file_bytes, &request.import.media_type)
        .map_err(|_| "Import document encryption failed".to_owned())?;
    if stored.sha256 != request.import.sha256.to_ascii_lowercase() {
        if !stored.deduplicated {
            let _ = vault.delete(&stored.sha256);
        }
        return Err("Import document hash does not match".to_owned());
    }

    let storage_uri = format!("vault://{}", stored.sha256);
    let result = workflow_result(&state, |connection| {
        import_workflow::start_import(connection, &request.import, &storage_uri)
    });
    if result.is_err() && !stored.deduplicated {
        let _ = vault.delete(&stored.sha256);
    }
    result
}

#[tauri::command]
fn import_preview(
    state: tauri::State<'_, AppState>,
    run_id: String,
) -> Result<ImportPreview, String> {
    workflow_result(&state, |connection| {
        import_workflow::preview_import(connection, &run_id)
    })
}

#[tauri::command]
fn import_commit(
    state: tauri::State<'_, AppState>,
    run_id: String,
    decisions: Vec<PostingDecision>,
) -> Result<CommitSummary, String> {
    workflow_result(&state, |connection| {
        import_workflow::commit_import(connection, &run_id, &decisions)
    })
}

#[tauri::command]
fn import_rollback(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    run_id: String,
) -> Result<(), String> {
    let hash = workflow_result(&state, |connection| {
        import_workflow::preview_import(connection, &run_id).map(|preview| preview.source.sha256)
    })?;
    workflow_result(&state, |connection| {
        import_workflow::rollback_import(connection, &run_id)
    })?;
    let still_referenced = state
        .with_connection(|connection| {
            Ok(connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM source_documents WHERE sha256 = ?1)",
                [&hash],
                |row| row.get::<_, bool>(0),
            )?)
        })
        .map_err(|_| "Import cleanup status failed".to_owned())?;
    if !still_referenced {
        let _ = vault.delete(&hash);
    }
    Ok(())
}

#[tauri::command]
async fn backup_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    paths: tauri::State<'_, BackupPaths>,
    backup_key: tauri::State<'_, BackupMasterKey>,
    passphrase: String,
) -> Result<Option<BackupSummaryDto>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("KakeFlow Backup", &["kakeflow-backup"])
        .set_file_name("kakeflow-backup.kakeflow-backup")
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let archive_path = selected
        .into_path()
        .map_err(|_| "Selected backup destination is unavailable".to_owned())?;
    let passphrase = Zeroizing::new(passphrase);
    let mut backup_result = None;
    state
        .with_connection(|connection| {
            // Keep the application-wide database lock from checkpoint through
            // the final archive fsync so no writer can race the snapshot.
            connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
            backup_result = Some(backup::create_portable_backup(
                &paths.database,
                &paths.vault,
                &archive_path,
                passphrase.as_str(),
                &backup_key.0,
            ));
            Ok(())
        })
        .map_err(|_| "Backup database checkpoint failed".to_owned())?;
    let summary = backup_result
        .ok_or_else(|| "Backup could not be created".to_owned())?
        .map_err(|error| match error {
            backup::BackupError::AlreadyExists => "Backup destination already exists",
            backup::BackupError::InvalidInput => "Backup input is invalid",
            _ => "Backup could not be created",
        })?;
    Ok(Some(BackupSummaryDto {
        format_version: 2,
        entry_count: summary.entry_count,
        plaintext_bytes: summary.plaintext_bytes,
    }))
}

#[tauri::command]
async fn backup_restore_stage(
    app: tauri::AppHandle,
    paths: tauri::State<'_, BackupPaths>,
    credentials: tauri::State<'_, OsRestoreCredentialStore>,
    authorization: tauri::State<'_, RestoreCommandAuthorization>,
    passphrase: String,
) -> Result<Option<BackupSummaryDto>, String> {
    // One backend-owned gate covers native selection, confirmation, staging,
    // and authorization publication. No path or consent bit crosses IPC.
    let _operation = authorization
        .operation_gate
        .lock()
        .map_err(|_| "Restore is unavailable".to_owned())?;
    authorization.clear()?;
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("KakeFlow Backup", &["kakeflow-backup"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let archive_path = selected
        .into_path()
        .map_err(|_| "Selected backup is unavailable".to_owned())?;
    let confirmed = app
        .dialog()
        .message(
            "現在の台帳と原本を選択したバックアップで置き換え、KakeFlowを再起動します。続行しますか？",
        )
        .title("バックアップから復元")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "置き換えて復元".to_owned(),
            "キャンセル".to_owned(),
        ))
        .blocking_show();
    if !confirmed {
        return Ok(None);
    }
    let passphrase = Zeroizing::new(passphrase);
    let summary = restore::stage_portable_restore(
        &paths.app_data_root,
        &archive_path,
        passphrase.as_str(),
        credentials.inner(),
    )
    .map_err(|error| match error {
        restore::RestoreError::RestorePending => "A restore is already waiting for restart",
        restore::RestoreError::Backup => "Backup authentication or format is invalid",
        restore::RestoreError::InvalidLayout => "Backup contents are invalid",
        _ => "Backup could not be staged for restore",
    })?;
    let fingerprint =
        restore::prepared_restore_fingerprint(&paths.app_data_root, credentials.inner())
            .map_err(|_| "Restore authorization check failed".to_owned())?
            .ok_or_else(|| "Restore authorization check failed".to_owned())?;
    authorization.authorize(fingerprint)?;
    Ok(Some(BackupSummaryDto {
        format_version: 2,
        entry_count: summary.entry_count,
        plaintext_bytes: summary.plaintext_bytes,
    }))
}

#[tauri::command]
fn app_restart_for_restore(
    app: tauri::AppHandle,
    paths: tauri::State<'_, BackupPaths>,
    credentials: tauri::State<'_, OsRestoreCredentialStore>,
    authorization: tauri::State<'_, RestoreCommandAuthorization>,
) -> Result<(), String> {
    let prepared = restore::prepared_restore_fingerprint(&paths.app_data_root, credentials.inner())
        .map_err(|_| "Restore authorization check failed".to_owned())?;
    if !authorization.consume_if_matches(prepared)? {
        return Err("No authorized restore is prepared".to_owned());
    }
    app.restart()
}

#[tauri::command]
fn document_extract(
    file_bytes: Vec<u8>,
    media_type: String,
) -> Result<document_extract::ExtractedDocument, String> {
    document_extract::extract_document(&file_bytes, &media_type).map_err(|error| {
        match error {
            document_extract::ExtractError::InvalidInput => "Document input is invalid",
            document_extract::ExtractError::Unsupported => "Document format is unsupported",
            document_extract::ExtractError::OcrRequired => "Document requires OCR",
            document_extract::ExtractError::Extraction => "Document extraction failed",
            document_extract::ExtractError::PasswordRequired => "PDF password is required",
            document_extract::ExtractError::PasswordInvalid => "PDF password is invalid",
            document_extract::ExtractError::PasswordUnsupported => {
                "PDF password encryption is unsupported"
            }
        }
        .to_owned()
    })
}

#[tauri::command]
fn document_extract_attempt(
    file_bytes: Vec<u8>,
    media_type: String,
    password: Option<String>,
) -> Result<document_extract::DocumentExtractionAttempt, String> {
    let password = password.map(zeroize::Zeroizing::new);
    document_extract::attempt_document_extraction(
        &file_bytes,
        &media_type,
        password.as_ref().map(|value| value.as_str()),
    )
    .map_err(|error| {
        match error {
            document_extract::ExtractError::InvalidInput => "Document input is invalid",
            document_extract::ExtractError::Unsupported => "Document format is unsupported",
            document_extract::ExtractError::OcrRequired => "Document requires OCR",
            document_extract::ExtractError::Extraction => "Document extraction failed",
            document_extract::ExtractError::PasswordRequired => "PDF password is required",
            document_extract::ExtractError::PasswordInvalid => "PDF password is invalid",
            document_extract::ExtractError::PasswordUnsupported => {
                "PDF password encryption is unsupported"
            }
        }
        .to_owned()
    })
}

#[tauri::command]
fn document_ocr(
    paths: tauri::State<'_, OcrPaths>,
    file_bytes: Vec<u8>,
    media_type: String,
) -> Result<document_extract::ExtractedDocument, String> {
    const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
    let extension = match media_type.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        _ => return Err("OCR image format is unsupported".to_owned()),
    };
    if file_bytes.is_empty() || file_bytes.len() > MAX_IMAGE_BYTES {
        return Err("OCR image input is invalid".to_owned());
    }

    std::fs::create_dir_all(&paths.temporary_directory)
        .map_err(|_| "OCR temporary storage is unavailable".to_owned())?;
    private_fs::secure_directory(&paths.temporary_directory)
        .map_err(|_| "OCR temporary storage is unavailable".to_owned())?;
    let temporary_path =
        create_ocr_temporary_file(&paths.temporary_directory, extension, &file_bytes)?;

    let config = ocr::OcrConfig {
        executable: paths.bundled_executable.clone(),
        tessdata_dir: paths.bundled_tessdata.clone(),
        ..ocr::OcrConfig::default()
    };
    let result = ocr::OfflineOcrProvider::discover(config)
        .and_then(|provider| provider.recognize(&temporary_path));
    let _ = std::fs::remove_file(&temporary_path);
    let result = result.map_err(|error| match error {
        ocr::OcrError::EngineUnavailable => "Offline OCR engine is unavailable",
        ocr::OcrError::LanguageModelsUnavailable => "Japanese OCR models are unavailable",
        ocr::OcrError::TimedOut => "Offline OCR timed out",
        ocr::OcrError::InputTooLarge | ocr::OcrError::ImageDimensionsTooLarge => {
            "OCR image exceeds the safety limit"
        }
        _ => "Offline OCR failed",
    })?;
    if result.text.len() > 1024 * 1024 {
        return Err("Offline OCR produced too much text".to_owned());
    }
    let confidence_bps = result
        .mean_confidence
        .map(|value| (value * 10_000.0).round() as u16)
        .unwrap_or(0);
    let mut issues = Vec::new();
    if confidence_bps < 7_500 {
        issues.push("LOW_OCR_CONFIDENCE");
    }
    Ok(document_extract::ExtractedDocument {
        method: "OCR",
        text: result.text,
        confidence_bps,
        issues,
        regions: result
            .words
            .into_iter()
            .map(|word| document_extract::ExtractedRegion {
                page_number: word.page.max(1),
                coordinate_space: "PIXELS".to_owned(),
                bounding_box: Some(document_extract::EvidenceBoundingBox {
                    left: word.left,
                    top: word.top,
                    width: word.width,
                    height: word.height,
                }),
                text: word.text,
                confidence_bps: (word.confidence * 10_000.0).round() as u16,
                provenance: "TESSERACT_WORD".to_owned(),
            })
            .collect(),
    })
}

fn create_ocr_temporary_file(
    directory: &std::path::Path,
    extension: &str,
    bytes: &[u8],
) -> Result<std::path::PathBuf, String> {
    use std::io::Write as _;

    for _ in 0..16 {
        let mut random = [0_u8; 16];
        getrandom::getrandom(&mut random)
            .map_err(|_| "OCR temporary storage is unavailable".to_owned())?;
        let name = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let path = directory.join(format!(".{name}.{extension}"));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        match options.open(&path) {
            Ok(mut file) => {
                if private_fs::secure_file(&path).is_err() {
                    let _ = std::fs::remove_file(&path);
                    return Err("OCR temporary storage is unavailable".to_owned());
                }
                if file.write_all(bytes).is_err() || file.sync_all().is_err() {
                    let _ = std::fs::remove_file(&path);
                    return Err("OCR temporary storage is unavailable".to_owned());
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("OCR temporary storage is unavailable".to_owned()),
        }
    }
    Err("OCR temporary storage is unavailable".to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let smoke_config = PackagedSmokeConfig::from_environment()
        .expect("KakeFlow packaged smoke configuration is invalid");
    let smoke_enabled = smoke_config.is_some();
    let mut builder = tauri::Builder::default();
    if !smoke_enabled {
        // Must be the first production plugin: first-run key generation assumes one process.
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}));
    }
    let setup_smoke_config = smoke_config.clone();

    builder
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(move |webview, payload| {
            if smoke_enabled
                && webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                let _ = webview.show();
                let _ = webview.set_focus();
                let _ = webview.eval(include_str!("packaged_smoke_ui.js"));
            }
        })
        .setup(move |app| {
            let app_data_dir = setup_smoke_config
                .as_ref()
                .map(|config| config.root.clone())
                .unwrap_or(app.path().app_data_dir()?);
            let database_path = app_data_dir.join("database").join("kakeflow.db");
            let vault_path = app_data_dir.join("documents");
            let resource_dir = app.path().resource_dir()?;
            let bundled_ocr = resource_dir
                .join("ocr")
                .join(if cfg!(target_os = "windows") {
                    "tesseract.exe"
                } else {
                    "tesseract"
                });
            let bundled_tessdata = resource_dir.join("ocr").join("tessdata");
            let bundled_ocr_available = bundled_ocr.is_file() && bundled_tessdata.is_dir();
            let ocr_temporary_directory = app_data_dir.join("temporary").join("ocr");
            if let Ok(metadata) = std::fs::symlink_metadata(&ocr_temporary_directory) {
                if metadata.file_type().is_symlink() || metadata.is_file() {
                    std::fs::remove_file(&ocr_temporary_directory)?;
                } else {
                    std::fs::remove_dir_all(&ocr_temporary_directory)?;
                }
            }
            let restore_credentials = OsRestoreCredentialStore::new()?;
            let master_key = if setup_smoke_config.is_some() {
                // Deterministic process-local test key. Packaged smoke runs must
                // never read or write the user's Keychain/Credential Manager.
                Zeroizing::new(vec![0x4b_u8; 32])
            } else {
                // Finish or roll back any staged restore before SQLite or the vault
                // obtains a file handle. This is required for reliable Windows
                // activation and makes every crash checkpoint restart-safe.
                restore::recover_interrupted_restore(&app_data_dir, &restore_credentials)?;
                let key_provider = OsDatabaseKeyProvider::new()?;
                if database_path.exists() {
                    key_provider.existing_key()?
                } else {
                    key_provider.key()?
                }
            };
            if master_key.len() != 32 {
                return Err(std::io::Error::other("database key has invalid length").into());
            }
            let mut vault_master_key = Zeroizing::new([0_u8; 32]);
            vault_master_key.copy_from_slice(&master_key);
            let mut portable_backup_key = Zeroizing::new([0_u8; 32]);
            portable_backup_key.copy_from_slice(&master_key);
            let vault = DocumentVault::new(&vault_path, &vault_master_key)?;
            // Reuse the exact credential resolved above. Looking it up again
            // would create a race where a disappearing keychain item could be
            // replaced while the vault still holds the original key.
            let state = AppState::open_with_key(database_path.clone(), &master_key)?;
            app.manage(state);
            app.manage(vault);
            app.manage(BackupMasterKey(portable_backup_key));
            app.manage(restore_credentials);
            app.manage(RestoreCommandAuthorization::default());
            app.manage(BackupPaths {
                app_data_root: app_data_dir.clone(),
                database: database_path,
                vault: vault_path,
            });
            app.manage(OcrPaths {
                temporary_directory: ocr_temporary_directory,
                bundled_executable: bundled_ocr_available.then_some(bundled_ocr),
                bundled_tessdata: bundled_ocr_available.then_some(bundled_tessdata),
            });
            if setup_smoke_config.is_none() {
                app.manage(folder_discovery::BackgroundFolderDiscovery::start(
                    app.handle().clone(),
                ));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_bootstrap,
            app_health,
            app_status,
            packaged_smoke_complete,
            packaged_smoke_failure,
            packaged_smoke_progress,
            households_list,
            household_create,
            household_members_list,
            household_member_create,
            household_member_update,
            household_member_archive,
            accounts_list,
            account_create,
            account_ownership_update,
            account_rename,
            account_archive,
            transactions_query,
            transaction_manual_create,
            transaction_detail_get,
            transaction_update,
            source_document_get,
            source_document_audience_update,
            source_document_records_query,
            source_image_preview_get,
            source_pdf_page_preview_get,
            source_pdf_page_preview_attempt,
            transaction_source_records_list,
            financial_calendar::financial_calendar_query,
            financial_calendar::financial_report_monthly_query,
            financial_calendar::financial_report_yearly_query,
            forecast_action::forecast_action_query,
            dashboard_query,
            financial_intelligence_query,
            budgets_query,
            budget_upsert,
            savings_goals_list,
            savings_goal_create,
            savings_goal_update,
            savings_goal_delete,
            portfolio_snapshot_import,
            portfolio_snapshots_list,
            portfolio_snapshot_get,
            brokerage_events_import,
            brokerage_history_query,
            investment_holdings_query,
            investment_performance_query,
            investment_fx_rates_import,
            investment_fx_rates_query,
            investment_reporting_query,
            investment_market_prices_import,
            investment_market_prices_query,
            investment_valuation_query,
            account_groups_list,
            account_group_create,
            account_group_update,
            account_group_delete,
            account_groups_reorder,
            export_csv_generate,
            export_csv_save,
            classification_rules_list,
            classification_rule_create,
            classification_rule_update,
            classification_rule_delete,
            classification_rules_preview,
            classification_rule_apply,
            watched_folders_list,
            watched_folder_select,
            watched_folder_remove,
            watched_folder_scan,
            watched_folder_file_read,
            import_summary,
            cards_list,
            card_match_confirm,
            import_start,
            import_preview,
            import_commit,
            import_rollback,
            backup_create,
            backup_restore_stage,
            app_restart_for_restore,
            document_extract,
            document_extract_attempt,
            document_ocr
        ])
        .run(tauri::generate_context!())
        .expect("KakeFlow failed to start");
}

#[cfg(test)]
mod command_authorization_tests {
    use super::{
        validate_import_metrics, ImportEnvelopeMetrics, RestoreCommandAuthorization,
        MAX_IMPORT_CANDIDATES, MAX_IMPORT_CARD_LINES, MAX_IMPORT_CARD_STATEMENTS,
        MAX_IMPORT_EVIDENCE_LINKS, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_METADATA_BYTES,
        MAX_IMPORT_RAW_PAYLOAD_BYTES, MAX_IMPORT_RECORDS,
    };

    #[test]
    fn restore_authorization_is_exact_match_and_one_shot() {
        let authorization = RestoreCommandAuthorization::default();
        let fingerprint = [0x42; 32];

        assert!(!authorization.consume_if_matches(Some(fingerprint)).unwrap());
        authorization.authorize(fingerprint).unwrap();
        assert!(!authorization.consume_if_matches(Some([0x24; 32])).unwrap());
        assert!(authorization.consume_if_matches(Some(fingerprint)).unwrap());
        assert!(!authorization.consume_if_matches(Some(fingerprint)).unwrap());
    }

    #[test]
    fn clearing_restore_authorization_prevents_restart() {
        let authorization = RestoreCommandAuthorization::default();
        let fingerprint = [0x73; 32];
        authorization.authorize(fingerprint).unwrap();
        authorization.clear().unwrap();

        assert!(!authorization.consume_if_matches(Some(fingerprint)).unwrap());
    }

    fn small_import_metrics() -> ImportEnvelopeMetrics {
        ImportEnvelopeMetrics {
            file_bytes: 1024,
            records: 10,
            candidates: 10,
            card_statements: 1,
            card_lines: 10,
            evidence_links: 10,
            raw_payload_bytes: 4096,
            metadata_bytes: 8192,
        }
    }

    #[test]
    fn import_boundary_accepts_small_envelope() {
        validate_import_metrics(small_import_metrics()).unwrap();
    }

    #[test]
    fn import_boundary_rejects_aggregate_resource_exhaustion() {
        for oversized in [
            ImportEnvelopeMetrics {
                file_bytes: MAX_IMPORT_FILE_BYTES + 1,
                ..small_import_metrics()
            },
            ImportEnvelopeMetrics {
                raw_payload_bytes: MAX_IMPORT_RAW_PAYLOAD_BYTES + 1,
                ..small_import_metrics()
            },
            ImportEnvelopeMetrics {
                metadata_bytes: MAX_IMPORT_METADATA_BYTES + 1,
                ..small_import_metrics()
            },
            ImportEnvelopeMetrics {
                card_lines: MAX_IMPORT_CARD_LINES + 1,
                ..small_import_metrics()
            },
            ImportEnvelopeMetrics {
                records: MAX_IMPORT_RECORDS + 1,
                ..small_import_metrics()
            },
            ImportEnvelopeMetrics {
                candidates: MAX_IMPORT_CANDIDATES + 1,
                ..small_import_metrics()
            },
            ImportEnvelopeMetrics {
                card_statements: MAX_IMPORT_CARD_STATEMENTS + 1,
                ..small_import_metrics()
            },
            ImportEnvelopeMetrics {
                evidence_links: MAX_IMPORT_EVIDENCE_LINKS + 1,
                ..small_import_metrics()
            },
        ] {
            assert!(validate_import_metrics(oversized).is_err());
        }
    }
}
