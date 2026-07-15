pub mod account_groups_export;
pub mod aggregate_asset_history;
pub mod annual_review_pdf;
pub mod annual_review_xlsx;
pub mod backup;
pub mod brokerage;
pub mod card_settlement_mapping;
pub mod change_package;
pub mod dashboard_preferences;
pub mod document_extract;
pub mod document_pdf_ocr;
pub mod document_vault;
pub mod evidence_bundle;
pub mod family_delivery_credentials;
pub mod family_delivery_http;
pub mod family_delivery_schedule;
mod family_delivery_scheduler;
pub mod family_delivery_transport;
pub mod family_encrypted_envelope;
pub mod family_envelope_identity;
mod family_evidence;
pub mod family_snapshot;
pub mod financial_calendar;
pub mod fixed_cost_review;
mod folder_discovery;
pub mod forecast_action;
pub mod gmail_api;
pub mod gmail_command_service;
pub mod gmail_commands;
pub mod gmail_credentials;
pub mod gmail_hydration;
pub mod gmail_oauth;
pub mod gmail_oauth_runtime;
mod gmail_scheduler;
pub mod gmail_store;
pub mod gmail_sync;
pub mod gmail_sync_adapter;
pub mod google_drive_api;
pub mod google_drive_command_service;
pub mod google_drive_commands;
pub mod google_drive_credentials;
pub mod google_drive_folder;
pub mod google_drive_hydration;
pub mod google_drive_initial_sync;
pub mod google_drive_oauth;
pub mod google_drive_oauth_runtime;
mod google_drive_scheduler;
pub mod google_drive_store;
pub mod google_drive_sync_adapter;
pub mod import_workflow;
pub mod investment_fx;
pub mod investment_market;
pub mod investment_performance;
pub mod investment_performance_pdf;
pub mod investment_performance_xlsx;
mod key_store;
mod mobile_capture_background;
pub mod mobile_capture_capsule;
pub mod mobile_capture_inbox;
pub mod monthly_review_pdf;
pub mod monthly_review_xlsx;
pub mod ocr;
mod parser_profiles;
pub mod pending_import_bundle;
mod persistence;
pub mod portfolio;
pub mod portfolio_snapshot_pdf;
pub mod portfolio_snapshot_xlsx;
mod private_fs;
mod read_model;
pub mod receipt_matching;
mod record_scope;
pub mod recurring_analytics;
pub mod relay_transport;
pub mod restore;
pub mod source_pdf_preview;
pub mod source_preview;
mod source_viewer;
pub mod sync_foundation;
pub mod watched_file_inbox;
pub mod watched_folders;

use account_groups_export::{
    AccountGroupDto, CreateAccountGroupInput, ExportCsvDto, ExportCsvRequest, ExportSavedDto,
    ReorderAccountGroupsInput, UpdateAccountGroupInput,
};
use aggregate_asset_history::{
    AggregateAssetSnapshotDto, ImportAggregateAssetHistoryInput,
    ImportAggregateAssetHistoryResultDto, ImportAggregateAssetSnapshotInput,
    ImportAggregateAssetSnapshotResultDto, ListAggregateAssetHistoryInput,
};
use brokerage::{
    BrokerageHistoryDto, BrokerageHistoryRequest, BrokerageImportSummaryDto,
    ImportBrokerageEventsInput,
};
use dashboard_preferences::{DashboardPreferencesDto, UpsertDashboardPreferencesInput};
use document_vault::DocumentVault;
use import_workflow::{
    CardMatchConfirmation, CommitSummary, ImportPreview, ImportSummary, PendingReviewListDto,
    PostingDecision, StartImport,
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
use parser_profiles::{
    CreateDelimitedParserProfileInput, DeleteDelimitedParserProfileInput,
    DelimitedParserProfileDto, UpdateDelimitedParserProfileInput,
};
use persistence::AppState;
use portfolio::{
    ImportPortfolioSnapshotInput, PortfolioSnapshotDetailDto, PortfolioSnapshotSummaryDto,
};
use read_model::{
    AccountDto, AccountingBasis, AppliedClassificationDto, ApplyClassificationRuleInput,
    ArchiveAccountInput, BulkUpdateTransactionMetadataDto, BulkUpdateTransactionMetadataInput,
    CardSettlementDto, ClassificationPreviewDto, ClassificationPreviewInput, ClassificationRuleDto,
    CreateAccountInput, CreateClassificationRuleInput, CreateHouseholdInput,
    CreateHouseholdMemberInput, CreateManualTransactionInput, CreateSavingsGoalInput,
    DashboardMonthlyTotalsDto, HouseholdDto, HouseholdMemberDto, ImportRunCountsDto,
    MonthlyCategoryBudgetDto, RenameAccountInput, SavingsGoalDto, TransactionDetailDto,
    TransactionPageDto, TransactionPageRequest, TransactionRowDto, UpdateAccountOwnershipInput,
    UpdateCardStatementDueDateInput, UpdateClassificationRuleInput, UpdateHouseholdMemberInput,
    UpdatePostedTransactionInput, UpdateSavingsGoalInput, UpsertMonthlyCategoryBudgetInput,
};
use record_scope::AttributionScope;
use recurring_analytics::{FinancialIntelligenceDto, FinancialIntelligenceRequest};
use serde::{Deserialize, Serialize};
use source_viewer::{
    SourceDocumentViewDto, SourceRecordPageDto, SourceRecordPageRequest, SourceRecordViewDto,
    UpdateSourceDocumentAudienceInput,
};
use sync_foundation::{LocalSyncFoundationStatusDto, UpdatePrincipalMemberBindingInput};
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
struct PendingImportStages(
    std::sync::Mutex<
        std::collections::HashMap<(String, String), pending_import_bundle::StagedPendingImport>,
    >,
);

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

fn bundled_ocr_ready(executable: &std::path::Path, tessdata: &std::path::Path) -> bool {
    let executable_ready = executable.is_file() && bundled_ocr_is_executable(executable);
    executable_ready
        && tessdata.join("jpn.traineddata").is_file()
        && tessdata.join("eng.traineddata").is_file()
        && tessdata.join("configs").join("tsv").is_file()
}

#[cfg(unix)]
fn bundled_ocr_is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;

    path.metadata()
        .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn bundled_ocr_is_executable(path: &std::path::Path) -> bool {
    path.is_file()
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
    heading_visible: bool,
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

#[tauri::command]
fn local_sync_foundation_status(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<LocalSyncFoundationStatusDto, String> {
    state
        .with_connection(|connection| {
            sync_foundation::get_local_status(connection, &household_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Local sync foundation is unavailable".to_owned())
}

#[tauri::command]
fn principal_member_binding_update(
    state: tauri::State<'_, AppState>,
    input: UpdatePrincipalMemberBindingInput,
) -> Result<LocalSyncFoundationStatusDto, String> {
    state
        .with_connection(|connection| {
            sync_foundation::update_principal_member_binding(connection, &input)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Principal member binding could not be updated".to_owned())
}

fn relay_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> relay_transport::Result<T>,
) -> Result<T, String> {
    state
        .with_connection(|connection| {
            operation(connection).map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Desktop relay operation could not be completed".to_owned())
}

#[tauri::command]
fn relay_status(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<relay_transport::RelayStatusDto, String> {
    relay_result(&state, |connection| {
        relay_transport::status(connection, &household_id)
    })
}

#[tauri::command]
fn relay_connection_save(
    state: tauri::State<'_, AppState>,
    input: relay_transport::SaveConnectionInput,
) -> Result<relay_transport::RelayStatusDto, String> {
    relay_result(&state, |connection| {
        relay_transport::save_connection(connection, &input)
    })
}

#[tauri::command]
fn relay_disconnect(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<relay_transport::RelayStatusDto, String> {
    relay_result(&state, |connection| {
        relay_transport::disconnect(connection, &household_id)
    })
}

#[tauri::command]
fn relay_send_prepare(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<relay_transport::RelayPreparedDeliveryDto, String> {
    relay_result(&state, |connection| {
        relay_transport::prepare_send(connection, &household_id)
    })
}

#[tauri::command]
fn relay_send_accept(
    state: tauri::State<'_, AppState>,
    input: relay_transport::AcceptDeliveryInput,
) -> Result<relay_transport::RelayStatusDto, String> {
    relay_result(&state, |connection| {
        relay_transport::mark_accepted(connection, &input)
    })
}

#[tauri::command]
fn relay_send_failed(
    state: tauri::State<'_, AppState>,
    household_id: String,
    delivery_id: String,
) -> Result<relay_transport::RelayStatusDto, String> {
    relay_result(&state, |connection| {
        relay_transport::mark_send_failed(connection, &household_id, &delivery_id)
    })
}

#[tauri::command]
fn relay_inbound_register(
    state: tauri::State<'_, AppState>,
    input: relay_transport::RegisterInboundInput,
) -> Result<relay_transport::RelayStatusDto, String> {
    relay_result(&state, |connection| {
        relay_transport::register_inbound(connection, &input)
    })
}

#[tauri::command]
fn relay_inbound_stage(
    state: tauri::State<'_, AppState>,
    input: relay_transport::StageInboundInput,
) -> Result<relay_transport::RelayStatusDto, String> {
    let household_id = input.household_id.clone();
    relay_result(&state, |connection| {
        relay_transport::stage_inbound(connection, &input)?;
        relay_transport::status(connection, &household_id)
    })
}

fn family_delivery_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> family_delivery_transport::Result<T>,
) -> Result<T, String> {
    state
        .with_connection(|connection| {
            operation(connection).map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Family delivery operation could not be completed".to_owned())
}

fn family_delivery_schedule_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> family_delivery_schedule::Result<T>,
) -> Result<T, String> {
    state
        .with_connection(|connection| {
            operation(connection).map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Automatic family delivery check could not be completed".to_owned())
}

fn mobile_capture_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> mobile_capture_inbox::Result<T>,
) -> Result<T, String> {
    state
        .with_connection(|connection| {
            operation(connection).map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Mobile capture operation could not be completed".to_owned())
}

#[tauri::command]
fn mobile_capture_status(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<mobile_capture_inbox::MobileCaptureStatusDto, String> {
    mobile_capture_result(&state, |connection| {
        mobile_capture_inbox::status(connection, &household_id)
    })
}

#[tauri::command]
fn mobile_capture_inbox_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<mobile_capture_inbox::MobileCaptureInboxItemDto>, String> {
    mobile_capture_result(&state, |connection| {
        mobile_capture_inbox::list(connection, &household_id)
    })
}

#[tauri::command]
fn mobile_capture_cursor_update(
    state: tauri::State<'_, AppState>,
    household_id: String,
    next_cursor: u64,
) -> Result<mobile_capture_inbox::MobileCaptureStatusDto, String> {
    mobile_capture_result(&state, |connection| {
        mobile_capture_inbox::update_cursor(connection, &household_id, next_cursor)
    })
}

#[tauri::command]
fn mobile_capture_ingest(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    input: mobile_capture_inbox::IngestMobileCaptureInput,
) -> Result<mobile_capture_inbox::MobileCaptureInboxItemDto, String> {
    mobile_capture_result(&state, |connection| {
        mobile_capture_inbox::ingest(connection, &vault, &input)
    })
}

#[tauri::command]
fn mobile_capture_image_preview(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    household_id: String,
    artifact_id: String,
) -> Result<mobile_capture_inbox::MobileCaptureImagePreviewDto, String> {
    mobile_capture_result(&state, |connection| {
        mobile_capture_inbox::image_preview(connection, &vault, &household_id, &artifact_id)
    })
}

#[tauri::command]
fn mobile_capture_mark_ocr_review_required(
    state: tauri::State<'_, AppState>,
    household_id: String,
    artifact_id: String,
) -> Result<mobile_capture_inbox::MobileCaptureInboxItemDto, String> {
    mobile_capture_result(&state, |connection| {
        mobile_capture_inbox::mark_ocr_review_required(connection, &household_id, &artifact_id)
    })
}

#[tauri::command]
fn mobile_capture_promote(
    state: tauri::State<'_, AppState>,
    input: mobile_capture_inbox::PromoteMobileCaptureInput,
) -> Result<mobile_capture_inbox::MobileCapturePromotionDto, String> {
    mobile_capture_result(&state, |connection| {
        mobile_capture_inbox::promote(connection, &input)
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnableMobileCaptureBackgroundInput {
    household_id: String,
    token: String,
    interval_minutes: u32,
}

fn disabled_mobile_capture_background(
    state: &AppState,
    household_id: &str,
) -> Result<mobile_capture_background::MobileCaptureBackgroundStatusDto, String> {
    state
        .with_connection(|connection| {
            let updated_at =
                connection.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
                    row.get(0)
                })?;
            Ok(
                mobile_capture_background::MobileCaptureBackgroundStatusDto {
                    household_id: household_id.to_owned(),
                    enabled: false,
                    interval_minutes: 30,
                    next_due_at: None,
                    running: false,
                    lease_expires_at: None,
                    last_attempt_at: None,
                    last_success_at: None,
                    last_result: "DISABLED".to_owned(),
                    last_ingested_count: 0,
                    consecutive_failures: 0,
                    suspended_until: None,
                    suspension_reason: None,
                    last_error_code: None,
                    updated_at,
                },
            )
        })
        .map_err(|_| "Automatic mobile capture status could not be loaded".to_owned())
}

#[tauri::command]
fn mobile_capture_background_status(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<mobile_capture_background::MobileCaptureBackgroundStatusDto, String> {
    match state.with_connection(|connection| {
        mobile_capture_background::status(connection, &household_id)
            .map_err(persistence::PersistenceError::from)
    }) {
        Ok(status) => Ok(status),
        Err(persistence::PersistenceError::Database(rusqlite::Error::QueryReturnedNoRows)) => {
            disabled_mobile_capture_background(&state, &household_id)
        }
        Err(_) => Err("Automatic mobile capture status could not be loaded".to_owned()),
    }
}

#[tauri::command]
fn mobile_capture_background_enable(
    state: tauri::State<'_, AppState>,
    credentials: tauri::State<'_, family_delivery_credentials::FamilyDeliveryCredentialStore>,
    identity: tauri::State<'_, family_envelope_identity::FamilyEnvelopeIdentityState>,
    input: EnableMobileCaptureBackgroundInput,
) -> Result<mobile_capture_background::MobileCaptureBackgroundStatusDto, String> {
    if !matches!(input.interval_minutes, 15 | 30 | 60) {
        return Err("Automatic capture interval is invalid".to_owned());
    }
    let context =
        family_delivery_scheduler::load_connection_context(&state, &input.household_id)
            .map_err(|_| "Connect family delivery before enabling automatic capture".to_owned())?;
    let token = Zeroizing::new(input.token);
    let client = family_delivery_http::FamilyDeliveryHttpClient::production(
        &context.endpoint,
        token.as_str(),
    )
    .map_err(|_| "Family relay connection could not be validated".to_owned())?;
    family_delivery_scheduler::validate_and_refresh_with_client(
        &state, &identity, &context, &client,
    )
    .map_err(|failure| match failure {
        family_delivery_scheduler::DiscoveryFailure::Terminal("AUTH_EXPIRED") => {
            "Family relay authentication expired".to_owned()
        }
        family_delivery_scheduler::DiscoveryFailure::Terminal("MEMBERSHIP_REVOKED") => {
            "Family relay membership is no longer active".to_owned()
        }
        _ => "Family relay connection could not be validated".to_owned(),
    })?;
    let binding = family_delivery_scheduler::credential_binding(&context)
        .map_err(|_| "Family delivery connection is invalid".to_owned())?;
    credentials
        .store(binding.clone(), token)
        .map_err(|_| "Family relay credential could not be stored".to_owned())?;
    match state.with_connection(|connection| {
        mobile_capture_background::configure(
            connection,
            &input.household_id,
            true,
            input.interval_minutes,
        )
        .map_err(persistence::PersistenceError::from)
    }) {
        Ok(status) => Ok(status),
        Err(_) => {
            let family_enabled = state
                .with_connection(|connection| {
                    connection.query_row(
                        "SELECT EXISTS(SELECT 1 FROM family_delivery_schedules WHERE household_id=?1 AND enabled=1)",
                        [&input.household_id],
                        |row| row.get::<_, bool>(0),
                    ).map_err(persistence::PersistenceError::from)
                })
                .unwrap_or(false);
            if !family_enabled {
                let _ = credentials.delete(&binding);
            }
            Err("Automatic mobile capture could not be enabled".to_owned())
        }
    }
}

#[tauri::command]
fn mobile_capture_background_disable(
    state: tauri::State<'_, AppState>,
    credentials: tauri::State<'_, family_delivery_credentials::FamilyDeliveryCredentialStore>,
    household_id: String,
) -> Result<mobile_capture_background::MobileCaptureBackgroundStatusDto, String> {
    let context = family_delivery_scheduler::load_connection_context(&state, &household_id)
        .map_err(|_| "Family delivery connection is unavailable".to_owned())?;
    let binding = family_delivery_scheduler::credential_binding(&context)
        .map_err(|_| "Family delivery connection is invalid".to_owned())?;
    let status = state
        .with_connection(|connection| {
            mobile_capture_background::disable(connection, &household_id)
                .map_err(persistence::PersistenceError::from)
        })
        .map_err(|_| "Automatic mobile capture could not be disabled".to_owned())?;
    let family_enabled = state
        .with_connection(|connection| {
            connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM family_delivery_schedules WHERE household_id=?1 AND enabled=1)",
                    [&household_id],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(persistence::PersistenceError::from)
        })
        .unwrap_or(false);
    if !family_enabled {
        credentials.delete(&binding).map_err(|_| {
            "Automatic capture is disabled, but its stored relay credential could not be deleted"
                .to_owned()
        })?;
    }
    Ok(status)
}

#[tauri::command]
fn mobile_capture_background_run_now(
    state: tauri::State<'_, AppState>,
    credentials: tauri::State<'_, family_delivery_credentials::FamilyDeliveryCredentialStore>,
    vault: tauri::State<'_, DocumentVault>,
    household_id: String,
) -> Result<mobile_capture_background::MobileCaptureBackgroundStatusDto, String> {
    state
        .with_connection(|connection| {
            mobile_capture_background::request_now(connection, &household_id)
                .map_err(persistence::PersistenceError::from)
        })
        .map_err(|_| "Automatic mobile capture could not be requested".to_owned())?;
    let lease = state
        .with_connection(|connection| {
            mobile_capture_background::claim_due(connection, &household_id)
                .map_err(persistence::PersistenceError::from)
        })
        .map_err(|_| "Automatic mobile capture could not start".to_owned())?
        .ok_or_else(|| "Automatic mobile capture is already running".to_owned())?;
    mobile_capture_background::process_now(
        &state,
        &credentials,
        &vault,
        &household_id,
        &lease.lease_token,
    )
}

#[tauri::command]
fn family_delivery_status(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    household_id: String,
) -> Result<family_delivery_transport::FamilyDeliveryStatusDto, String> {
    family_delivery_result(&state, |connection| {
        family_delivery_transport::status_with_vault(connection, &vault, &household_id)
    })
}

#[tauri::command]
fn family_delivery_connection_save(
    state: tauri::State<'_, AppState>,
    credentials: tauri::State<'_, family_delivery_credentials::FamilyDeliveryCredentialStore>,
    input: family_delivery_transport::SaveFamilyConnectionInput,
) -> Result<family_delivery_transport::FamilyDeliveryStatusDto, String> {
    let next_binding = family_delivery_credentials::FamilyDeliveryCredentialBinding::new(
        input.household_id.clone(),
        &input.endpoint,
        input.remote_principal_id.clone(),
    )
    .map_err(|_| "Family delivery connection is invalid".to_owned())?;
    let household_id = input.household_id.clone();
    let saved = state
        .with_connection(|connection| {
            let previous_status = family_delivery_transport::status(connection, &household_id)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let previous_input = match (
                previous_status.endpoint.clone(),
                previous_status.remote_principal_id.clone(),
                previous_status.local_member_id.clone(),
                previous_status.local_member_name.clone(),
            ) {
                (
                    Some(endpoint),
                    Some(remote_principal_id),
                    Some(local_member_id),
                    Some(local_member_name),
                ) => Some(family_delivery_transport::SaveFamilyConnectionInput {
                    household_id: household_id.clone(),
                    endpoint,
                    remote_principal_id,
                    local_member_id: Some(local_member_id),
                    local_member_name: Some(local_member_name),
                    memberships: previous_status.memberships.clone(),
                }),
                _ => None,
            };
            let previous_binding = previous_input.as_ref().and_then(|previous| {
                family_delivery_credentials::FamilyDeliveryCredentialBinding::new(
                    previous.household_id.clone(),
                    &previous.endpoint,
                    previous.remote_principal_id.clone(),
                )
                .ok()
            });
            let binding_changed = previous_binding
                .as_ref()
                .is_some_and(|previous| previous != &next_binding);

            // Persist the replacement first while holding the database lock. If
            // disabling its inherited schedule fails, restore the prior
            // connection before another worker can claim it.
            let saved = family_delivery_transport::save_connection(connection, &input)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            if binding_changed {
                match family_delivery_schedule::disable(connection, &household_id) {
                    Ok(_)
                    | Err(family_delivery_schedule::FamilyDeliveryScheduleError::NotConfigured) => {
                    }
                    Err(_) => {
                        if let Some(previous) = previous_input.as_ref() {
                            let _ =
                                family_delivery_transport::save_connection(connection, previous);
                        }
                        return Err(rusqlite::Error::InvalidQuery.into());
                    }
                }
                match mobile_capture_background::disable(connection, &household_id) {
                    Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => {}
                    Err(_) => {
                        if let Some(previous) = previous_input.as_ref() {
                            let _ =
                                family_delivery_transport::save_connection(connection, previous);
                        }
                        return Err(rusqlite::Error::InvalidQuery.into());
                    }
                }
            }
            Ok((saved, binding_changed.then_some(previous_binding).flatten()))
        })
        .map_err(|_| "Family delivery connection could not be saved safely".to_owned())?;

    if let Some(previous_binding) = saved.1 {
        // The new connection is durable and automatic checking is disabled at
        // this point. A credential cleanup failure is reported, but can never
        // leave the schedule enabled for the replacement binding.
        credentials
            .delete(&previous_binding)
            .map_err(|_| "Stored family relay credential could not be deleted".to_owned())?;
    }
    Ok(saved.0)
}

#[tauri::command]
fn family_delivery_disconnect(
    state: tauri::State<'_, AppState>,
    credentials: tauri::State<'_, family_delivery_credentials::FamilyDeliveryCredentialStore>,
    household_id: String,
) -> Result<family_delivery_transport::FamilyDeliveryStatusDto, String> {
    match state.with_connection(|connection| {
        Ok(family_delivery_schedule::disable(connection, &household_id))
    }) {
        Ok(Ok(_))
        | Ok(Err(family_delivery_schedule::FamilyDeliveryScheduleError::NotConfigured)) => {}
        _ => return Err("Automatic family delivery check could not be disabled".to_owned()),
    }
    match state.with_connection(|connection| {
        mobile_capture_background::disable(connection, &household_id)
            .map_err(persistence::PersistenceError::from)
    }) {
        Ok(_)
        | Err(persistence::PersistenceError::Database(rusqlite::Error::QueryReturnedNoRows)) => {}
        Err(_) => return Err("Automatic mobile capture could not be disabled".to_owned()),
    }
    if let Ok(context) = family_delivery_scheduler::load_connection_context(&state, &household_id) {
        let binding = family_delivery_scheduler::credential_binding(&context)
            .map_err(|_| "Family delivery connection is invalid".to_owned())?;
        credentials
            .delete(&binding)
            .map_err(|_| "Stored family relay credential could not be deleted".to_owned())?;
    }
    family_delivery_result(&state, |connection| {
        family_delivery_transport::disconnect(connection, &household_id)
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnableFamilyDeliveryBackgroundInput {
    household_id: String,
    token: String,
    interval_minutes: u32,
}

fn disabled_family_delivery_schedule(
    state: &AppState,
    household_id: &str,
) -> Result<family_delivery_schedule::FamilyDeliveryScheduleStatusDto, String> {
    state
        .with_connection(|connection| {
            let updated_at =
                connection.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
                    row.get(0)
                })?;
            Ok(family_delivery_schedule::FamilyDeliveryScheduleStatusDto {
                household_id: household_id.to_owned(),
                enabled: false,
                interval_minutes: 30,
                next_due_at: None,
                running: false,
                lease_expires_at: None,
                last_attempt_at: None,
                last_success_at: None,
                last_result: "DISABLED".to_owned(),
                last_discovered_count: 0,
                consecutive_failures: 0,
                suspended_until: None,
                suspension_reason: None,
                last_error_code: None,
                updated_at,
            })
        })
        .map_err(|_| "Automatic family delivery status could not be loaded".to_owned())
}

#[tauri::command]
fn family_delivery_background_status(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<family_delivery_schedule::FamilyDeliveryScheduleStatusDto, String> {
    match state.with_connection(|connection| {
        Ok(family_delivery_schedule::status(connection, &household_id))
    }) {
        Ok(Ok(status)) => Ok(status),
        Ok(Err(family_delivery_schedule::FamilyDeliveryScheduleError::NotConfigured)) => {
            disabled_family_delivery_schedule(&state, &household_id)
        }
        _ => Err("Automatic family delivery status could not be loaded".to_owned()),
    }
}

#[tauri::command]
fn family_delivery_background_enable(
    state: tauri::State<'_, AppState>,
    credentials: tauri::State<'_, family_delivery_credentials::FamilyDeliveryCredentialStore>,
    identity: tauri::State<'_, family_envelope_identity::FamilyEnvelopeIdentityState>,
    input: EnableFamilyDeliveryBackgroundInput,
) -> Result<family_delivery_schedule::FamilyDeliveryScheduleStatusDto, String> {
    if !matches!(input.interval_minutes, 15 | 30 | 60) {
        return Err("Automatic check interval is invalid".to_owned());
    }
    let context =
        family_delivery_scheduler::load_connection_context(&state, &input.household_id)
            .map_err(|_| "Connect family delivery before enabling automatic checks".to_owned())?;
    let token = Zeroizing::new(input.token);
    let client = family_delivery_http::FamilyDeliveryHttpClient::production(
        &context.endpoint,
        token.as_str(),
    )
    .map_err(|_| "Family relay connection could not be validated".to_owned())?;
    family_delivery_scheduler::validate_and_refresh_with_client(
        &state, &identity, &context, &client,
    )
    .map_err(|failure| match failure {
        family_delivery_scheduler::DiscoveryFailure::Terminal("AUTH_EXPIRED") => {
            "Family relay authentication expired".to_owned()
        }
        family_delivery_scheduler::DiscoveryFailure::Terminal("MEMBERSHIP_REVOKED") => {
            "Family relay membership is no longer active".to_owned()
        }
        _ => "Family relay connection could not be validated".to_owned(),
    })?;
    let binding = family_delivery_scheduler::credential_binding(&context)
        .map_err(|_| "Family delivery connection is invalid".to_owned())?;
    credentials
        .store(binding.clone(), token)
        .map_err(|_| "Family relay credential could not be stored".to_owned())?;
    match family_delivery_schedule_result(&state, |connection| {
        family_delivery_schedule::configure(
            connection,
            &input.household_id,
            true,
            input.interval_minutes,
        )
    }) {
        Ok(status) => Ok(status),
        Err(error) => {
            let capture_enabled = state
                .with_connection(|connection| {
                    connection
                        .query_row(
                            "SELECT EXISTS(SELECT 1 FROM mobile_capture_schedules WHERE household_id=?1 AND enabled=1)",
                            [&input.household_id],
                            |row| row.get::<_, bool>(0),
                        )
                        .map_err(persistence::PersistenceError::from)
                })
                .unwrap_or(false);
            if !capture_enabled {
                let _ = credentials.delete(&binding);
            }
            Err(error)
        }
    }
}

#[tauri::command]
fn family_delivery_background_disable(
    state: tauri::State<'_, AppState>,
    credentials: tauri::State<'_, family_delivery_credentials::FamilyDeliveryCredentialStore>,
    household_id: String,
) -> Result<family_delivery_schedule::FamilyDeliveryScheduleStatusDto, String> {
    let context = family_delivery_scheduler::load_connection_context(&state, &household_id)
        .map_err(|_| "Family delivery connection is unavailable".to_owned())?;
    let binding = family_delivery_scheduler::credential_binding(&context)
        .map_err(|_| "Family delivery connection is invalid".to_owned())?;
    let status = family_delivery_schedule_result(&state, |connection| {
        family_delivery_schedule::disable(connection, &household_id)
    })?;
    // Disable the durable schedule before touching the OS credential. If the
    // database write fails the token remains available and the existing
    // schedule is unchanged. If deletion fails, the schedule remains disabled.
    let capture_enabled = state
        .with_connection(|connection| {
            connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM mobile_capture_schedules WHERE household_id=?1 AND enabled=1)",
                    [&household_id],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(persistence::PersistenceError::from)
        })
        .unwrap_or(false);
    if !capture_enabled {
        credentials
            .delete(&binding)
            .map_err(|_| "Automatic checks are disabled, but the stored family relay credential could not be deleted".to_owned())?;
    }
    Ok(status)
}

#[tauri::command]
fn family_delivery_background_run_now(
    state: tauri::State<'_, AppState>,
    credentials: tauri::State<'_, family_delivery_credentials::FamilyDeliveryCredentialStore>,
    identity: tauri::State<'_, family_envelope_identity::FamilyEnvelopeIdentityState>,
    household_id: String,
) -> Result<family_delivery_schedule::FamilyDeliveryScheduleStatusDto, String> {
    family_delivery_schedule_result(&state, |connection| {
        family_delivery_schedule::request_now(connection, &household_id)
    })?;
    let lease = family_delivery_schedule_result(&state, |connection| {
        family_delivery_schedule::claim_due(connection, &household_id)
    })?
    .ok_or_else(|| "Automatic family delivery check is already running".to_owned())?;
    family_delivery_scheduler::process_claimed_now(
        &state,
        &credentials,
        &identity,
        &household_id,
        &lease.lease_token,
    )
}

#[tauri::command]
fn family_delivery_remote_state_register(
    state: tauri::State<'_, AppState>,
    input: family_delivery_transport::RegisterRemoteStateInput,
) -> Result<family_delivery_transport::FamilyDeliveryStatusDto, String> {
    family_delivery_result(&state, |connection| {
        family_delivery_transport::register_remote_state(connection, &input)
    })
}

#[tauri::command]
fn family_delivery_send_prepare(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    input: family_delivery_transport::PrepareFamilyDeliveryInput,
) -> Result<Vec<family_delivery_transport::PreparedFamilyArtifactDto>, String> {
    family_delivery_result(&state, |connection| {
        family_delivery_transport::prepare_send_with_vault(connection, &vault, &input)
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareEncryptedFamilyEnvelopeInput {
    delivery_id: String,
    metadata: family_encrypted_envelope::FamilyEnvelopeMetadata,
    recipients: Vec<family_envelope_identity::FamilyEnvelopeRecipientDto>,
    recipient_set_digest: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GetCachedFamilyEnvelopeInput {
    delivery_id: String,
    metadata: family_encrypted_envelope::FamilyEnvelopeMetadata,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareEncryptedFamilyEnvelopeOutput {
    envelope_byte_size: u64,
    envelope_bytes: Vec<u8>,
    envelope_sha256: String,
    recipient_count: u32,
    recipient_set_digest: String,
    cache_disposition: String,
}

fn cached_family_envelope_output(
    cached: family_delivery_transport::CachedOutboundEnvelopeDto,
    expected_metadata: &family_encrypted_envelope::FamilyEnvelopeMetadata,
    cache_disposition: &str,
) -> Result<PrepareEncryptedFamilyEnvelopeOutput, String> {
    let summary = family_encrypted_envelope::inspect_family_envelope(&cached.envelope_bytes)
        .map_err(|_| "Cached family delivery envelope is invalid".to_owned())?;
    if summary.metadata != *expected_metadata {
        return Err("Cached family delivery envelope metadata conflicts".to_owned());
    }
    let recipient_count = u32::try_from(summary.recipient_ids.len())
        .map_err(|_| "Cached family delivery recipient count is invalid".to_owned())?;
    Ok(PrepareEncryptedFamilyEnvelopeOutput {
        envelope_byte_size: summary.encrypted_byte_size,
        envelope_bytes: cached.envelope_bytes,
        envelope_sha256: cached.transport_sha256,
        recipient_count,
        recipient_set_digest: cached.recipient_set_digest,
        cache_disposition: cache_disposition.to_owned(),
    })
}

fn artifact_matches_envelope_metadata(
    artifact: &family_delivery_transport::PreparedFamilyArtifactDto,
    metadata: &family_encrypted_envelope::FamilyEnvelopeMetadata,
) -> bool {
    artifact.digest == metadata.inner_sha256
        && artifact.household_id == metadata.household_id
        && artifact.artifact_id == metadata.publication_id
        && artifact.origin_device_id == metadata.origin_installation_id
        && artifact.artifact_schema == metadata.artifact_schema
}

#[tauri::command]
fn family_delivery_envelope_cached_get(
    state: tauri::State<'_, AppState>,
    input: GetCachedFamilyEnvelopeInput,
) -> Result<Option<PrepareEncryptedFamilyEnvelopeOutput>, String> {
    let cached = family_delivery_result(&state, |connection| {
        family_delivery_transport::load_any_cached_outbound_envelope(
            connection,
            &input.delivery_id,
            &input.metadata.inner_sha256,
        )
    })?;
    let Some(cached) = cached else {
        return Ok(None);
    };
    let artifact = family_delivery_result(&state, |connection| {
        family_delivery_transport::load_prepared_artifact(connection, &input.delivery_id)
    })?
    .ok_or_else(|| "Family delivery artifact is unavailable".to_owned())?;
    if !artifact_matches_envelope_metadata(&artifact, &input.metadata) {
        return Err("Family delivery envelope metadata conflicts".to_owned());
    }
    cached_family_envelope_output(cached, &input.metadata, "STALE_CACHE_REUSED").map(Some)
}

#[tauri::command]
fn family_delivery_envelope_prepare(
    state: tauri::State<'_, AppState>,
    identity: tauri::State<'_, family_envelope_identity::FamilyEnvelopeIdentityState>,
    input: PrepareEncryptedFamilyEnvelopeInput,
) -> Result<PrepareEncryptedFamilyEnvelopeOutput, String> {
    let cached = family_delivery_result(&state, |connection| {
        family_delivery_transport::load_cached_outbound_envelope(
            connection,
            &input.delivery_id,
            &input.metadata.inner_sha256,
            &input.recipient_set_digest,
        )
    })?;
    if let Some(cached) = cached {
        return cached_family_envelope_output(cached, &input.metadata, "EXACT_CACHE");
    }

    let artifact = family_delivery_result(&state, |connection| {
        family_delivery_transport::load_prepared_artifact(connection, &input.delivery_id)
    })?
    .ok_or_else(|| "Family delivery artifact is unavailable".to_owned())?;
    if !artifact_matches_envelope_metadata(&artifact, &input.metadata) {
        return Err("Family delivery envelope metadata conflicts".to_owned());
    }
    let sealed = identity
        .seal(family_envelope_identity::SealFamilyEnvelopeInput {
            metadata: input.metadata,
            artifact_bytes: artifact.package_bytes,
            recipients: input.recipients,
        })
        .map_err(|error| error.to_string())?;
    let cached = family_delivery_result(&state, |connection| {
        family_delivery_transport::cache_outbound_envelope(
            connection,
            &family_delivery_transport::CacheOutboundEnvelopeInput {
                delivery_id: input.delivery_id,
                envelope_schema: "FAMILY_ENCRYPTED_ENVELOPE_V1".to_owned(),
                transport_sha256: sealed.envelope_sha256.clone(),
                inner_sha256: artifact.digest,
                recipient_set_digest: input.recipient_set_digest,
                envelope_bytes: sealed.envelope_bytes.clone(),
            },
        )
    })?;
    Ok(PrepareEncryptedFamilyEnvelopeOutput {
        envelope_bytes: cached.envelope_bytes,
        envelope_sha256: cached.transport_sha256,
        envelope_byte_size: sealed.envelope_byte_size,
        recipient_count: sealed.recipient_count,
        recipient_set_digest: cached.recipient_set_digest,
        cache_disposition: "NEWLY_SEALED".to_owned(),
    })
}

#[tauri::command]
fn family_delivery_send_accept(
    state: tauri::State<'_, AppState>,
    input: family_delivery_transport::AcceptFamilyDeliveryInput,
) -> Result<family_delivery_transport::FamilyDeliveryStatusDto, String> {
    family_delivery_result(&state, |connection| {
        family_delivery_transport::mark_accepted(connection, &input)
    })
}

#[tauri::command]
fn family_delivery_send_failed(
    state: tauri::State<'_, AppState>,
    household_id: String,
    delivery_ids: Vec<String>,
) -> Result<family_delivery_transport::FamilyDeliveryStatusDto, String> {
    family_delivery_result(&state, |connection| {
        family_delivery_transport::mark_failed(connection, &household_id, &delivery_ids)
    })
}

#[tauri::command]
fn family_delivery_envelope_recipient_set_changed(
    state: tauri::State<'_, AppState>,
    household_id: String,
    deliveries: Vec<family_delivery_transport::RejectedRecipientSetDeliveryInput>,
) -> Result<family_delivery_transport::FamilyDeliveryStatusDto, String> {
    let input = family_delivery_transport::ResetRejectedRecipientSetsInput {
        household_id,
        deliveries,
    };
    family_delivery_result(&state, |connection| {
        family_delivery_transport::reset_rejected_outbound_envelopes(connection, &input)
    })
}

#[tauri::command]
fn family_delivery_inbound_register(
    state: tauri::State<'_, AppState>,
    input: family_delivery_transport::RegisterFamilyInboundInput,
) -> Result<family_delivery_transport::FamilyDeliveryStatusDto, String> {
    family_delivery_result(&state, |connection| {
        family_delivery_transport::register_inbound(connection, &input)
    })
}

#[tauri::command]
fn family_delivery_inbound_stage(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    input: family_delivery_transport::StageFamilyInboundInput,
) -> Result<family_delivery_transport::FamilyDeliveryStatusDto, String> {
    let household_id = input.household_id.clone();
    family_delivery_result(&state, |connection| {
        family_delivery_transport::stage_inbound_with_vault(connection, &vault, &input)?;
        family_delivery_transport::status(connection, &household_id)
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StageEncryptedFamilyInboundInput {
    household_id: String,
    artifact_id: String,
    envelope_bytes: Vec<u8>,
    local_membership_id: String,
}

#[tauri::command]
fn family_delivery_encrypted_inbound_stage(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    identity: tauri::State<'_, family_envelope_identity::FamilyEnvelopeIdentityState>,
    input: StageEncryptedFamilyInboundInput,
) -> Result<family_delivery_transport::FamilyDeliveryStatusDto, String> {
    let metadata = family_delivery_result(&state, |connection| {
        family_delivery_transport::load_inbound_transport_metadata(
            connection,
            &input.household_id,
            &input.artifact_id,
        )
    })?
    .ok_or_else(|| "Family delivery artifact is unavailable".to_owned())?;
    if metadata.envelope_schema.as_deref() != Some("FAMILY_ENCRYPTED_ENVELOPE_V1")
        || metadata.byte_size != input.envelope_bytes.len() as u64
    {
        return Err("Family delivery envelope metadata conflicts".to_owned());
    }
    let opened = identity
        .open(family_envelope_identity::OpenFamilyEnvelopeInput {
            expected_metadata: family_encrypted_envelope::FamilyEnvelopeMetadata {
                household_id: input.household_id.clone(),
                publication_id: input.artifact_id.clone(),
                origin_installation_id: metadata.origin_device_id,
                artifact_schema: metadata.artifact_schema,
                inner_sha256: metadata.inner_sha256,
            },
            envelope_bytes: input.envelope_bytes,
            local_membership_id: input.local_membership_id,
        })
        .map_err(|error| error.to_string())?;
    let stage = family_delivery_transport::StageFamilyInboundInput {
        household_id: input.household_id.clone(),
        artifact_id: input.artifact_id,
        package_bytes: opened.artifact_bytes,
    };
    family_delivery_result(&state, |connection| {
        family_delivery_transport::stage_inbound_with_vault(connection, &vault, &stage)?;
        family_delivery_transport::status(connection, &input.household_id)
    })
}

#[tauri::command]
fn family_snapshot_active_review(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Option<family_delivery_transport::FamilySnapshotUiReviewDto>, String> {
    family_delivery_result(&state, |connection| {
        family_delivery_transport::active_ui_review(connection, &household_id)
    })
}

#[tauri::command]
fn family_snapshot_resolve(
    state: tauri::State<'_, AppState>,
    package_id: String,
    resolutions: Vec<family_delivery_transport::FamilySnapshotUiResolutionInput>,
) -> Result<family_delivery_transport::FamilySnapshotUiReviewDto, String> {
    family_delivery_result(&state, |connection| {
        family_delivery_transport::resolve_ui_review(connection, &package_id, &resolutions)
    })
}

#[tauri::command]
fn family_snapshot_apply(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    package_id: String,
) -> Result<family_delivery_transport::FamilySnapshotUiReviewDto, String> {
    family_delivery_result(&state, |connection| {
        family_delivery_transport::apply_ui_review_with_vault(connection, &vault, &package_id)
    })
}

#[tauri::command]
fn family_snapshot_discard(
    state: tauri::State<'_, AppState>,
    package_id: String,
) -> Result<(), String> {
    family_delivery_result(&state, |connection| {
        family_delivery_transport::discard_ui_review(connection, &package_id)
    })
}

fn change_package_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> change_package::Result<T>,
) -> Result<T, String> {
    state
        .with_connection(|connection| {
            operation(connection).map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| "Change package operation could not be completed".to_owned())
}

#[tauri::command]
async fn change_package_export_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Option<String>, String> {
    let package = change_package_result(&state, |connection| {
        change_package::export_current_state(connection, &household_id)
    })?;
    let bytes = change_package::encode_pretty(&package)
        .map_err(|_| "Change package could not be encoded".to_owned())?;
    let file_name = format!(
        "kakeflow-change-{}.kakeflow-change.json",
        &package.snapshot_sha256[..12]
    );
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("KakeFlow Change Package", &["json"])
        .set_file_name(&file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected change package destination is unavailable".to_owned())?;
    std::fs::write(destination, bytes)
        .map_err(|_| "Change package could not be saved".to_owned())?;
    Ok(Some(file_name))
}

#[tauri::command]
async fn change_package_pick_and_stage(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Option<change_package::ChangePackageReviewDto>, String> {
    const MAX_CHANGE_PACKAGE_BYTES: u64 = 64 * 1024 * 1024;
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("KakeFlow Change Package", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "Selected change package is unavailable".to_owned())?;
    let metadata = std::fs::metadata(&path)
        .map_err(|_| "Selected change package is unavailable".to_owned())?;
    if !metadata.is_file() || metadata.len() > MAX_CHANGE_PACKAGE_BYTES {
        return Err("Selected change package is too large".to_owned());
    }
    let bytes =
        std::fs::read(path).map_err(|_| "Selected change package could not be read".to_owned())?;
    change_package_result(&state, |connection| {
        change_package::stage_package(connection, &household_id, &bytes)
    })
    .map(Some)
}

#[tauri::command]
fn change_package_active_review(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Option<change_package::ChangePackageReviewDto>, String> {
    change_package_result(&state, |connection| {
        change_package::get_active_review(connection, &household_id)
    })
}

#[tauri::command]
fn change_package_resolve(
    state: tauri::State<'_, AppState>,
    package_id: String,
    resolutions: Vec<change_package::ChangePackageResolutionInput>,
) -> Result<change_package::ChangePackageReviewDto, String> {
    change_package_result(&state, |connection| {
        change_package::resolve_package(connection, &package_id, &resolutions)
    })
}

#[tauri::command]
fn change_package_apply(
    state: tauri::State<'_, AppState>,
    package_id: String,
) -> Result<change_package::ChangePackageReviewDto, String> {
    change_package_result(&state, |connection| {
        change_package::apply_package(connection, &package_id)
    })
}

#[tauri::command]
fn change_package_discard(
    state: tauri::State<'_, AppState>,
    package_id: String,
) -> Result<(), String> {
    change_package_result(&state, |connection| {
        change_package::discard_package(connection, &package_id)
    })
}

fn evidence_bundle_message(error: evidence_bundle::EvidenceBundleError) -> String {
    match error {
        evidence_bundle::EvidenceBundleError::Empty => {
            "No confirmed source evidence is available for this household"
        }
        evidence_bundle::EvidenceBundleError::MissingDependency => {
            "Apply the matching change package before importing its source evidence"
        }
        evidence_bundle::EvidenceBundleError::Conflict => {
            "This evidence conflicts with existing local provenance"
        }
        evidence_bundle::EvidenceBundleError::LimitExceeded => {
            "The evidence bundle exceeds supported limits"
        }
        _ => "Evidence bundle operation could not be completed",
    }
    .to_owned()
}

#[tauri::command]
async fn evidence_bundle_export_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    household_id: String,
    passphrase: String,
) -> Result<Option<evidence_bundle::EvidenceBundleSummaryDto>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("KakeFlow Confirmed Evidence", &["kakeflow-evidence"])
        .set_file_name("kakeflow-confirmed-evidence.kakeflow-evidence")
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected evidence destination is unavailable".to_owned())?;
    let passphrase = Zeroizing::new(passphrase);
    state
        .with_connection(|connection| {
            Ok(evidence_bundle::export_confirmed_evidence(
                connection,
                &vault,
                &household_id,
                &destination,
                passphrase.as_str(),
            ))
        })
        .map_err(|_| "Evidence bundle operation could not be completed".to_owned())?
        .map(Some)
        .map_err(evidence_bundle_message)
}

#[tauri::command]
async fn evidence_bundle_pick_and_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    household_id: String,
    passphrase: String,
) -> Result<Option<evidence_bundle::EvidenceBundleSummaryDto>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("KakeFlow Confirmed Evidence", &["kakeflow-evidence"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let source = selected
        .into_path()
        .map_err(|_| "Selected evidence bundle is unavailable".to_owned())?;
    let passphrase = Zeroizing::new(passphrase);
    let staged = evidence_bundle::stage_evidence_bundle(&source, passphrase.as_str())
        .map_err(evidence_bundle_message)?;
    if staged.summary().household_id != household_id {
        return Err("The evidence bundle belongs to a different household".to_owned());
    }
    state
        .with_connection(|connection| {
            Ok(evidence_bundle::apply_evidence_bundle(
                connection, &vault, &staged,
            ))
        })
        .map_err(|_| "Evidence bundle operation could not be completed".to_owned())?
        .map(Some)
        .map_err(evidence_bundle_message)
}

fn pending_import_message(error: pending_import_bundle::PendingImportBundleError) -> String {
    match error {
        pending_import_bundle::PendingImportBundleError::NotFound => {
            "The pending import could not be found"
        }
        pending_import_bundle::PendingImportBundleError::UnsupportedRun => {
            "Only transaction candidate reviews can be handed off in this version"
        }
        pending_import_bundle::PendingImportBundleError::MissingDependency => {
            "Every source account and member must be mapped explicitly"
        }
        pending_import_bundle::PendingImportBundleError::Conflict => {
            "This pending import conflicts with existing local review data"
        }
        pending_import_bundle::PendingImportBundleError::Terminal => {
            "The same source document already belongs to a completed local import"
        }
        pending_import_bundle::PendingImportBundleError::LimitExceeded => {
            "The pending import package exceeds supported limits"
        }
        _ => "Pending import handoff could not be completed",
    }
    .to_owned()
}

#[tauri::command]
async fn pending_import_export_to_picker(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    request: pending_import_bundle::PendingImportExportRequest,
    passphrase: String,
) -> Result<Option<pending_import_bundle::PendingImportExportSummaryDto>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("KakeFlow Pending Review", &["kakeflow-review"])
        .set_file_name("kakeflow-pending-review.kakeflow-review")
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected pending review destination is unavailable".to_owned())?;
    let passphrase = Zeroizing::new(passphrase);
    state
        .with_connection(|connection| {
            Ok(pending_import_bundle::export_pending_import(
                connection,
                &vault,
                &request,
                &destination,
                passphrase.as_str(),
            ))
        })
        .map_err(|_| "Pending import handoff could not be completed".to_owned())?
        .map(Some)
        .map_err(pending_import_message)
}

#[tauri::command]
async fn pending_import_pick_and_stage(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    stages: tauri::State<'_, PendingImportStages>,
    household_id: String,
    passphrase: String,
) -> Result<Option<pending_import_bundle::PendingImportStageDto>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("KakeFlow Pending Review", &["kakeflow-review"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let source = selected
        .into_path()
        .map_err(|_| "Selected pending review package is unavailable".to_owned())?;
    let passphrase = Zeroizing::new(passphrase);
    let staged = state
        .with_connection(|connection| {
            Ok(pending_import_bundle::stage_pending_import(
                connection,
                &source,
                &household_id,
                passphrase.as_str(),
            ))
        })
        .map_err(|_| "Pending import handoff could not be completed".to_owned())?
        .map_err(pending_import_message)?;
    let summary = staged.summary().clone();
    stages
        .0
        .lock()
        .map_err(|_| "Pending import staging is unavailable".to_owned())?
        .insert((household_id, summary.package_id.clone()), staged);
    Ok(Some(summary))
}

#[tauri::command]
fn pending_import_apply(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    stages: tauri::State<'_, PendingImportStages>,
    household_id: String,
    package_id: String,
    mappings: pending_import_bundle::PendingImportMappingsDto,
) -> Result<pending_import_bundle::PendingImportApplySummaryDto, String> {
    let mut guard = stages
        .0
        .lock()
        .map_err(|_| "Pending import staging is unavailable".to_owned())?;
    let staged = guard
        .get(&(household_id.clone(), package_id.clone()))
        .ok_or_else(|| "Stage the pending import package before applying it".to_owned())?;
    if staged.summary().package_id != package_id || staged.target_household_id() != household_id {
        return Err("Pending import staging is invalid".to_owned());
    }
    let result = state
        .with_connection(|connection| {
            Ok(pending_import_bundle::apply_pending_import(
                connection, &vault, staged, &mappings,
            ))
        })
        .map_err(|_| "Pending import handoff could not be completed".to_owned())?
        .map_err(pending_import_message)?;
    guard.remove(&(household_id, package_id));
    Ok(result)
}

#[tauri::command]
fn pending_import_discard(
    stages: tauri::State<'_, PendingImportStages>,
    package_id: String,
) -> Result<bool, String> {
    let mut guard = stages
        .0
        .lock()
        .map_err(|_| "Pending import staging is unavailable".to_owned())?;
    let before = guard.len();
    guard.retain(|(_, staged_package_id), _| staged_package_id != &package_id);
    Ok(guard.len() != before)
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

const PACKAGED_SMOKE_REQUIRED_PAGES: [(&str, &str); 11] = [
    ("ホーム", "Packaged Smoke Householdの家計"),
    ("取引", "すべての取引"),
    ("インポート", "インポート Inbox"),
    ("撮影 Inbox", "撮影 Inbox"),
    ("カード照合", "カード引落・支払余力"),
    ("資産・投資", "資産・投資"),
    ("カレンダー・レポート", "カレンダー・レポート"),
    ("予算・目標", "予算・貯蓄目標"),
    ("分類ルール", "分類ルール"),
    ("家族スペース", "家族スペース"),
    ("設定", "設定"),
];

fn validate_packaged_smoke_visual_evidence(
    evidence: &PackagedSmokeVisualEvidence,
) -> Result<(), String> {
    let navigation_complete = PACKAGED_SMOKE_REQUIRED_PAGES.iter().all(|(required, _)| {
        evidence
            .navigation_labels
            .iter()
            .any(|actual| actual == required)
    });
    let pages_complete = evidence.visited_pages.len() == PACKAGED_SMOKE_REQUIRED_PAGES.len()
        && PACKAGED_SMOKE_REQUIRED_PAGES
            .iter()
            .zip(&evidence.visited_pages)
            .all(|((navigation, title), page)| {
                page.navigation_label == *navigation
                    && page.page_title == *title
                    && page.active_navigation
                    && page.heading_visible
                    && page.main_width >= 600
                    && page.main_height > 0
                    && page.rendered_text_length >= 20
            });
    if evidence.onboarding_title != "家計簿をはじめましょう"
        || evidence.household_name != "Packaged Smoke Household"
        || evidence.interaction_count < PACKAGED_SMOKE_REQUIRED_PAGES.len() as u32 + 1
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
                "ホーム",
                "取引",
                "インポート",
                "撮影 Inbox",
                "カード照合",
                "資産・投資",
                "カレンダー・レポート",
                "予算・目標",
                "分類ルール",
                "家族スペース",
                "設定",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
            visited_pages: PACKAGED_SMOKE_REQUIRED_PAGES
                .into_iter()
                .map(|(navigation_label, page_title)| PackagedSmokePageEvidence {
                    navigation_label: navigation_label.into(),
                    page_title: page_title.into(),
                    active_navigation: true,
                    heading_visible: true,
                    main_width: 1000,
                    main_height: 700,
                    interactive_element_count: 2,
                    rendered_text_length: 100,
                })
                .collect(),
            interaction_count: 12,
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

fn dashboard_preferences_result<T>(
    state: &AppState,
    operation: impl FnOnce(
        &rusqlite::Connection,
    ) -> Result<T, dashboard_preferences::DashboardPreferencesError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Dashboard preference database access failed".to_owned())?
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

fn aggregate_asset_history_result<T>(
    state: &AppState,
    operation: impl FnOnce(
        &rusqlite::Connection,
    ) -> Result<T, aggregate_asset_history::AggregateAssetHistoryError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Aggregate asset database access failed".to_owned())?
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

fn parser_profile_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> Result<T, parser_profiles::ParserProfileError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Parser profile database access failed".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
fn delimited_parser_profiles_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<DelimitedParserProfileDto>, String> {
    parser_profile_result(&state, |connection| {
        parser_profiles::list_profiles(connection, &household_id)
    })
}

#[tauri::command]
fn delimited_parser_profile_create(
    state: tauri::State<'_, AppState>,
    input: CreateDelimitedParserProfileInput,
) -> Result<DelimitedParserProfileDto, String> {
    parser_profile_result(&state, |connection| {
        parser_profiles::create_profile(connection, &input)
    })
}

#[tauri::command]
fn delimited_parser_profile_update(
    state: tauri::State<'_, AppState>,
    input: UpdateDelimitedParserProfileInput,
) -> Result<DelimitedParserProfileDto, String> {
    parser_profile_result(&state, |connection| {
        parser_profiles::update_profile(connection, &input)
    })
}

#[tauri::command]
fn delimited_parser_profile_delete(
    state: tauri::State<'_, AppState>,
    input: DeleteDelimitedParserProfileInput,
) -> Result<(), String> {
    parser_profile_result(&state, |connection| {
        parser_profiles::delete_profile(connection, &input)
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
fn transaction_metadata_bulk_update(
    state: tauri::State<'_, AppState>,
    input: BulkUpdateTransactionMetadataInput,
) -> Result<BulkUpdateTransactionMetadataDto, String> {
    repository_result(&state, |connection| {
        read_model::bulk_update_transaction_metadata(connection, &input)
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
fn dashboard_preferences_get(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<DashboardPreferencesDto, String> {
    dashboard_preferences_result(&state, |connection| {
        dashboard_preferences::get(connection, &household_id)
    })
}

#[tauri::command]
fn dashboard_preferences_upsert(
    state: tauri::State<'_, AppState>,
    input: UpsertDashboardPreferencesInput,
) -> Result<DashboardPreferencesDto, String> {
    dashboard_preferences_result(&state, |connection| {
        dashboard_preferences::upsert(connection, &input)
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
fn aggregate_asset_snapshot_import(
    state: tauri::State<'_, AppState>,
    input: ImportAggregateAssetSnapshotInput,
) -> Result<ImportAggregateAssetSnapshotResultDto, String> {
    aggregate_asset_history_result(&state, |connection| {
        aggregate_asset_history::import_snapshot(connection, &input)
    })
}

#[tauri::command]
fn aggregate_asset_history_import(
    state: tauri::State<'_, AppState>,
    input: ImportAggregateAssetHistoryInput,
) -> Result<ImportAggregateAssetHistoryResultDto, String> {
    aggregate_asset_history_result(&state, |connection| {
        aggregate_asset_history::import_history(connection, &input)
    })
}

#[tauri::command]
fn aggregate_asset_history_list(
    state: tauri::State<'_, AppState>,
    request: ListAggregateAssetHistoryInput,
) -> Result<Vec<AggregateAssetSnapshotDto>, String> {
    aggregate_asset_history_result(&state, |connection| {
        aggregate_asset_history::list_snapshots(connection, &request)
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
async fn annual_household_review_csv_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: financial_calendar::YearlyFinancialReportRequest,
) -> Result<Option<financial_calendar::AnnualReviewCsvSavedDto>, String> {
    let result = state.with_connection(|connection| {
        Ok(financial_calendar::annual_household_review_csv(
            connection, &request,
        ))
    });
    let export = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Err(error.public_message().to_owned()),
        Err(_) => {
            return Err("Annual household review export is temporarily unavailable".to_owned())
        }
    };
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
        .map_err(|_| "Selected annual review destination is unavailable".to_owned())?;
    std::fs::write(destination, export.utf8_bom_csv.as_bytes())
        .map_err(|_| "Annual household review CSV could not be saved".to_owned())?;
    Ok(Some(financial_calendar::AnnualReviewCsvSavedDto {
        file_name: export.file_name,
        row_count: export.row_count,
        byte_size: export.byte_size,
    }))
}

#[tauri::command]
async fn monthly_household_review_csv_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: financial_calendar::MonthlyFinancialReportRequest,
) -> Result<Option<financial_calendar::MonthlyReviewCsvSavedDto>, String> {
    let result = state.with_connection(|connection| {
        Ok(financial_calendar::monthly_household_review_csv(
            connection, &request,
        ))
    });
    let export = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Err(error.public_message().to_owned()),
        Err(_) => {
            return Err("Monthly household review export is temporarily unavailable".to_owned())
        }
    };
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
        .map_err(|_| "Selected monthly review destination is unavailable".to_owned())?;
    std::fs::write(destination, export.utf8_bom_csv.as_bytes())
        .map_err(|_| "Monthly household review CSV could not be saved".to_owned())?;
    Ok(Some(financial_calendar::MonthlyReviewCsvSavedDto {
        file_name: export.file_name,
        row_count: export.row_count,
        byte_size: export.byte_size,
    }))
}

#[tauri::command]
async fn annual_household_review_xlsx_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: financial_calendar::YearlyFinancialReportRequest,
) -> Result<Option<annual_review_xlsx::AnnualReviewXlsxSavedDto>, String> {
    let result = state.with_connection(|connection| {
        Ok(annual_review_xlsx::generate_annual_review_xlsx(
            connection, &request,
        ))
    });
    let document = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Err(error.public_message().to_owned()),
        Err(_) => {
            return Err("Annual household review workbook is temporarily unavailable".to_owned())
        }
    };
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Excel workbook", &["xlsx"])
        .set_file_name(&document.file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected annual review destination is unavailable".to_owned())?;
    annual_review_xlsx::save_annual_review_xlsx_document(&document, Some(&destination))
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
async fn annual_household_review_pdf_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: financial_calendar::YearlyFinancialReportRequest,
) -> Result<Option<annual_review_pdf::AnnualReviewPdfSavedDto>, String> {
    let result = state.with_connection(|connection| {
        Ok(annual_review_pdf::generate_annual_review_pdf(
            connection, &request,
        ))
    });
    let document = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Err(error.public_message().to_owned()),
        Err(_) => return Err("Annual household review PDF is temporarily unavailable".to_owned()),
    };
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("PDF document", &["pdf"])
        .set_file_name(&document.file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected annual review PDF destination is unavailable".to_owned())?;
    annual_review_pdf::save_annual_review_pdf_document(&document, Some(&destination))
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
async fn monthly_household_review_xlsx_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: financial_calendar::MonthlyFinancialReportRequest,
) -> Result<Option<monthly_review_xlsx::MonthlyReviewXlsxSavedDto>, String> {
    let result = state.with_connection(|connection| {
        Ok(monthly_review_xlsx::generate_monthly_review_xlsx(
            connection, &request,
        ))
    });
    let document = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Err(error.public_message().to_owned()),
        Err(_) => {
            return Err("Monthly household review workbook is temporarily unavailable".to_owned())
        }
    };
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Excel workbook", &["xlsx"])
        .set_file_name(&document.file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected monthly review destination is unavailable".to_owned())?;
    monthly_review_xlsx::save_monthly_review_xlsx_document(&document, Some(&destination))
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
async fn monthly_household_review_pdf_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: financial_calendar::MonthlyFinancialReportRequest,
) -> Result<Option<monthly_review_pdf::MonthlyReviewPdfSavedDto>, String> {
    let result = state.with_connection(|connection| {
        Ok(monthly_review_pdf::generate_monthly_review_pdf(
            connection, &request,
        ))
    });
    let document = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Err(error.public_message().to_owned()),
        Err(_) => return Err("Monthly household review PDF is temporarily unavailable".to_owned()),
    };
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("PDF document", &["pdf"])
        .set_file_name(&document.file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected monthly review PDF destination is unavailable".to_owned())?;
    monthly_review_pdf::save_monthly_review_pdf_document(&document, Some(&destination))
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
async fn investment_performance_xlsx_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: InvestmentPerformanceRequest,
) -> Result<Option<investment_performance_xlsx::InvestmentPerformanceXlsxSavedDto>, String> {
    let result = state.with_connection(|connection| {
        Ok(investment_performance_xlsx::generate_investment_performance_xlsx(connection, &request))
    });
    let document = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Err(error.public_message().to_owned()),
        Err(_) => {
            return Err("Investment performance workbook is temporarily unavailable".to_owned())
        }
    };
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Excel workbook", &["xlsx"])
        .set_file_name(&document.file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected investment performance destination is unavailable".to_owned())?;
    investment_performance_xlsx::save_investment_performance_xlsx_document(
        &document,
        Some(&destination),
    )
    .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
async fn investment_performance_pdf_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: InvestmentPerformanceRequest,
) -> Result<Option<investment_performance_pdf::InvestmentPerformancePdfSavedDto>, String> {
    let result = state.with_connection(|connection| {
        Ok(investment_performance_pdf::generate_investment_performance_pdf(connection, &request))
    });
    let document = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Err(error.public_message().to_owned()),
        Err(_) => return Err("Investment performance PDF is temporarily unavailable".to_owned()),
    };
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("PDF document", &["pdf"])
        .set_file_name(&document.file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected investment performance PDF destination is unavailable".to_owned())?;
    investment_performance_pdf::save_investment_performance_pdf_document(
        &document,
        Some(&destination),
    )
    .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
async fn portfolio_snapshot_xlsx_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: portfolio_snapshot_xlsx::PortfolioSnapshotXlsxRequest,
) -> Result<Option<portfolio_snapshot_xlsx::PortfolioSnapshotXlsxSavedDto>, String> {
    let result = state.with_connection(|connection| {
        Ok(portfolio_snapshot_xlsx::generate_portfolio_snapshot_xlsx(
            connection, &request,
        ))
    });
    let document = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Err(error.public_message().to_owned()),
        Err(_) => return Err("Portfolio snapshot workbook is temporarily unavailable".to_owned()),
    };
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Excel workbook", &["xlsx"])
        .set_file_name(&document.file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected portfolio snapshot destination is unavailable".to_owned())?;
    portfolio_snapshot_xlsx::save_portfolio_snapshot_xlsx_document(&document, Some(&destination))
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
async fn portfolio_snapshot_pdf_save(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: portfolio_snapshot_xlsx::PortfolioSnapshotXlsxRequest,
) -> Result<Option<portfolio_snapshot_pdf::PortfolioSnapshotPdfSavedDto>, String> {
    let result = state.with_connection(|connection| {
        Ok(portfolio_snapshot_pdf::generate_portfolio_snapshot_pdf(
            connection, &request,
        ))
    });
    let document = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Err(error.public_message().to_owned()),
        Err(_) => return Err("Portfolio snapshot PDF is temporarily unavailable".to_owned()),
    };
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("PDF document", &["pdf"])
        .set_file_name(&document.file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let destination = selected
        .into_path()
        .map_err(|_| "Selected portfolio snapshot PDF destination is unavailable".to_owned())?;
    portfolio_snapshot_pdf::save_portfolio_snapshot_pdf_document(&document, Some(&destination))
        .map_err(|error| error.public_message().to_owned())
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
async fn icloud_folder_select(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    household_id: String,
    label: String,
) -> Result<Option<watched_folders::WatchedFolderDto>, String> {
    let icloud_root = watched_folders::resolve_icloud_root()
        .map_err(|error| error.public_message().to_owned())?;
    let Some(selected) = app
        .dialog()
        .file()
        .set_directory(&icloud_root)
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "Selected folder is unavailable".to_owned())?;
    watched_folder_result(&state, |connection| {
        watched_folders::register_icloud(connection, &household_id, &label, &path, &icloud_root)
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
        let scan = watched_folders::scan_registered(connection, &household_id, &watched_folder_id)?;
        watched_file_inbox::reconcile_scan(
            connection,
            &household_id,
            &watched_folder_id,
            &scan.files,
        )
        .map_err(|_| watched_folders::WatchedFolderError::Database)?;
        Ok(scan)
    })
}

fn watched_file_inbox_result<T>(
    state: &AppState,
    operation: impl FnOnce(
        &rusqlite::Connection,
    ) -> Result<T, watched_file_inbox::WatchedFileInboxError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Watched-file Inbox database access failed".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
fn watched_file_inbox_list(
    app_state: tauri::State<'_, AppState>,
    household_id: String,
    state: Option<String>,
    limit: Option<u16>,
) -> Result<Vec<watched_file_inbox::WatchedFileInboxItemDto>, String> {
    watched_file_inbox_result(&app_state, |connection| {
        watched_file_inbox::list(connection, &household_id, state.as_deref(), limit)
    })
}

#[tauri::command]
fn watched_file_inbox_counts(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<watched_file_inbox::WatchedFileInboxCountsDto, String> {
    watched_file_inbox_result(&state, |connection| {
        watched_file_inbox::counts(connection, &household_id)
    })
}

#[tauri::command]
fn watched_file_inbox_claim(
    state: tauri::State<'_, AppState>,
    household_id: String,
    item_ids: Vec<String>,
) -> Result<watched_file_inbox::WatchedFileInboxClaimDto, String> {
    watched_file_inbox_result(&state, |connection| {
        watched_file_inbox::claim(connection, &household_id, &item_ids)
    })
}

#[tauri::command]
fn watched_file_inbox_mark_ready(
    state: tauri::State<'_, AppState>,
    household_id: String,
    item_id: String,
    lease_token: String,
) -> Result<watched_file_inbox::WatchedFileInboxItemDto, String> {
    watched_file_inbox_result(&state, |connection| {
        watched_file_inbox::mark_ready(connection, &household_id, &item_id, &lease_token)
    })
}

#[tauri::command]
fn watched_file_inbox_mark_needs_mapping(
    state: tauri::State<'_, AppState>,
    household_id: String,
    item_id: String,
    lease_token: String,
) -> Result<watched_file_inbox::WatchedFileInboxItemDto, String> {
    watched_file_inbox_result(&state, |connection| {
        watched_file_inbox::mark_needs_mapping(connection, &household_id, &item_id, &lease_token)
    })
}

#[tauri::command]
fn watched_file_inbox_mark_failed(
    state: tauri::State<'_, AppState>,
    household_id: String,
    item_id: String,
    lease_token: String,
    error_code: String,
) -> Result<watched_file_inbox::WatchedFileInboxItemDto, String> {
    watched_file_inbox_result(&state, |connection| {
        watched_file_inbox::mark_failed(
            connection,
            &household_id,
            &item_id,
            &lease_token,
            &error_code,
        )
    })
}

#[tauri::command]
fn watched_file_inbox_mark_staged(
    state: tauri::State<'_, AppState>,
    household_id: String,
    item_id: String,
    lease_token: String,
    import_run_id: String,
) -> Result<watched_file_inbox::WatchedFileInboxItemDto, String> {
    watched_file_inbox_result(&state, |connection| {
        watched_file_inbox::mark_staged(
            connection,
            &household_id,
            &item_id,
            &lease_token,
            &import_run_id,
        )
    })
}

#[tauri::command]
fn watched_file_inbox_ignore(
    state: tauri::State<'_, AppState>,
    household_id: String,
    item_id: String,
) -> Result<watched_file_inbox::WatchedFileInboxItemDto, String> {
    watched_file_inbox_result(&state, |connection| {
        watched_file_inbox::ignore(connection, &household_id, &item_id)
    })
}

#[tauri::command]
fn watched_file_inbox_retry(
    state: tauri::State<'_, AppState>,
    household_id: String,
    item_id: String,
) -> Result<watched_file_inbox::WatchedFileInboxItemDto, String> {
    watched_file_inbox_result(&state, |connection| {
        watched_file_inbox::retry(connection, &household_id, &item_id)
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
    repository_result(&state, |connection| {
        let settlement = read_model::confirm_card_payment_link(
            connection,
            &household_id,
            &statement_id,
            &payment_id,
        )?;
        Ok(CardMatchConfirmation {
            statement_id,
            payment_id,
            reconciliation_status: settlement.reconciliation_status,
        })
    })
}

#[tauri::command]
fn card_payment_link_confirm(
    state: tauri::State<'_, AppState>,
    household_id: String,
    statement_id: String,
    payment_id: String,
) -> Result<CardSettlementDto, String> {
    repository_result(&state, |connection| {
        read_model::confirm_card_payment_link(connection, &household_id, &statement_id, &payment_id)
    })
}

#[tauri::command]
fn card_statement_due_date_update(
    state: tauri::State<'_, AppState>,
    input: UpdateCardStatementDueDateInput,
) -> Result<CardSettlementDto, String> {
    repository_result(&state, |connection| {
        read_model::update_card_statement_due_date(connection, &input)
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
fn pending_review_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<PendingReviewListDto, String> {
    workflow_result(&state, |connection| {
        import_workflow::list_pending_reviews(connection, &household_id)
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
    run_local_ocr(&paths, file_bytes, media_type)
}

#[tauri::command]
fn document_pdf_ocr_attempt(
    paths: tauri::State<'_, OcrPaths>,
    file_bytes: Vec<u8>,
    media_type: String,
    password: Option<String>,
) -> Result<document_pdf_ocr::PdfOcrAttempt, String> {
    let password = password.map(zeroize::Zeroizing::new);
    let config = ocr::OcrConfig {
        executable: paths.bundled_executable.clone(),
        tessdata_dir: paths.bundled_tessdata.clone(),
        ..ocr::OcrConfig::default()
    };
    Ok(document_pdf_ocr::attempt_pdf_ocr(
        &file_bytes,
        &media_type,
        password.as_ref().map(|value| value.as_str()),
        &paths.temporary_directory,
        config,
    ))
}

fn run_local_ocr(
    paths: &OcrPaths,
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
    let mut regions = document_pdf_ocr::line_regions(1, &result.words);
    regions.extend(
        result
            .words
            .iter()
            .map(|word| document_pdf_ocr::word_region(1, word)),
    );
    Ok(document_extract::ExtractedDocument {
        method: "OCR",
        text: result.text,
        confidence_bps,
        issues,
        regions,
        page_count: 1,
        pages: vec![document_extract::ExtractedPage {
            page_number: 1,
            width_pixels: None,
            height_pixels: None,
            confidence_bps,
            issues: if confidence_bps < 7_500 {
                vec!["LOW_OCR_CONFIDENCE"]
            } else {
                Vec::new()
            },
        }],
    })
}

#[tauri::command]
fn mobile_capture_ocr(
    state: tauri::State<'_, AppState>,
    vault: tauri::State<'_, DocumentVault>,
    paths: tauri::State<'_, OcrPaths>,
    household_id: String,
    artifact_id: String,
) -> Result<mobile_capture_inbox::MobileCaptureOcrDto, String> {
    if let Some((extraction_id, document)) = mobile_capture_result(&state, |connection| {
        mobile_capture_inbox::latest_extraction(connection, &household_id, &artifact_id)
    })? {
        let item = mobile_capture_result(&state, |connection| {
            mobile_capture_inbox::get(connection, &household_id, &artifact_id)
        })?;
        return Ok(mobile_capture_inbox::MobileCaptureOcrDto {
            item,
            extraction_id,
            document,
        });
    }
    let (bytes, media_type) = mobile_capture_result(&state, |connection| {
        mobile_capture_inbox::image(connection, &vault, &household_id, &artifact_id)
    })?;
    let document = run_local_ocr(&paths, bytes, media_type)?;
    let (extraction_id, item) = mobile_capture_result(&state, |connection| {
        mobile_capture_inbox::record_extraction(connection, &household_id, &artifact_id, &document)
    })?;
    Ok(mobile_capture_inbox::MobileCaptureOcrDto {
        item,
        extraction_id,
        document,
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
            let bundled_ocr_available = bundled_ocr_ready(&bundled_ocr, &bundled_tessdata);
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
            let family_envelope_identity = if setup_smoke_config.is_some() {
                family_envelope_identity::FamilyEnvelopeIdentityState::from_private_key(
                    [0x46_u8; 32],
                )?
            } else {
                family_envelope_identity::FamilyEnvelopeIdentityState::load_or_create_os()?
            };
            let family_delivery_credentials = if setup_smoke_config.is_some() {
                family_delivery_credentials::FamilyDeliveryCredentialStore::new_ephemeral()
            } else {
                family_delivery_credentials::FamilyDeliveryCredentialStore::new_os()?
            };
            let google_drive_credentials = if setup_smoke_config.is_some() {
                google_drive_credentials::GoogleDriveCredentialStore::new_ephemeral()
            } else {
                google_drive_credentials::GoogleDriveCredentialStore::new_os()?
            };
            let gmail_credentials = if setup_smoke_config.is_some() {
                gmail_credentials::GmailCredentialStore::new_ephemeral()
            } else {
                gmail_credentials::GmailCredentialStore::new_os()?
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
            state.with_connection(|connection| {
                family_delivery_transport::recover_interrupted_sends(connection)
                    .map(|_| ())
                    .map_err(|_| rusqlite::Error::InvalidQuery.into())
            })?;
            app.manage(state);
            app.manage(vault);
            app.manage(family_envelope_identity);
            app.manage(family_delivery_credentials);
            app.manage(google_drive_credentials);
            app.manage(gmail_credentials);
            app.manage(BackupMasterKey(portable_backup_key));
            app.manage(restore_credentials);
            app.manage(RestoreCommandAuthorization::default());
            app.manage(PendingImportStages::default());
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
                app.manage(
                    family_delivery_scheduler::BackgroundFamilyDeliveryDiscovery::start(
                        app.handle().clone(),
                    ),
                );
                app.manage(google_drive_scheduler::BackgroundGoogleDriveSync::start(
                    app.handle().clone(),
                ));
                app.manage(gmail_scheduler::BackgroundGmailSync::start(
                    app.handle().clone(),
                ));
                app.manage(
                    mobile_capture_background::BackgroundMobileCaptureIntake::start(
                        app.handle().clone(),
                    ),
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_bootstrap,
            app_health,
            app_status,
            local_sync_foundation_status,
            principal_member_binding_update,
            relay_status,
            relay_connection_save,
            relay_disconnect,
            relay_send_prepare,
            relay_send_accept,
            relay_send_failed,
            relay_inbound_register,
            relay_inbound_stage,
            family_delivery_status,
            family_delivery_connection_save,
            family_delivery_disconnect,
            family_delivery_background_status,
            family_delivery_background_enable,
            family_delivery_background_disable,
            family_delivery_background_run_now,
            family_delivery_remote_state_register,
            family_delivery_send_prepare,
            family_delivery_envelope_cached_get,
            family_delivery_envelope_prepare,
            family_delivery_send_accept,
            family_delivery_send_failed,
            family_delivery_envelope_recipient_set_changed,
            family_delivery_inbound_register,
            family_delivery_inbound_stage,
            family_delivery_encrypted_inbound_stage,
            family_envelope_identity::family_envelope_identity_get,
            family_envelope_identity::family_envelope_seal,
            family_envelope_identity::family_envelope_open,
            family_snapshot_active_review,
            family_snapshot_resolve,
            family_snapshot_apply,
            family_snapshot_discard,
            mobile_capture_status,
            mobile_capture_inbox_list,
            mobile_capture_cursor_update,
            mobile_capture_ingest,
            mobile_capture_image_preview,
            mobile_capture_ocr,
            mobile_capture_mark_ocr_review_required,
            mobile_capture_promote,
            mobile_capture_background_status,
            mobile_capture_background_enable,
            mobile_capture_background_disable,
            mobile_capture_background_run_now,
            change_package_export_save,
            change_package_pick_and_stage,
            change_package_active_review,
            change_package_resolve,
            change_package_apply,
            change_package_discard,
            evidence_bundle_export_save,
            evidence_bundle_pick_and_import,
            pending_import_export_to_picker,
            pending_import_pick_and_stage,
            pending_import_apply,
            pending_import_discard,
            packaged_smoke_complete,
            packaged_smoke_failure,
            packaged_smoke_progress,
            households_list,
            household_create,
            household_members_list,
            household_member_create,
            household_member_update,
            household_member_archive,
            delimited_parser_profiles_list,
            delimited_parser_profile_create,
            delimited_parser_profile_update,
            delimited_parser_profile_delete,
            accounts_list,
            account_create,
            account_ownership_update,
            account_rename,
            account_archive,
            transactions_query,
            transaction_metadata_bulk_update,
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
            financial_calendar::annual_household_review_csv_generate,
            financial_calendar::monthly_household_review_csv_generate,
            card_settlement_mapping::card_settlement_bank_mappings_list,
            card_settlement_mapping::card_settlement_bank_mapping_upsert,
            card_settlement_mapping::card_settlement_bank_mapping_delete,
            card_settlement_mapping::card_settlement_balance_coverage_query,
            receipt_matching::receipt_match_suggestions,
            receipt_matching::receipt_match_confirm,
            fixed_cost_review::fixed_cost_review_query,
            forecast_action::forecast_action_query,
            dashboard_query,
            dashboard_preferences_get,
            dashboard_preferences_upsert,
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
            aggregate_asset_snapshot_import,
            aggregate_asset_history_import,
            aggregate_asset_history_list,
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
            annual_household_review_csv_save,
            monthly_household_review_csv_save,
            annual_household_review_xlsx_save,
            annual_household_review_pdf_save,
            monthly_household_review_xlsx_save,
            monthly_household_review_pdf_save,
            investment_performance_xlsx_save,
            investment_performance_pdf_save,
            portfolio_snapshot_xlsx_save,
            portfolio_snapshot_pdf_save,
            classification_rules_list,
            classification_rule_create,
            classification_rule_update,
            classification_rule_delete,
            classification_rules_preview,
            classification_rule_apply,
            watched_folders_list,
            watched_folder_select,
            icloud_folder_select,
            watched_folder_remove,
            watched_folder_scan,
            watched_folder_file_read,
            watched_file_inbox_list,
            watched_file_inbox_counts,
            watched_file_inbox_claim,
            watched_file_inbox_mark_ready,
            watched_file_inbox_mark_needs_mapping,
            watched_file_inbox_mark_failed,
            watched_file_inbox_mark_staged,
            watched_file_inbox_ignore,
            watched_file_inbox_retry,
            google_drive_commands::google_drive_availability,
            google_drive_commands::google_drive_connections_list,
            google_drive_commands::google_drive_connect,
            google_drive_commands::google_drive_folder_bind,
            google_drive_commands::google_drive_disconnect,
            google_drive_commands::google_drive_schedule_get,
            google_drive_commands::google_drive_schedule_update,
            google_drive_commands::google_drive_sync_now,
            google_drive_commands::google_drive_inbox_list,
            google_drive_commands::google_drive_inbox_file_read,
            google_drive_commands::google_drive_inbox_claim,
            google_drive_commands::google_drive_inbox_mark_staged,
            google_drive_commands::google_drive_inbox_mark_failed,
            google_drive_commands::google_drive_inbox_reopen,
            google_drive_commands::google_drive_inbox_ignore,
            google_drive_commands::google_drive_inbox_retry,
            gmail_commands::gmail_availability,
            gmail_commands::gmail_connections_list,
            gmail_commands::gmail_connect,
            gmail_commands::gmail_labels_list,
            gmail_commands::gmail_label_bind,
            gmail_commands::gmail_disconnect,
            gmail_commands::gmail_schedule_get,
            gmail_commands::gmail_schedule_update,
            gmail_commands::gmail_sync_now,
            gmail_commands::gmail_inbox_list,
            gmail_commands::gmail_inbox_file_read,
            gmail_commands::gmail_inbox_claim,
            gmail_commands::gmail_inbox_mark_staged,
            gmail_commands::gmail_inbox_mark_failed,
            gmail_commands::gmail_inbox_reopen,
            gmail_commands::gmail_inbox_ignore,
            gmail_commands::gmail_inbox_retry,
            import_summary,
            cards_list,
            card_match_confirm,
            card_payment_link_confirm,
            card_statement_due_date_update,
            import_start,
            import_preview,
            pending_review_list,
            import_commit,
            import_rollback,
            backup_create,
            backup_restore_stage,
            app_restart_for_restore,
            document_extract,
            document_extract_attempt,
            document_ocr,
            document_pdf_ocr_attempt
        ])
        .run(tauri::generate_context!())
        .expect("KakeFlow failed to start");
}

#[cfg(test)]
mod command_authorization_tests {
    use super::{
        bundled_ocr_ready, cached_family_envelope_output, validate_import_metrics,
        ImportEnvelopeMetrics, RestoreCommandAuthorization, MAX_IMPORT_CANDIDATES,
        MAX_IMPORT_CARD_LINES, MAX_IMPORT_CARD_STATEMENTS, MAX_IMPORT_EVIDENCE_LINKS,
        MAX_IMPORT_FILE_BYTES, MAX_IMPORT_METADATA_BYTES, MAX_IMPORT_RAW_PAYLOAD_BYTES,
        MAX_IMPORT_RECORDS,
    };
    use crate::{
        family_delivery_transport::CachedOutboundEnvelopeDto,
        family_encrypted_envelope::{
            seal_family_envelope, FamilyEnvelopeMetadata, RecipientKeyPair,
        },
    };
    use sha2::{Digest, Sha256};

    #[test]
    fn bundled_ocr_requires_both_models_the_tsv_config_and_an_executable() {
        let temporary = tempfile::tempdir().unwrap();
        let executable = temporary.path().join("tesseract");
        let tessdata = temporary.path().join("tessdata");
        std::fs::create_dir_all(tessdata.join("configs")).unwrap();
        std::fs::write(&executable, b"fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mut permissions = executable.metadata().unwrap().permissions();
            permissions.set_mode(0o700);
            std::fs::set_permissions(&executable, permissions).unwrap();
        }
        std::fs::write(tessdata.join("eng.traineddata"), b"eng").unwrap();
        std::fs::write(tessdata.join("jpn.traineddata"), b"jpn").unwrap();
        assert!(!bundled_ocr_ready(&executable, &tessdata));

        std::fs::write(
            tessdata.join("configs").join("tsv"),
            b"tessedit_create_tsv 1\n",
        )
        .unwrap();
        assert!(bundled_ocr_ready(&executable, &tessdata));
    }

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

    #[test]
    fn cached_family_envelope_output_reports_persisted_tuple_and_actual_recipient_count() {
        let artifact = b"immutable-family-artifact";
        let metadata = FamilyEnvelopeMetadata::new(
            "family",
            "publication",
            "device-a",
            "FAMILY_AUDIENCE_PARTITION_V3",
            artifact,
        );
        let recipient_a = RecipientKeyPair::from_private_bytes("membership-a", [31_u8; 32])
            .unwrap()
            .public_key();
        let recipient_b = RecipientKeyPair::from_private_bytes("membership-b", [32_u8; 32])
            .unwrap()
            .public_key();
        let envelope =
            seal_family_envelope(metadata.clone(), artifact, &[recipient_a, recipient_b]).unwrap();
        let transport_sha256 = hex_sha256(&envelope);
        let recipient_set_digest = hex_sha256(b"persisted-recipient-set");
        let output = cached_family_envelope_output(
            CachedOutboundEnvelopeDto {
                delivery_id: "delivery".into(),
                envelope_schema: "FAMILY_ENCRYPTED_ENVELOPE_V1".into(),
                transport_sha256: transport_sha256.clone(),
                inner_sha256: metadata.inner_sha256.clone(),
                recipient_set_digest: recipient_set_digest.clone(),
                envelope_bytes: envelope.clone(),
            },
            &metadata,
            "STALE_CACHE_REUSED",
        )
        .unwrap();
        assert_eq!(output.envelope_bytes, envelope);
        assert_eq!(output.envelope_sha256, transport_sha256);
        assert_eq!(output.recipient_set_digest, recipient_set_digest);
        assert_eq!(output.recipient_count, 2);
        assert_eq!(output.cache_disposition, "STALE_CACHE_REUSED");
    }

    fn hex_sha256(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}
