//! Race-safe orchestration for the first recursive Google Drive synchronization.
//!
//! Drive does not expose a point-in-time recursive folder snapshot. The safe
//! sequence is therefore: capture a Changes baseline, crawl the selected tree,
//! replay every change after that baseline, and only then publish the terminal
//! cursor. Network and persistence are traits so the protocol can be tested
//! without OAuth, HTTP, SQLite, or wall-clock time.

use std::collections::{HashSet, VecDeque};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitialSyncLimits {
    pub folder_page_size: u16,
    pub change_page_size: u16,
    pub max_folder_pages: u32,
    pub max_change_pages: u32,
    pub max_folders: u32,
    pub max_nodes: u64,
    pub max_changes: u64,
}

impl Default for InitialSyncLimits {
    fn default() -> Self {
        Self {
            folder_page_size: 100,
            change_page_size: 100,
            max_folder_pages: 10_000,
            max_change_pages: 10_000,
            max_folders: 10_000,
            max_nodes: 250_000,
            max_changes: 250_000,
        }
    }
}

impl InitialSyncLimits {
    fn validate(&self) -> bool {
        (1..=1_000).contains(&self.folder_page_size)
            && (1..=1_000).contains(&self.change_page_size)
            && self.max_folder_pages > 0
            && self.max_change_pages > 0
            && self.max_folders > 0
            && self.max_nodes > 0
            && self.max_changes > 0
    }
}

/// The minimum metadata the traversal needs. Concrete API adapters may carry
/// more fields in `Node`; the store receives that value unchanged.
pub trait DriveNode {
    fn file_id(&self) -> &str;
    fn is_folder(&self) -> bool;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderPage<Node> {
    pub nodes: Vec<Node>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DriveChange<Node> {
    Upsert(Node),
    Removed { file_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangePage<Node> {
    pub changes: Vec<DriveChange<Node>>,
    /// Present on a non-terminal page and used for the next request.
    pub next_page_token: Option<String>,
    /// Present only on the terminal page. This becomes the durable cursor.
    pub new_start_page_token: Option<String>,
}

pub trait InitialSyncApi {
    type Node: DriveNode;
    type Error;

    fn capture_start_page_token(&mut self, drive_id: Option<&str>) -> Result<String, Self::Error>;

    fn list_folder_children(
        &mut self,
        drive_id: Option<&str>,
        folder_id: &str,
        page_token: Option<&str>,
        page_size: u16,
    ) -> Result<FolderPage<Self::Node>, Self::Error>;

    fn list_changes(
        &mut self,
        drive_id: Option<&str>,
        page_token: &str,
        page_size: u16,
    ) -> Result<ChangePage<Self::Node>, Self::Error>;
}

/// Persistence intentionally separates page application from cursor
/// publication. Implementations must make `complete_initial_sync` an atomic,
/// lease-fenced compare-and-set so a stale worker cannot publish its cursor.
pub trait InitialSyncStore<Node> {
    type Error;

    fn persist_crawl_page(&mut self, nodes: &[Node]) -> Result<(), Self::Error>;
    fn persist_change_page(&mut self, changes: &[DriveChange<Node>]) -> Result<(), Self::Error>;
    fn complete_initial_sync(
        &mut self,
        captured_start_page_token: &str,
        terminal_page_token: &str,
        report: &InitialSyncReport,
    ) -> Result<(), Self::Error>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitialSyncReport {
    pub captured_start_page_token: String,
    pub terminal_page_token: String,
    pub folders_visited: u32,
    pub folder_pages: u32,
    pub nodes_crawled: u64,
    pub change_pages: u32,
    pub changes_replayed: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InitialSyncError<ApiError, StoreError> {
    Api(ApiError),
    Store(StoreError),
    InvalidInput,
    InvalidResponse,
    FolderLimitExceeded,
    FolderPageLimitExceeded,
    NodeLimitExceeded,
    ChangePageLimitExceeded,
    ChangeLimitExceeded,
    PaginationCycle,
}

/// Performs a complete first sync. No cursor is published unless both the
/// recursive crawl and the post-baseline change drain finish successfully.
pub fn run_initial_sync<Api, Store>(
    api: &mut Api,
    store: &mut Store,
    drive_id: Option<&str>,
    root_folder_id: &str,
    limits: &InitialSyncLimits,
) -> Result<InitialSyncReport, InitialSyncError<Api::Error, Store::Error>>
where
    Api: InitialSyncApi,
    Store: InitialSyncStore<Api::Node>,
{
    if !limits.validate() || !valid_identifier(root_folder_id) {
        return Err(InitialSyncError::InvalidInput);
    }
    if drive_id.is_some_and(|id| !valid_identifier(id)) {
        return Err(InitialSyncError::InvalidInput);
    }

    // This ordering is the central race invariant: a mutation which occurs
    // during the recursive crawl must be observable in the following drain.
    let baseline = api
        .capture_start_page_token(drive_id)
        .map_err(InitialSyncError::Api)?;
    if !valid_token(&baseline) {
        return Err(InitialSyncError::InvalidResponse);
    }

    let mut folders = VecDeque::from([root_folder_id.to_owned()]);
    let mut seen_folders = HashSet::from([root_folder_id.to_owned()]);
    let mut folders_visited = 0_u32;
    let mut folder_pages = 0_u32;
    let mut nodes_crawled = 0_u64;

    while let Some(folder_id) = folders.pop_front() {
        folders_visited = folders_visited
            .checked_add(1)
            .ok_or(InitialSyncError::FolderLimitExceeded)?;
        if folders_visited > limits.max_folders {
            return Err(InitialSyncError::FolderLimitExceeded);
        }

        let mut page_token = None::<String>;
        let mut page_tokens = HashSet::new();
        loop {
            folder_pages = folder_pages
                .checked_add(1)
                .ok_or(InitialSyncError::FolderPageLimitExceeded)?;
            if folder_pages > limits.max_folder_pages {
                return Err(InitialSyncError::FolderPageLimitExceeded);
            }
            let page = api
                .list_folder_children(
                    drive_id,
                    &folder_id,
                    page_token.as_deref(),
                    limits.folder_page_size,
                )
                .map_err(InitialSyncError::Api)?;
            if page.nodes.len() > usize::from(limits.folder_page_size) {
                return Err(InitialSyncError::InvalidResponse);
            }

            nodes_crawled = nodes_crawled
                .checked_add(page.nodes.len() as u64)
                .ok_or(InitialSyncError::NodeLimitExceeded)?;
            if nodes_crawled > limits.max_nodes {
                return Err(InitialSyncError::NodeLimitExceeded);
            }
            for node in &page.nodes {
                if !valid_identifier(node.file_id()) {
                    return Err(InitialSyncError::InvalidResponse);
                }
                if node.is_folder() && seen_folders.insert(node.file_id().to_owned()) {
                    if seen_folders.len() > limits.max_folders as usize {
                        return Err(InitialSyncError::FolderLimitExceeded);
                    }
                    folders.push_back(node.file_id().to_owned());
                }
            }
            store
                .persist_crawl_page(&page.nodes)
                .map_err(InitialSyncError::Store)?;

            match page.next_page_token {
                Some(next) if valid_token(&next) && page_tokens.insert(next.clone()) => {
                    page_token = Some(next);
                }
                Some(next) if !valid_token(&next) => {
                    return Err(InitialSyncError::InvalidResponse);
                }
                Some(_) => return Err(InitialSyncError::PaginationCycle),
                None => break,
            }
        }
    }

    let mut change_cursor = baseline.clone();
    let mut seen_change_tokens = HashSet::from([baseline.clone()]);
    let mut change_pages = 0_u32;
    let mut changes_replayed = 0_u64;
    let terminal_page_token;
    loop {
        change_pages = change_pages
            .checked_add(1)
            .ok_or(InitialSyncError::ChangePageLimitExceeded)?;
        if change_pages > limits.max_change_pages {
            return Err(InitialSyncError::ChangePageLimitExceeded);
        }
        let page = api
            .list_changes(drive_id, &change_cursor, limits.change_page_size)
            .map_err(InitialSyncError::Api)?;
        if page.changes.len() > usize::from(limits.change_page_size) {
            return Err(InitialSyncError::InvalidResponse);
        }
        changes_replayed = changes_replayed
            .checked_add(page.changes.len() as u64)
            .ok_or(InitialSyncError::ChangeLimitExceeded)?;
        if changes_replayed > limits.max_changes {
            return Err(InitialSyncError::ChangeLimitExceeded);
        }
        if page.changes.iter().any(|change| match change {
            DriveChange::Upsert(node) => !valid_identifier(node.file_id()),
            DriveChange::Removed { file_id } => !valid_identifier(file_id),
        }) {
            return Err(InitialSyncError::InvalidResponse);
        }
        store
            .persist_change_page(&page.changes)
            .map_err(InitialSyncError::Store)?;

        match (page.next_page_token, page.new_start_page_token) {
            (Some(next), None) if valid_token(&next) && seen_change_tokens.insert(next.clone()) => {
                change_cursor = next;
            }
            (None, Some(terminal)) if valid_token(&terminal) => {
                terminal_page_token = terminal;
                break;
            }
            (Some(next), None) if !valid_token(&next) => {
                return Err(InitialSyncError::InvalidResponse);
            }
            (Some(_), None) => return Err(InitialSyncError::PaginationCycle),
            _ => return Err(InitialSyncError::InvalidResponse),
        }
    }

    let report = InitialSyncReport {
        captured_start_page_token: baseline.clone(),
        terminal_page_token: terminal_page_token.clone(),
        folders_visited,
        folder_pages,
        nodes_crawled,
        change_pages,
        changes_replayed,
    };
    store
        .complete_initial_sync(&baseline, &terminal_page_token, &report)
        .map_err(InitialSyncError::Store)?;
    Ok(report)
}

fn valid_identifier(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

fn valid_token(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 8_192 && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, VecDeque};

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct TestNode {
        id: String,
        folder: bool,
        version: u8,
    }

    impl TestNode {
        fn file(id: &str, version: u8) -> Self {
            Self {
                id: id.to_owned(),
                folder: false,
                version,
            }
        }

        fn folder(id: &str) -> Self {
            Self {
                id: id.to_owned(),
                folder: true,
                version: 1,
            }
        }
    }

    impl DriveNode for TestNode {
        fn file_id(&self) -> &str {
            &self.id
        }

        fn is_folder(&self) -> bool {
            self.folder
        }
    }

    #[derive(Default)]
    struct MockApi {
        baseline: String,
        folder_pages: VecDeque<(&'static str, Option<&'static str>, FolderPage<TestNode>)>,
        change_pages: VecDeque<(&'static str, ChangePage<TestNode>)>,
        calls: Vec<String>,
    }

    impl InitialSyncApi for MockApi {
        type Node = TestNode;
        type Error = &'static str;

        fn capture_start_page_token(
            &mut self,
            drive_id: Option<&str>,
        ) -> Result<String, Self::Error> {
            self.calls.push(format!("baseline:{drive_id:?}"));
            Ok(self.baseline.clone())
        }

        fn list_folder_children(
            &mut self,
            _drive_id: Option<&str>,
            folder_id: &str,
            page_token: Option<&str>,
            _page_size: u16,
        ) -> Result<FolderPage<Self::Node>, Self::Error> {
            self.calls
                .push(format!("folder:{folder_id}:{page_token:?}"));
            let (expected_folder, expected_token, result) = self
                .folder_pages
                .pop_front()
                .ok_or("unexpected folder call")?;
            if expected_folder != folder_id || expected_token != page_token {
                return Err("wrong folder request");
            }
            Ok(result)
        }

        fn list_changes(
            &mut self,
            _drive_id: Option<&str>,
            page_token: &str,
            _page_size: u16,
        ) -> Result<ChangePage<Self::Node>, Self::Error> {
            self.calls.push(format!("changes:{page_token}"));
            let (expected_token, result) = self
                .change_pages
                .pop_front()
                .ok_or("unexpected change call")?;
            if expected_token != page_token {
                return Err("wrong change request");
            }
            Ok(result)
        }
    }

    #[derive(Default)]
    struct MockStore {
        current: BTreeMap<String, TestNode>,
        events: Vec<String>,
        completed: Option<(String, String, InitialSyncReport)>,
        fail_changes: bool,
    }

    impl InitialSyncStore<TestNode> for MockStore {
        type Error = &'static str;

        fn persist_crawl_page(&mut self, nodes: &[TestNode]) -> Result<(), Self::Error> {
            self.events.push(format!("crawl:{}", nodes.len()));
            for node in nodes {
                self.current.insert(node.id.clone(), node.clone());
            }
            Ok(())
        }

        fn persist_change_page(
            &mut self,
            changes: &[DriveChange<TestNode>],
        ) -> Result<(), Self::Error> {
            if self.fail_changes {
                return Err("write failed");
            }
            self.events.push(format!("changes:{}", changes.len()));
            for change in changes {
                match change {
                    DriveChange::Upsert(node) => {
                        self.current.insert(node.id.clone(), node.clone());
                    }
                    DriveChange::Removed { file_id } => {
                        self.current.remove(file_id);
                    }
                }
            }
            Ok(())
        }

        fn complete_initial_sync(
            &mut self,
            baseline: &str,
            terminal: &str,
            report: &InitialSyncReport,
        ) -> Result<(), Self::Error> {
            self.events.push("complete".to_owned());
            self.completed = Some((baseline.to_owned(), terminal.to_owned(), report.clone()));
            Ok(())
        }
    }

    fn terminal(token: &str, changes: Vec<DriveChange<TestNode>>) -> ChangePage<TestNode> {
        ChangePage {
            changes,
            next_page_token: None,
            new_start_page_token: Some(token.to_owned()),
        }
    }

    #[test]
    fn captures_baseline_before_crawl_and_replays_a_mutation_racing_the_crawl() {
        let mut api = MockApi {
            baseline: "cursor-before-crawl".to_owned(),
            folder_pages: VecDeque::from([(
                "root",
                None,
                FolderPage {
                    // Version 1 is the state observed by the crawl.
                    nodes: vec![TestNode::file("receipt", 1)],
                    next_page_token: None,
                },
            )]),
            change_pages: VecDeque::from([(
                "cursor-before-crawl",
                terminal(
                    "cursor-after-drain",
                    vec![DriveChange::Upsert(TestNode::file("receipt", 2))],
                ),
            )]),
            ..Default::default()
        };
        let mut store = MockStore::default();

        let report = run_initial_sync(
            &mut api,
            &mut store,
            Some("shared-drive"),
            "root",
            &InitialSyncLimits::default(),
        )
        .unwrap();

        assert_eq!(
            api.calls,
            [
                "baseline:Some(\"shared-drive\")",
                "folder:root:None",
                "changes:cursor-before-crawl",
            ]
        );
        assert_eq!(store.current["receipt"].version, 2);
        assert_eq!(store.events, ["crawl:1", "changes:1", "complete"]);
        assert_eq!(report.captured_start_page_token, "cursor-before-crawl");
        assert_eq!(report.terminal_page_token, "cursor-after-drain");
        assert_eq!(report.changes_replayed, 1);
        assert_eq!(store.completed.unwrap().1, "cursor-after-drain");
    }

    #[test]
    fn recursively_walks_each_folder_and_paginates_before_draining_changes() {
        let mut api = MockApi {
            baseline: "c0".to_owned(),
            folder_pages: VecDeque::from([
                (
                    "root",
                    None,
                    FolderPage {
                        nodes: vec![TestNode::folder("child"), TestNode::file("a", 1)],
                        next_page_token: Some("root-page-2".to_owned()),
                    },
                ),
                (
                    "root",
                    Some("root-page-2"),
                    FolderPage {
                        nodes: vec![TestNode::file("b", 1)],
                        next_page_token: None,
                    },
                ),
                (
                    "child",
                    None,
                    FolderPage {
                        nodes: vec![TestNode::file("nested", 1)],
                        next_page_token: None,
                    },
                ),
            ]),
            change_pages: VecDeque::from([
                (
                    "c0",
                    ChangePage {
                        changes: vec![],
                        next_page_token: Some("c1".to_owned()),
                        new_start_page_token: None,
                    },
                ),
                ("c1", terminal("c2", vec![])),
            ]),
            ..Default::default()
        };
        let mut store = MockStore::default();

        let report = run_initial_sync(
            &mut api,
            &mut store,
            None,
            "root",
            &InitialSyncLimits::default(),
        )
        .unwrap();

        assert_eq!(report.folders_visited, 2);
        assert_eq!(report.folder_pages, 3);
        assert_eq!(report.nodes_crawled, 4);
        assert_eq!(report.change_pages, 2);
        assert_eq!(store.current.len(), 4);
        assert_eq!(store.completed.unwrap().1, "c2");
    }

    #[test]
    fn never_publishes_cursor_when_change_replay_persistence_fails() {
        let mut api = MockApi {
            baseline: "c0".to_owned(),
            folder_pages: VecDeque::from([(
                "root",
                None,
                FolderPage {
                    nodes: vec![TestNode::file("a", 1)],
                    next_page_token: None,
                },
            )]),
            change_pages: VecDeque::from([("c0", terminal("c1", vec![]))]),
            ..Default::default()
        };
        let mut store = MockStore {
            fail_changes: true,
            ..Default::default()
        };

        assert_eq!(
            run_initial_sync(
                &mut api,
                &mut store,
                None,
                "root",
                &InitialSyncLimits::default(),
            ),
            Err(InitialSyncError::Store("write failed"))
        );
        assert!(store.completed.is_none());
    }

    #[test]
    fn rejects_change_cursor_cycles_without_publishing_cursor() {
        let mut api = MockApi {
            baseline: "c0".to_owned(),
            folder_pages: VecDeque::from([(
                "root",
                None,
                FolderPage {
                    nodes: vec![],
                    next_page_token: None,
                },
            )]),
            change_pages: VecDeque::from([(
                "c0",
                ChangePage {
                    changes: vec![],
                    next_page_token: Some("c0".to_owned()),
                    new_start_page_token: None,
                },
            )]),
            ..Default::default()
        };
        let mut store = MockStore::default();

        assert_eq!(
            run_initial_sync(
                &mut api,
                &mut store,
                None,
                "root",
                &InitialSyncLimits::default(),
            ),
            Err(InitialSyncError::PaginationCycle)
        );
        assert!(store.completed.is_none());
    }

    #[test]
    fn enforces_node_bound_before_persisting_oversized_page() {
        let mut api = MockApi {
            baseline: "c0".to_owned(),
            folder_pages: VecDeque::from([(
                "root",
                None,
                FolderPage {
                    nodes: vec![TestNode::file("a", 1), TestNode::file("b", 1)],
                    next_page_token: None,
                },
            )]),
            ..Default::default()
        };
        let mut store = MockStore::default();
        let limits = InitialSyncLimits {
            max_nodes: 1,
            ..Default::default()
        };

        assert_eq!(
            run_initial_sync(&mut api, &mut store, None, "root", &limits),
            Err(InitialSyncError::NodeLimitExceeded)
        );
        assert!(store.current.is_empty());
        assert!(store.completed.is_none());
    }
}
