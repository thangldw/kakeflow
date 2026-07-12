use crate::{persistence::AppState, watched_folders};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT_NAME: &str = "kakeflow://watched-folder-discovery";
const POLL_INTERVAL: Duration = Duration::from_secs(10);

type FolderKey = (String, String);
type FolderSnapshot = BTreeMap<String, watched_folders::WatchedFileMetadataDto>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ChangeKind {
    Created,
    Modified,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChangeDto {
    change_kind: ChangeKind,
    relative_path: String,
    file_name: String,
    media_type: String,
    byte_size: u64,
    modified_unix_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderDiscoveryEventDto {
    event_version: u8,
    household_id: String,
    watched_folder_id: String,
    detected_unix_ms: u64,
    changes: Vec<FileChangeDto>,
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
        match self.changed.wait_timeout(stopped, duration) {
            Ok((stopped, _)) => *stopped,
            Err(_) => true,
        }
    }

    fn stop(&self) {
        if let Ok(mut stopped) = self.stopped.lock() {
            *stopped = true;
            self.changed.notify_all();
        }
    }
}

/// One process-wide polling supervisor. It discovers supported file metadata
/// only; it never reads file contents, creates imports, or posts ledger data.
pub struct BackgroundFolderDiscovery {
    stop: Arc<StopSignal>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl BackgroundFolderDiscovery {
    pub fn start(app: AppHandle) -> Self {
        let stop = Arc::new(StopSignal::default());
        let worker_stop = Arc::clone(&stop);
        let worker = thread::Builder::new()
            .name("kakeflow-folder-discovery".to_owned())
            .spawn(move || run_worker(app, worker_stop))
            .ok();
        Self {
            stop,
            worker: Mutex::new(worker),
        }
    }
}

impl Drop for BackgroundFolderDiscovery {
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
    let mut snapshots: BTreeMap<FolderKey, FolderSnapshot> = BTreeMap::new();
    loop {
        poll_once(&app, &mut snapshots);
        if stop.wait(POLL_INTERVAL) {
            break;
        }
    }
}

fn poll_once(app: &AppHandle, snapshots: &mut BTreeMap<FolderKey, FolderSnapshot>) {
    let state = app.state::<AppState>();
    let registrations = match state
        .with_connection(|connection| Ok(watched_folders::list_enabled_registrations(connection)))
    {
        Ok(Ok(registrations)) => registrations,
        _ => return,
    };
    let active = registrations
        .iter()
        .map(|folder| {
            (
                folder.household_id.clone(),
                folder.watched_folder_id.clone(),
            )
        })
        .collect::<BTreeSet<_>>();
    snapshots.retain(|key, _| active.contains(key));

    for folder in registrations {
        let scan = state.with_connection(|connection| {
            Ok(watched_folders::scan_registered(
                connection,
                &folder.household_id,
                &folder.watched_folder_id,
            ))
        });
        let Ok(Ok(scan)) = scan else {
            // Keep the last good snapshot. A temporarily unavailable synced or
            // network folder must not turn every file into a remove/create pair.
            continue;
        };
        let current = scan
            .files
            .into_iter()
            .map(|file| (file.relative_path.clone(), file))
            .collect::<FolderSnapshot>();
        let key = (
            folder.household_id.clone(),
            folder.watched_folder_id.clone(),
        );
        let Some(previous) = snapshots.insert(key, current.clone()) else {
            // The first successful scan is the baseline, not an import request.
            continue;
        };
        let changes = diff_snapshots(&previous, &current);
        if changes.is_empty() {
            continue;
        }
        let payload = FolderDiscoveryEventDto {
            event_version: 1,
            household_id: folder.household_id,
            watched_folder_id: folder.watched_folder_id,
            detected_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .try_into()
                .unwrap_or(u64::MAX),
            changes,
        };
        let _ = app.emit(EVENT_NAME, payload);
    }
}

fn diff_snapshots(previous: &FolderSnapshot, current: &FolderSnapshot) -> Vec<FileChangeDto> {
    let mut changes = Vec::new();
    for (path, file) in current {
        let kind = match previous.get(path) {
            None => Some(ChangeKind::Created),
            Some(old) if old != file => Some(ChangeKind::Modified),
            Some(_) => None,
        };
        if let Some(kind) = kind {
            changes.push(file_change(kind, file));
        }
    }
    for (path, file) in previous {
        if !current.contains_key(path) {
            changes.push(file_change(ChangeKind::Removed, file));
        }
    }
    changes.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    changes
}

fn file_change(
    change_kind: ChangeKind,
    file: &watched_folders::WatchedFileMetadataDto,
) -> FileChangeDto {
    FileChangeDto {
        change_kind,
        relative_path: file.relative_path.clone(),
        file_name: file.file_name.clone(),
        media_type: file.media_type.clone(),
        byte_size: file.byte_size,
        modified_unix_ms: file.modified_unix_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::{diff_snapshots, ChangeKind, FolderSnapshot, StopSignal};
    use crate::watched_folders::WatchedFileMetadataDto;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    fn file(path: &str, bytes: u64, modified: u64) -> WatchedFileMetadataDto {
        WatchedFileMetadataDto {
            relative_path: path.to_owned(),
            file_name: path.rsplit('/').next().unwrap_or(path).to_owned(),
            media_type: "text/csv".to_owned(),
            byte_size: bytes,
            modified_unix_ms: Some(modified),
        }
    }

    #[test]
    fn diff_is_debounced_until_metadata_changes() {
        let previous = FolderSnapshot::from([("bank.csv".to_owned(), file("bank.csv", 10, 1))]);
        assert!(diff_snapshots(&previous, &previous).is_empty());

        let current = FolderSnapshot::from([
            ("bank.csv".to_owned(), file("bank.csv", 12, 2)),
            ("receipts/a.pdf".to_owned(), file("receipts/a.pdf", 20, 3)),
        ]);
        let changes = diff_snapshots(&previous, &current);
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].change_kind, ChangeKind::Modified);
        assert_eq!(changes[1].change_kind, ChangeKind::Created);
    }

    #[test]
    fn diff_reports_removal_without_absolute_paths() {
        let previous = FolderSnapshot::from([(
            "private/card.csv".to_owned(),
            file("private/card.csv", 10, 1),
        )]);
        let changes = diff_snapshots(&previous, &FolderSnapshot::new());
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].change_kind, ChangeKind::Removed);
        assert_eq!(changes[0].relative_path, "private/card.csv");
    }

    #[test]
    fn stop_signal_interrupts_a_long_poll_wait() {
        let signal = Arc::new(StopSignal::default());
        let worker_signal = Arc::clone(&signal);
        let started = Instant::now();
        let worker = std::thread::spawn(move || worker_signal.wait(Duration::from_secs(60)));
        signal.stop();
        assert!(worker.join().unwrap());
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
