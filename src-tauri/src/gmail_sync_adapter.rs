//! Concrete Gmail API and SQLite/vault adapters for the bounded sync protocol.

use crate::{
    document_vault::DocumentVault,
    gmail_api::{
        GmailApiClient, GmailApiError, GmailHistoryPage as ApiHistoryPage,
        GmailMessagePage as ApiMessagePage, GmailRawMessage as ApiRawMessage, GmailTransport,
    },
    gmail_hydration::{GmailMappingPolicy, ImmutableGmailSink},
    gmail_store::{self, MessageDisposition, RemoteMessage, SyncLeaseDto},
    gmail_sync::{
        GmailFullSyncReport, GmailHistoryMutationRef, GmailHistoryPage, GmailIncrementalSyncReport,
        GmailMessagePage, GmailMessageRef, GmailRawMessage, GmailSyncApi, GmailSyncMutation,
        GmailSyncStore,
    },
};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use thiserror::Error;

impl<T: GmailTransport> GmailSyncApi for GmailApiClient<T> {
    type Error = GmailApiError;

    fn capture_profile_history_id(&mut self) -> Result<u64, Self::Error> {
        self.profile().map(|profile| profile.history_id)
    }

    fn list_messages(
        &mut self,
        label_id: &str,
        query: &str,
        page_token: Option<&str>,
        page_size: u16,
    ) -> Result<GmailMessagePage, Self::Error> {
        let page = self.list_messages_page(Some(query), Some(label_id), page_token, page_size)?;
        Ok(convert_message_page(page))
    }

    fn get_raw_message(
        &mut self,
        message_id: &str,
        max_decoded_bytes: usize,
    ) -> Result<GmailRawMessage, Self::Error> {
        self.get_message_raw(message_id, max_decoded_bytes)
            .map(convert_raw_message)
    }

    fn list_history(
        &mut self,
        start_history_id: u64,
        label_id: &str,
        page_token: Option<&str>,
        page_size: u16,
    ) -> Result<GmailHistoryPage, Self::Error> {
        self.list_message_added_history_page(
            start_history_id,
            Some(label_id),
            page_token,
            page_size,
        )
        .map(|page| convert_history_page(page, label_id))
    }

    fn is_history_cursor_expired(&self, error: &Self::Error) -> bool {
        *error == GmailApiError::HistoryCursorExpired
    }

    fn is_message_not_found(&self, error: &Self::Error) -> bool {
        *error == GmailApiError::NotFound
    }
}

fn convert_message_page(page: ApiMessagePage) -> GmailMessagePage {
    GmailMessagePage {
        messages: page
            .messages
            .into_iter()
            .map(|message| GmailMessageRef {
                id: message.id,
                thread_id: message.thread_id,
            })
            .collect(),
        next_page_token: page.next_page_token,
    }
}

fn convert_raw_message(raw: ApiRawMessage) -> GmailRawMessage {
    GmailRawMessage {
        id: raw.id,
        thread_id: raw.thread_id,
        history_id: raw.history_id,
        internal_date_ms: raw.internal_date_ms,
        size_estimate: raw.size_estimate,
        bytes: raw.bytes,
    }
}

fn convert_history_page(page: ApiHistoryPage, selected_label: &str) -> GmailHistoryPage {
    let record_count = page.history.len();
    let mut mutations = Vec::new();
    for record in page.history {
        for added in record.messages_added {
            mutations.push(GmailHistoryMutationRef::Upsert(GmailMessageRef {
                id: added.message.id,
                thread_id: added.message.thread_id,
            }));
        }
        for added in record.labels_added {
            if added.label_ids.iter().any(|label| label == selected_label) {
                mutations.push(GmailHistoryMutationRef::Upsert(GmailMessageRef {
                    id: added.message.id,
                    thread_id: added.message.thread_id,
                }));
            }
        }
        for removed in record.labels_removed {
            if removed
                .label_ids
                .iter()
                .any(|label| label == selected_label)
            {
                mutations.push(GmailHistoryMutationRef::Removed {
                    message_id: removed.message.id,
                });
            }
        }
        for deleted in record.messages_deleted {
            mutations.push(GmailHistoryMutationRef::Removed {
                message_id: deleted.message.id,
            });
        }
    }
    GmailHistoryPage {
        record_count,
        mutations,
        next_page_token: page.next_page_token,
        response_history_id: page.history_id,
    }
}

#[derive(Debug, Error)]
pub enum GmailSyncAdapterError {
    #[error("Gmail sync persistence failed")]
    Store(#[from] gmail_store::GmailStoreError),
    #[error("Gmail raw evidence storage failed")]
    Vault,
    #[error("Gmail raw evidence receipt was inconsistent")]
    VaultMismatch,
    #[error("Gmail sync cursor did not match the active lease")]
    CursorMismatch,
}

pub struct GmailSqliteSyncStore<'a, P> {
    connection: &'a Connection,
    lease: SyncLeaseDto,
    vault: &'a DocumentVault,
    mapping_policy: &'a P,
    hydrated_items: BTreeSet<String>,
    present_message_ids: BTreeSet<String>,
}

impl<'a, P: GmailMappingPolicy> GmailSqliteSyncStore<'a, P> {
    pub fn new(
        connection: &'a Connection,
        lease: SyncLeaseDto,
        vault: &'a DocumentVault,
        mapping_policy: &'a P,
    ) -> Result<Self, GmailSyncAdapterError> {
        gmail_store::heartbeat_sync(connection, &lease)?;
        Ok(Self {
            connection,
            lease,
            vault,
            mapping_policy,
            hydrated_items: BTreeSet::new(),
            present_message_ids: BTreeSet::new(),
        })
    }

    fn persist_raw_messages(
        &mut self,
        messages: &[GmailRawMessage],
    ) -> Result<(), GmailSyncAdapterError> {
        gmail_store::heartbeat_sync(self.connection, &self.lease)?;
        for raw in messages {
            self.present_message_ids.insert(raw.id.clone());
            let remote = RemoteMessage {
                provider_message_id: raw.id.clone(),
                thread_id: Some(raw.thread_id.clone()),
                history_id: raw.history_id.to_string(),
                internal_date_ms: raw.internal_date_ms,
                estimated_byte_size: Some(raw.size_estimate),
                rfc822_message_id: None,
                file_name: format!("gmail-{}.eml", raw.id),
                disposition: MessageDisposition::Reviewable,
            };
            let item = gmail_store::discover_messages_claimed(
                self.connection,
                &self.lease,
                std::slice::from_ref(&remote),
            )?
            .remove(0);
            if item.state != "DISCOVERED" {
                continue;
            }
            let expected_sha = format!("{:x}", Sha256::digest(&raw.bytes));
            let object = self
                .vault
                .put_raw_eml(&raw.bytes)
                .map_err(|_| GmailSyncAdapterError::Vault)?;
            if object.sha256 != expected_sha
                || object.byte_size != raw.bytes.len() as u64
                || object.media_type != "message/rfc822"
            {
                return Err(GmailSyncAdapterError::VaultMismatch);
            }
            let claim = gmail_store::claim_inbox(
                self.connection,
                &self.lease.household_id,
                &self.lease.connection_id,
                std::slice::from_ref(&item.id),
            )?;
            let needs_mapping = self
                .mapping_policy
                .needs_mapping(&item.file_name, &raw.bytes);
            gmail_store::mark_inbox_ready(
                self.connection,
                &self.lease.household_id,
                &item.id,
                &claim.lease_token,
                &object.sha256,
                needs_mapping,
            )?;
            self.hydrated_items.insert(item.id);
            gmail_store::heartbeat_sync(self.connection, &self.lease)?;
        }
        Ok(())
    }
}

impl<P: GmailMappingPolicy> GmailSyncStore for GmailSqliteSyncStore<'_, P> {
    type Error = GmailSyncAdapterError;

    fn persist_full_message_page(
        &mut self,
        messages: &[GmailRawMessage],
    ) -> Result<(), Self::Error> {
        self.persist_raw_messages(messages)
    }

    fn persist_history_page(&mut self, mutations: &[GmailSyncMutation]) -> Result<(), Self::Error> {
        gmail_store::heartbeat_sync(self.connection, &self.lease)?;
        for mutation in mutations {
            match mutation {
                GmailSyncMutation::Upsert(raw) => {
                    self.persist_raw_messages(std::slice::from_ref(raw))?;
                }
                GmailSyncMutation::Removed { message_id } => {
                    self.present_message_ids.remove(message_id);
                    gmail_store::mark_message_removed_claimed(
                        self.connection,
                        &self.lease,
                        message_id,
                    )?;
                }
            }
        }
        Ok(())
    }

    fn require_full_reconciliation(&mut self) -> Result<(), Self::Error> {
        gmail_store::require_full_reconciliation(self.connection, &self.lease)?;
        Ok(())
    }

    fn complete_full_sync(
        &mut self,
        _captured_history_id: u64,
        terminal_history_id: u64,
        _report: &GmailFullSyncReport,
    ) -> Result<(), Self::Error> {
        gmail_store::heartbeat_sync(self.connection, &self.lease)?;
        let present = self.present_message_ids.iter().cloned().collect::<Vec<_>>();
        gmail_store::complete_full_reconciliation(
            self.connection,
            &self.lease,
            &terminal_history_id.to_string(),
            self.hydrated_items.len() as u64,
            &present,
        )?;
        Ok(())
    }

    fn complete_incremental_sync(
        &mut self,
        starting_history_id: u64,
        terminal_history_id: u64,
        _report: &GmailIncrementalSyncReport,
    ) -> Result<(), Self::Error> {
        if self.lease.history_id != starting_history_id.to_string() {
            return Err(GmailSyncAdapterError::CursorMismatch);
        }
        gmail_store::heartbeat_sync(self.connection, &self.lease)?;
        gmail_store::complete_sync(
            self.connection,
            &self.lease,
            &terminal_history_id.to_string(),
            self.hydrated_items.len() as u64,
            false,
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{gmail_store, persistence::AppState};

    fn setup() -> (AppState, tempfile::TempDir, SyncLeaseDto) {
        let state = AppState::in_memory(&[31_u8; 32]).unwrap();
        let lease = state
            .with_connection(|connection| {
                connection.execute("INSERT INTO households(id,name) VALUES('home','Home')", [])?;
                gmail_store::begin_connection(connection, "home", "gmail", &"a".repeat(64))
                    .unwrap();
                gmail_store::mark_authorized(
                    connection,
                    "home",
                    "gmail",
                    "account",
                    "home@example.com",
                    "99",
                )
                .unwrap();
                gmail_store::bind_label(
                    connection,
                    "home",
                    "gmail",
                    "has:attachment",
                    "Label_42",
                    "KakeFlow Inbox",
                    "100",
                )
                .unwrap();
                gmail_store::configure_schedule(connection, "home", "gmail", true, 30).unwrap();
                Ok(gmail_store::claim_due_sync(connection, "home", "gmail")
                    .unwrap()
                    .unwrap())
            })
            .unwrap();
        (state, tempfile::tempdir().unwrap(), lease)
    }

    fn raw() -> GmailRawMessage {
        raw_id("message_1")
    }

    fn raw_id(id: &str) -> GmailRawMessage {
        GmailRawMessage {
            id: id.into(),
            thread_id: format!("thread_{id}"),
            history_id: 101,
            internal_date_ms: 1_784_064_000_000,
            size_estimate: 512,
            bytes: b"From: bank@example.com\r\n\r\nstatement".to_vec(),
        }
    }

    fn never_map(_: &str, _: &[u8]) -> bool {
        false
    }

    #[test]
    fn raw_pages_are_vaulted_ready_and_cursor_commits_only_at_completion() {
        let (state, temp, lease) = setup();
        let vault = DocumentVault::new(temp.path(), &[41_u8; 32]).unwrap();
        state
            .with_connection(|connection| {
                let mut store =
                    GmailSqliteSyncStore::new(connection, lease.clone(), &vault, &never_map)
                        .unwrap();
                store.persist_full_message_page(&[raw()]).unwrap();
                let item = gmail_store::list_inbox(connection, "home", "gmail", 10)
                    .unwrap()
                    .remove(0);
                assert_eq!(item.state, "READY");
                let sha = item.content_sha256.clone().unwrap();
                assert_eq!(vault.read(&sha).unwrap().bytes, raw().bytes);
                assert_eq!(
                    gmail_store::load_connection(connection, "home", "gmail")
                        .unwrap()
                        .history_id
                        .as_deref(),
                    Some("100")
                );
                store
                    .complete_full_sync(
                        100,
                        101,
                        &GmailFullSyncReport {
                            captured_history_id: 100,
                            terminal_history_id: 101,
                            message_pages: 1,
                            message_refs_seen: 1,
                            unique_messages_persisted: 1,
                            history_pages: 1,
                            history_records: 0,
                            history_mutations_seen: 0,
                            history_mutations_persisted: 0,
                            raw_bytes_fetched: raw().bytes.len() as u64,
                        },
                    )
                    .unwrap();
                assert_eq!(
                    gmail_store::load_connection(connection, "home", "gmail")
                        .unwrap()
                        .history_id
                        .as_deref(),
                    Some("101")
                );
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn repeated_upsert_is_idempotent_and_label_removal_is_lease_fenced() {
        let (state, temp, lease) = setup();
        let vault = DocumentVault::new(temp.path(), &[41_u8; 32]).unwrap();
        state
            .with_connection(|connection| {
                let mut store =
                    GmailSqliteSyncStore::new(connection, lease, &vault, &never_map).unwrap();
                store.persist_full_message_page(&[raw()]).unwrap();
                store.persist_full_message_page(&[raw()]).unwrap();
                assert_eq!(
                    gmail_store::list_inbox(connection, "home", "gmail", 10)
                        .unwrap()
                        .len(),
                    1
                );
                store
                    .persist_history_page(&[GmailSyncMutation::Removed {
                        message_id: "message_1".into(),
                    }])
                    .unwrap();
                assert_eq!(
                    gmail_store::list_inbox(connection, "home", "gmail", 10).unwrap()[0].state,
                    "REMOVED"
                );
                let removed = gmail_store::list_inbox(connection, "home", "gmail", 10)
                    .unwrap()
                    .remove(0);
                let original_sha = removed.content_sha256.clone();
                store.persist_full_message_page(&[raw()]).unwrap();
                let restored = gmail_store::list_inbox(connection, "home", "gmail", 10)
                    .unwrap()
                    .remove(0);
                assert_eq!(restored.state, "READY");
                assert_eq!(restored.content_sha256, original_sha);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn full_completion_removes_omissions_but_preserves_staged_evidence() {
        let (state, temp, lease) = setup();
        let vault = DocumentVault::new(temp.path(), &[41_u8; 32]).unwrap();
        state
            .with_connection(|connection| {
                let mut seed =
                    GmailSqliteSyncStore::new(connection, lease.clone(), &vault, &never_map)
                        .unwrap();
                seed.persist_full_message_page(&[raw_id("keep_staged"), raw_id("remove_pending")])
                    .unwrap();
                drop(seed);

                let staged_item = gmail_store::list_inbox(connection, "home", "gmail", 10)
                    .unwrap()
                    .into_iter()
                    .find(|item| item.provider_message_id == "keep_staged")
                    .unwrap();
                connection
                    .execute(
                        "INSERT INTO import_runs(id,household_id,status) VALUES('run-staged','home','REVIEW_REQUIRED')",
                        [],
                    )
                    .unwrap();
                let claim = gmail_store::claim_inbox(
                    connection,
                    "home",
                    "gmail",
                    std::slice::from_ref(&staged_item.id),
                )
                .unwrap();
                gmail_store::mark_inbox_staged(
                    connection,
                    "home",
                    &staged_item.id,
                    &claim.lease_token,
                    "run-staged",
                )
                .unwrap();

                let mut reconciliation =
                    GmailSqliteSyncStore::new(connection, lease, &vault, &never_map).unwrap();
                reconciliation
                    .persist_full_message_page(&[raw_id("present")])
                    .unwrap();
                reconciliation
                    .complete_full_sync(
                        100,
                        102,
                        &GmailFullSyncReport {
                            captured_history_id: 100,
                            terminal_history_id: 102,
                            message_pages: 1,
                            message_refs_seen: 1,
                            unique_messages_persisted: 1,
                            history_pages: 1,
                            history_records: 0,
                            history_mutations_seen: 0,
                            history_mutations_persisted: 0,
                            raw_bytes_fetched: raw_id("present").bytes.len() as u64,
                        },
                    )
                    .unwrap();
                let items = gmail_store::list_inbox(connection, "home", "gmail", 10).unwrap();
                assert_eq!(
                    items
                        .iter()
                        .find(|item| item.provider_message_id == "keep_staged")
                        .unwrap()
                        .state,
                    "STAGED"
                );
                assert_eq!(
                    items
                        .iter()
                        .find(|item| item.provider_message_id == "remove_pending")
                        .unwrap()
                        .state,
                    "REMOVED"
                );
                assert_eq!(
                    items
                        .iter()
                        .find(|item| item.provider_message_id == "present")
                        .unwrap()
                        .state,
                    "READY"
                );
                Ok(())
            })
            .unwrap();
    }
}
