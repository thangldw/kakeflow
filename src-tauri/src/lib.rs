mod persistence;

use persistence::{AppState, EnvironmentKeyProvider};
use serde::Serialize;
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let database_path = app_data_dir.join("database").join("kakeflow.db");
            let state = AppState::open(database_path, &EnvironmentKeyProvider)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_bootstrap,
            app_health,
            app_status
        ])
        .run(tauri::generate_context!())
        .expect("KakeFlow failed to start");
}
