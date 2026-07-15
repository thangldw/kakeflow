//! Bounded, injectable Gmail v1 read-only client.
//!
//! The client deliberately exposes only the operations required by the mailbox
//! ingestion pipeline. HTTP is injectable so paging, error classification, and
//! raw-message decoding can be tested without network access.

use base64::{engine::general_purpose, Engine as _};
use reqwest::{
    blocking::Client as ReqwestClient,
    header::{HeaderValue, AUTHORIZATION},
    Method, Url,
};
use serde::Deserialize;
use std::{io::Read, time::Duration};
use thiserror::Error;
use zeroize::Zeroizing;

const API_ROOT: &str = "https://gmail.googleapis.com/gmail/v1/users/me/";
const MAX_JSON_BYTES: u64 = 512 * 1024;
pub const MAX_RAW_MESSAGE_BYTES: usize = 50 * 1024 * 1024;
const MAX_QUERY_BYTES: usize = 4 * 1024;
const MAX_PAGE_TOKEN_BYTES: usize = 8 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum GmailApiError {
    #[error("Gmail authorization expired")]
    ReauthorizationRequired,
    #[error("Gmail access was denied")]
    Forbidden,
    #[error("Gmail message was not found")]
    NotFound,
    #[error("Gmail history cursor expired")]
    HistoryCursorExpired,
    #[error("Gmail request was rate limited")]
    RateLimited,
    #[error("Gmail is temporarily unavailable")]
    Retryable,
    #[error("Gmail network request failed")]
    Network,
    #[error("Gmail returned an invalid response")]
    InvalidResponse,
    #[error("Gmail request input is invalid")]
    InvalidInput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GmailHttpMethod {
    Get,
}

pub struct GmailHttpRequest<'a> {
    pub method: GmailHttpMethod,
    pub url: String,
    pub bearer_token: &'a str,
    pub max_response_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailHttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

pub trait GmailTransport: Send + Sync {
    fn execute(&self, request: GmailHttpRequest<'_>) -> Result<GmailHttpResponse, GmailApiError>;
}

#[derive(Clone, Debug)]
pub struct ReqwestGmailTransport {
    client: ReqwestClient,
}

impl ReqwestGmailTransport {
    pub fn new() -> Result<Self, GmailApiError> {
        Ok(Self {
            client: ReqwestClient::builder()
                .connect_timeout(TIMEOUT)
                .timeout(TIMEOUT)
                .build()
                .map_err(|_| GmailApiError::Network)?,
        })
    }
}

impl GmailTransport for ReqwestGmailTransport {
    fn execute(&self, request: GmailHttpRequest<'_>) -> Result<GmailHttpResponse, GmailApiError> {
        let authorization = Zeroizing::new(format!("Bearer {}", request.bearer_token));
        let authorization =
            HeaderValue::from_str(&authorization).map_err(|_| GmailApiError::InvalidInput)?;
        let method = match request.method {
            GmailHttpMethod::Get => Method::GET,
        };
        let mut response = self
            .client
            .request(method, &request.url)
            .header(AUTHORIZATION, authorization)
            .send()
            .map_err(|_| GmailApiError::Network)?;
        let status = response.status().as_u16();
        let mut body = Vec::new();
        response
            .by_ref()
            .take(request.max_response_bytes + 1)
            .read_to_end(&mut body)
            .map_err(|_| GmailApiError::Network)?;
        if body.len() as u64 > request.max_response_bytes {
            return Err(GmailApiError::InvalidResponse);
        }
        Ok(GmailHttpResponse { status, body })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailProfile {
    pub email_address: String,
    pub messages_total: u64,
    pub threads_total: u64,
    #[serde(deserialize_with = "u64_string")]
    pub history_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailMessageRef {
    pub id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailMessagePage {
    pub messages: Vec<GmailMessageRef>,
    pub next_page_token: Option<String>,
    pub result_size_estimate: u64,
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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailHistoryMessageAdded {
    pub message: GmailMessageRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailHistoryMessageDeleted {
    pub message: GmailMessageRef,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailHistoryLabelAdded {
    pub message: GmailMessageRef,
    #[serde(default)]
    pub label_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailHistoryLabelRemoved {
    pub message: GmailMessageRef,
    #[serde(default)]
    pub label_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailHistoryRecord {
    #[serde(deserialize_with = "u64_string")]
    pub id: u64,
    #[serde(default)]
    pub messages_added: Vec<GmailHistoryMessageAdded>,
    #[serde(default)]
    pub messages_deleted: Vec<GmailHistoryMessageDeleted>,
    #[serde(default)]
    pub labels_added: Vec<GmailHistoryLabelAdded>,
    #[serde(default)]
    pub labels_removed: Vec<GmailHistoryLabelRemoved>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailHistoryPage {
    pub history: Vec<GmailHistoryRecord>,
    pub next_page_token: Option<String>,
    pub history_id: u64,
}

pub struct GmailApiClient<T> {
    access_token: Zeroizing<String>,
    transport: T,
}

impl GmailApiClient<ReqwestGmailTransport> {
    pub fn production(access_token: &str) -> Result<Self, GmailApiError> {
        Self::new(access_token, ReqwestGmailTransport::new()?)
    }
}

impl<T: GmailTransport> GmailApiClient<T> {
    pub fn new(access_token: &str, transport: T) -> Result<Self, GmailApiError> {
        validate_token(access_token)?;
        Ok(Self {
            access_token: Zeroizing::new(access_token.to_owned()),
            transport,
        })
    }

    pub fn profile(&self) -> Result<GmailProfile, GmailApiError> {
        let profile: GmailProfile = self.get_json(api_url("profile")?, MAX_JSON_BYTES, false)?;
        if !valid_email(&profile.email_address) || profile.history_id == 0 {
            return Err(GmailApiError::InvalidResponse);
        }
        Ok(profile)
    }

    pub fn list_messages_page(
        &self,
        query: Option<&str>,
        label_id: Option<&str>,
        page_token: Option<&str>,
        max_results: u16,
    ) -> Result<GmailMessagePage, GmailApiError> {
        validate_query(query)?;
        validate_optional_label_id(label_id)?;
        validate_page(page_token, max_results)?;
        let mut url = api_url("messages")?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs
                .append_pair("maxResults", &max_results.to_string())
                .append_pair(
                    "fields",
                    "messages(id,threadId),nextPageToken,resultSizeEstimate",
                );
            if let Some(query) = query {
                pairs.append_pair("q", query);
            }
            if let Some(label_id) = label_id {
                pairs.append_pair("labelIds", label_id);
            }
            if let Some(token) = page_token {
                pairs.append_pair("pageToken", token);
            }
        }
        let wire: MessageListWire = self.get_json(url, MAX_JSON_BYTES, false)?;
        validate_page_token(wire.next_page_token.as_deref(), false)?;
        if wire.messages.len() > usize::from(max_results)
            || wire
                .messages
                .iter()
                .any(|message| !valid_message_ref(message))
        {
            return Err(GmailApiError::InvalidResponse);
        }
        Ok(GmailMessagePage {
            messages: wire.messages,
            next_page_token: wire.next_page_token,
            result_size_estimate: wire.result_size_estimate,
        })
    }

    pub fn get_message_raw(
        &self,
        message_id: &str,
        max_decoded_bytes: usize,
    ) -> Result<GmailRawMessage, GmailApiError> {
        validate_id(message_id)?;
        if max_decoded_bytes == 0 || max_decoded_bytes > MAX_RAW_MESSAGE_BYTES {
            return Err(GmailApiError::InvalidInput);
        }
        let mut url = api_url(&format!("messages/{message_id}"))?;
        url.query_pairs_mut()
            .append_pair("format", "raw")
            .append_pair(
                "fields",
                "id,threadId,historyId,internalDate,sizeEstimate,raw",
            );
        let encoded_bound = encoded_len_bound(max_decoded_bytes)?;
        let response_bound = encoded_bound
            .checked_add(16 * 1024)
            .ok_or(GmailApiError::InvalidInput)? as u64;
        let wire: RawMessageWire = self.get_json(url, response_bound, false)?;
        if validate_id(&wire.id).is_err()
            || validate_id(&wire.thread_id).is_err()
            || wire.history_id == 0
            || wire.internal_date_ms == 0
            || wire.size_estimate > MAX_RAW_MESSAGE_BYTES as u64
        {
            return Err(GmailApiError::InvalidResponse);
        }
        let bytes = decode_raw_message(&wire.raw, max_decoded_bytes)?;
        Ok(GmailRawMessage {
            id: wire.id,
            thread_id: wire.thread_id,
            history_id: wire.history_id,
            internal_date_ms: wire.internal_date_ms,
            size_estimate: wire.size_estimate,
            bytes,
        })
    }

    pub fn list_message_added_history_page(
        &self,
        start_history_id: u64,
        label_id: Option<&str>,
        page_token: Option<&str>,
        max_results: u16,
    ) -> Result<GmailHistoryPage, GmailApiError> {
        if start_history_id == 0 {
            return Err(GmailApiError::InvalidInput);
        }
        validate_optional_label_id(label_id)?;
        validate_page(page_token, max_results)?;
        let mut url = api_url("history")?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs
                .append_pair("startHistoryId", &start_history_id.to_string())
                .append_pair("historyTypes", "messageAdded")
                .append_pair("historyTypes", "messageDeleted")
                .append_pair("historyTypes", "labelAdded")
                .append_pair("historyTypes", "labelRemoved")
                .append_pair("maxResults", &max_results.to_string())
                .append_pair(
                    "fields",
                    "history(id,messagesAdded(message(id,threadId)),messagesDeleted(message(id,threadId)),labelsAdded(message(id,threadId),labelIds),labelsRemoved(message(id,threadId),labelIds)),nextPageToken,historyId",
                );
            if let Some(label_id) = label_id {
                pairs.append_pair("labelId", label_id);
            }
            if let Some(token) = page_token {
                pairs.append_pair("pageToken", token);
            }
        }
        let wire: HistoryListWire = self.get_json(url, MAX_JSON_BYTES, true)?;
        validate_page_token(wire.next_page_token.as_deref(), false)?;
        if wire.history_id == 0
            || wire.history.len() > usize::from(max_results)
            || wire.history.iter().any(|record| {
                record.id == 0
                    || record
                        .messages_added
                        .iter()
                        .any(|added| !valid_message_ref(&added.message))
                    || record
                        .messages_deleted
                        .iter()
                        .any(|deleted| !valid_message_ref(&deleted.message))
                    || record.labels_added.iter().any(|added| {
                        !valid_message_ref(&added.message)
                            || added.label_ids.len() > 100
                            || added
                                .label_ids
                                .iter()
                                .any(|label_id| validate_label_id(label_id).is_err())
                    })
                    || record.labels_removed.iter().any(|removed| {
                        !valid_message_ref(&removed.message)
                            || removed.label_ids.len() > 100
                            || removed
                                .label_ids
                                .iter()
                                .any(|label_id| validate_label_id(label_id).is_err())
                    })
            })
        {
            return Err(GmailApiError::InvalidResponse);
        }
        Ok(GmailHistoryPage {
            history: wire.history,
            next_page_token: wire.next_page_token,
            history_id: wire.history_id,
        })
    }

    fn get_json<R: for<'de> Deserialize<'de>>(
        &self,
        url: Url,
        max_response_bytes: u64,
        history_request: bool,
    ) -> Result<R, GmailApiError> {
        let body = self.execute(url, max_response_bytes, history_request)?;
        serde_json::from_slice(&body).map_err(|_| GmailApiError::InvalidResponse)
    }

    fn execute(
        &self,
        url: Url,
        max_response_bytes: u64,
        history_request: bool,
    ) -> Result<Vec<u8>, GmailApiError> {
        let response = self.transport.execute(GmailHttpRequest {
            method: GmailHttpMethod::Get,
            url: url.into(),
            bearer_token: &self.access_token,
            max_response_bytes,
        })?;
        match response.status {
            200..=299 => Ok(response.body),
            401 => Err(GmailApiError::ReauthorizationRequired),
            403 => Err(GmailApiError::Forbidden),
            404 if history_request => Err(GmailApiError::HistoryCursorExpired),
            404 => Err(GmailApiError::NotFound),
            429 => Err(GmailApiError::RateLimited),
            500..=599 => Err(GmailApiError::Retryable),
            _ => Err(GmailApiError::InvalidResponse),
        }
    }
}

pub fn decode_raw_message(
    encoded: &str,
    max_decoded_bytes: usize,
) -> Result<Vec<u8>, GmailApiError> {
    if max_decoded_bytes == 0 || max_decoded_bytes > MAX_RAW_MESSAGE_BYTES {
        return Err(GmailApiError::InvalidInput);
    }
    if encoded.is_empty()
        || encoded.len() > encoded_len_bound(max_decoded_bytes)?
        || encoded
            .bytes()
            .any(|byte| !(byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'=')))
        || encoded[..encoded.len().saturating_sub(2)].contains('=')
    {
        return Err(GmailApiError::InvalidResponse);
    }
    let decoded = general_purpose::URL_SAFE_NO_PAD
        .decode(encoded)
        .or_else(|_| general_purpose::URL_SAFE.decode(encoded))
        .map_err(|_| GmailApiError::InvalidResponse)?;
    if decoded.len() > max_decoded_bytes {
        return Err(GmailApiError::InvalidResponse);
    }
    Ok(decoded)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageListWire {
    #[serde(default)]
    messages: Vec<GmailMessageRef>,
    next_page_token: Option<String>,
    #[serde(default)]
    result_size_estimate: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawMessageWire {
    id: String,
    thread_id: String,
    #[serde(deserialize_with = "u64_string")]
    history_id: u64,
    #[serde(rename = "internalDate", deserialize_with = "u64_string")]
    internal_date_ms: u64,
    #[serde(default)]
    size_estimate: u64,
    raw: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryListWire {
    #[serde(default)]
    history: Vec<GmailHistoryRecord>,
    next_page_token: Option<String>,
    #[serde(deserialize_with = "u64_string")]
    history_id: u64,
}

fn api_url(path: &str) -> Result<Url, GmailApiError> {
    Url::parse(API_ROOT)
        .and_then(|base| base.join(path))
        .map_err(|_| GmailApiError::InvalidInput)
}

fn validate_token(value: &str) -> Result<(), GmailApiError> {
    if value.is_empty()
        || value.len() > 16_384
        || value
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
    {
        Err(GmailApiError::InvalidInput)
    } else {
        Ok(())
    }
}

fn validate_id(value: &str) -> Result<(), GmailApiError> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Err(GmailApiError::InvalidInput)
    } else {
        Ok(())
    }
}

fn valid_message_ref(message: &GmailMessageRef) -> bool {
    validate_id(&message.id).is_ok() && validate_id(&message.thread_id).is_ok()
}

fn validate_label_id(value: &str) -> Result<(), GmailApiError> {
    validate_id(value)
}

fn validate_optional_label_id(value: Option<&str>) -> Result<(), GmailApiError> {
    value.map_or(Ok(()), validate_label_id)
}

fn validate_query(query: Option<&str>) -> Result<(), GmailApiError> {
    if query.is_some_and(|value| {
        value.trim().is_empty()
            || value.len() > MAX_QUERY_BYTES
            || value.chars().any(char::is_control)
    }) {
        Err(GmailApiError::InvalidInput)
    } else {
        Ok(())
    }
}

fn validate_page(token: Option<&str>, max_results: u16) -> Result<(), GmailApiError> {
    if !(1..=500).contains(&max_results) {
        return Err(GmailApiError::InvalidInput);
    }
    validate_page_token(token, true)
}

fn validate_page_token(token: Option<&str>, input: bool) -> Result<(), GmailApiError> {
    if token.is_some_and(|value| {
        value.is_empty()
            || value.len() > MAX_PAGE_TOKEN_BYTES
            || value.bytes().any(|byte| byte.is_ascii_control())
    }) {
        Err(if input {
            GmailApiError::InvalidInput
        } else {
            GmailApiError::InvalidResponse
        })
    } else {
        Ok(())
    }
}

fn encoded_len_bound(decoded: usize) -> Result<usize, GmailApiError> {
    decoded
        .checked_add(2)
        .and_then(|value| value.checked_div(3))
        .and_then(|value| value.checked_mul(4))
        .and_then(|value| value.checked_add(4))
        .ok_or(GmailApiError::InvalidInput)
}

fn valid_email(value: &str) -> bool {
    value.len() <= 320
        && value.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && !domain.is_empty()
                && !value
                    .bytes()
                    .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
        })
}

fn u64_string<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
    String::deserialize(deserializer)?
        .parse()
        .map_err(serde::de::Error::custom)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Fake {
        responses: Mutex<Vec<GmailHttpResponse>>,
        requests: Mutex<Vec<(String, u64)>>,
    }

    impl Fake {
        fn new(responses: Vec<GmailHttpResponse>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().rev().collect()),
                requests: Mutex::new(Vec::new()),
            }
        }
    }

    impl GmailTransport for &Fake {
        fn execute(
            &self,
            request: GmailHttpRequest<'_>,
        ) -> Result<GmailHttpResponse, GmailApiError> {
            assert_eq!(request.bearer_token, "access");
            self.requests
                .lock()
                .unwrap()
                .push((request.url, request.max_response_bytes));
            self.responses
                .lock()
                .unwrap()
                .pop()
                .ok_or(GmailApiError::Network)
        }
    }

    fn json(value: serde_json::Value) -> GmailHttpResponse {
        GmailHttpResponse {
            status: 200,
            body: serde_json::to_vec(&value).unwrap(),
        }
    }

    #[test]
    fn profile_and_message_list_are_validated_and_bounded() {
        let fake = Fake::new(vec![
            json(serde_json::json!({
                "emailAddress":"home@example.com","messagesTotal":12,
                "threadsTotal":7,"historyId":"9001"
            })),
            json(serde_json::json!({
                "messages":[{"id":"msg_1","threadId":"thread_1"}],
                "nextPageToken":"next_1","resultSizeEstimate":1
            })),
        ]);
        let client = GmailApiClient::new("access", &fake).unwrap();
        assert_eq!(client.profile().unwrap().history_id, 9001);
        let page = client
            .list_messages_page(
                Some("has:attachment newer_than:30d"),
                Some("Label_123"),
                Some("page_1"),
                25,
            )
            .unwrap();
        assert_eq!(page.messages[0].id, "msg_1");
        let requests = fake.requests.lock().unwrap();
        assert!(requests[1]
            .0
            .contains("q=has%3Aattachment+newer_than%3A30d"));
        assert!(requests[1].0.contains("pageToken=page_1"));
        assert!(requests[1].0.contains("labelIds=Label_123"));
        assert!(requests[1].0.contains("maxResults=25"));
    }

    #[test]
    fn raw_message_is_base64url_decoded_with_caller_bound() {
        let raw = b"From: sender@example.com\r\nSubject: Statement\r\n\r\nbody";
        let encoded = general_purpose::URL_SAFE_NO_PAD.encode(raw);
        let fake = Fake::new(vec![json(serde_json::json!({
            "id":"msg_1","threadId":"thread_1","historyId":"42",
            "internalDate":"1720000000000","sizeEstimate":raw.len(),"raw":encoded
        }))]);
        let client = GmailApiClient::new("access", &fake).unwrap();
        assert_eq!(client.get_message_raw("msg_1", 1024).unwrap().bytes, raw);

        let encoded = general_purpose::URL_SAFE_NO_PAD.encode([0_u8; 9]);
        assert_eq!(
            decode_raw_message(&encoded, 8),
            Err(GmailApiError::InvalidResponse)
        );
        assert_eq!(
            decode_raw_message("not valid", 128),
            Err(GmailApiError::InvalidResponse)
        );
    }

    #[test]
    fn history_requests_label_scoped_additions_and_removals_and_maps_expired_cursor() {
        let fake = Fake::new(vec![json(serde_json::json!({
            "history":[{
                "id":"101",
                "messagesAdded":[{"message":{"id":"msg_2","threadId":"thread_2"}}],
                "messagesDeleted":[{"message":{"id":"msg_5","threadId":"thread_5"}}],
                "labelsAdded":[{"message":{"id":"msg_3","threadId":"thread_3"},"labelIds":["Label_123"]}],
                "labelsRemoved":[{"message":{"id":"msg_4","threadId":"thread_4"},"labelIds":["Label_123"]}]
            }],
            "nextPageToken":"next_2","historyId":"102"
        }))]);
        let client = GmailApiClient::new("access", &fake).unwrap();
        let page = client
            .list_message_added_history_page(100, Some("Label_123"), Some("page_2"), 50)
            .unwrap();
        assert_eq!(page.history[0].messages_added[0].message.id, "msg_2");
        assert_eq!(page.history[0].messages_deleted[0].message.id, "msg_5");
        assert_eq!(page.history[0].labels_added[0].message.id, "msg_3");
        assert_eq!(page.history[0].labels_removed[0].message.id, "msg_4");
        let url = &fake.requests.lock().unwrap()[0].0;
        assert!(url.contains("historyTypes=messageAdded"));
        assert!(url.contains("historyTypes=messageDeleted"));
        assert!(url.contains("historyTypes=labelAdded"));
        assert!(url.contains("historyTypes=labelRemoved"));
        assert!(url.contains("labelId=Label_123"));
        assert!(url.contains("startHistoryId=100"));

        let expired = Fake::new(vec![GmailHttpResponse {
            status: 404,
            body: b"private provider detail".to_vec(),
        }]);
        assert_eq!(
            GmailApiClient::new("access", &expired)
                .unwrap()
                .list_message_added_history_page(100, Some("Label_123"), None, 50),
            Err(GmailApiError::HistoryCursorExpired)
        );
    }

    #[test]
    fn history_rejects_malformed_remote_removal_events() {
        let fake = Fake::new(vec![json(serde_json::json!({
            "history":[{
                "id":"101",
                "labelsRemoved":[{"message":{"id":"msg_4","threadId":"thread_4"},"labelIds":["invalid label"]}]
            }],
            "historyId":"102"
        }))]);
        assert_eq!(
            GmailApiClient::new("access", &fake)
                .unwrap()
                .list_message_added_history_page(100, Some("Label_123"), None, 50),
            Err(GmailApiError::InvalidResponse)
        );

        let fake = Fake::new(vec![json(serde_json::json!({
            "history":[{
                "id":"101",
                "messagesDeleted":[{"message":{"id":"bad id","threadId":"thread_5"}}]
            }],
            "historyId":"102"
        }))]);
        assert_eq!(
            GmailApiClient::new("access", &fake)
                .unwrap()
                .list_message_added_history_page(100, Some("Label_123"), None, 50),
            Err(GmailApiError::InvalidResponse)
        );
    }

    #[test]
    fn status_errors_are_sanitized_and_operation_aware() {
        for (status, expected) in [
            (401, GmailApiError::ReauthorizationRequired),
            (403, GmailApiError::Forbidden),
            (404, GmailApiError::NotFound),
            (429, GmailApiError::RateLimited),
            (503, GmailApiError::Retryable),
        ] {
            let fake = Fake::new(vec![GmailHttpResponse {
                status,
                body: b"provider detail".to_vec(),
            }]);
            assert_eq!(
                GmailApiClient::new("access", &fake)
                    .unwrap()
                    .get_message_raw("msg_1", 1024),
                Err(expected)
            );
        }
    }

    #[test]
    fn rejects_malformed_inputs_and_provider_pages() {
        let fake = Fake::new(vec![json(serde_json::json!({
            "messages":[],"nextPageToken":"","resultSizeEstimate":0
        }))]);
        let client = GmailApiClient::new("access", &fake).unwrap();
        assert_eq!(
            client.list_messages_page(None, None, None, 25),
            Err(GmailApiError::InvalidResponse)
        );
        assert_eq!(
            client.list_messages_page(Some("\n"), None, None, 25),
            Err(GmailApiError::InvalidInput)
        );
        assert_eq!(
            client.list_messages_page(None, None, None, 501),
            Err(GmailApiError::InvalidInput)
        );
        assert!(GmailApiClient::new("bad token", &fake).is_err());
    }
}
