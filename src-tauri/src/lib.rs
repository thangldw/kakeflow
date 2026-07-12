pub mod backup;
pub mod document_vault;
pub mod import_workflow;
mod key_store;
mod persistence;
mod read_model;

use document_vault::DocumentVault;
use import_workflow::{CommitSummary, ImportPreview, ImportSummary, PostingDecision, StartImport};
use key_store::OsDatabaseKeyProvider;
use persistence::AppState;
use read_model::{
    AccountDto, AccountingBasis, CreateHouseholdInput, DashboardMonthlyTotalsDto, HouseholdDto,
    ImportRunCountsDto, TransactionPageDto, TransactionPageRequest,
};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use zeroize::Zeroizing;

struct BackupPaths {
    database: std::path::PathBuf,
    vault: std::path::PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupSummaryDto {
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
    archive_path: String,
    passphrase: String,
) -> Result<BackupSummaryDto, String> {
    let mut backup_result = None;
    state
        .with_connection(|connection| {
            // Keep the application-wide database lock from checkpoint through
            // the final archive fsync so no writer can race the snapshot.
            connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
            backup_result = Some(backup::create_backup(
                &paths.database,
                &paths.vault,
                std::path::Path::new(&archive_path),
                &passphrase,
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
        entry_count: summary.entry_count,
        plaintext_bytes: summary.plaintext_bytes,
    })
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
            let key_provider = OsDatabaseKeyProvider::new()?;
            let master_key = key_provider.key()?;
            if master_key.len() != 32 {
                return Err(std::io::Error::other("database key has invalid length").into());
            }
            let mut vault_master_key = Zeroizing::new([0_u8; 32]);
            vault_master_key.copy_from_slice(&master_key);
            let vault = DocumentVault::new(&vault_path, &vault_master_key)?;
            let state = AppState::open(database_path.clone(), &key_provider)?;
            app.manage(state);
            app.manage(vault);
            app.manage(BackupPaths {
                database: database_path,
                vault: vault_path,
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
            import_start,
            import_preview,
            import_commit,
            import_rollback,
            backup_create
        ])
        .run(tauri::generate_context!())
        .expect("KakeFlow failed to start");
}
