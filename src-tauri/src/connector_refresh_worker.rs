use crate::connector_refresh::{
    self, ConnectorRefreshBatchDto, ConnectorRefreshClaimDto, LoadedConnectorRefreshBatchDto,
    RefreshBatchStatus, RefreshOutcome,
};
use crate::{
    connector_control::ConnectorKind, folder_discovery, gmail_commands, gmail_store,
    google_drive_commands, google_drive_store, persistence::AppState,
};
#[cfg(test)]
use rusqlite::Connection;
use std::{
    sync::{Arc, Condvar, Mutex},
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{AppHandle, Manager};

const IDLE_WAIT: Duration = Duration::from_secs(15);
const ACTIVE_WAIT: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RefreshInfrastructureError {
    PersistenceUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RunBatchState {
    Drained,
    WaitingForLease,
}

trait ConnectorRefreshExecutor {
    fn execute(
        &self,
        household_id: &str,
        claim: &ConnectorRefreshClaimDto,
    ) -> Result<RefreshOutcome, RefreshInfrastructureError>;
}

trait RefreshPersistence {
    fn recover_expired(
        &self,
        household_id: &str,
        batch_id: &str,
    ) -> Result<u64, RefreshInfrastructureError>;

    fn claim_next(
        &self,
        household_id: &str,
        batch_id: &str,
    ) -> Result<Option<ConnectorRefreshClaimDto>, RefreshInfrastructureError>;

    fn complete_item(
        &self,
        household_id: &str,
        claim: &ConnectorRefreshClaimDto,
        outcome: &RefreshOutcome,
    ) -> Result<ConnectorRefreshBatchDto, RefreshInfrastructureError>;

    fn load_batch(
        &self,
        household_id: &str,
        batch_id: &str,
    ) -> Result<LoadedConnectorRefreshBatchDto, RefreshInfrastructureError>;
}

#[cfg(test)]
struct SqliteRefreshPersistence<'a> {
    connection: &'a Connection,
}

#[cfg(test)]
impl<'a> SqliteRefreshPersistence<'a> {
    fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }
}

#[cfg(test)]
impl RefreshPersistence for SqliteRefreshPersistence<'_> {
    fn recover_expired(
        &self,
        household_id: &str,
        batch_id: &str,
    ) -> Result<u64, RefreshInfrastructureError> {
        connector_refresh::recover_expired(self.connection, household_id, batch_id)
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)
    }

    fn claim_next(
        &self,
        household_id: &str,
        batch_id: &str,
    ) -> Result<Option<ConnectorRefreshClaimDto>, RefreshInfrastructureError> {
        connector_refresh::claim_next(self.connection, household_id, batch_id)
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)
    }

    fn complete_item(
        &self,
        household_id: &str,
        claim: &ConnectorRefreshClaimDto,
        outcome: &RefreshOutcome,
    ) -> Result<ConnectorRefreshBatchDto, RefreshInfrastructureError> {
        connector_refresh::complete_item(
            self.connection,
            household_id,
            &claim.batch_id,
            &claim.item_id,
            &claim.lease_token,
            claim.attempt_generation,
            outcome,
        )
        .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)
    }

    fn load_batch(
        &self,
        household_id: &str,
        batch_id: &str,
    ) -> Result<LoadedConnectorRefreshBatchDto, RefreshInfrastructureError> {
        connector_refresh::load_batch(self.connection, household_id, batch_id)
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)
    }
}

struct AppStateRefreshPersistence<'a> {
    state: &'a AppState,
}

impl<'a> AppStateRefreshPersistence<'a> {
    fn new(state: &'a AppState) -> Self {
        Self { state }
    }
}

impl RefreshPersistence for AppStateRefreshPersistence<'_> {
    fn recover_expired(
        &self,
        household_id: &str,
        batch_id: &str,
    ) -> Result<u64, RefreshInfrastructureError> {
        self.state
            .with_connection(|connection| {
                Ok(connector_refresh::recover_expired(
                    connection,
                    household_id,
                    batch_id,
                ))
            })
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)?
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)
    }

    fn claim_next(
        &self,
        household_id: &str,
        batch_id: &str,
    ) -> Result<Option<ConnectorRefreshClaimDto>, RefreshInfrastructureError> {
        self.state
            .with_connection(|connection| {
                Ok(connector_refresh::claim_next(
                    connection,
                    household_id,
                    batch_id,
                ))
            })
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)?
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)
    }

    fn complete_item(
        &self,
        household_id: &str,
        claim: &ConnectorRefreshClaimDto,
        outcome: &RefreshOutcome,
    ) -> Result<ConnectorRefreshBatchDto, RefreshInfrastructureError> {
        self.state
            .with_connection(|connection| {
                Ok(connector_refresh::complete_item(
                    connection,
                    household_id,
                    &claim.batch_id,
                    &claim.item_id,
                    &claim.lease_token,
                    claim.attempt_generation,
                    outcome,
                ))
            })
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)?
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)
    }

    fn load_batch(
        &self,
        household_id: &str,
        batch_id: &str,
    ) -> Result<LoadedConnectorRefreshBatchDto, RefreshInfrastructureError> {
        self.state
            .with_connection(|connection| {
                Ok(connector_refresh::load_batch(
                    connection,
                    household_id,
                    batch_id,
                ))
            })
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)?
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)
    }
}

fn run_batch(
    persistence: &impl RefreshPersistence,
    executor: &impl ConnectorRefreshExecutor,
    household_id: &str,
    batch_id: &str,
) -> Result<RunBatchState, RefreshInfrastructureError> {
    persistence.recover_expired(household_id, batch_id)?;
    loop {
        let Some(claim) = persistence.claim_next(household_id, batch_id)? else {
            let batch = persistence.load_batch(household_id, batch_id)?;
            return Ok(if batch.status == RefreshBatchStatus::Active {
                RunBatchState::WaitingForLease
            } else {
                RunBatchState::Drained
            });
        };
        let outcome = executor.execute(household_id, &claim)?;
        let batch = persistence.complete_item(household_id, &claim, &outcome)?;
        if batch.status != RefreshBatchStatus::Active {
            return Ok(RunBatchState::Drained);
        }
    }
}

fn classify_provider_outcome(
    runner_succeeded: bool,
    running: bool,
    last_result: &str,
    changed_count: u64,
    provider_error_code: Option<&str>,
    connection_status: Option<&str>,
) -> RefreshOutcome {
    if runner_succeeded && last_result == "DISCOVERED" && changed_count > 0 {
        return RefreshOutcome::Succeeded { changed_count };
    }
    if runner_succeeded && last_result == "NO_CHANGES" {
        return RefreshOutcome::NoChanges;
    }
    if connection_status.is_some_and(|status| status != "CONNECTED") {
        return RefreshOutcome::NeedsAction {
            error_code: if connection_status == Some("AUTH_REQUIRED") {
                "AUTH_REQUIRED"
            } else {
                "CONNECTION_ACTION_REQUIRED"
            }
            .to_owned(),
        };
    }
    if running {
        return RefreshOutcome::FailedRetryable {
            error_code: "PROVIDER_BUSY".to_owned(),
        };
    }

    let action_code = match provider_error_code {
        Some("AUTH_EXPIRED") => Some("AUTH_REQUIRED"),
        Some("MISSING_CREDENTIAL") => Some("CREDENTIAL_REQUIRED"),
        Some("CONFIG_UNAVAILABLE" | "LABEL_UNAVAILABLE") => Some("CONFIGURATION_REQUIRED"),
        Some("CURSOR_INVALID") => Some("CURSOR_ACTION_REQUIRED"),
        _ => None,
    };
    if last_result == "TERMINAL_SUSPENDED" || action_code.is_some() {
        return RefreshOutcome::NeedsAction {
            error_code: action_code
                .unwrap_or("CONNECTION_ACTION_REQUIRED")
                .to_owned(),
        };
    }

    let error_code = match provider_error_code {
        Some("REMOTE_RATE_LIMITED") => "RATE_LIMITED",
        Some("DRIVE_UNAVAILABLE" | "GMAIL_UNAVAILABLE" | "REMOTE_UNAVAILABLE") => {
            "PROVIDER_UNAVAILABLE"
        }
        Some("REMOTE_NETWORK_FAILED") => "NETWORK_UNAVAILABLE",
        Some(
            "AUTH_REFRESH_FAILED"
            | "CONNECTION_UNAVAILABLE"
            | "SYNC_FAILED"
            | "WORKER_FAILED"
            | "WORKER_INCOMPLETE"
            | "FULL_RECONCILIATION_REQUIRED",
        ) => "PROVIDER_REFRESH_FAILED",
        _ => "PROVIDER_REFRESH_FAILED",
    };
    RefreshOutcome::FailedRetryable {
        error_code: error_code.to_owned(),
    }
}

struct NativeConnectorRefreshExecutor<'a> {
    app: &'a AppHandle,
}

impl ConnectorRefreshExecutor for NativeConnectorRefreshExecutor<'_> {
    fn execute(
        &self,
        household_id: &str,
        claim: &ConnectorRefreshClaimDto,
    ) -> Result<RefreshOutcome, RefreshInfrastructureError> {
        match claim.connector_kind {
            ConnectorKind::GoogleDrive => self.refresh_google_drive(household_id, claim),
            ConnectorKind::Gmail => self.refresh_gmail(household_id, claim),
            ConnectorKind::WatchedFolder => self.refresh_watched_folder(household_id, claim),
            ConnectorKind::ManualImport => Ok(RefreshOutcome::NeedsAction {
                error_code: "MANUAL_REFRESH_UNSUPPORTED".to_owned(),
            }),
        }
    }
}

impl NativeConnectorRefreshExecutor<'_> {
    fn refresh_google_drive(
        &self,
        household_id: &str,
        claim: &ConnectorRefreshClaimDto,
    ) -> Result<RefreshOutcome, RefreshInfrastructureError> {
        match google_drive_commands::google_drive_sync_now_blocking(
            self.app,
            household_id,
            &claim.connection_key,
        ) {
            Ok(schedule) => Ok(classify_provider_outcome(
                true,
                schedule.running,
                &schedule.last_result,
                schedule.last_discovered_count,
                schedule.last_error_code.as_deref(),
                Some("CONNECTED"),
            )),
            Err(_) => {
                let state = self.app.state::<AppState>();
                let (schedule, connection) = state
                    .with_connection(|connection| {
                        Ok((
                            google_drive_store::load_schedule(
                                connection,
                                household_id,
                                &claim.connection_key,
                            ),
                            google_drive_store::load_connection(
                                connection,
                                household_id,
                                &claim.connection_key,
                            ),
                        ))
                    })
                    .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)?;
                let schedule = match schedule {
                    Ok(schedule) => schedule,
                    Err(google_drive_store::GoogleDriveStoreError::Database(_)) => {
                        return Err(RefreshInfrastructureError::PersistenceUnavailable);
                    }
                    Err(_) => {
                        return Ok(RefreshOutcome::NeedsAction {
                            error_code: "CONFIGURATION_REQUIRED".to_owned(),
                        });
                    }
                };
                let connection_status = match connection {
                    Ok(connection) => connection.status,
                    Err(google_drive_store::GoogleDriveStoreError::Database(_)) => {
                        return Err(RefreshInfrastructureError::PersistenceUnavailable);
                    }
                    Err(_) => "CONNECTION_CHANGED".to_owned(),
                };
                Ok(classify_provider_outcome(
                    false,
                    schedule.running,
                    &schedule.last_result,
                    schedule.last_discovered_count,
                    schedule.last_error_code.as_deref(),
                    Some(&connection_status),
                ))
            }
        }
    }

    fn refresh_gmail(
        &self,
        household_id: &str,
        claim: &ConnectorRefreshClaimDto,
    ) -> Result<RefreshOutcome, RefreshInfrastructureError> {
        match gmail_commands::sync_now_blocking(self.app, household_id, &claim.connection_key) {
            Ok(schedule) => Ok(classify_provider_outcome(
                true,
                schedule.running,
                &schedule.last_result,
                schedule.last_discovered_count,
                schedule.last_error_code.as_deref(),
                Some("CONNECTED"),
            )),
            Err(_) => {
                let state = self.app.state::<AppState>();
                let (schedule, connection) = state
                    .with_connection(|connection| {
                        Ok((
                            gmail_store::load_schedule(
                                connection,
                                household_id,
                                &claim.connection_key,
                            ),
                            gmail_store::load_connection(
                                connection,
                                household_id,
                                &claim.connection_key,
                            ),
                        ))
                    })
                    .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)?;
                let schedule = match schedule {
                    Ok(schedule) => schedule,
                    Err(gmail_store::GmailStoreError::Database(_)) => {
                        return Err(RefreshInfrastructureError::PersistenceUnavailable);
                    }
                    Err(_) => {
                        return Ok(RefreshOutcome::NeedsAction {
                            error_code: "CONFIGURATION_REQUIRED".to_owned(),
                        });
                    }
                };
                let connection_status = match connection {
                    Ok(connection) => connection.status,
                    Err(gmail_store::GmailStoreError::Database(_)) => {
                        return Err(RefreshInfrastructureError::PersistenceUnavailable);
                    }
                    Err(_) => "CONNECTION_CHANGED".to_owned(),
                };
                Ok(classify_provider_outcome(
                    false,
                    schedule.running,
                    &schedule.last_result,
                    schedule.last_discovered_count,
                    schedule.last_error_code.as_deref(),
                    Some(&connection_status),
                ))
            }
        }
    }

    fn refresh_watched_folder(
        &self,
        household_id: &str,
        claim: &ConnectorRefreshClaimDto,
    ) -> Result<RefreshOutcome, RefreshInfrastructureError> {
        self.app
            .state::<AppState>()
            .with_connection(|connection| {
                Ok(folder_discovery::refresh_registered(
                    connection,
                    household_id,
                    &claim.connection_key,
                ))
            })
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)?
            .map(|result| match result {
                folder_discovery::FolderRefreshResult::Scanned { outcome, .. }
                | folder_discovery::FolderRefreshResult::RecordedFailure(outcome) => outcome,
            })
            .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ActiveBatch {
    household_id: String,
    batch_id: String,
}

fn active_batches(state: &AppState) -> Result<Vec<ActiveBatch>, RefreshInfrastructureError> {
    state
        .with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT household_id,batch_id FROM connector_refresh_batches
                 WHERE status='ACTIVE' ORDER BY created_at,household_id,batch_id",
            )?;
            let batches = statement
                .query_map([], |row| {
                    Ok(ActiveBatch {
                        household_id: row.get(0)?,
                        batch_id: row.get(1)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(batches)
        })
        .map_err(|_| RefreshInfrastructureError::PersistenceUnavailable)
}

#[derive(Default)]
struct WorkerSignalState {
    stopped: bool,
    wake_requested: bool,
}

#[derive(Default)]
struct WorkerSignal {
    state: Mutex<WorkerSignalState>,
    changed: Condvar,
}

impl WorkerSignal {
    fn wait(&self, duration: Duration) -> bool {
        let Ok(state) = self.state.lock() else {
            return true;
        };
        let Ok((mut state, _)) = self.changed.wait_timeout_while(state, duration, |state| {
            !state.stopped && !state.wake_requested
        }) else {
            return true;
        };
        let stopped = state.stopped;
        state.wake_requested = false;
        stopped
    }

    fn wake(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.wake_requested = true;
            self.changed.notify_all();
        }
    }

    fn stop(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.stopped = true;
            self.changed.notify_all();
        }
    }
}

pub struct BackgroundConnectorRefresh {
    signal: Arc<WorkerSignal>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl BackgroundConnectorRefresh {
    pub(crate) fn start(app: AppHandle) -> Self {
        let signal = Arc::new(WorkerSignal::default());
        let worker_signal = Arc::clone(&signal);
        let worker = thread::Builder::new()
            .name("kakeflow-connector-refresh".to_owned())
            .spawn(move || run_worker(app, worker_signal))
            .ok();
        Self {
            signal,
            worker: Mutex::new(worker),
        }
    }

    pub(crate) fn disabled() -> Self {
        Self {
            signal: Arc::new(WorkerSignal::default()),
            worker: Mutex::new(None),
        }
    }

    pub(crate) fn wake(&self) {
        self.signal.wake();
    }
}

impl Drop for BackgroundConnectorRefresh {
    fn drop(&mut self) {
        self.signal.stop();
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}

fn run_worker(app: AppHandle, signal: Arc<WorkerSignal>) {
    loop {
        let state = app.state::<AppState>();
        let batches = match active_batches(state.inner()) {
            Ok(batches) => batches,
            Err(_) => {
                if signal.wait(ACTIVE_WAIT) {
                    break;
                }
                continue;
            }
        };
        let wait = if batches.is_empty() {
            IDLE_WAIT
        } else {
            let persistence = AppStateRefreshPersistence::new(state.inner());
            let executor = NativeConnectorRefreshExecutor { app: &app };
            let mut infrastructure_failed = false;
            let mut waiting_for_lease = false;
            for batch in batches {
                match run_batch(
                    &persistence,
                    &executor,
                    &batch.household_id,
                    &batch.batch_id,
                ) {
                    Ok(RunBatchState::Drained) => {}
                    Ok(RunBatchState::WaitingForLease) => waiting_for_lease = true,
                    Err(_) => {
                        infrastructure_failed = true;
                        break;
                    }
                }
            }
            if infrastructure_failed || waiting_for_lease {
                ACTIVE_WAIT
            } else {
                Duration::ZERO
            }
        };
        if signal.wait(wait) {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        connector_control::ConnectorKind,
        connector_refresh::{
            self, ConnectorRefreshBatchDto, ConnectorRefreshClaimDto, RefreshBatchStatus,
            RefreshItemStatus, RefreshOutcome, RefreshTarget,
        },
        persistence::AppState,
    };
    use rusqlite::{params, Connection};
    use std::cell::{Cell, RefCell};

    const TEST_KEY: &[u8] = b"connector-refresh-worker-test-key";

    fn with_database(test: impl FnOnce(&Connection)) {
        let state = AppState::in_memory(TEST_KEY).expect("migrate worker database");
        state
            .with_connection(|connection| {
                connection
                    .execute("INSERT INTO households(id,name) VALUES('home','Home')", [])
                    .expect("seed household");
                test(connection);
                Ok(())
            })
            .expect("run worker test");
    }

    fn target(kind: ConnectorKind, key: &str) -> RefreshTarget {
        RefreshTarget {
            connector_kind: kind,
            connection_key: key.to_owned(),
        }
    }

    struct RecordingExecutor<'a> {
        connection: &'a Connection,
        batch_id: &'a str,
        calls: RefCell<Vec<(ConnectorKind, String)>>,
        previous_item: RefCell<Option<String>>,
        active: Cell<usize>,
        maximum_active: Cell<usize>,
    }

    impl<'a> RecordingExecutor<'a> {
        fn new(connection: &'a Connection, batch_id: &'a str) -> Self {
            Self {
                connection,
                batch_id,
                calls: RefCell::new(Vec::new()),
                previous_item: RefCell::new(None),
                active: Cell::new(0),
                maximum_active: Cell::new(0),
            }
        }
    }

    impl ConnectorRefreshExecutor for RecordingExecutor<'_> {
        fn execute(
            &self,
            household_id: &str,
            claim: &ConnectorRefreshClaimDto,
        ) -> Result<RefreshOutcome, RefreshInfrastructureError> {
            let active = self.active.get() + 1;
            self.active.set(active);
            self.maximum_active
                .set(self.maximum_active.get().max(active));

            if let Some(previous_item) = self.previous_item.borrow().as_ref() {
                let previous_status =
                    connector_refresh::load_batch(self.connection, household_id, self.batch_id)
                        .expect("load prior durable result")
                        .items
                        .into_iter()
                        .find(|item| item.item_id == *previous_item)
                        .expect("prior item remains in batch")
                        .status;
                assert!(matches!(
                    previous_status,
                    RefreshItemStatus::Succeeded
                        | RefreshItemStatus::NoChanges
                        | RefreshItemStatus::FailedRetryable
                        | RefreshItemStatus::NeedsAction
                ));
            }

            self.calls
                .borrow_mut()
                .push((claim.connector_kind, claim.connection_key.clone()));
            *self.previous_item.borrow_mut() = Some(claim.item_id.clone());
            let outcome = match claim.connection_key.as_str() {
                "drive" => RefreshOutcome::FailedRetryable {
                    error_code: "PROVIDER_UNAVAILABLE".to_owned(),
                },
                "gmail-a" => RefreshOutcome::NeedsAction {
                    error_code: "AUTH_REQUIRED".to_owned(),
                },
                "gmail-z" => RefreshOutcome::NoChanges,
                "folder" => RefreshOutcome::Succeeded { changed_count: 2 },
                _ => panic!("unexpected connector"),
            };
            self.active.set(active - 1);
            Ok(outcome)
        }
    }

    #[test]
    fn batch_execution_is_ordered_non_overlapping_and_persists_before_continuing() {
        with_database(|connection| {
            let batch = connector_refresh::create_batch(
                connection,
                "home",
                &[
                    target(ConnectorKind::ManualImport, "manual-import"),
                    target(ConnectorKind::WatchedFolder, "folder"),
                    target(ConnectorKind::Gmail, "gmail-z"),
                    target(ConnectorKind::GoogleDrive, "drive"),
                    target(ConnectorKind::Gmail, "gmail-a"),
                ],
            )
            .expect("create batch");
            let executor = RecordingExecutor::new(connection, &batch.batch_id);
            let persistence = SqliteRefreshPersistence::new(connection);

            let result = run_batch(&persistence, &executor, "home", &batch.batch_id)
                .expect("execute durable batch");

            assert_eq!(result, RunBatchState::Drained);
            assert_eq!(executor.maximum_active.get(), 1);
            assert_eq!(
                *executor.calls.borrow(),
                vec![
                    (ConnectorKind::GoogleDrive, "drive".to_owned()),
                    (ConnectorKind::Gmail, "gmail-a".to_owned()),
                    (ConnectorKind::Gmail, "gmail-z".to_owned()),
                    (ConnectorKind::WatchedFolder, "folder".to_owned()),
                ]
            );
            let completed = connector_refresh::load_batch(connection, "home", &batch.batch_id)
                .expect("load completed batch");
            assert_eq!(completed.status, RefreshBatchStatus::Partial);
            assert_eq!(completed.terminal_count, 5);
            assert_eq!(completed.skipped_manual_count, 1);
            assert_eq!(completed.failed_count, 2);
            assert_eq!(completed.no_changes_count, 1);
            assert_eq!(completed.succeeded_count, 1);
            assert_eq!(completed.changed_count, 2);
        });
    }

    struct FailingCompletion<'a> {
        inner: SqliteRefreshPersistence<'a>,
        completion_calls: Cell<usize>,
    }

    impl RefreshPersistence for FailingCompletion<'_> {
        fn recover_expired(
            &self,
            household_id: &str,
            batch_id: &str,
        ) -> Result<u64, RefreshInfrastructureError> {
            self.inner.recover_expired(household_id, batch_id)
        }

        fn claim_next(
            &self,
            household_id: &str,
            batch_id: &str,
        ) -> Result<Option<ConnectorRefreshClaimDto>, RefreshInfrastructureError> {
            self.inner.claim_next(household_id, batch_id)
        }

        fn complete_item(
            &self,
            _household_id: &str,
            _claim: &ConnectorRefreshClaimDto,
            _outcome: &RefreshOutcome,
        ) -> Result<ConnectorRefreshBatchDto, RefreshInfrastructureError> {
            self.completion_calls
                .set(self.completion_calls.get().saturating_add(1));
            Err(RefreshInfrastructureError::PersistenceUnavailable)
        }

        fn load_batch(
            &self,
            household_id: &str,
            batch_id: &str,
        ) -> Result<LoadedConnectorRefreshBatchDto, RefreshInfrastructureError> {
            self.inner.load_batch(household_id, batch_id)
        }
    }

    #[test]
    fn persistence_failure_stops_before_another_connector_can_start() {
        with_database(|connection| {
            let batch = connector_refresh::create_batch(
                connection,
                "home",
                &[
                    target(ConnectorKind::GoogleDrive, "drive"),
                    target(ConnectorKind::Gmail, "gmail-z"),
                ],
            )
            .unwrap();
            let executor = RecordingExecutor::new(connection, &batch.batch_id);
            let persistence = FailingCompletion {
                inner: SqliteRefreshPersistence::new(connection),
                completion_calls: Cell::new(0),
            };

            assert_eq!(
                run_batch(&persistence, &executor, "home", &batch.batch_id),
                Err(RefreshInfrastructureError::PersistenceUnavailable)
            );
            assert_eq!(persistence.completion_calls.get(), 1);
            assert_eq!(executor.calls.borrow().len(), 1);
            let loaded =
                connector_refresh::load_batch(connection, "home", &batch.batch_id).unwrap();
            assert_eq!(loaded.items[0].status, RefreshItemStatus::Running);
            assert_eq!(loaded.items[1].status, RefreshItemStatus::Pending);
        });
    }

    struct InfrastructureExecutor {
        calls: Cell<usize>,
    }

    impl ConnectorRefreshExecutor for InfrastructureExecutor {
        fn execute(
            &self,
            _household_id: &str,
            _claim: &ConnectorRefreshClaimDto,
        ) -> Result<RefreshOutcome, RefreshInfrastructureError> {
            self.calls.set(self.calls.get() + 1);
            Err(RefreshInfrastructureError::PersistenceUnavailable)
        }
    }

    #[test]
    fn executor_infrastructure_failure_preserves_the_claim_and_stops_the_batch() {
        with_database(|connection| {
            let batch = connector_refresh::create_batch(
                connection,
                "home",
                &[
                    target(ConnectorKind::GoogleDrive, "drive"),
                    target(ConnectorKind::Gmail, "gmail"),
                ],
            )
            .unwrap();
            let executor = InfrastructureExecutor {
                calls: Cell::new(0),
            };
            let persistence = SqliteRefreshPersistence::new(connection);

            assert_eq!(
                run_batch(&persistence, &executor, "home", &batch.batch_id),
                Err(RefreshInfrastructureError::PersistenceUnavailable)
            );
            assert_eq!(executor.calls.get(), 1);
            let loaded =
                connector_refresh::load_batch(connection, "home", &batch.batch_id).unwrap();
            assert_eq!(loaded.items[0].status, RefreshItemStatus::Running);
            assert_eq!(loaded.items[1].status, RefreshItemStatus::Pending);
        });
    }

    #[test]
    fn startup_recovers_an_expired_item_and_fences_its_old_generation() {
        with_database(|connection| {
            let batch = connector_refresh::create_batch(
                connection,
                "home",
                &[target(ConnectorKind::GoogleDrive, "drive")],
            )
            .unwrap();
            let stale = connector_refresh::claim_next(connection, "home", &batch.batch_id)
                .unwrap()
                .unwrap();
            connection
                .execute(
                    "DELETE FROM connector_refresh_batch_items WHERE item_id=?1",
                    [&stale.item_id],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO connector_refresh_batch_items
                       (batch_id,item_id,connector_kind,connection_key,status,attempt_generation,
                        lease_token,created_at,started_at,lease_expires_at,updated_at)
                     VALUES(?1,?2,'GOOGLE_DRIVE',?3,'RUNNING',?4,?5,
                            '2000-01-01T00:00:00Z','2000-01-01T00:00:00.100Z',
                            '2000-01-01T00:00:00.200Z','2000-01-01T00:00:00.300Z')",
                    params![
                        batch.batch_id,
                        stale.item_id,
                        stale.connection_key,
                        stale.attempt_generation,
                        stale.lease_token,
                    ],
                )
                .unwrap();

            let executor = RecordingExecutor::new(connection, &batch.batch_id);
            let persistence = SqliteRefreshPersistence::new(connection);
            assert_eq!(
                run_batch(&persistence, &executor, "home", &batch.batch_id).unwrap(),
                RunBatchState::Drained
            );

            let loaded =
                connector_refresh::load_batch(connection, "home", &batch.batch_id).unwrap();
            assert_eq!(loaded.items[0].attempt_generation, 2);
            assert_eq!(loaded.items[0].status, RefreshItemStatus::FailedRetryable);
            assert_eq!(
                connector_refresh::complete_item(
                    connection,
                    "home",
                    &batch.batch_id,
                    &stale.item_id,
                    &stale.lease_token,
                    stale.attempt_generation,
                    &RefreshOutcome::Succeeded { changed_count: 1 },
                )
                .unwrap_err(),
                connector_refresh::ConnectorRefreshError::StaleLease
            );
        });
    }

    #[test]
    fn provider_outcomes_use_a_closed_stable_error_classification() {
        assert_eq!(
            classify_provider_outcome(true, false, "DISCOVERED", 3, None, Some("CONNECTED")),
            RefreshOutcome::Succeeded { changed_count: 3 }
        );
        assert_eq!(
            classify_provider_outcome(true, false, "NO_CHANGES", 0, None, Some("CONNECTED")),
            RefreshOutcome::NoChanges
        );
        for (provider_code, public_code) in [
            ("AUTH_EXPIRED", "AUTH_REQUIRED"),
            ("MISSING_CREDENTIAL", "CREDENTIAL_REQUIRED"),
            ("CONFIG_UNAVAILABLE", "CONFIGURATION_REQUIRED"),
            ("CURSOR_INVALID", "CURSOR_ACTION_REQUIRED"),
        ] {
            assert_eq!(
                classify_provider_outcome(
                    false,
                    false,
                    "TERMINAL_SUSPENDED",
                    0,
                    Some(provider_code),
                    Some("CONNECTED"),
                ),
                RefreshOutcome::NeedsAction {
                    error_code: public_code.to_owned(),
                }
            );
        }
        assert_eq!(
            classify_provider_outcome(
                false,
                false,
                "FAILED_RETRYABLE",
                0,
                Some("REMOTE_RATE_LIMITED"),
                Some("CONNECTED"),
            ),
            RefreshOutcome::FailedRetryable {
                error_code: "RATE_LIMITED".to_owned(),
            }
        );
        assert_eq!(
            classify_provider_outcome(
                false,
                false,
                "FAILED_RETRYABLE",
                0,
                Some("contains provider detail: /private/path"),
                Some("CONNECTED"),
            ),
            RefreshOutcome::FailedRetryable {
                error_code: "PROVIDER_REFRESH_FAILED".to_owned(),
            }
        );
        assert_eq!(
            classify_provider_outcome(false, true, "RUNNING", 0, None, Some("CONNECTED"),),
            RefreshOutcome::FailedRetryable {
                error_code: "PROVIDER_BUSY".to_owned(),
            }
        );
        assert_eq!(
            classify_provider_outcome(false, false, "NEVER", 0, None, Some("AUTH_REQUIRED")),
            RefreshOutcome::NeedsAction {
                error_code: "AUTH_REQUIRED".to_owned(),
            }
        );
    }

    #[test]
    fn active_batch_snapshot_is_deterministic_and_excludes_terminal_batches() {
        let state = AppState::in_memory(TEST_KEY).unwrap();
        state
            .with_connection(|connection| {
                connection
                    .execute_batch(
                        "INSERT INTO households(id,name) VALUES
                           ('alpha','Alpha'),('beta','Beta'),('gamma','Gamma');",
                    )
                    .unwrap();
                connector_refresh::create_batch(
                    connection,
                    "beta",
                    &[target(ConnectorKind::Gmail, "gmail")],
                )
                .unwrap();
                connector_refresh::create_batch(
                    connection,
                    "alpha",
                    &[target(ConnectorKind::GoogleDrive, "drive")],
                )
                .unwrap();
                connector_refresh::create_batch(
                    connection,
                    "gamma",
                    &[target(ConnectorKind::ManualImport, "manual-import")],
                )
                .unwrap();
                Ok(())
            })
            .unwrap();

        let active = active_batches(&state).unwrap();
        assert_eq!(
            active
                .iter()
                .map(|batch| batch.household_id.as_str())
                .collect::<Vec<_>>(),
            vec!["beta", "alpha"]
        );
        assert!(active.iter().all(|batch| batch.batch_id.len() == 64));
    }

    #[test]
    fn worker_signal_wake_interrupts_an_idle_wait() {
        let signal = std::sync::Arc::new(WorkerSignal::default());
        let worker_signal = std::sync::Arc::clone(&signal);
        let started = std::time::Instant::now();
        let worker =
            std::thread::spawn(move || worker_signal.wait(std::time::Duration::from_secs(60)));
        signal.wake();
        assert!(!worker.join().unwrap());
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }

    #[test]
    fn repeated_provider_generations_are_idempotent_and_stop_at_review_inboxes() {
        with_database(|connection| {
            google_drive_store::begin_connection(connection, "home", "drive", &"a".repeat(64))
                .unwrap();
            google_drive_store::mark_authorized(
                connection,
                "home",
                "drive",
                "drive-user",
                "drive@example.com",
            )
            .unwrap();
            google_drive_store::select_root_with_baseline(
                connection, "home", "drive", None, "root", "Inbox", None, "page-1",
            )
            .unwrap();
            google_drive_store::configure_schedule(connection, "home", "drive", true, 15).unwrap();
            let drive_lease = google_drive_store::claim_due_sync(connection, "home", "drive")
                .unwrap()
                .unwrap();
            let drive_node = google_drive_store::RemoteNode {
                file_id: "drive-file".to_owned(),
                parent_file_id: Some("root".to_owned()),
                name: "statement.csv".to_owned(),
                mime_type: "text/csv".to_owned(),
                modified_time: Some("2026-08-25T00:00:00Z".to_owned()),
                byte_size: Some(128),
                md5_checksum: Some("b".repeat(32)),
                drive_version: Some("1".to_owned()),
                is_folder: false,
                can_download: true,
                is_in_selected_tree: true,
                is_trashed: false,
                disposition: google_drive_store::DiscoveryDisposition::Reviewable,
            };
            for _ in 0..2 {
                google_drive_store::discover_nodes_claimed(
                    connection,
                    "home",
                    "drive",
                    &drive_lease.lease_token,
                    std::slice::from_ref(&drive_node),
                )
                .unwrap();
            }

            gmail_store::begin_connection(connection, "home", "gmail", &"c".repeat(64)).unwrap();
            gmail_store::mark_authorized(
                connection,
                "home",
                "gmail",
                "gmail-user",
                "gmail@example.com",
                "100",
            )
            .unwrap();
            gmail_store::bind_label(
                connection,
                "home",
                "gmail",
                "has:attachment",
                "Label_1",
                "Inbox",
                "100",
            )
            .unwrap();
            gmail_store::configure_schedule(connection, "home", "gmail", true, 15).unwrap();
            let gmail_lease = gmail_store::claim_due_sync(connection, "home", "gmail")
                .unwrap()
                .unwrap();
            let gmail_message = gmail_store::RemoteMessage {
                provider_message_id: "gmail-message".to_owned(),
                thread_id: Some("thread".to_owned()),
                history_id: "101".to_owned(),
                internal_date_ms: 1_787_616_000_000,
                estimated_byte_size: Some(256),
                rfc822_message_id: Some("<statement@example.com>".to_owned()),
                file_name: "statement.eml".to_owned(),
                disposition: gmail_store::MessageDisposition::Reviewable,
            };
            for _ in 0..2 {
                gmail_store::discover_messages_claimed(
                    connection,
                    &gmail_lease,
                    std::slice::from_ref(&gmail_message),
                )
                .unwrap();
            }

            connection
                .execute(
                    "INSERT INTO watched_folders(
                         id,household_id,label,canonical_path,source_type,provider
                     ) VALUES('folder','home','Folder','/safe/folder','LOCAL_FOLDER','LOCAL')",
                    [],
                )
                .unwrap();
            let watched_file = crate::watched_folders::WatchedFileMetadataDto {
                relative_path: "statement.csv".to_owned(),
                file_name: "statement.csv".to_owned(),
                media_type: "text/csv".to_owned(),
                byte_size: 512,
                modified_unix_ms: Some(1_787_616_000_000),
            };
            for _ in 0..2 {
                crate::watched_file_inbox::reconcile_scan(
                    connection,
                    "home",
                    "folder",
                    std::slice::from_ref(&watched_file),
                )
                .unwrap();
            }

            for (table, expected) in [
                ("google_drive_inbox", 1_u64),
                ("gmail_inbox", 1),
                ("watched_file_inbox", 1),
                ("import_runs", 0),
                ("source_documents", 0),
                ("source_records", 0),
                ("transaction_candidates", 0),
                ("candidate_sources", 0),
            ] {
                let count = connection
                    .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                        row.get::<_, u64>(0)
                    })
                    .unwrap();
                assert_eq!(count, expected, "unexpected durable rows in {table}");
            }
        });
    }
}
