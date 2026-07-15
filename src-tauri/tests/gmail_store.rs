use kakeflow_lib::gmail_store::*;
use rusqlite::Connection;

fn database() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    for migration in [
        include_str!("../migrations/0001_household_accounts.sql"),
        include_str!("../migrations/0002_import_provenance.sql"),
        include_str!("../migrations/0053_google_drive_connections.sql"),
        include_str!("../migrations/0054_google_drive_inbox.sql"),
        include_str!("../migrations/0055_google_drive_root_resource_key.sql"),
        include_str!("../migrations/0056_source_document_cloud_sources.sql"),
        include_str!("../migrations/0057_gmail_connector.sql"),
        include_str!("../migrations/0058_gmail_label_selection_state.sql"),
        include_str!("../migrations/0059_gmail_removed_evidence.sql"),
    ] {
        connection.execute_batch(migration).unwrap();
    }
    connection
        .execute_batch("INSERT INTO households(id,name) VALUES('home','Home'),('other','Other');")
        .unwrap();
    connection
}

fn connected(c: &Connection) {
    begin_connection(c, "home", "gmail", &"a".repeat(64)).unwrap();
    mark_authorized(c, "home", "gmail", "google-user", "user@example.com", "99").unwrap();
    assert_eq!(
        load_connection(c, "home", "gmail").unwrap().status,
        "SELECTING_LABEL"
    );
    bind_label(
        c,
        "home",
        "gmail",
        "has:attachment (filename:csv OR filename:pdf)",
        "Label_42",
        "KakeFlow Inbox",
        "100",
    )
    .unwrap();
}

fn message(history: &str, size: u64) -> RemoteMessage {
    RemoteMessage {
        provider_message_id: "message-1".into(),
        thread_id: Some("thread-1".into()),
        history_id: history.into(),
        internal_date_ms: 1_784_064_000_000,
        estimated_byte_size: Some(size),
        rfc822_message_id: Some("<statement@example.com>".into()),
        file_name: "gmail-message-1.eml".into(),
        disposition: MessageDisposition::Reviewable,
    }
}

#[test]
fn migrations_0058_and_0059_upgrade_released_gmail_foundation_without_data_loss() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    for migration in [
        include_str!("../migrations/0001_household_accounts.sql"),
        include_str!("../migrations/0002_import_provenance.sql"),
        include_str!("../migrations/0053_google_drive_connections.sql"),
        include_str!("../migrations/0054_google_drive_inbox.sql"),
        include_str!("../migrations/0055_google_drive_root_resource_key.sql"),
        include_str!("../migrations/0056_source_document_cloud_sources.sql"),
        include_str!("../migrations/0057_gmail_connector.sql"),
    ] {
        c.execute_batch(migration).unwrap();
    }
    c.execute_batch(
        "INSERT INTO households(id,name) VALUES('home','Home');
         INSERT INTO gmail_connections(
           id,household_id,google_account_id,account_email,client_id_fingerprint,
           gmail_query,label_id,label_name,status,start_history_id,history_id)
         VALUES('legacy','home','legacy-account','legacy@example.com',
           'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
           'has:attachment','Label_1','KakeFlow Inbox','CONNECTED','90','100');",
    )
    .unwrap();
    c.execute_batch(include_str!(
        "../migrations/0058_gmail_label_selection_state.sql"
    ))
    .unwrap();
    assert_eq!(
        load_connection(&c, "home", "legacy").unwrap().status,
        "CONNECTED"
    );
    begin_connection(&c, "home", "new", &"b".repeat(64)).unwrap();
    assert_eq!(
        mark_authorized(&c, "home", "new", "new-account", "new@example.com", "101")
            .unwrap()
            .status,
        "SELECTING_LABEL"
    );
    c.execute(
        "INSERT INTO gmail_inbox(
           id,household_id,connection_id,provider_message_id,generation_fingerprint,
           message_history_id,internal_date_ms,file_name,content_sha256,state)
         VALUES(?1,'home','legacy','legacy-message',?2,'100',1784064000000,
           'legacy.eml',?3,'READY')",
        rusqlite::params!["c".repeat(64), "d".repeat(64), "e".repeat(64)],
    )
    .unwrap();
    c.execute_batch(include_str!(
        "../migrations/0059_gmail_removed_evidence.sql"
    ))
    .unwrap();
    c.execute(
        "UPDATE gmail_inbox SET state='REMOVED' WHERE provider_message_id='legacy-message'",
        [],
    )
    .unwrap();
    let preserved: String = c
        .query_row(
            "SELECT content_sha256 FROM gmail_inbox WHERE provider_message_id='legacy-message'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(preserved, "e".repeat(64));
}

#[test]
fn connection_and_schedule_are_household_scoped_and_opt_in() {
    let c = database();
    connected(&c);
    assert!(matches!(
        load_connection(&c, "other", "gmail"),
        Err(GmailStoreError::NotFound)
    ));
    assert!(matches!(
        configure_schedule(&c, "home", "gmail", true, 5),
        Err(GmailStoreError::InvalidInput)
    ));
    let disabled = configure_schedule(&c, "home", "gmail", false, 30).unwrap();
    assert!(!disabled.enabled);
    assert!(claim_due_sync(&c, "home", "gmail").unwrap().is_none());
    configure_schedule(&c, "home", "gmail", true, 15).unwrap();
    let lease = claim_next_due_sync(&c).unwrap().unwrap();
    assert_eq!(lease.history_id, "100");
    assert!(claim_next_due_sync(&c).unwrap().is_none());
    let failed = fail_sync(&c, &lease, "NETWORK_TIMEOUT").unwrap();
    assert_eq!(failed.last_result, "FAILED_RETRYABLE");
    assert_eq!(failed.suspension_reason.as_deref(), Some("RETRY_BACKOFF"));
}

#[test]
fn cursor_advancement_is_fenced_by_the_exact_sync_generation() {
    let c = database();
    connected(&c);
    configure_schedule(&c, "home", "gmail", true, 15).unwrap();
    let lease = claim_due_sync(&c, "home", "gmail").unwrap().unwrap();
    heartbeat_sync(&c, &lease).unwrap();
    let mut stale = lease.clone();
    stale.history_id = "99".into();
    assert!(matches!(
        complete_sync(&c, &stale, "101", 0, false),
        Err(GmailStoreError::StaleLease)
    ));
    let done = complete_sync(&c, &lease, "101", 0, false).unwrap();
    assert_eq!(done.last_result, "NO_CHANGES");
    assert_eq!(
        load_connection(&c, "home", "gmail")
            .unwrap()
            .history_id
            .as_deref(),
        Some("101")
    );
    assert!(matches!(
        complete_sync(&c, &lease, "102", 0, false),
        Err(GmailStoreError::StaleLease)
    ));
}

#[test]
fn immutable_message_identity_ignores_repeated_history_and_label_changes() {
    let c = database();
    connected(&c);
    configure_schedule(&c, "home", "gmail", true, 15).unwrap();
    let sync = claim_due_sync(&c, "home", "gmail").unwrap().unwrap();
    let first = discover_messages_claimed(&c, &sync, &[message("101", 500)])
        .unwrap()
        .remove(0);
    let second = discover_messages_claimed(&c, &sync, &[message("102", 600)])
        .unwrap()
        .remove(0);
    assert_eq!(first.id, second.id);
    assert_eq!(list_inbox(&c, "home", "gmail", 10).unwrap().len(), 1);
    assert_eq!(second.message_history_id, "101");
    assert_eq!(second.estimated_byte_size, Some(500));
    mark_message_removed_claimed(&c, &sync, "message-1").unwrap();
    assert_eq!(
        load_household_inbox_item(&c, "home", &second.id)
            .unwrap()
            .state,
        "REMOVED"
    );
    let restored = discover_messages_claimed(&c, &sync, &[message("103", 700)])
        .unwrap()
        .remove(0);
    assert_eq!(restored.id, second.id);
    assert_eq!(restored.state, "DISCOVERED");

    let download = claim_inbox(&c, "home", "gmail", std::slice::from_ref(&second.id)).unwrap();
    let ready = mark_inbox_ready(
        &c,
        "home",
        &second.id,
        &download.lease_token,
        &"c".repeat(64),
        false,
    )
    .unwrap();
    assert_eq!(ready.state, "READY");
    assert!(matches!(
        mark_inbox_ready(
            &c,
            "home",
            &second.id,
            &download.lease_token,
            &"c".repeat(64),
            false
        ),
        Err(GmailStoreError::StaleLease)
    ));

    c.execute(
        "INSERT INTO import_runs(id,household_id,status) VALUES('run-home','home','REVIEW_REQUIRED')",
        [],
    )
    .unwrap();
    c.execute_batch(
        "INSERT INTO source_documents(id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path)
         VALUES('gmail-doc','home','run-home','GMAIL','message.eml','message/rfc822',600,
         'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','vault://gmail-doc');",
    )
    .unwrap();
    let staging = claim_inbox(&c, "home", "gmail", std::slice::from_ref(&second.id)).unwrap();
    let staged =
        mark_inbox_staged(&c, "home", &second.id, &staging.lease_token, "run-home").unwrap();
    assert_eq!(staged.state, "STAGED");
    assert_eq!(staged.import_run_id.as_deref(), Some("run-home"));
    let links: i64 = c
        .query_row(
            "SELECT count(*) FROM gmail_source_links WHERE inbox_id=?1 AND source_document_id='gmail-doc'",
            [&second.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(links, 1);
    assert!(matches!(
        load_household_inbox_item(&c, "other", &second.id),
        Err(GmailStoreError::NotFound)
    ));
    assert!(matches!(
        reopen_staged_inbox(&c, "home", &second.id, "run-home"),
        Err(GmailStoreError::Conflict)
    ));
    c.execute(
        "UPDATE import_runs SET status='ROLLED_BACK',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='run-home'",
        [],
    )
    .unwrap();
    assert_eq!(
        reopen_staged_inbox(&c, "home", &second.id, "run-home")
            .unwrap()
            .state,
        "READY"
    );
    let links_after_reopen: i64 = c
        .query_row(
            "SELECT count(*) FROM gmail_source_links WHERE inbox_id=?1",
            [&second.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(links_after_reopen, 1);
}

#[test]
fn history_expiration_requires_a_new_lease_and_full_scan() {
    let c = database();
    connected(&c);
    c.execute(
        "UPDATE gmail_connections SET last_full_scan_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id='gmail'",
        [],
    )
    .unwrap();
    configure_schedule(&c, "home", "gmail", true, 15).unwrap();
    let lease = claim_due_sync(&c, "home", "gmail").unwrap().unwrap();
    let schedule = require_full_reconciliation(&c, &lease).unwrap();
    assert!(!schedule.running);
    assert_eq!(
        schedule.last_error_code.as_deref(),
        Some("FULL_RECONCILIATION_REQUIRED")
    );
    assert!(load_connection(&c, "home", "gmail")
        .unwrap()
        .last_full_scan_at
        .is_none());
    let replacement = claim_due_sync(&c, "home", "gmail").unwrap().unwrap();
    assert_ne!(replacement.lease_token, lease.lease_token);
}

#[test]
fn failed_hydration_can_retry_without_storing_message_bytes_in_sqlite() {
    let c = database();
    connected(&c);
    configure_schedule(&c, "home", "gmail", true, 15).unwrap();
    let sync = claim_due_sync(&c, "home", "gmail").unwrap().unwrap();
    let item = discover_messages_claimed(&c, &sync, &[message("101", 500)])
        .unwrap()
        .remove(0);
    let claim = claim_inbox(&c, "home", "gmail", std::slice::from_ref(&item.id)).unwrap();
    let failed = fail_inbox(&c, "home", &item.id, &claim.lease_token, "DOWNLOAD_FAILED").unwrap();
    assert_eq!(failed.state, "FAILED");
    assert!(failed.content_sha256.is_none());
    assert_eq!(
        retry_inbox(&c, "home", &item.id).unwrap().state,
        "DISCOVERED"
    );
    assert_eq!(ignore_inbox(&c, "home", &item.id).unwrap().state, "IGNORED");

    let columns: Vec<String> = c
        .prepare("PRAGMA table_info(gmail_inbox)")
        .unwrap()
        .query_map([], |row| row.get(1))
        .unwrap()
        .collect::<std::result::Result<_, _>>()
        .unwrap();
    assert!(!columns
        .iter()
        .any(|column| matches!(column.as_str(), "body" | "raw_eml" | "bytes")));
    c.execute_batch(
        "INSERT INTO import_runs(id,household_id,status) VALUES('run-gmail','home','REVIEW_REQUIRED');
         INSERT INTO source_documents(id,household_id,import_run_id,source_type,original_filename,media_type,byte_size,sha256,storage_path)
         VALUES('gmail-doc','home','run-gmail','GMAIL','message.eml','message/rfc822',500,
           'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','vault://gmail-doc');",
    )
    .unwrap();
}
