pub mod backup;
pub mod document_extract;
pub mod document_vault;
pub mod import_workflow;
mod key_store;
pub mod ocr;
mod persistence;
mod private_fs;
mod read_model;
pub mod restore;

use document_vault::DocumentVault;
use import_workflow::{
    CardMatchConfirmation, CommitSummary, ImportPreview, ImportSummary, PostingDecision,
    StartImport,
};
use key_store::{OsDatabaseKeyProvider, OsRestoreCredentialStore};
use persistence::AppState;
use read_model::{
    AccountDto, AccountingBasis, CardSettlementDto, CreateHouseholdInput,
    DashboardMonthlyTotalsDto, HouseholdDto, ImportRunCountsDto, TransactionPageDto,
    TransactionPageRequest,
};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use zeroize::Zeroizing;

struct BackupPaths {
    app_data_root: std::path::PathBuf,
    database: std::path::PathBuf,
    vault: std::path::PathBuf,
}

struct BackupMasterKey(Zeroizing<[u8; 32]>);

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseStatus {
    healthy: bool,
    schema_version: i64,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DashboardRequest {
    household_id: String,
    month: String,
    accounting_basis: AccountingBasis,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportStartEnvelope {
    import: StartImport,
    file_bytes: Vec<u8>,
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

fn repository_result<T>(
    state: &AppState,
    operation: impl FnOnce(&rusqlite::Connection) -> Result<T, read_model::RepositoryError>,
) -> Result<T, String> {
    state
        .with_connection(|connection| Ok(operation(connection)))
        .map_err(|_| "Database access failed".to_owned())?
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
fn accounts_list(
    state: tauri::State<'_, AppState>,
    household_id: String,
) -> Result<Vec<AccountDto>, String> {
    repository_result(&state, |connection| {
        read_model::list_accounts(connection, &household_id)
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
fn backup_create(
    state: tauri::State<'_, AppState>,
    paths: tauri::State<'_, BackupPaths>,
    backup_key: tauri::State<'_, BackupMasterKey>,
    archive_path: String,
    passphrase: String,
) -> Result<BackupSummaryDto, String> {
    let mut backup_result = None;
    state
        .with_connection(|connection| {
            // Keep the application-wide database lock from checkpoint through
            // the final archive fsync so no writer can race the snapshot.
            connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
            backup_result = Some(backup::create_portable_backup(
                &paths.database,
                &paths.vault,
                std::path::Path::new(&archive_path),
                &passphrase,
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
    Ok(BackupSummaryDto {
        format_version: 2,
        entry_count: summary.entry_count,
        plaintext_bytes: summary.plaintext_bytes,
    })
}

#[tauri::command]
fn backup_restore_stage(
    paths: tauri::State<'_, BackupPaths>,
    credentials: tauri::State<'_, OsRestoreCredentialStore>,
    archive_path: String,
    passphrase: String,
) -> Result<BackupSummaryDto, String> {
    let summary = restore::stage_portable_restore(
        &paths.app_data_root,
        std::path::Path::new(&archive_path),
        &passphrase,
        credentials.inner(),
    )
    .map_err(|error| match error {
        restore::RestoreError::RestorePending => "A restore is already waiting for restart",
        restore::RestoreError::Backup => "Backup authentication or format is invalid",
        restore::RestoreError::InvalidLayout => "Backup contents are invalid",
        _ => "Backup could not be staged for restore",
    })?;
    Ok(BackupSummaryDto {
        format_version: 2,
        entry_count: summary.entry_count,
        plaintext_bytes: summary.plaintext_bytes,
    })
}

#[tauri::command]
fn app_restart_for_restore(app: tauri::AppHandle) {
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
    tauri::Builder::default()
        // Must be the first plugin: first-run key generation assumes one process.
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
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
            // Finish or roll back any staged restore before SQLite or the vault
            // obtains a file handle. This is required for reliable Windows
            // activation and makes every crash checkpoint restart-safe.
            restore::recover_interrupted_restore(&app_data_dir, &restore_credentials)?;
            let key_provider = OsDatabaseKeyProvider::new()?;
            let master_key = if database_path.exists() {
                key_provider.existing_key()?
            } else {
                key_provider.key()?
            };
            if master_key.len() != 32 {
                return Err(std::io::Error::other("database key has invalid length").into());
            }
            let mut vault_master_key = Zeroizing::new([0_u8; 32]);
            vault_master_key.copy_from_slice(&master_key);
            let mut portable_backup_key = Zeroizing::new([0_u8; 32]);
            portable_backup_key.copy_from_slice(&master_key);
            let vault = DocumentVault::new(&vault_path, &vault_master_key)?;
            let state = AppState::open(database_path.clone(), &key_provider)?;
            app.manage(state);
            app.manage(vault);
            app.manage(BackupMasterKey(portable_backup_key));
            app.manage(restore_credentials);
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_bootstrap,
            app_health,
            app_status,
            households_list,
            household_create,
            accounts_list,
            transactions_query,
            dashboard_query,
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
            document_ocr
        ])
        .run(tauri::generate_context!())
        .expect("KakeFlow failed to start");
}
