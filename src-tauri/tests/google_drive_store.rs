use kakeflow_lib::google_drive_store::*;
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
    connection
        .execute(
            "INSERT INTO households(id,name) VALUES('other','Other')",
            [],
        )
        .unwrap();
    connection
}

fn connected(connection: &Connection) {
    begin_connection(connection, "home", "drive", &"a".repeat(64)).unwrap();
    mark_authorized(
        connection,
        "home",
        "drive",
        "google-user",
        "user@example.com",
    )
    .unwrap();
    select_root_with_baseline(
        connection,
        "home",
        "drive",
        None,
        "folder",
        "KakeFlow Inbox",
        None,
        "start-token",
    )
    .unwrap();
}

fn file(version: &str) -> RemoteNode {
    RemoteNode {
        file_id: "file-1".into(),
        parent_file_id: Some("folder".into()),
        name: "statement.csv".into(),
        mime_type: "text/csv".into(),
        modified_time: Some(format!("2026-07-{version}T00:00:00Z")),
        byte_size: Some(123),
        md5_checksum: Some("b".repeat(32)),
        drive_version: Some(version.into()),
        is_folder: false,
        can_download: true,
        is_in_selected_tree: true,
        is_trashed: false,
        disposition: DiscoveryDisposition::Reviewable,
    }
}

fn sync_lease(connection: &Connection) -> SyncLeaseDto {
    configure_schedule(connection, "home", "drive", true, 15).unwrap();
    claim_due_sync(connection, "home", "drive")
        .unwrap()
        .unwrap()
}

#[test]
fn lifecycle_requires_order_and_is_household_scoped() {
    let connection = database();
    begin_connection(&connection, "home", "drive", &"a".repeat(64)).unwrap();
    assert!(matches!(
        select_root_with_baseline(
            &connection,
            "home",
            "drive",
            None,
            "folder",
            "Inbox",
            None,
            "token"
        ),
        Err(GoogleDriveStoreError::Conflict)
    ));
    assert!(matches!(
        load_connection(&connection, "other", "drive"),
        Err(GoogleDriveStoreError::NotFound)
    ));
    mark_authorized(
        &connection,
        "home",
        "drive",
        "google-user",
        "user@example.com",
    )
    .unwrap();
    let dto = select_root_with_baseline(
        &connection,
        "home",
        "drive",
        Some("shared-drive"),
        "folder",
        "Inbox",
        Some("0-Key_123"),
        "token",
    )
    .unwrap();
    assert_eq!(dto.status, "CONNECTED");
    assert_eq!(dto.change_page_token.as_deref(), Some("token"));
    assert_eq!(dto.root_resource_key.as_deref(), Some("0-Key_123"));
}

#[test]
fn current_nodes_and_inbox_preserve_multiple_generations() {
    let connection = database();
    connected(&connection);
    let lease = sync_lease(&connection);
    let first = discover_nodes_claimed(
        &connection,
        "home",
        "drive",
        &lease.lease_token,
        &[file("01")],
    )
    .unwrap();
    let second = discover_nodes_claimed(
        &connection,
        "home",
        "drive",
        &lease.lease_token,
        &[file("02")],
    )
    .unwrap();
    assert_ne!(first[0].id, second[0].id);
    let states: Vec<String> = connection
        .prepare("SELECT state FROM google_drive_inbox ORDER BY discovered_at,id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<std::result::Result<_, _>>()
        .unwrap();
    assert_eq!(states.len(), 2);
    assert!(states.contains(&"REMOVED".to_owned()));
    assert!(states.contains(&"DISCOVERED".to_owned()));
    let current: String = connection
        .query_row(
            "SELECT drive_version FROM google_drive_nodes WHERE file_id='file-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(current, "02");
}

#[test]
fn removal_marks_current_generation_without_deleting_history() {
    let connection = database();
    connected(&connection);
    let lease = sync_lease(&connection);
    let item = discover_nodes_claimed(
        &connection,
        "home",
        "drive",
        &lease.lease_token,
        &[file("01")],
    )
    .unwrap()
    .remove(0);
    let mut removed = file("01");
    removed.is_trashed = true;
    discover_nodes_claimed(&connection, "home", "drive", &lease.lease_token, &[removed]).unwrap();
    let state: String = connection
        .query_row(
            "SELECT state FROM google_drive_inbox WHERE id=?1",
            [&item.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(state, "REMOVED");
    let count: i64 = connection
        .query_row("SELECT count(*) FROM google_drive_inbox", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn inbox_download_is_review_gated_and_stale_leases_fail() {
    let connection = database();
    connected(&connection);
    let sync = sync_lease(&connection);
    let item = discover_nodes_claimed(
        &connection,
        "home",
        "drive",
        &sync.lease_token,
        &[file("01")],
    )
    .unwrap()
    .remove(0);
    let lease = claim_inbox(&connection, "home", "drive", std::slice::from_ref(&item.id)).unwrap();
    let ready = mark_inbox_ready(
        &connection,
        "home",
        &item.id,
        &lease.lease_token,
        &"c".repeat(64),
        true,
    )
    .unwrap();
    assert_eq!(ready.state, "NEEDS_MAPPING");
    assert!(ready.import_run_id.is_none());
    assert!(matches!(
        mark_inbox_ready(
            &connection,
            "home",
            &item.id,
            &lease.lease_token,
            &"c".repeat(64),
            false
        ),
        Err(GoogleDriveStoreError::StaleLease)
    ));
}

#[test]
fn cursor_advances_only_with_current_schedule_lease() {
    let connection = database();
    connected(&connection);
    let lease = sync_lease(&connection);
    assert!(matches!(
        complete_sync(
            &connection,
            "other",
            "drive",
            &lease.lease_token,
            "next-token",
            1,
            true
        ),
        Err(GoogleDriveStoreError::StaleLease)
    ));
    let status = complete_sync(
        &connection,
        "home",
        "drive",
        &lease.lease_token,
        "next-token",
        1,
        true,
    )
    .unwrap();
    assert_eq!(status.last_result, "DISCOVERED");
    let dto = load_connection(&connection, "home", "drive").unwrap();
    assert_eq!(dto.change_page_token.as_deref(), Some("next-token"));
    assert!(dto.last_full_scan_at.is_some());
    assert!(matches!(
        complete_sync(
            &connection,
            "home",
            "drive",
            &lease.lease_token,
            "stale-token",
            0,
            false
        ),
        Err(GoogleDriveStoreError::StaleLease)
    ));
}

#[test]
fn retryable_and_terminal_sync_failures_are_lease_fenced() {
    let connection = database();
    connected(&connection);
    let lease = sync_lease(&connection);
    let status = fail_sync(
        &connection,
        "home",
        "drive",
        &lease.lease_token,
        "NETWORK_TIMEOUT",
    )
    .unwrap();
    assert_eq!(status.last_result, "FAILED_RETRYABLE");
    assert_eq!(status.consecutive_failures, 1);
    assert!(matches!(
        suspend_sync_claimed(
            &connection,
            "home",
            "drive",
            &lease.lease_token,
            "CURSOR_INVALID"
        ),
        Err(GoogleDriveStoreError::StaleLease)
    ));
    configure_schedule(&connection, "home", "drive", true, 15).unwrap();
    let next = claim_due_sync(&connection, "home", "drive")
        .unwrap()
        .unwrap();
    let terminal = suspend_sync_claimed(
        &connection,
        "home",
        "drive",
        &next.lease_token,
        "CURSOR_INVALID",
    )
    .unwrap();
    assert_eq!(terminal.last_result, "TERMINAL_SUSPENDED");
    assert_eq!(
        terminal.suspension_reason.as_deref(),
        Some("CURSOR_INVALID")
    );
}

#[test]
fn auth_required_suspends_schedule_and_disconnect_keeps_evidence() {
    let connection = database();
    connected(&connection);
    let lease = sync_lease(&connection);
    discover_nodes_claimed(
        &connection,
        "home",
        "drive",
        &lease.lease_token,
        &[file("01")],
    )
    .unwrap();
    let dto = require_reauthorization(&connection, "home", "drive").unwrap();
    assert_eq!(dto.status, "AUTH_REQUIRED");
    let schedule = load_schedule(&connection, "home", "drive").unwrap();
    assert_eq!(schedule.last_result, "TERMINAL_SUSPENDED");
    assert_eq!(schedule.suspension_reason.as_deref(), Some("AUTH_EXPIRED"));
    disconnect(&connection, "home", "drive").unwrap();
    let count: i64 = connection
        .query_row("SELECT count(*) FROM google_drive_inbox", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
}
