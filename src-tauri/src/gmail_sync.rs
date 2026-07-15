//! Bounded, race-safe Gmail full and incremental synchronization protocol.
//!
//! Gmail messages are immutable, but membership in the selected Inbox label is
//! not. A full scan therefore captures a History baseline before listing the
//! label, persists raw RFC 822 messages page-by-page, then replays label-scoped
//! history before publishing a terminal cursor. Incremental runs drain that
//! same history feed. Provider access and persistence are traits so the
//! protocol is deterministic and independently testable.

use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailSyncLimits {
    pub message_page_size: u16,
    pub history_page_size: u16,
    pub max_message_pages: u32,
    pub max_history_pages: u32,
    pub max_messages: u64,
    pub max_history_records: u64,
    pub max_history_mutations: u64,
    pub max_raw_message_bytes: usize,
    pub max_total_raw_bytes: u64,
}

impl Default for GmailSyncLimits {
    fn default() -> Self {
        Self {
            message_page_size: 100,
            history_page_size: 100,
            max_message_pages: 10_000,
            max_history_pages: 10_000,
            max_messages: 250_000,
            max_history_records: 250_000,
            max_history_mutations: 500_000,
            max_raw_message_bytes: 50 * 1024 * 1024,
            max_total_raw_bytes: 4 * 1024 * 1024 * 1024,
        }
    }
}

impl GmailSyncLimits {
    fn validate(&self) -> bool {
        (1..=500).contains(&self.message_page_size)
            && (1..=500).contains(&self.history_page_size)
            && self.max_message_pages > 0
            && self.max_history_pages > 0
            && self.max_messages > 0
            && self.max_history_records > 0
            && self.max_history_mutations > 0
            && (1..=50 * 1024 * 1024).contains(&self.max_raw_message_bytes)
            && self.max_total_raw_bytes >= self.max_raw_message_bytes as u64
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailMessageRef {
    pub id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailMessagePage {
    pub messages: Vec<GmailMessageRef>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailRawMessage {
    pub id: String,
    pub thread_id: String,
    pub history_id: u64,
    pub internal_date_ms: u64,
    pub size_estimate: u64,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GmailHistoryMutationRef {
    Upsert(GmailMessageRef),
    Removed { message_id: String },
}

impl GmailHistoryMutationRef {
    fn message_id(&self) -> &str {
        match self {
            Self::Upsert(message) => &message.id,
            Self::Removed { message_id } => message_id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailHistoryPage {
    /// Count of Gmail History records, distinct from the number of mutations.
    pub record_count: usize,
    /// Adapter-produced, label-scoped mutations in provider order.
    pub mutations: Vec<GmailHistoryMutationRef>,
    pub next_page_token: Option<String>,
    /// Gmail's response `historyId`; publish only from the terminal page.
    pub response_history_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GmailSyncMutation {
    Upsert(GmailRawMessage),
    Removed { message_id: String },
}

pub trait GmailSyncApi {
    type Error;

    fn capture_profile_history_id(&mut self) -> Result<u64, Self::Error>;

    fn list_messages(
        &mut self,
        label_id: &str,
        query: &str,
        page_token: Option<&str>,
        page_size: u16,
    ) -> Result<GmailMessagePage, Self::Error>;

    fn get_raw_message(
        &mut self,
        message_id: &str,
        max_decoded_bytes: usize,
    ) -> Result<GmailRawMessage, Self::Error>;

    fn list_history(
        &mut self,
        start_history_id: u64,
        label_id: &str,
        page_token: Option<&str>,
        page_size: u16,
    ) -> Result<GmailHistoryPage, Self::Error>;

    /// Returns true only for Gmail's expired/invalid History cursor response.
    fn is_history_cursor_expired(&self, _error: &Self::Error) -> bool {
        false
    }

    /// A message can disappear between list/history and format=raw fetch. In
    /// that race a full scan skips it and history treats it as a removal.
    fn is_message_not_found(&self, _error: &Self::Error) -> bool {
        false
    }
}

/// Page writes and cursor publication are deliberately separate. Concrete
/// stores must fence every method to the same active sync lease and make each
/// page durable before returning.
pub trait GmailSyncStore {
    type Error;

    fn persist_full_message_page(
        &mut self,
        messages: &[GmailRawMessage],
    ) -> Result<(), Self::Error>;

    fn persist_history_page(&mut self, mutations: &[GmailSyncMutation]) -> Result<(), Self::Error>;

    fn require_full_reconciliation(&mut self) -> Result<(), Self::Error>;

    fn complete_full_sync(
        &mut self,
        captured_history_id: u64,
        terminal_history_id: u64,
        report: &GmailFullSyncReport,
    ) -> Result<(), Self::Error>;

    fn complete_incremental_sync(
        &mut self,
        starting_history_id: u64,
        terminal_history_id: u64,
        report: &GmailIncrementalSyncReport,
    ) -> Result<(), Self::Error>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailFullSyncReport {
    pub captured_history_id: u64,
    pub terminal_history_id: u64,
    pub message_pages: u32,
    pub message_refs_seen: u64,
    pub unique_messages_persisted: u64,
    pub history_pages: u32,
    pub history_records: u64,
    pub history_mutations_seen: u64,
    pub history_mutations_persisted: u64,
    pub raw_bytes_fetched: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailIncrementalSyncReport {
    pub starting_history_id: u64,
    pub terminal_history_id: u64,
    pub history_pages: u32,
    pub history_records: u64,
    pub history_mutations_seen: u64,
    pub history_mutations_persisted: u64,
    pub raw_bytes_fetched: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GmailSyncError<ApiError, StoreError> {
    Api(ApiError),
    Store(StoreError),
    FullReconciliationRequired,
    InvalidInput,
    InvalidResponse,
    MessagePageLimitExceeded,
    MessageLimitExceeded,
    HistoryPageLimitExceeded,
    HistoryRecordLimitExceeded,
    HistoryMutationLimitExceeded,
    RawByteLimitExceeded,
    PaginationCycle,
}

struct HistoryDrainReport {
    terminal_history_id: u64,
    pages: u32,
    records: u64,
    mutations_seen: u64,
    mutations_persisted: u64,
    raw_bytes: u64,
}

/// Executes a race-safe query/label reconciliation. The profile History cursor
/// is captured before the first list call, so mutations racing the full list
/// are replayed before completion.
pub fn run_full_sync<Api, Store>(
    api: &mut Api,
    store: &mut Store,
    label_id: &str,
    query: &str,
    limits: &GmailSyncLimits,
) -> Result<GmailFullSyncReport, GmailSyncError<Api::Error, Store::Error>>
where
    Api: GmailSyncApi,
    Store: GmailSyncStore,
{
    validate_inputs(label_id, Some(query), limits)?;
    let captured_history_id = api
        .capture_profile_history_id()
        .map_err(GmailSyncError::Api)?;
    if captured_history_id == 0 {
        return Err(GmailSyncError::InvalidResponse);
    }

    let mut page_token = None::<String>;
    let mut seen_page_tokens = HashSet::new();
    let mut seen_messages = HashMap::<String, String>::new();
    let mut message_pages = 0_u32;
    let mut message_refs_seen = 0_u64;
    let mut unique_messages_persisted = 0_u64;
    let mut raw_bytes_fetched = 0_u64;

    loop {
        message_pages = message_pages
            .checked_add(1)
            .ok_or(GmailSyncError::MessagePageLimitExceeded)?;
        if message_pages > limits.max_message_pages {
            return Err(GmailSyncError::MessagePageLimitExceeded);
        }
        let page = api
            .list_messages(
                label_id,
                query,
                page_token.as_deref(),
                limits.message_page_size,
            )
            .map_err(GmailSyncError::Api)?;
        if page.messages.len() > usize::from(limits.message_page_size) {
            return Err(GmailSyncError::InvalidResponse);
        }
        message_refs_seen = checked_count(
            message_refs_seen,
            page.messages.len(),
            limits.max_messages,
            || GmailSyncError::MessageLimitExceeded,
        )?;

        let mut raw_page = Vec::with_capacity(page.messages.len());
        for message in page.messages {
            validate_message_ref(&message).map_err(|_| GmailSyncError::InvalidResponse)?;
            if let Some(existing_thread) = seen_messages.get(&message.id) {
                if existing_thread != &message.thread_id {
                    return Err(GmailSyncError::InvalidResponse);
                }
                continue;
            }
            seen_messages.insert(message.id.clone(), message.thread_id.clone());
            let raw = match api.get_raw_message(&message.id, limits.max_raw_message_bytes) {
                Ok(raw) => raw,
                Err(error) if api.is_message_not_found(&error) => continue,
                Err(error) => return Err(GmailSyncError::Api(error)),
            };
            validate_raw_message(&raw, &message, limits.max_raw_message_bytes)
                .map_err(|_| GmailSyncError::InvalidResponse)?;
            raw_bytes_fetched = checked_raw_bytes(
                raw_bytes_fetched,
                raw.bytes.len(),
                limits.max_total_raw_bytes,
            )?;
            unique_messages_persisted = unique_messages_persisted
                .checked_add(1)
                .ok_or(GmailSyncError::MessageLimitExceeded)?;
            raw_page.push(raw);
        }
        store
            .persist_full_message_page(&raw_page)
            .map_err(GmailSyncError::Store)?;

        match page.next_page_token {
            Some(next) if valid_page_token(&next) && seen_page_tokens.insert(next.clone()) => {
                page_token = Some(next);
            }
            Some(next) if !valid_page_token(&next) => {
                return Err(GmailSyncError::InvalidResponse);
            }
            Some(_) => return Err(GmailSyncError::PaginationCycle),
            None => break,
        }
    }

    let history = drain_history(
        api,
        store,
        label_id,
        captured_history_id,
        limits,
        raw_bytes_fetched,
    )?;
    let report = GmailFullSyncReport {
        captured_history_id,
        terminal_history_id: history.terminal_history_id,
        message_pages,
        message_refs_seen,
        unique_messages_persisted,
        history_pages: history.pages,
        history_records: history.records,
        history_mutations_seen: history.mutations_seen,
        history_mutations_persisted: history.mutations_persisted,
        raw_bytes_fetched: history.raw_bytes,
    };
    store
        .complete_full_sync(captured_history_id, history.terminal_history_id, &report)
        .map_err(GmailSyncError::Store)?;
    Ok(report)
}

pub fn run_incremental_sync<Api, Store>(
    api: &mut Api,
    store: &mut Store,
    label_id: &str,
    starting_history_id: u64,
    limits: &GmailSyncLimits,
) -> Result<GmailIncrementalSyncReport, GmailSyncError<Api::Error, Store::Error>>
where
    Api: GmailSyncApi,
    Store: GmailSyncStore,
{
    validate_inputs(label_id, None, limits)?;
    if starting_history_id == 0 {
        return Err(GmailSyncError::InvalidInput);
    }
    let history = drain_history(api, store, label_id, starting_history_id, limits, 0)?;
    let report = GmailIncrementalSyncReport {
        starting_history_id,
        terminal_history_id: history.terminal_history_id,
        history_pages: history.pages,
        history_records: history.records,
        history_mutations_seen: history.mutations_seen,
        history_mutations_persisted: history.mutations_persisted,
        raw_bytes_fetched: history.raw_bytes,
    };
    store
        .complete_incremental_sync(starting_history_id, history.terminal_history_id, &report)
        .map_err(GmailSyncError::Store)?;
    Ok(report)
}

fn drain_history<Api, Store>(
    api: &mut Api,
    store: &mut Store,
    label_id: &str,
    starting_history_id: u64,
    limits: &GmailSyncLimits,
    starting_raw_bytes: u64,
) -> Result<HistoryDrainReport, GmailSyncError<Api::Error, Store::Error>>
where
    Api: GmailSyncApi,
    Store: GmailSyncStore,
{
    let mut page_token = None::<String>;
    let mut seen_page_tokens = HashSet::new();
    let mut pages = 0_u32;
    let mut records = 0_u64;
    let mut mutations_seen = 0_u64;
    let mut mutations_persisted = 0_u64;
    let mut raw_bytes = starting_raw_bytes;
    let terminal_history_id;

    loop {
        pages = pages
            .checked_add(1)
            .ok_or(GmailSyncError::HistoryPageLimitExceeded)?;
        if pages > limits.max_history_pages {
            return Err(GmailSyncError::HistoryPageLimitExceeded);
        }
        let page = match api.list_history(
            starting_history_id,
            label_id,
            page_token.as_deref(),
            limits.history_page_size,
        ) {
            Ok(page) => page,
            Err(error) if api.is_history_cursor_expired(&error) => {
                store
                    .require_full_reconciliation()
                    .map_err(GmailSyncError::Store)?;
                return Err(GmailSyncError::FullReconciliationRequired);
            }
            Err(error) => return Err(GmailSyncError::Api(error)),
        };
        if page.record_count > usize::from(limits.history_page_size)
            || page.response_history_id < starting_history_id
        {
            return Err(GmailSyncError::InvalidResponse);
        }
        records = checked_count(
            records,
            page.record_count,
            limits.max_history_records,
            || GmailSyncError::HistoryRecordLimitExceeded,
        )?;
        mutations_seen = checked_count(
            mutations_seen,
            page.mutations.len(),
            limits.max_history_mutations,
            || GmailSyncError::HistoryMutationLimitExceeded,
        )?;

        // Gmail can surface the same message through messageAdded and
        // labelAdded in one page. The final provider-ordered mutation wins.
        let normalized = normalize_history_mutations(page.mutations)?;
        let mut durable = Vec::with_capacity(normalized.len());
        for mutation in normalized {
            match mutation {
                GmailHistoryMutationRef::Upsert(message) => {
                    let raw = match api.get_raw_message(&message.id, limits.max_raw_message_bytes) {
                        Ok(raw) => raw,
                        Err(error) if api.is_message_not_found(&error) => {
                            durable.push(GmailSyncMutation::Removed {
                                message_id: message.id,
                            });
                            continue;
                        }
                        Err(error) => return Err(GmailSyncError::Api(error)),
                    };
                    validate_raw_message(&raw, &message, limits.max_raw_message_bytes)
                        .map_err(|_| GmailSyncError::InvalidResponse)?;
                    raw_bytes =
                        checked_raw_bytes(raw_bytes, raw.bytes.len(), limits.max_total_raw_bytes)?;
                    durable.push(GmailSyncMutation::Upsert(raw));
                }
                GmailHistoryMutationRef::Removed { message_id } => {
                    durable.push(GmailSyncMutation::Removed { message_id });
                }
            }
        }
        mutations_persisted = mutations_persisted
            .checked_add(durable.len() as u64)
            .ok_or(GmailSyncError::HistoryMutationLimitExceeded)?;
        store
            .persist_history_page(&durable)
            .map_err(GmailSyncError::Store)?;

        match page.next_page_token {
            Some(next) if valid_page_token(&next) && seen_page_tokens.insert(next.clone()) => {
                page_token = Some(next);
            }
            Some(next) if !valid_page_token(&next) => {
                return Err(GmailSyncError::InvalidResponse);
            }
            Some(_) => return Err(GmailSyncError::PaginationCycle),
            None => {
                terminal_history_id = page.response_history_id;
                break;
            }
        }
    }

    Ok(HistoryDrainReport {
        terminal_history_id,
        pages,
        records,
        mutations_seen,
        mutations_persisted,
        raw_bytes,
    })
}

fn normalize_history_mutations<ApiError, StoreError>(
    mutations: Vec<GmailHistoryMutationRef>,
) -> Result<Vec<GmailHistoryMutationRef>, GmailSyncError<ApiError, StoreError>> {
    let mut last_index = HashMap::new();
    for (index, mutation) in mutations.iter().enumerate() {
        if !valid_identifier(mutation.message_id())
            || matches!(mutation, GmailHistoryMutationRef::Upsert(message) if validate_message_ref(message).is_err())
        {
            return Err(GmailSyncError::InvalidResponse);
        }
        last_index.insert(mutation.message_id().to_owned(), index);
    }
    Ok(mutations
        .into_iter()
        .enumerate()
        .filter_map(|(index, mutation)| {
            (last_index.get(mutation.message_id()) == Some(&index)).then_some(mutation)
        })
        .collect())
}

fn validate_inputs<ApiError, StoreError>(
    label_id: &str,
    query: Option<&str>,
    limits: &GmailSyncLimits,
) -> Result<(), GmailSyncError<ApiError, StoreError>> {
    if !limits.validate()
        || !valid_identifier(label_id)
        || query.is_some_and(|value| {
            value.trim().is_empty() || value.len() > 4 * 1024 || value.chars().any(char::is_control)
        })
    {
        Err(GmailSyncError::InvalidInput)
    } else {
        Ok(())
    }
}

fn validate_message_ref(message: &GmailMessageRef) -> Result<(), ()> {
    if valid_identifier(&message.id) && valid_identifier(&message.thread_id) {
        Ok(())
    } else {
        Err(())
    }
}

fn validate_raw_message(
    raw: &GmailRawMessage,
    expected: &GmailMessageRef,
    max_bytes: usize,
) -> Result<(), ()> {
    if raw.id == expected.id
        && raw.thread_id == expected.thread_id
        && raw.history_id > 0
        && raw.internal_date_ms > 0
        && raw.size_estimate <= max_bytes as u64
        && !raw.bytes.is_empty()
        && raw.bytes.len() <= max_bytes
    {
        Ok(())
    } else {
        Err(())
    }
}

fn checked_count<ApiError, StoreError, ErrorFactory>(
    current: u64,
    additional: usize,
    limit: u64,
    error: ErrorFactory,
) -> Result<u64, GmailSyncError<ApiError, StoreError>>
where
    ErrorFactory: Fn() -> GmailSyncError<ApiError, StoreError>,
{
    let next = current.checked_add(additional as u64).ok_or_else(&error)?;
    if next > limit {
        Err(error())
    } else {
        Ok(next)
    }
}

fn checked_raw_bytes<ApiError, StoreError>(
    current: u64,
    additional: usize,
    limit: u64,
) -> Result<u64, GmailSyncError<ApiError, StoreError>> {
    let next = current
        .checked_add(additional as u64)
        .ok_or(GmailSyncError::RawByteLimitExceeded)?;
    if next > limit {
        Err(GmailSyncError::RawByteLimitExceeded)
    } else {
        Ok(next)
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_page_token(value: &str) -> bool {
    !value.is_empty() && value.len() <= 8_192 && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    #[derive(Default)]
    struct MockApi {
        baseline: u64,
        message_pages: VecDeque<Result<GmailMessagePage, &'static str>>,
        history_pages: VecDeque<Result<GmailHistoryPage, &'static str>>,
        raw_messages: HashMap<String, GmailRawMessage>,
        calls: Vec<String>,
    }

    impl GmailSyncApi for MockApi {
        type Error = &'static str;

        fn capture_profile_history_id(&mut self) -> Result<u64, Self::Error> {
            self.calls.push("profile".into());
            Ok(self.baseline)
        }

        fn list_messages(
            &mut self,
            label: &str,
            query: &str,
            token: Option<&str>,
            _size: u16,
        ) -> Result<GmailMessagePage, Self::Error> {
            self.calls.push(format!("list:{label}:{query}:{token:?}"));
            self.message_pages
                .pop_front()
                .ok_or("unexpected message page")?
        }

        fn get_raw_message(
            &mut self,
            id: &str,
            _max: usize,
        ) -> Result<GmailRawMessage, Self::Error> {
            self.calls.push(format!("raw:{id}"));
            self.raw_messages.get(id).cloned().ok_or("missing raw")
        }

        fn list_history(
            &mut self,
            start: u64,
            label: &str,
            token: Option<&str>,
            _size: u16,
        ) -> Result<GmailHistoryPage, Self::Error> {
            self.calls
                .push(format!("history:{start}:{label}:{token:?}"));
            self.history_pages
                .pop_front()
                .ok_or("unexpected history page")?
        }

        fn is_history_cursor_expired(&self, error: &Self::Error) -> bool {
            *error == "expired"
        }

        fn is_message_not_found(&self, error: &Self::Error) -> bool {
            *error == "missing raw"
        }
    }

    #[derive(Default)]
    struct MockStore {
        events: Vec<String>,
        full_pages: Vec<Vec<GmailRawMessage>>,
        history_pages: Vec<Vec<GmailSyncMutation>>,
        full_completion: Option<(u64, u64)>,
        incremental_completion: Option<(u64, u64)>,
        reconciliation_required: bool,
        fail_history: bool,
    }

    impl GmailSyncStore for MockStore {
        type Error = &'static str;

        fn persist_full_message_page(
            &mut self,
            messages: &[GmailRawMessage],
        ) -> Result<(), Self::Error> {
            self.events.push(format!("full-page:{}", messages.len()));
            self.full_pages.push(messages.to_vec());
            Ok(())
        }

        fn persist_history_page(
            &mut self,
            mutations: &[GmailSyncMutation],
        ) -> Result<(), Self::Error> {
            if self.fail_history {
                return Err("write failed");
            }
            self.events
                .push(format!("history-page:{}", mutations.len()));
            self.history_pages.push(mutations.to_vec());
            Ok(())
        }

        fn require_full_reconciliation(&mut self) -> Result<(), Self::Error> {
            self.events.push("reconcile".into());
            self.reconciliation_required = true;
            Ok(())
        }

        fn complete_full_sync(
            &mut self,
            baseline: u64,
            terminal: u64,
            _report: &GmailFullSyncReport,
        ) -> Result<(), Self::Error> {
            self.events.push("complete-full".into());
            self.full_completion = Some((baseline, terminal));
            Ok(())
        }

        fn complete_incremental_sync(
            &mut self,
            starting: u64,
            terminal: u64,
            _report: &GmailIncrementalSyncReport,
        ) -> Result<(), Self::Error> {
            self.events.push("complete-incremental".into());
            self.incremental_completion = Some((starting, terminal));
            Ok(())
        }
    }

    fn message(id: &str) -> GmailMessageRef {
        GmailMessageRef {
            id: id.into(),
            thread_id: format!("thread_{id}"),
        }
    }

    fn raw(id: &str, bytes: usize) -> GmailRawMessage {
        GmailRawMessage {
            id: id.into(),
            thread_id: format!("thread_{id}"),
            history_id: 10,
            internal_date_ms: 1_720_000_000_000,
            size_estimate: bytes as u64,
            bytes: vec![b'x'; bytes],
        }
    }

    fn terminal_history(id: u64, mutations: Vec<GmailHistoryMutationRef>) -> GmailHistoryPage {
        GmailHistoryPage {
            record_count: usize::from(!mutations.is_empty()),
            mutations,
            next_page_token: None,
            response_history_id: id,
        }
    }

    #[test]
    fn full_sync_captures_baseline_before_list_and_replays_racing_history() {
        let mut api = MockApi {
            baseline: 100,
            message_pages: VecDeque::from([Ok(GmailMessagePage {
                messages: vec![message("one")],
                next_page_token: None,
            })]),
            history_pages: VecDeque::from([Ok(terminal_history(
                105,
                vec![
                    GmailHistoryMutationRef::Upsert(message("two")),
                    GmailHistoryMutationRef::Removed {
                        message_id: "one".into(),
                    },
                ],
            ))]),
            raw_messages: HashMap::from([
                ("one".into(), raw("one", 4)),
                ("two".into(), raw("two", 5)),
            ]),
            ..Default::default()
        };
        let mut store = MockStore::default();
        let report = run_full_sync(
            &mut api,
            &mut store,
            "Label_1",
            "has:attachment",
            &GmailSyncLimits::default(),
        )
        .unwrap();

        assert_eq!(report.captured_history_id, 100);
        assert_eq!(report.terminal_history_id, 105);
        assert_eq!(report.raw_bytes_fetched, 9);
        assert_eq!(api.calls[0], "profile");
        assert!(api.calls[1].starts_with("list:Label_1:has:attachment"));
        assert_eq!(store.full_completion, Some((100, 105)));
        assert_eq!(store.events.last().unwrap(), "complete-full");
        assert!(matches!(
            store.history_pages[0][1],
            GmailSyncMutation::Removed { .. }
        ));
    }

    #[test]
    fn full_list_pages_are_persisted_separately_and_duplicate_ids_are_fetched_once() {
        let mut api = MockApi {
            baseline: 10,
            message_pages: VecDeque::from([
                Ok(GmailMessagePage {
                    messages: vec![message("one")],
                    next_page_token: Some("page_2".into()),
                }),
                Ok(GmailMessagePage {
                    messages: vec![message("one"), message("two")],
                    next_page_token: None,
                }),
            ]),
            history_pages: VecDeque::from([Ok(terminal_history(10, vec![]))]),
            raw_messages: HashMap::from([
                ("one".into(), raw("one", 1)),
                ("two".into(), raw("two", 1)),
            ]),
            ..Default::default()
        };
        let mut store = MockStore::default();
        let report = run_full_sync(
            &mut api,
            &mut store,
            "Label_1",
            "has:attachment",
            &GmailSyncLimits::default(),
        )
        .unwrap();
        assert_eq!(report.message_refs_seen, 3);
        assert_eq!(report.unique_messages_persisted, 2);
        assert_eq!(
            store.full_pages.iter().map(Vec::len).collect::<Vec<_>>(),
            vec![1, 1]
        );
        assert_eq!(
            api.calls.iter().filter(|call| *call == "raw:one").count(),
            1
        );
    }

    #[test]
    fn incremental_persists_each_page_before_publishing_only_terminal_cursor() {
        let mut api = MockApi {
            history_pages: VecDeque::from([
                Ok(GmailHistoryPage {
                    record_count: 1,
                    mutations: vec![GmailHistoryMutationRef::Upsert(message("one"))],
                    next_page_token: Some("page_2".into()),
                    response_history_id: 105,
                }),
                Ok(terminal_history(
                    110,
                    vec![GmailHistoryMutationRef::Removed {
                        message_id: "one".into(),
                    }],
                )),
            ]),
            raw_messages: HashMap::from([("one".into(), raw("one", 3))]),
            ..Default::default()
        };
        let mut store = MockStore::default();
        let report = run_incremental_sync(
            &mut api,
            &mut store,
            "Label_1",
            100,
            &GmailSyncLimits::default(),
        )
        .unwrap();
        assert_eq!(report.terminal_history_id, 110);
        assert_eq!(store.history_pages.len(), 2);
        assert_eq!(store.incremental_completion, Some((100, 110)));
        assert_eq!(
            store.events,
            vec!["history-page:1", "history-page:1", "complete-incremental"]
        );
    }

    #[test]
    fn history_duplicates_are_collapsed_with_last_mutation_winning() {
        let mut api = MockApi {
            history_pages: VecDeque::from([Ok(terminal_history(
                101,
                vec![
                    GmailHistoryMutationRef::Upsert(message("one")),
                    GmailHistoryMutationRef::Removed {
                        message_id: "one".into(),
                    },
                    GmailHistoryMutationRef::Upsert(message("two")),
                    GmailHistoryMutationRef::Upsert(message("two")),
                ],
            ))]),
            raw_messages: HashMap::from([("two".into(), raw("two", 2))]),
            ..Default::default()
        };
        let mut store = MockStore::default();
        let report = run_incremental_sync(
            &mut api,
            &mut store,
            "Label_1",
            100,
            &GmailSyncLimits::default(),
        )
        .unwrap();
        assert_eq!(report.history_mutations_seen, 4);
        assert_eq!(report.history_mutations_persisted, 2);
        assert_eq!(store.history_pages[0].len(), 2);
        assert!(matches!(
            store.history_pages[0][0],
            GmailSyncMutation::Removed { .. }
        ));
        assert_eq!(
            api.calls.iter().filter(|call| *call == "raw:two").count(),
            1
        );
    }

    #[test]
    fn message_disappearing_before_raw_fetch_is_reconciled_as_removed() {
        let mut api = MockApi {
            history_pages: VecDeque::from([Ok(terminal_history(
                101,
                vec![GmailHistoryMutationRef::Upsert(message("gone"))],
            ))]),
            ..Default::default()
        };
        let mut store = MockStore::default();
        let report = run_incremental_sync(
            &mut api,
            &mut store,
            "Label_1",
            100,
            &GmailSyncLimits::default(),
        )
        .unwrap();
        assert_eq!(report.history_mutations_seen, 1);
        assert_eq!(report.history_mutations_persisted, 1);
        assert_eq!(report.raw_bytes_fetched, 0);
        assert!(matches!(
            store.history_pages[0][0],
            GmailSyncMutation::Removed { ref message_id } if message_id == "gone"
        ));
    }

    #[test]
    fn expired_history_requests_full_reconciliation_without_cursor_publication() {
        let mut api = MockApi {
            history_pages: VecDeque::from([Err("expired")]),
            ..Default::default()
        };
        let mut store = MockStore::default();
        assert_eq!(
            run_incremental_sync(
                &mut api,
                &mut store,
                "Label_1",
                100,
                &GmailSyncLimits::default()
            ),
            Err(GmailSyncError::FullReconciliationRequired)
        );
        assert!(store.reconciliation_required);
        assert_eq!(store.incremental_completion, None);
    }

    #[test]
    fn failed_page_store_never_publishes_terminal_cursor() {
        let mut api = MockApi {
            history_pages: VecDeque::from([Ok(terminal_history(
                101,
                vec![GmailHistoryMutationRef::Removed {
                    message_id: "one".into(),
                }],
            ))]),
            ..Default::default()
        };
        let mut store = MockStore {
            fail_history: true,
            ..Default::default()
        };
        assert_eq!(
            run_incremental_sync(
                &mut api,
                &mut store,
                "Label_1",
                100,
                &GmailSyncLimits::default()
            ),
            Err(GmailSyncError::Store("write failed"))
        );
        assert_eq!(store.incremental_completion, None);
    }

    #[test]
    fn pagination_cycles_and_non_terminal_cursor_shapes_are_rejected() {
        let mut api = MockApi {
            history_pages: VecDeque::from([
                Ok(GmailHistoryPage {
                    record_count: 0,
                    mutations: vec![],
                    next_page_token: Some("same".into()),
                    response_history_id: 100,
                }),
                Ok(GmailHistoryPage {
                    record_count: 0,
                    mutations: vec![],
                    next_page_token: Some("same".into()),
                    response_history_id: 100,
                }),
            ]),
            ..Default::default()
        };
        assert_eq!(
            run_incremental_sync(
                &mut api,
                &mut MockStore::default(),
                "Label_1",
                100,
                &GmailSyncLimits::default()
            ),
            Err(GmailSyncError::PaginationCycle)
        );
    }

    #[test]
    fn raw_identity_size_and_aggregate_byte_bounds_are_enforced() {
        let limits = GmailSyncLimits {
            max_raw_message_bytes: 4,
            max_total_raw_bytes: 4,
            ..Default::default()
        };
        let mut api = MockApi {
            baseline: 10,
            message_pages: VecDeque::from([Ok(GmailMessagePage {
                messages: vec![message("one"), message("two")],
                next_page_token: None,
            })]),
            raw_messages: HashMap::from([
                ("one".into(), raw("one", 3)),
                ("two".into(), raw("two", 3)),
            ]),
            ..Default::default()
        };
        assert_eq!(
            run_full_sync(
                &mut api,
                &mut MockStore::default(),
                "Label_1",
                "has:attachment",
                &limits
            ),
            Err(GmailSyncError::RawByteLimitExceeded)
        );
    }

    #[test]
    fn count_page_and_input_limits_are_enforced() {
        let invalid = GmailSyncLimits {
            message_page_size: 0,
            ..Default::default()
        };
        assert_eq!(
            run_incremental_sync(
                &mut MockApi::default(),
                &mut MockStore::default(),
                "Label_1",
                1,
                &invalid
            ),
            Err(GmailSyncError::InvalidInput)
        );
        assert_eq!(
            run_full_sync(
                &mut MockApi::default(),
                &mut MockStore::default(),
                "Label_1",
                "",
                &GmailSyncLimits::default()
            ),
            Err(GmailSyncError::InvalidInput)
        );

        let limits = GmailSyncLimits {
            max_history_mutations: 1,
            ..Default::default()
        };
        let mut api = MockApi {
            history_pages: VecDeque::from([Ok(terminal_history(
                2,
                vec![
                    GmailHistoryMutationRef::Removed {
                        message_id: "one".into(),
                    },
                    GmailHistoryMutationRef::Removed {
                        message_id: "two".into(),
                    },
                ],
            ))]),
            ..Default::default()
        };
        assert_eq!(
            run_incremental_sync(&mut api, &mut MockStore::default(), "Label_1", 1, &limits),
            Err(GmailSyncError::HistoryMutationLimitExceeded)
        );
    }
}
