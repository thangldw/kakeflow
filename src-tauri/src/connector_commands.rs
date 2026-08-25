use crate::{
    connector_binding::{
        self, ConnectorBindingDto, DeleteConnectorBindingInput, UpsertConnectorBindingInput,
    },
    connector_projection::{
        ConnectionProjectionService, ConnectorCursorDto, ConnectorSummaryPageDto,
        SqliteProjectionClock,
    },
    persistence::AppState,
};
use tauri::State;

#[tauri::command]
pub fn connector_control_list(
    state: State<'_, AppState>,
    household_id: String,
    cursor: Option<ConnectorCursorDto>,
    limit: Option<u16>,
) -> Result<ConnectorSummaryPageDto, String> {
    state
        .with_connection(|connection| {
            Ok(
                ConnectionProjectionService::new(&SqliteProjectionClock).list_page(
                    connection,
                    &household_id,
                    cursor,
                    limit,
                ),
            )
        })
        .map_err(|_| "Connector summaries are temporarily unavailable".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
pub fn connector_bindings_list(
    state: State<'_, AppState>,
    household_id: String,
) -> Result<Vec<ConnectorBindingDto>, String> {
    state
        .with_connection(|connection| {
            Ok(connector_binding::list_bindings(connection, &household_id))
        })
        .map_err(|_| "Connector bindings are temporarily unavailable".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
pub fn connector_binding_upsert(
    state: State<'_, AppState>,
    input: UpsertConnectorBindingInput,
) -> Result<ConnectorBindingDto, String> {
    state
        .with_connection(|connection| Ok(connector_binding::upsert_binding(connection, &input)))
        .map_err(|_| "Connector bindings are temporarily unavailable".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}

#[tauri::command]
pub fn connector_binding_delete(
    state: State<'_, AppState>,
    input: DeleteConnectorBindingInput,
) -> Result<(), String> {
    state
        .with_connection(|connection| Ok(connector_binding::delete_binding(connection, &input)))
        .map_err(|_| "Connector bindings are temporarily unavailable".to_owned())?
        .map_err(|error| error.public_message().to_owned())
}
