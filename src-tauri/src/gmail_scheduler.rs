//! Process-scoped Gmail polling while KakeFlow is open.

use crate::{gmail_commands::run_claimed_gmail_sync, gmail_store, persistence::AppState};
use serde::Serialize;
use std::{
    sync::{Arc, Condvar, Mutex},
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT_NAME: &str = "kakeflow://gmail-synced";
const INTERVAL: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GmailSyncEvent {
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
    fn wait(&self) -> bool {
        let Ok(stopped) = self.stopped.lock() else {
            return true;
        };
        if *stopped {
            return true;
        }
        self.changed
            .wait_timeout(stopped, INTERVAL)
            .map_or(true, |(value, _)| *value)
    }
    fn stop(&self) {
        if let Ok(mut stopped) = self.stopped.lock() {
            *stopped = true;
            self.changed.notify_all();
        }
    }
}

pub struct BackgroundGmailSync {
    stop: Arc<StopSignal>,
    worker: Mutex<Option<JoinHandle<()>>>,
}
impl BackgroundGmailSync {
    pub fn start(app: AppHandle) -> Self {
        let stop = Arc::new(StopSignal::default());
        let worker_stop = Arc::clone(&stop);
        let worker = thread::Builder::new()
            .name("kakeflow-gmail-sync".into())
            .spawn(move || run(app, worker_stop))
            .ok();
        Self {
            stop,
            worker: Mutex::new(worker),
        }
    }
}
impl Drop for BackgroundGmailSync {
    fn drop(&mut self) {
        self.stop.stop();
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}

fn run(app: AppHandle, stop: Arc<StopSignal>) {
    while !stop.wait() {
        let state = app.state::<AppState>();
        let Ok(Some(lease)) = state.with_connection(|c| {
            gmail_store::claim_next_due_sync(c).map_err(|_| rusqlite::Error::InvalidQuery.into())
        }) else {
            continue;
        };
        let _ = run_claimed_gmail_sync(&app, &lease);
        let status = state.with_connection(|c| {
            if gmail_store::heartbeat_sync(c, &lease).is_ok() {
                let _ = gmail_store::fail_sync(c, &lease, "WORKER_INCOMPLETE");
            }
            gmail_store::load_schedule(c, &lease.household_id, &lease.connection_id)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        });
        if let Ok(status) = status {
            let _ = app.emit(
                EVENT_NAME,
                GmailSyncEvent {
                    household_id: lease.household_id,
                    connection_id: lease.connection_id,
                    discovered_count: status.last_discovered_count,
                    result: status.last_result,
                },
            );
        }
    }
}
