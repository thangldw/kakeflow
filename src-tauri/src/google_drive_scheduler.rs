//! Process-scoped Google Drive polling while the desktop application is open.
//!
//! The worker claims only persisted, opt-in schedules. It does not install a
//! daemon or login item and it never posts hydrated files into the ledger;
//! downloaded generations remain in the review-gated Drive Inbox.

use crate::{
    google_drive_commands::run_claimed_google_drive_sync,
    google_drive_store::{self, SyncLeaseDto, SyncScheduleDto},
    persistence::AppState,
};
use rusqlite::Connection;
use serde::Serialize;
use std::{
    sync::{Arc, Condvar, Mutex},
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT_NAME: &str = "kakeflow://google-drive-synced";
const WORKER_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct GoogleDriveSyncEvent {
    household_id: String,
    connection_id: String,
    discovered_count: u64,
    result: String,
}

#[derive(Default)]
struct StopSignal {
    stopped: Mutex<bool>,
    changed: Condvar,
}

impl StopSignal {
    fn wait(&self, duration: Duration) -> bool {
        let Ok(stopped) = self.stopped.lock() else {
            return true;
        };
        if *stopped {
            return true;
        }
        self.changed
            .wait_timeout(stopped, duration)
            .map_or(true, |(stopped, _)| *stopped)
    }

    fn stop(&self) {
        if let Ok(mut stopped) = self.stopped.lock() {
            *stopped = true;
            self.changed.notify_all();
        }
    }
}

/// Dropping this managed state stops and joins the worker before the app's
/// persistence and credential states are destroyed.
pub struct BackgroundGoogleDriveSync {
    stop: Arc<StopSignal>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl BackgroundGoogleDriveSync {
    pub fn start(app: AppHandle) -> Self {
        let stop = Arc::new(StopSignal::default());
        let worker_stop = Arc::clone(&stop);
        let worker = thread::Builder::new()
            .name("kakeflow-google-drive-sync".to_owned())
            .spawn(move || run_worker(app, worker_stop))
            .ok();
        Self {
            stop,
            worker: Mutex::new(worker),
        }
    }
}

impl Drop for BackgroundGoogleDriveSync {
    fn drop(&mut self) {
        self.stop.stop();
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}

fn run_worker(app: AppHandle, stop: Arc<StopSignal>) {
    while !stop.wait(WORKER_INTERVAL) {
        let state = app.state::<AppState>();
        let lease = state.with_connection(|connection| {
            google_drive_store::claim_next_due_sync(connection)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        });
        let Ok(Some(lease)) = lease else {
            continue;
        };

        let run_result = run_claimed_google_drive_sync(&app, &lease);
        let status = state.with_connection(|connection| {
            // This guard covers unexpected helper exits without overwriting a
            // result already committed by the exact lease owner.
            ensure_claim_finished(connection, &lease, run_result.is_ok())?;
            google_drive_store::load_schedule(connection, &lease.household_id, &lease.connection_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        });
        if let Ok(status) = status {
            let _ = app.emit(EVENT_NAME, event_from_status(&lease, &status));
        }
    }
}

fn ensure_claim_finished(
    connection: &Connection,
    lease: &SyncLeaseDto,
    helper_succeeded: bool,
) -> rusqlite::Result<()> {
    if google_drive_store::assert_sync_lease(
        connection,
        &lease.household_id,
        &lease.connection_id,
        &lease.lease_token,
    )
    .is_ok()
    {
        let code = if helper_succeeded {
            "WORKER_INCOMPLETE"
        } else {
            "WORKER_FAILED"
        };
        google_drive_store::fail_sync(
            connection,
            &lease.household_id,
            &lease.connection_id,
            &lease.lease_token,
            code,
        )
        .map_err(|_| rusqlite::Error::InvalidQuery)?;
    }
    Ok(())
}

fn event_from_status(lease: &SyncLeaseDto, status: &SyncScheduleDto) -> GoogleDriveSyncEvent {
    GoogleDriveSyncEvent {
        household_id: lease.household_id.clone(),
        connection_id: lease.connection_id.clone(),
        discovered_count: status.last_discovered_count,
        result: status.last_result.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::google_drive_store;
    use rusqlite::Connection;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        connection
            .execute_batch(include_str!("../migrations/0001_household_accounts.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0002_import_provenance.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0053_google_drive_connections.sql"
            ))
            .unwrap();
        connection
            .execute_batch(include_str!("../migrations/0054_google_drive_inbox.sql"))
            .unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0055_google_drive_root_resource_key.sql"
            ))
            .unwrap();
        connection
            .execute("INSERT INTO households(id,name) VALUES('home','Home')", [])
            .unwrap();
        google_drive_store::begin_connection(&connection, "home", "drive", &"a".repeat(64))
            .unwrap();
        google_drive_store::mark_authorized(
            &connection,
            "home",
            "drive",
            "google-user",
            "user@example.com",
        )
        .unwrap();
        google_drive_store::select_root_with_baseline(
            &connection,
            "home",
            "drive",
            None,
            "folder",
            "Inbox",
            None,
            "cursor",
        )
        .unwrap();
        google_drive_store::configure_schedule(&connection, "home", "drive", true, 15).unwrap();
        connection
    }

    #[test]
    fn worker_guard_releases_an_unfinished_claim_and_projects_redacted_event() {
        let connection = database();
        let lease = google_drive_store::claim_next_due_sync(&connection)
            .unwrap()
            .unwrap();
        ensure_claim_finished(&connection, &lease, false).unwrap();
        let status = google_drive_store::load_schedule(&connection, "home", "drive").unwrap();
        assert!(!status.running);
        assert_eq!(status.last_result, "FAILED_RETRYABLE");
        assert_eq!(status.last_error_code.as_deref(), Some("WORKER_FAILED"));

        let event = event_from_status(&lease, &status);
        assert_eq!(event.household_id, "home");
        assert_eq!(event.connection_id, "drive");
        assert_eq!(event.discovered_count, 0);
        assert_eq!(event.result, "FAILED_RETRYABLE");
    }
}
