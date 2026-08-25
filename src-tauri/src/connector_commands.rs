use crate::{
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
