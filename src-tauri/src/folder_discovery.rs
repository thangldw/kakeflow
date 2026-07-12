use crate::{persistence::AppState, watched_folders};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT_NAME: &str = "kakeflow://watched-folder-discovery";

// Native notifications are advisory. Every registered folder is still
// reconciled at a bounded interval so network/sync folders and unavailable OS
// watcher backends recover without restarting the application.
const POLL_INTERVAL: Duration = Duration::from_secs(10);
const REGISTRATION_REFRESH_INTERVAL: Duration = Duration::from_secs(2);
const NATIVE_DEBOUNCE: Duration = Duration::from_millis(400);
const WORKER_TICK: Duration = Duration::from_millis(100);
const NATIVE_CHANNEL_CAPACITY: usize = 512;

type FolderKey = (String, String);
type FolderSnapshot = BTreeMap<String, watched_folders::WatchedFileMetadataDto>;
type Registrations = BTreeMap<FolderKey, PathBuf>;

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
    fn is_stopped(&self) -> bool {
        self.stopped.lock().map_or(true, |stopped| *stopped)
    }

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

/// One process-wide supervisor. Native filesystem notifications only trigger
/// a metadata rescan; this component never reads file contents, starts an
/// import, or posts ledger data.
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
    let (native_sender, native_receiver) = mpsc::sync_channel(NATIVE_CHANNEL_CAPACITY);
    let mut native_watcher = make_native_watcher(native_sender.clone());
    let mut native_roots = BTreeSet::new();
    let mut registrations = Registrations::new();
    let mut snapshots: BTreeMap<FolderKey, FolderSnapshot> = BTreeMap::new();
    let mut pending = BTreeSet::new();
    let mut debounce_deadline: Option<Instant> = None;
    let mut next_refresh = Instant::now();
    let mut next_poll = Instant::now();

    while !stop.is_stopped() {
        let now = Instant::now();
        if now >= next_refresh {
            refresh_registrations(
                &app,
                &mut registrations,
                &mut snapshots,
                &mut native_watcher,
                &mut native_roots,
                &native_sender,
            );
            next_refresh = now + REGISTRATION_REFRESH_INTERVAL;
        }

        drain_native_events(
            &native_receiver,
            &registrations,
            &mut pending,
            &mut debounce_deadline,
        );

        let now = Instant::now();
        if debounce_deadline.is_some_and(|deadline| now >= deadline) {
            scan_keys(&app, &registrations, &mut snapshots, &pending);
            pending.clear();
            debounce_deadline = None;
        }

        if now >= next_poll {
            let all = registrations.keys().cloned().collect::<BTreeSet<_>>();
            scan_keys(&app, &registrations, &mut snapshots, &all);
            next_poll = now + POLL_INTERVAL;
        }

        if stop.wait(WORKER_TICK) {
            break;
        }
    }

    // Dropping the watcher here unregisters all native roots before the worker
    // exits. BackgroundFolderDiscovery::drop joins this thread, so shutdown is
    // complete before Tauri tears down managed state.
    drop(native_watcher);
}

fn make_native_watcher(sender: SyncSender<notify::Result<Event>>) -> Option<RecommendedWatcher> {
    notify::recommended_watcher(move |event| {
        // A full channel means a rescan signal is already queued. Dropping an
        // advisory notification is safe because snapshots and polling provide
        // the authoritative reconciliation.
        let _ = sender.try_send(event);
    })
    .ok()
}

#[allow(clippy::too_many_arguments)]
fn refresh_registrations(
    app: &AppHandle,
    registrations: &mut Registrations,
    snapshots: &mut BTreeMap<FolderKey, FolderSnapshot>,
    watcher: &mut Option<RecommendedWatcher>,
    native_roots: &mut BTreeSet<PathBuf>,
    native_sender: &SyncSender<notify::Result<Event>>,
) {
    let state = app.state::<AppState>();
    let listed = match state
        .with_connection(|connection| Ok(watched_folders::list_enabled_registrations(connection)))
    {
        Ok(Ok(listed)) => listed,
        _ => return,
    };
    let current = listed
        .into_iter()
        .map(|folder| {
            (
                (folder.household_id, folder.watched_folder_id),
                folder.canonical_root,
            )
        })
        .collect::<Registrations>();

    let removed = registrations
        .keys()
        .filter(|key| !current.contains_key(*key))
        .cloned()
        .collect::<Vec<_>>();
    for key in removed {
        snapshots.remove(&key);
    }

    let added = current
        .keys()
        .filter(|key| !registrations.contains_key(*key))
        .cloned()
        .collect::<BTreeSet<_>>();
    *registrations = current;

    // Establish a baseline before notifications are allowed to produce a
    // discovery event. A newly registered folder never requests an import for
    // files that already existed when it was registered.
    scan_keys(app, registrations, snapshots, &added);

    if watcher.is_none() {
        *watcher = make_native_watcher(native_sender.clone());
        native_roots.clear();
    }
    sync_native_roots(watcher, native_roots, registrations.values());
}

fn sync_native_roots<'a>(
    watcher: &mut Option<RecommendedWatcher>,
    native_roots: &mut BTreeSet<PathBuf>,
    desired_roots: impl Iterator<Item = &'a PathBuf>,
) {
    let desired = desired_roots.cloned().collect::<BTreeSet<_>>();
    let Some(watcher) = watcher.as_mut() else {
        return;
    };

    for root in native_roots
        .difference(&desired)
        .cloned()
        .collect::<Vec<_>>()
    {
        let _ = watcher.unwatch(&root);
        native_roots.remove(&root);
    }
    for root in desired
        .difference(native_roots)
        .cloned()
        .collect::<Vec<_>>()
    {
        // Failed roots remain absent and are retried at the next registration
        // refresh while polling continues to cover them.
        if watcher.watch(&root, RecursiveMode::Recursive).is_ok() {
            native_roots.insert(root);
        }
    }
}

fn drain_native_events(
    receiver: &Receiver<notify::Result<Event>>,
    registrations: &Registrations,
    pending: &mut BTreeSet<FolderKey>,
    debounce_deadline: &mut Option<Instant>,
) {
    loop {
        match receiver.try_recv() {
            Ok(Ok(event)) if !matches!(event.kind, EventKind::Access(_)) => {
                pending.extend(keys_for_native_paths(registrations, &event.paths));
                if !pending.is_empty() {
                    *debounce_deadline = Some(Instant::now() + NATIVE_DEBOUNCE);
                }
            }
            Ok(Ok(_)) => {}
            Ok(Err(_)) => {
                // Native backend errors contain no safe actionable path. A
                // bounded all-folder reconciliation recovers without exposing
                // backend error strings or device paths to the webview.
                pending.extend(registrations.keys().cloned());
                if !pending.is_empty() {
                    *debounce_deadline = Some(Instant::now() + NATIVE_DEBOUNCE);
                }
            }
            Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
        }
    }
}

fn keys_for_native_paths(registrations: &Registrations, paths: &[PathBuf]) -> BTreeSet<FolderKey> {
    if paths.is_empty() {
        return registrations.keys().cloned().collect();
    }
    registrations
        .iter()
        .filter(|(_, root)| {
            paths
                .iter()
                .any(|path| path.starts_with(root) || root.starts_with(path))
        })
        .map(|(key, _)| key.clone())
        .collect()
}

fn scan_keys(
    app: &AppHandle,
    registrations: &Registrations,
    snapshots: &mut BTreeMap<FolderKey, FolderSnapshot>,
    keys: &BTreeSet<FolderKey>,
) {
    for key in keys {
        if !registrations.contains_key(key) {
            continue;
        }
        let state = app.state::<AppState>();
        let scan = state.with_connection(|connection| {
            Ok(watched_folders::scan_registered(connection, &key.0, &key.1))
        });
        let Ok(Ok(scan)) = scan else {
            // Preserve the last good snapshot. A temporarily unavailable sync
            // folder must not become a remove/create storm when it reconnects.
            continue;
        };
        let current = scan
            .files
            .into_iter()
            .map(|file| (file.relative_path.clone(), file))
            .collect::<FolderSnapshot>();
        let Some(previous) = snapshots.insert(key.clone(), current.clone()) else {
            continue;
        };
        let changes = diff_snapshots(&previous, &current);
        if !changes.is_empty() {
            emit_changes(app, key, changes);
        }
    }
}

fn emit_changes(app: &AppHandle, key: &FolderKey, changes: Vec<FileChangeDto>) {
    let payload = FolderDiscoveryEventDto {
        event_version: 1,
        household_id: key.0.clone(),
        watched_folder_id: key.1.clone(),
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
    use super::{
        diff_snapshots, keys_for_native_paths, ChangeKind, FolderDiscoveryEventDto, FolderKey,
        FolderSnapshot, Registrations, StopSignal,
    };
    use crate::watched_folders::WatchedFileMetadataDto;
    use std::collections::BTreeSet;
    use std::path::PathBuf;
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

    fn key(household: &str, folder: &str) -> FolderKey {
        (household.to_owned(), folder.to_owned())
    }

    #[test]
    fn diff_coalesces_duplicate_native_signals_until_metadata_changes() {
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
        assert!(diff_snapshots(&current, &current).is_empty());
    }

    #[test]
    fn diff_reports_removal_using_only_relative_metadata() {
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
    fn native_paths_select_only_containing_registered_roots() {
        let registrations = Registrations::from([
            (key("home", "bank"), PathBuf::from("/sync/home/bank")),
            (key("home", "cards"), PathBuf::from("/sync/home/cards")),
        ]);
        let selected = keys_for_native_paths(
            &registrations,
            &[PathBuf::from("/sync/home/bank/2026/july.csv")],
        );
        assert_eq!(selected, BTreeSet::from([key("home", "bank")]));
    }

    #[test]
    fn empty_or_parent_native_path_requests_safe_reconciliation() {
        let registrations = Registrations::from([
            (key("home", "bank"), PathBuf::from("/sync/home/bank")),
            (key("home", "cards"), PathBuf::from("/sync/home/cards")),
        ]);
        let all = registrations.keys().cloned().collect::<BTreeSet<_>>();
        assert_eq!(keys_for_native_paths(&registrations, &[]), all);
        assert_eq!(
            keys_for_native_paths(&registrations, &[PathBuf::from("/sync/home")]),
            all
        );
    }

    #[test]
    fn serialized_event_cannot_contain_registered_absolute_root() {
        let payload = FolderDiscoveryEventDto {
            event_version: 1,
            household_id: "home".to_owned(),
            watched_folder_id: "bank".to_owned(),
            detected_unix_ms: 1,
            changes: vec![super::file_change(
                ChangeKind::Created,
                &file("2026/july.csv", 10, 1),
            )],
        };
        let serialized = serde_json::to_string(&payload).unwrap();
        assert!(!serialized.contains("/sync/home/bank"));
        assert!(serialized.contains("2026/july.csv"));
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
