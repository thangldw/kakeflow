//! Concrete adapters joining the bounded Drive client, race-safe initial
//! traversal, and lease-fenced SQLite metadata store.

use crate::{
    google_drive_api::{
        DriveApiClient, DriveApiError, DriveChange as ApiChange, DriveFile, DriveTransport,
    },
    google_drive_initial_sync::{
        ChangePage, DriveChange, DriveNode, FolderPage, InitialSyncApi, InitialSyncReport,
        InitialSyncStore,
    },
    google_drive_store::{
        self, DiscoveryDisposition, GoogleDriveStoreError, RemoteNode, SyncLeaseDto,
    },
};
use rusqlite::{params, Connection};
use std::collections::{BTreeMap, HashMap, HashSet};

pub const GOOGLE_DRIVE_FOLDER_MIME: &str = "application/vnd.google-apps.folder";

impl DriveNode for DriveFile {
    fn file_id(&self) -> &str {
        &self.id
    }

    fn is_folder(&self) -> bool {
        self.mime_type == GOOGLE_DRIVE_FOLDER_MIME
    }
}

/// Network half of the initial-sync protocol. A baseline captured while the
/// root was selected may be supplied exactly once; this avoids opening a race
/// between durable root selection and traversal.
pub struct GoogleDriveInitialApi<'a, T> {
    client: &'a DriveApiClient<T>,
    root_folder_id: String,
    root_resource_key: Option<String>,
    selected_baseline: Option<String>,
}

impl<'a, T> GoogleDriveInitialApi<'a, T> {
    pub fn new(
        client: &'a DriveApiClient<T>,
        root_folder_id: &str,
        root_resource_key: Option<&str>,
        selected_baseline: Option<&str>,
    ) -> Self {
        Self {
            client,
            root_folder_id: root_folder_id.to_owned(),
            root_resource_key: root_resource_key.map(str::to_owned),
            selected_baseline: selected_baseline.map(str::to_owned),
        }
    }
}

impl<T: DriveTransport> InitialSyncApi for GoogleDriveInitialApi<'_, T> {
    type Node = DriveFile;
    type Error = DriveApiError;

    fn capture_start_page_token(&mut self, drive_id: Option<&str>) -> Result<String, Self::Error> {
        match self.selected_baseline.take() {
            Some(token) => Ok(token),
            None => self.client.start_page_token(drive_id),
        }
    }

    fn list_folder_children(
        &mut self,
        drive_id: Option<&str>,
        folder_id: &str,
        page_token: Option<&str>,
        page_size: u16,
    ) -> Result<FolderPage<Self::Node>, Self::Error> {
        let resource_key = if folder_id == self.root_folder_id {
            self.root_resource_key.as_deref()
        } else {
            None
        };
        let mut page = self.client.list_children_page(
            folder_id,
            drive_id,
            page_token,
            page_size,
            resource_key,
        )?;
        // A Drive item can have more than one parent in older data. Put the
        // folder through which it was reached first so SQLite preserves the
        // selected-tree edge, not an unrelated parent returned first.
        for file in &mut page.files {
            if let Some(index) = file.parents.iter().position(|parent| parent == folder_id) {
                file.parents.swap(0, index);
            }
        }
        Ok(FolderPage {
            nodes: page.files,
            next_page_token: page.next_page_token,
        })
    }

    fn list_changes(
        &mut self,
        drive_id: Option<&str>,
        page_token: &str,
        page_size: u16,
    ) -> Result<ChangePage<Self::Node>, Self::Error> {
        let page = self
            .client
            .list_changes_page(page_token, drive_id, page_size)?;
        let changes = page
            .changes
            .into_iter()
            .map(|change| match change {
                ApiChange {
                    file_id,
                    removed: true,
                    ..
                } => DriveChange::Removed { file_id },
                ApiChange {
                    file: Some(file), ..
                } => DriveChange::Upsert(file),
                ApiChange { file_id, .. } => DriveChange::Removed { file_id },
            })
            .collect();
        Ok(ChangePage {
            changes,
            next_page_token: page.next_page_token,
            new_start_page_token: page.new_start_page_token,
        })
    }
}

/// SQLite half of the protocol. Every page is fenced by the active schedule
/// lease and the terminal cursor is published only by `complete_sync`.
pub struct GoogleDriveInitialStore<'a> {
    connection: &'a Connection,
    household_id: String,
    connection_id: String,
    root_folder_id: String,
    lease_token: String,
    expected_baseline: String,
    discovered_generations: HashSet<String>,
    tree_expansion_detected: bool,
}

impl<'a> GoogleDriveInitialStore<'a> {
    pub fn new(
        connection: &'a Connection,
        lease: &SyncLeaseDto,
        root_folder_id: &str,
    ) -> Result<Self, GoogleDriveStoreError> {
        google_drive_store::assert_sync_lease(
            connection,
            &lease.household_id,
            &lease.connection_id,
            &lease.lease_token,
        )?;
        Ok(Self {
            connection,
            household_id: lease.household_id.clone(),
            connection_id: lease.connection_id.clone(),
            root_folder_id: root_folder_id.to_owned(),
            lease_token: lease.lease_token.clone(),
            expected_baseline: lease.change_page_token.clone(),
            discovered_generations: HashSet::new(),
            tree_expansion_detected: false,
        })
    }

    fn persist(&mut self, nodes: Vec<RemoteNode>) -> Result<(), GoogleDriveStoreError> {
        for chunk in nodes.chunks(100) {
            let discovered = google_drive_store::discover_nodes_claimed(
                self.connection,
                &self.household_id,
                &self.connection_id,
                &self.lease_token,
                chunk,
            )?;
            self.discovered_generations
                .extend(discovered.into_iter().map(|item| item.id));
        }
        Ok(())
    }

    fn node_in_tree(&self, file_id: &str) -> Result<bool, GoogleDriveStoreError> {
        Ok(self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM google_drive_nodes
             WHERE connection_id=?1 AND file_id=?2
               AND is_in_selected_tree=1 AND is_trashed=0)",
            params![self.connection_id, file_id],
            |row| row.get(0),
        )?)
    }

    fn remote_node(
        &self,
        file: &DriveFile,
        in_tree: bool,
    ) -> Result<RemoteNode, GoogleDriveStoreError> {
        let mut selected_parent = None;
        for parent in &file.parents {
            if self.node_in_tree(parent)? {
                selected_parent = Some(parent.clone());
                break;
            }
        }
        Ok(remote_node(
            file,
            selected_parent.or_else(|| file.parents.first().cloned()),
            in_tree,
        ))
    }

    fn stored_subtree(&self, root_id: &str) -> Result<Vec<RemoteNode>, GoogleDriveStoreError> {
        let mut statement = self.connection.prepare(
            "WITH RECURSIVE subtree(file_id) AS (
                 SELECT file_id FROM google_drive_nodes
                  WHERE connection_id=?1
                    AND (file_id=?2 OR (?2=?3 AND parent_file_id=?2))
                 UNION ALL
                 SELECT child.file_id FROM google_drive_nodes child
                 JOIN subtree parent ON child.parent_file_id=parent.file_id
                  WHERE child.connection_id=?1
             )
             SELECT n.file_id,n.parent_file_id,n.name,n.mime_type,n.modified_time,
                    n.byte_size,n.md5_checksum,n.drive_version,n.is_folder,n.can_download,
                    n.is_trashed
             FROM google_drive_nodes n JOIN subtree s ON s.file_id=n.file_id
             WHERE n.connection_id=?1 ORDER BY n.file_id",
        )?;
        let rows = statement.query_map(
            params![self.connection_id, root_id, self.root_folder_id],
            |row| {
                let byte_size = row
                    .get::<_, Option<i64>>(5)?
                    .map(u64::try_from)
                    .transpose()
                    .map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            5,
                            rusqlite::types::Type::Integer,
                            Box::new(error),
                        )
                    })?;
                Ok(RemoteNode {
                    file_id: row.get(0)?,
                    parent_file_id: row.get(1)?,
                    name: row.get(2)?,
                    mime_type: row.get(3)?,
                    modified_time: row.get(4)?,
                    byte_size,
                    md5_checksum: row.get(6)?,
                    drive_version: row.get(7)?,
                    is_folder: row.get(8)?,
                    can_download: row.get(9)?,
                    is_in_selected_tree: false,
                    is_trashed: row.get(10)?,
                    disposition: DiscoveryDisposition::Unsupported,
                })
            },
        )?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}

impl InitialSyncStore<DriveFile> for GoogleDriveInitialStore<'_> {
    type Error = GoogleDriveStoreError;

    fn persist_crawl_page(&mut self, nodes: &[DriveFile]) -> Result<(), Self::Error> {
        let remote = nodes
            .iter()
            .map(|file| self.remote_node(file, !file.trashed))
            .collect::<Result<Vec<_>, _>>()?;
        self.persist(remote)
    }

    fn persist_change_page(
        &mut self,
        changes: &[DriveChange<DriveFile>],
    ) -> Result<(), Self::Error> {
        // A page is not guaranteed to put a moved parent before its children.
        // Collapse repeated ids to their last state, then resolve new tree
        // membership to a fixed point over all parent edges in this page.
        let mut latest = BTreeMap::<String, Option<&DriveFile>>::new();
        for change in changes {
            match change {
                DriveChange::Upsert(file) => {
                    latest.insert(file.id.clone(), Some(file));
                }
                DriveChange::Removed { file_id } => {
                    latest.insert(file_id.clone(), None);
                }
            }
        }
        let upserts = latest
            .iter()
            .filter_map(|(id, file)| file.map(|file| (id.as_str(), file)))
            .collect::<HashMap<_, _>>();
        let mut existing_tree = HashSet::<String>::new();
        existing_tree.insert(self.root_folder_id.clone());
        for file in upserts.values() {
            for parent in &file.parents {
                if !latest.contains_key(parent) && self.node_in_tree(parent)? {
                    existing_tree.insert(parent.clone());
                }
            }
        }
        let mut membership = HashSet::<String>::new();
        for (id, file) in &upserts {
            if file.trashed {
                continue;
            }
            let reaches_existing_tree = file
                .parents
                .iter()
                .any(|parent| existing_tree.contains(parent));
            if *id == self.root_folder_id || reaches_existing_tree {
                membership.insert((*id).to_owned());
            }
        }
        loop {
            let before = membership.len();
            for (id, file) in &upserts {
                if !file.trashed
                    && file
                        .parents
                        .iter()
                        .any(|parent| membership.contains(parent))
                {
                    membership.insert((*id).to_owned());
                }
            }
            if membership.len() == before {
                break;
            }
        }

        // Apply removals and folder move-outs first so explicit descendant
        // upserts later in this same page can restore their final membership.
        for (id, file) in &latest {
            let removes_subtree = match file {
                None => true,
                Some(file) => {
                    file.mime_type == GOOGLE_DRIVE_FOLDER_MIME && !membership.contains(id)
                }
            };
            if removes_subtree {
                self.persist(self.stored_subtree(id)?)?;
            }
        }
        for (id, file) in upserts {
            let in_tree = membership.contains(id);
            let was_in_tree = self.node_in_tree(id)?;
            if file.mime_type == GOOGLE_DRIVE_FOLDER_MIME && in_tree && !was_in_tree {
                // Moving a populated folder into the selected tree may emit
                // only one folder change. Do not publish a cursor which could
                // omit descendants; repeat the bounded full crawl.
                self.tree_expansion_detected = true;
            }
            let selected_parent = file
                .parents
                .iter()
                .find(|parent| membership.contains(*parent))
                .cloned()
                .or_else(|| {
                    file.parents
                        .iter()
                        .find(|parent| existing_tree.contains(*parent))
                        .cloned()
                })
                .or_else(|| file.parents.first().cloned());
            self.persist(vec![remote_node(file, selected_parent, in_tree)])?;
        }
        Ok(())
    }

    fn complete_initial_sync(
        &mut self,
        captured_start_page_token: &str,
        terminal_page_token: &str,
        _report: &InitialSyncReport,
    ) -> Result<(), Self::Error> {
        if captured_start_page_token != self.expected_baseline {
            google_drive_store::fail_sync(
                self.connection,
                &self.household_id,
                &self.connection_id,
                &self.lease_token,
                "BASELINE_MISMATCH",
            )?;
            return Err(GoogleDriveStoreError::Conflict);
        }
        if self.tree_expansion_detected {
            google_drive_store::fail_sync(
                self.connection,
                &self.household_id,
                &self.connection_id,
                &self.lease_token,
                "TREE_EXPANSION",
            )?;
            return Err(GoogleDriveStoreError::Conflict);
        }
        google_drive_store::complete_sync(
            self.connection,
            &self.household_id,
            &self.connection_id,
            &self.lease_token,
            terminal_page_token,
            self.discovered_generations.len() as u64,
            true,
        )?;
        Ok(())
    }
}

fn remote_node(file: &DriveFile, parent_file_id: Option<String>, in_tree: bool) -> RemoteNode {
    let is_folder = file.mime_type == GOOGLE_DRIVE_FOLDER_MIME;
    RemoteNode {
        file_id: file.id.clone(),
        parent_file_id,
        name: file.name.clone(),
        mime_type: file.mime_type.clone(),
        modified_time: file.modified_time.clone(),
        byte_size: (!is_folder).then_some(file.size).flatten(),
        md5_checksum: (!is_folder).then_some(file.md5_checksum.clone()).flatten(),
        drive_version: file.version.map(|version| version.to_string()),
        is_folder,
        can_download: !is_folder && file.capabilities.can_download,
        is_in_selected_tree: in_tree,
        is_trashed: file.trashed,
        disposition: disposition(file),
    }
}

fn disposition(file: &DriveFile) -> DiscoveryDisposition {
    if file
        .size
        .is_some_and(|size| size > crate::google_drive_api::MAX_DOWNLOAD_BYTES)
    {
        return DiscoveryDisposition::TooLarge;
    }
    if file.capabilities.can_download && supported_media_type(&file.mime_type) {
        DiscoveryDisposition::Reviewable
    } else {
        DiscoveryDisposition::Unsupported
    }
}

fn supported_media_type(media_type: &str) -> bool {
    matches!(
        media_type,
        "text/csv"
            | "application/csv"
            | "application/pdf"
            | "application/vnd.ms-excel"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "image/jpeg"
            | "image/png"
            | "image/heic"
            | "image/heif"
            | "message/rfc822"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        google_drive_api::{DriveHttpRequest, DriveHttpResponse, DriveTransport},
        google_drive_initial_sync::{run_initial_sync, InitialSyncLimits},
        persistence::AppState,
    };
    use std::sync::Mutex;

    struct FakeTransport {
        responses: Mutex<Vec<DriveHttpResponse>>,
        urls: Mutex<Vec<String>>,
    }

    impl FakeTransport {
        fn new(responses: Vec<serde_json::Value>) -> Self {
            Self {
                responses: Mutex::new(
                    responses
                        .into_iter()
                        .rev()
                        .map(|value| DriveHttpResponse {
                            status: 200,
                            body: serde_json::to_vec(&value).unwrap(),
                        })
                        .collect(),
                ),
                urls: Mutex::new(Vec::new()),
            }
        }
    }

    impl DriveTransport for &FakeTransport {
        fn execute(
            &self,
            request: DriveHttpRequest<'_>,
        ) -> Result<DriveHttpResponse, DriveApiError> {
            self.urls.lock().unwrap().push(request.url);
            self.responses
                .lock()
                .unwrap()
                .pop()
                .ok_or(DriveApiError::Network)
        }
    }

    fn file(id: &str, name: &str, parent: &str, mime: &str, version: u64) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "name": name,
            "mimeType": mime,
            "parents": [parent],
            "modifiedTime": format!("2026-07-{version:02}T00:00:00Z"),
            "size": if mime == GOOGLE_DRIVE_FOLDER_MIME { None } else { Some("42") },
            "md5Checksum": if mime == GOOGLE_DRIVE_FOLDER_MIME { None } else { Some(format!("{version:032x}")) },
            "version": version.to_string(),
            "trashed": false,
            "capabilities": { "canDownload": mime != GOOGLE_DRIVE_FOLDER_MIME }
        })
    }

    fn setup() -> AppState {
        let state = AppState::in_memory(&[7_u8; 32]).unwrap();
        state
            .with_connection(|connection| {
                connection
                    .execute("INSERT INTO households(id,name) VALUES('home','Home')", [])
                    .unwrap();
                google_drive_store::begin_connection(connection, "home", "drive", &"a".repeat(64))
                    .unwrap();
                google_drive_store::mark_authorized(
                    connection,
                    "home",
                    "drive",
                    "google-account",
                    "home@example.com",
                )
                .unwrap();
                google_drive_store::select_root_with_baseline(
                    connection,
                    "home",
                    "drive",
                    None,
                    "root",
                    "KakeFlow Inbox",
                    None,
                    "baseline",
                )
                .unwrap();
                google_drive_store::configure_schedule(connection, "home", "drive", true, 30)
                    .unwrap();
                Ok(())
            })
            .unwrap();
        state
    }

    fn claim(connection: &Connection) -> SyncLeaseDto {
        google_drive_store::claim_due_sync(connection, "home", "drive")
            .unwrap()
            .expect("due sync lease")
    }

    #[test]
    fn crawl_then_change_replay_wins_and_cursor_is_published_atomically() {
        let state = setup();
        state
            .with_connection(|connection| {
                let lease = claim(connection);
                let fake = FakeTransport::new(vec![
                    serde_json::json!({"files": [
                        file("folder", "Folder", "root", GOOGLE_DRIVE_FOLDER_MIME, 1),
                        file("stale", "stale.csv", "root", "text/csv", 1)
                    ]}),
                    serde_json::json!({"files": [
                        file("raced", "raced.csv", "folder", "text/csv", 1)
                    ]}),
                    serde_json::json!({
                        "changes": [
                            {"fileId": "raced", "file": file("raced", "raced.csv", "folder", "text/csv", 2)},
                            {"fileId": "stale", "removed": true}
                        ],
                        "newStartPageToken": "terminal"
                    }),
                ]);
                let client = DriveApiClient::new("access", &fake).unwrap();
                let mut api = GoogleDriveInitialApi::new(
                    &client,
                    "root",
                    None,
                    Some(&lease.change_page_token),
                );
                let mut store = GoogleDriveInitialStore::new(connection, &lease, "root").unwrap();
                let report = run_initial_sync(
                    &mut api,
                    &mut store,
                    None,
                    "root",
                    &InitialSyncLimits::default(),
                )
                .unwrap();
                assert_eq!(report.nodes_crawled, 3);
                assert_eq!(report.changes_replayed, 2);

                let (cursor, version): (String, String) = connection
                    .query_row(
                        "SELECT c.change_page_token,n.drive_version
                         FROM google_drive_connections c
                         JOIN google_drive_nodes n ON n.connection_id=c.id
                         WHERE c.id='drive' AND n.file_id='raced'",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .unwrap();
                assert_eq!((cursor.as_str(), version.as_str()), ("terminal", "2"));
                let states: Vec<String> = {
                    let mut statement = connection
                        .prepare(
                            "SELECT state FROM google_drive_inbox
                             WHERE file_id='stale' ORDER BY discovered_at,id",
                        )
                        .unwrap();
                    statement
                        .query_map([], |row| row.get(0))
                        .unwrap()
                        .collect::<rusqlite::Result<_>>()
                        .unwrap()
                };
                assert_eq!(states, vec!["REMOVED"]);
                assert!(!google_drive_store::load_schedule(connection, "home", "drive")
                    .unwrap()
                    .running);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn removal_cascades_to_descendants_before_terminal_cursor() {
        let state = setup();
        state
            .with_connection(|connection| {
                let lease = claim(connection);
                let mut store = GoogleDriveInitialStore::new(connection, &lease, "root").unwrap();
                let folder = drive_file("folder", "Folder", "root", GOOGLE_DRIVE_FOLDER_MIME, 1);
                let child = drive_file("child", "child.csv", "folder", "text/csv", 1);
                store.persist_crawl_page(&[folder, child]).unwrap();
                store
                    .persist_change_page(&[DriveChange::Removed {
                        file_id: "folder".to_owned(),
                    }])
                    .unwrap();
                store
                    .complete_initial_sync("baseline", "terminal", &empty_report())
                    .unwrap();
                let remaining: i64 = connection
                    .query_row(
                        "SELECT count(*) FROM google_drive_nodes
                         WHERE connection_id='drive' AND is_in_selected_tree=1",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                let child_state: String = connection
                    .query_row(
                        "SELECT state FROM google_drive_inbox WHERE file_id='child'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(remaining, 0);
                assert_eq!(child_state, "REMOVED");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn parent_child_page_is_resolved_independent_of_change_order() {
        for child_first in [false, true] {
            let state = setup();
            state
                .with_connection(|connection| {
                    let lease = claim(connection);
                    let mut store =
                        GoogleDriveInitialStore::new(connection, &lease, "root").unwrap();
                    let parent = DriveChange::Upsert(drive_file(
                        "new_folder",
                        "New",
                        "root",
                        GOOGLE_DRIVE_FOLDER_MIME,
                        1,
                    ));
                    let child = DriveChange::Upsert(drive_file(
                        "new_child",
                        "new.csv",
                        "new_folder",
                        "text/csv",
                        1,
                    ));
                    let changes = if child_first {
                        vec![child, parent]
                    } else {
                        vec![parent, child]
                    };
                    store.persist_change_page(&changes).unwrap();
                    let in_tree: i64 = connection
                        .query_row(
                            "SELECT count(*) FROM google_drive_nodes
                             WHERE connection_id='drive' AND is_in_selected_tree=1",
                            [],
                            |row| row.get(0),
                        )
                        .unwrap();
                    assert_eq!(in_tree, 2);
                    assert!(matches!(
                        store.complete_initial_sync("baseline", "terminal", &empty_report()),
                        Err(GoogleDriveStoreError::Conflict)
                    ));
                    Ok(())
                })
                .unwrap();
        }
    }

    fn drive_file(id: &str, name: &str, parent: &str, mime: &str, version: u64) -> DriveFile {
        serde_json::from_value(file(id, name, parent, mime, version)).unwrap()
    }

    fn empty_report() -> InitialSyncReport {
        InitialSyncReport {
            captured_start_page_token: "baseline".to_owned(),
            terminal_page_token: "terminal".to_owned(),
            folders_visited: 1,
            folder_pages: 1,
            nodes_crawled: 0,
            change_pages: 1,
            changes_replayed: 0,
        }
    }
}
