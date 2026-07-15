//! Small, synchronous relay client used by the background family-delivery poller.
//!
//! The transport is injectable so parsing and pagination can be tested without
//! opening sockets. The production transport deliberately exposes only the four
//! relay operations needed by the poller.

use reqwest::{
    blocking::Client as ReqwestClient,
    header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    Method, StatusCode, Url,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::Read, time::Duration};
use thiserror::Error;
use zeroize::Zeroizing;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_JSON_BYTES: u64 = 256 * 1024;
const MAX_PUBLICATION_BYTES: u64 = 64 * 1024 * 1024;
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 3;
pub const MAX_PUBLICATIONS_PER_POLL: usize = PAGE_SIZE * MAX_PAGES;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum FamilyDeliveryHttpError {
    #[error("relay authentication failed")]
    Authentication,
    #[error("relay is temporarily unavailable")]
    Network,
    #[error("family relay membership is no longer active")]
    MembershipRevoked,
    #[error("relay returned an invalid response")]
    InvalidResponse,
    #[error("downloaded family artifact failed size or digest validation")]
    InvalidArtifact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Put,
}

pub struct HttpRequest<'a> {
    pub method: HttpMethod,
    pub url: String,
    pub bearer_token: &'a str,
    pub json_body: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

pub trait FamilyDeliveryTransport: Send + Sync {
    fn execute(&self, request: HttpRequest<'_>) -> Result<HttpResponse, FamilyDeliveryHttpError>;

    fn download(
        &self,
        request: HttpRequest<'_>,
        max_bytes: u64,
    ) -> Result<HttpResponse, FamilyDeliveryHttpError> {
        let response = self.execute(request)?;
        if response.body.len() as u64 > max_bytes {
            return Err(FamilyDeliveryHttpError::InvalidArtifact);
        }
        Ok(response)
    }
}

#[derive(Debug, Clone)]
pub struct ReqwestTransport {
    client: ReqwestClient,
}

impl ReqwestTransport {
    pub fn new() -> Result<Self, FamilyDeliveryHttpError> {
        let client = ReqwestClient::builder()
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|_| FamilyDeliveryHttpError::Network)?;
        Ok(Self { client })
    }
}

impl FamilyDeliveryTransport for ReqwestTransport {
    fn execute(&self, request: HttpRequest<'_>) -> Result<HttpResponse, FamilyDeliveryHttpError> {
        self.execute_bounded(request, MAX_JSON_BYTES)
    }

    fn download(
        &self,
        request: HttpRequest<'_>,
        max_bytes: u64,
    ) -> Result<HttpResponse, FamilyDeliveryHttpError> {
        self.execute_bounded(request, max_bytes)
    }
}

impl ReqwestTransport {
    fn execute_bounded(
        &self,
        request: HttpRequest<'_>,
        max_bytes: u64,
    ) -> Result<HttpResponse, FamilyDeliveryHttpError> {
        let authorization_text = Zeroizing::new(format!("Bearer {}", request.bearer_token));
        let authorization = HeaderValue::from_str(authorization_text.as_str())
            .map_err(|_| FamilyDeliveryHttpError::Authentication)?;
        let method = match request.method {
            HttpMethod::Get => Method::GET,
            HttpMethod::Put => Method::PUT,
        };
        let mut builder = self
            .client
            .request(method, request.url)
            .header(AUTHORIZATION, authorization)
            .timeout(REQUEST_TIMEOUT);
        if let Some(body) = request.json_body {
            builder = builder.header(CONTENT_TYPE, "application/json").body(body);
        }
        let mut response = builder
            .send()
            .map_err(|_| FamilyDeliveryHttpError::Network)?;
        let status = response.status().as_u16();
        let mut body = Vec::new();
        response
            .by_ref()
            .take(max_bytes + 1)
            .read_to_end(&mut body)
            .map_err(|_| FamilyDeliveryHttpError::Network)?;
        if body.len() as u64 > max_bytes {
            return Err(FamilyDeliveryHttpError::InvalidResponse);
        }
        Ok(HttpResponse { status, body })
    }
}

pub struct FamilyDeliveryHttpClient<T> {
    endpoint: Url,
    bearer_token: Zeroizing<String>,
    transport: T,
}

impl FamilyDeliveryHttpClient<ReqwestTransport> {
    pub fn production(endpoint: &str, bearer_token: &str) -> Result<Self, FamilyDeliveryHttpError> {
        Self::new(endpoint, bearer_token, ReqwestTransport::new()?)
    }
}

impl<T: FamilyDeliveryTransport> FamilyDeliveryHttpClient<T> {
    pub fn new(
        endpoint: &str,
        bearer_token: &str,
        transport: T,
    ) -> Result<Self, FamilyDeliveryHttpError> {
        let mut endpoint =
            Url::parse(endpoint).map_err(|_| FamilyDeliveryHttpError::InvalidResponse)?;
        let local_http = endpoint.scheme() == "http"
            && matches!(endpoint.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
        if endpoint.scheme() != "https" && !local_http {
            return Err(FamilyDeliveryHttpError::InvalidResponse);
        }
        if endpoint.cannot_be_a_base()
            || endpoint.username() != ""
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
            || bearer_token.is_empty()
            || bearer_token.len() > 4096
            || bearer_token.chars().any(char::is_whitespace)
        {
            return Err(FamilyDeliveryHttpError::InvalidResponse);
        }
        endpoint.set_path(&format!("{}/", endpoint.path().trim_end_matches('/')));
        Ok(Self {
            endpoint,
            bearer_token: Zeroizing::new(bearer_token.to_owned()),
            transport,
        })
    }

    pub fn whoami(&self) -> Result<RemoteIdentity, FamilyDeliveryHttpError> {
        let response: WhoamiResponse = self.get_json("v2/whoami")?;
        let membership_ids: HashSet<&str> = response
            .memberships
            .iter()
            .map(|item| item.membership_id.as_str())
            .collect();
        if !valid_id(&response.remote_principal_id)
            || response.memberships.len() > 10_000
            || membership_ids.len() != response.memberships.len()
            || response.memberships.iter().any(|membership| {
                !valid_membership(membership)
                    || membership.state != MembershipState::Active
                    || membership.principal_id != response.remote_principal_id
            })
        {
            return Err(FamilyDeliveryHttpError::InvalidResponse);
        }
        Ok(RemoteIdentity {
            remote_principal_id: response.remote_principal_id,
            memberships: response.memberships,
        })
    }

    pub fn household_members(
        &self,
        household_id: &str,
    ) -> Result<Vec<RemoteMembership>, FamilyDeliveryHttpError> {
        require_id(household_id)?;
        let path = format!("v2/households/{household_id}/members");
        let response: MembersResponse = self.get_json(&path)?;
        let membership_ids: HashSet<&str> = response
            .members
            .iter()
            .map(|item| item.membership_id.as_str())
            .collect();
        if response.members.len() > 10_000
            || membership_ids.len() != response.members.len()
            || response
                .members
                .iter()
                .any(|item| !valid_membership(item) || item.household_id != household_id)
        {
            return Err(FamilyDeliveryHttpError::InvalidResponse);
        }
        Ok(response.members)
    }

    /// Registers `key` only when the active local membership does not already
    /// advertise exactly that key generation and material.
    pub fn ensure_local_encryption_key(
        &self,
        household_id: &str,
        key: &EncryptionPublicIdentity,
    ) -> Result<RemoteMembership, FamilyDeliveryHttpError> {
        require_id(household_id)?;
        if !valid_encryption_identity(key) {
            return Err(FamilyDeliveryHttpError::InvalidResponse);
        }
        let identity = self.whoami()?;
        let local = identity
            .memberships
            .into_iter()
            .find(|item| item.household_id == household_id)
            .ok_or(FamilyDeliveryHttpError::MembershipRevoked)?;
        if local.encryption_key_id.as_deref() == Some(key.key_id.as_str())
            && local.encryption_public_key.as_deref() == Some(key.public_key.as_str())
            && local.encryption_key_generation == key.generation
        {
            return Ok(local);
        }

        let path = format!("v2/households/{household_id}/members/encryption-key");
        let body = serde_json::to_vec(key).map_err(|_| FamilyDeliveryHttpError::InvalidResponse)?;
        let response: EncryptionKeyResponse = self.put_json(&path, body)?;
        let membership = response.membership;
        if !valid_membership(&membership)
            || membership.state != MembershipState::Active
            || membership.household_id != household_id
            || membership.principal_id != identity.remote_principal_id
            || membership.encryption_key_id.as_deref() != Some(key.key_id.as_str())
            || membership.encryption_public_key.as_deref() != Some(key.public_key.as_str())
            || membership.encryption_key_generation != key.generation
        {
            return Err(FamilyDeliveryHttpError::InvalidResponse);
        }
        Ok(membership)
    }

    pub fn list_publications(
        &self,
        household_id: &str,
        after: u64,
        exclude_origin_device_id: &str,
    ) -> Result<PublicationBatch, FamilyDeliveryHttpError> {
        require_id(household_id)?;
        require_id(exclude_origin_device_id)?;
        let mut cursor = after;
        let mut publications = Vec::new();
        for _ in 0..MAX_PAGES {
            let path = format!(
                "v2/households/{household_id}/publications?after={cursor}&excludeOriginDeviceId={exclude_origin_device_id}"
            );
            let page: PublicationsResponse = self.get_json(&path)?;
            let next_cursor = page
                .next_cursor
                .parse::<u64>()
                .map_err(|_| FamilyDeliveryHttpError::InvalidResponse)?;
            if page.publications.len() > PAGE_SIZE
                || next_cursor < cursor
                || page
                    .publications
                    .windows(2)
                    .any(|pair| pair[0].sequence >= pair[1].sequence)
                || page.publications.iter().any(|publication| {
                    !valid_publication(publication)
                        || publication.household_id != household_id
                        || publication.sequence <= cursor
                        || publication.sequence > next_cursor
                })
            {
                return Err(FamilyDeliveryHttpError::InvalidResponse);
            }
            publications.extend(page.publications);
            if publications.len() > MAX_PUBLICATIONS_PER_POLL {
                return Err(FamilyDeliveryHttpError::InvalidResponse);
            }
            if next_cursor == cursor {
                break;
            }
            cursor = next_cursor;
        }
        Ok(PublicationBatch {
            publications,
            next_cursor: cursor,
        })
    }

    pub fn download_publication(
        &self,
        household_id: &str,
        publication_id: &str,
        expected_size: u64,
        expected_sha256: &str,
    ) -> Result<Vec<u8>, FamilyDeliveryHttpError> {
        require_id(household_id)?;
        require_id(publication_id)?;
        if !(1..=MAX_PUBLICATION_BYTES).contains(&expected_size) || !valid_hash(expected_sha256) {
            return Err(FamilyDeliveryHttpError::InvalidResponse);
        }
        let path = format!("v2/households/{household_id}/publications/{publication_id}");
        let url = self
            .endpoint
            .join(&path)
            .map_err(|_| FamilyDeliveryHttpError::InvalidResponse)?;
        let response = self
            .transport
            .download(
                HttpRequest {
                    method: HttpMethod::Get,
                    url: url.into(),
                    bearer_token: self.bearer_token.as_str(),
                    json_body: None,
                },
                expected_size,
            )
            .map_err(|error| match error {
                FamilyDeliveryHttpError::InvalidResponse => {
                    FamilyDeliveryHttpError::InvalidArtifact
                }
                other => other,
            })?;
        if !(200..300).contains(&response.status) {
            return Err(map_failure(response.status, &response.body));
        }
        if response.body.len() as u64 != expected_size
            || format!("{:x}", Sha256::digest(&response.body)) != expected_sha256
        {
            return Err(FamilyDeliveryHttpError::InvalidArtifact);
        }
        Ok(response.body)
    }

    fn get_json<R: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
    ) -> Result<R, FamilyDeliveryHttpError> {
        self.request_json(HttpMethod::Get, path, None)
    }

    fn put_json<R: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: Vec<u8>,
    ) -> Result<R, FamilyDeliveryHttpError> {
        self.request_json(HttpMethod::Put, path, Some(body))
    }

    fn request_json<R: for<'de> Deserialize<'de>>(
        &self,
        method: HttpMethod,
        path: &str,
        json_body: Option<Vec<u8>>,
    ) -> Result<R, FamilyDeliveryHttpError> {
        let url = self
            .endpoint
            .join(path)
            .map_err(|_| FamilyDeliveryHttpError::InvalidResponse)?;
        let response = self.transport.execute(HttpRequest {
            method,
            url: url.into(),
            bearer_token: self.bearer_token.as_str(),
            json_body,
        })?;
        if !(200..300).contains(&response.status) {
            return Err(map_failure(response.status, &response.body));
        }
        serde_json::from_slice(&response.body).map_err(|_| FamilyDeliveryHttpError::InvalidResponse)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteIdentity {
    pub remote_principal_id: String,
    pub memberships: Vec<RemoteMembership>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EncryptionPublicIdentity {
    pub key_id: String,
    pub public_key: String,
    pub generation: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MembershipRole {
    Owner,
    Member,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MembershipState {
    Active,
    Revoked,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteMembership {
    pub membership_id: String,
    pub household_id: String,
    pub principal_id: String,
    pub domain_member_id: String,
    pub role: MembershipRole,
    pub state: MembershipState,
    pub generation: u64,
    pub encryption_key_id: Option<String>,
    pub encryption_public_key: Option<String>,
    pub encryption_key_generation: u64,
    pub encryption_key_updated_at: Option<String>,
    pub joined_at: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AudienceVisibility {
    Shared,
    Personal,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationAudience {
    pub visibility: AudienceVisibility,
    pub member_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ArtifactSchema {
    FamilyAudiencePartitionV1,
    FamilyAudiencePartitionV2,
    FamilyAudiencePartitionV3,
    FamilyAudiencePartitionV4,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemotePublication {
    pub sequence: u64,
    pub publication_id: String,
    pub digest: String,
    pub household_id: String,
    pub origin_device_id: String,
    pub audience: PublicationAudience,
    pub artifact_schema: ArtifactSchema,
    pub envelope_schema: Option<String>,
    pub recipient_set_digest: Option<String>,
    pub inner_digest: Option<String>,
    pub sender_principal_id: String,
    pub sender_membership_id: String,
    pub recipient_count: u64,
    pub byte_size: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationBatch {
    pub publications: Vec<RemotePublication>,
    pub next_cursor: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WhoamiResponse {
    remote_principal_id: String,
    memberships: Vec<RemoteMembership>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MembersResponse {
    members: Vec<RemoteMembership>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EncryptionKeyResponse {
    membership: RemoteMembership,
    #[serde(rename = "updated")]
    _updated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PublicationsResponse {
    publications: Vec<RemotePublication>,
    next_cursor: String,
}

#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: String,
}

fn map_failure(status: u16, body: &[u8]) -> FamilyDeliveryHttpError {
    if status == StatusCode::UNAUTHORIZED.as_u16() {
        return FamilyDeliveryHttpError::Authentication;
    }
    if (500..=599).contains(&status) {
        return FamilyDeliveryHttpError::Network;
    }
    let code = serde_json::from_slice::<ErrorResponse>(body)
        .map(|value| value.error)
        .unwrap_or_default();
    if matches!(
        code.as_str(),
        "ACTIVE_MEMBERSHIP_REQUIRED" | "HOUSEHOLD_NOT_FOUND" | "MEMBERSHIP_NOT_FOUND"
    ) {
        FamilyDeliveryHttpError::MembershipRevoked
    } else {
        FamilyDeliveryHttpError::InvalidResponse
    }
}

fn require_id(value: &str) -> Result<(), FamilyDeliveryHttpError> {
    if valid_id(value) {
        Ok(())
    } else {
        Err(FamilyDeliveryHttpError::InvalidResponse)
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.:-".contains(&byte))
}

fn valid_membership_id(value: &str) -> bool {
    value.strip_prefix("membership-").is_some_and(|suffix| {
        !suffix.is_empty()
            && !suffix.starts_with('0')
            && suffix.bytes().all(|byte| byte.is_ascii_digit())
    })
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_public_key(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_timestamp(value: &str) -> bool {
    value.len() >= 20
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value.as_bytes().get(10) == Some(&b'T')
        && (value.ends_with('Z')
            || value
                .get(19..)
                .is_some_and(|suffix| suffix.contains('+') || suffix.contains('-')))
}

fn valid_encryption_identity(value: &EncryptionPublicIdentity) -> bool {
    valid_hash(&value.key_id) && valid_public_key(&value.public_key) && value.generation > 0
}

fn valid_membership(value: &RemoteMembership) -> bool {
    let key_is_complete = match (
        value.encryption_key_id.as_deref(),
        value.encryption_public_key.as_deref(),
        value.encryption_key_updated_at.as_deref(),
    ) {
        (None, None, None) => value.encryption_key_generation == 0,
        (Some(key_id), Some(public_key), Some(updated_at)) => {
            value.encryption_key_generation > 0
                && valid_hash(key_id)
                && valid_public_key(public_key)
                && valid_timestamp(updated_at)
        }
        _ => false,
    };
    valid_membership_id(&value.membership_id)
        && valid_id(&value.household_id)
        && valid_id(&value.principal_id)
        && valid_id(&value.domain_member_id)
        && value.generation > 0
        && valid_timestamp(&value.joined_at)
        && value.revoked_at.as_deref().is_none_or(valid_timestamp)
        && ((value.state == MembershipState::Active && value.revoked_at.is_none())
            || (value.state == MembershipState::Revoked && value.revoked_at.is_some()))
        && key_is_complete
}

fn valid_publication(value: &RemotePublication) -> bool {
    let envelope_is_complete = match (
        value.envelope_schema.as_deref(),
        value.recipient_set_digest.as_deref(),
        value.inner_digest.as_deref(),
    ) {
        (None, None, None) => true,
        (Some("FAMILY_ENCRYPTED_ENVELOPE_V1"), Some(recipient), Some(inner)) => {
            valid_hash(recipient) && valid_hash(inner)
        }
        _ => false,
    };
    value.sequence > 0
        && valid_id(&value.publication_id)
        && valid_hash(&value.digest)
        && valid_id(&value.household_id)
        && valid_id(&value.origin_device_id)
        && valid_id(&value.sender_principal_id)
        && valid_membership_id(&value.sender_membership_id)
        && (1..=10_000).contains(&value.recipient_count)
        && (1..=MAX_PUBLICATION_BYTES).contains(&value.byte_size)
        && valid_timestamp(&value.created_at)
        && match value.audience.visibility {
            AudienceVisibility::Shared => value.audience.member_id.is_none(),
            AudienceVisibility::Personal => {
                value.audience.member_id.as_deref().is_some_and(valid_id)
            }
        }
        && envelope_is_complete
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, sync::Mutex};

    type RecordedRequest = (HttpMethod, String, Option<Vec<u8>>);

    #[derive(Debug)]
    struct FakeTransport {
        responses: Mutex<VecDeque<Result<HttpResponse, FamilyDeliveryHttpError>>>,
        requests: Mutex<Vec<RecordedRequest>>,
    }

    impl FakeTransport {
        fn new(responses: Vec<HttpResponse>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().map(Ok).collect()),
                requests: Mutex::new(Vec::new()),
            }
        }
    }

    impl FamilyDeliveryTransport for FakeTransport {
        fn execute(
            &self,
            request: HttpRequest<'_>,
        ) -> Result<HttpResponse, FamilyDeliveryHttpError> {
            self.requests
                .lock()
                .unwrap()
                .push((request.method, request.url, request.json_body));
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected request")
        }
    }

    fn response(value: serde_json::Value) -> HttpResponse {
        HttpResponse {
            status: 200,
            body: serde_json::to_vec(&value).unwrap(),
        }
    }

    fn membership_json(keyed: bool) -> serde_json::Value {
        let mut value = serde_json::json!({
            "membershipId": "membership-1",
            "householdId": "family",
            "principalId": "principal-1",
            "domainMemberId": "member-taro",
            "role": "OWNER",
            "state": "ACTIVE",
            "generation": 1,
            "encryptionKeyId": null,
            "encryptionPublicKey": null,
            "encryptionKeyGeneration": 0,
            "encryptionKeyUpdatedAt": null,
            "joinedAt": "2026-07-14T00:00:00.000Z",
            "revokedAt": null
        });
        if keyed {
            value["encryptionKeyId"] = serde_json::json!("a".repeat(64));
            value["encryptionPublicKey"] = serde_json::json!("A".repeat(43));
            value["encryptionKeyGeneration"] = serde_json::json!(1);
            value["encryptionKeyUpdatedAt"] = serde_json::json!("2026-07-14T01:00:00.000Z");
        }
        value
    }

    fn publication(sequence: u64) -> serde_json::Value {
        serde_json::json!({
            "sequence": sequence,
            "publicationId": format!("publication-{sequence}"),
            "digest": "b".repeat(64),
            "householdId": "family",
            "originDeviceId": "device-other",
            "audience": { "visibility": "SHARED", "memberId": null },
            "artifactSchema": "FAMILY_AUDIENCE_PARTITION_V4",
            "envelopeSchema": "FAMILY_ENCRYPTED_ENVELOPE_V1",
            "recipientSetDigest": "c".repeat(64),
            "innerDigest": "d".repeat(64),
            "senderPrincipalId": "principal-2",
            "senderMembershipId": "membership-2",
            "recipientCount": 1,
            "byteSize": 123,
            "createdAt": "2026-07-14T02:00:00.000Z"
        })
    }

    #[test]
    fn strictly_parses_whoami_and_member_key_fields() {
        let transport = FakeTransport::new(vec![response(serde_json::json!({
            "remotePrincipalId": "principal-1",
            "memberships": [membership_json(true)]
        }))]);
        let client =
            FamilyDeliveryHttpClient::new("https://relay.example", "token", transport).unwrap();
        let identity = client.whoami().unwrap();
        assert_eq!(identity.remote_principal_id, "principal-1");
        assert_eq!(identity.memberships[0].encryption_key_generation, 1);
    }

    #[test]
    fn loads_active_and_revoked_household_members() {
        let mut revoked = membership_json(false);
        revoked["membershipId"] = serde_json::json!("membership-2");
        revoked["principalId"] = serde_json::json!("principal-2");
        revoked["state"] = serde_json::json!("REVOKED");
        revoked["revokedAt"] = serde_json::json!("2026-07-14T03:00:00.000Z");
        let transport = FakeTransport::new(vec![response(serde_json::json!({
            "members": [membership_json(false), revoked]
        }))]);
        let client =
            FamilyDeliveryHttpClient::new("https://relay.example", "token", transport).unwrap();
        let members = client.household_members("family").unwrap();
        assert_eq!(members.len(), 2);
        assert_eq!(members[1].state, MembershipState::Revoked);
        assert!(client.transport.requests.lock().unwrap()[0]
            .1
            .ends_with("/v2/households/family/members"));
    }

    #[test]
    fn skips_key_put_when_remote_key_is_current() {
        let transport = FakeTransport::new(vec![response(serde_json::json!({
            "remotePrincipalId": "principal-1",
            "memberships": [membership_json(true)]
        }))]);
        let client =
            FamilyDeliveryHttpClient::new("https://relay.example", "token", transport).unwrap();
        let key = EncryptionPublicIdentity {
            key_id: "a".repeat(64),
            public_key: "A".repeat(43),
            generation: 1,
        };
        let membership = client.ensure_local_encryption_key("family", &key).unwrap();
        assert_eq!(
            membership.encryption_key_id.as_deref(),
            Some(key.key_id.as_str())
        );
        assert_eq!(client.transport.requests.lock().unwrap().len(), 1);
    }

    #[test]
    fn puts_changed_key_and_validates_returned_membership() {
        let keyed = membership_json(true);
        let transport = FakeTransport::new(vec![
            response(serde_json::json!({
                "remotePrincipalId": "principal-1", "memberships": [membership_json(false)]
            })),
            response(serde_json::json!({ "membership": keyed, "updated": true })),
        ]);
        let client =
            FamilyDeliveryHttpClient::new("https://relay.example", "token", transport).unwrap();
        let key = EncryptionPublicIdentity {
            key_id: "a".repeat(64),
            public_key: "A".repeat(43),
            generation: 1,
        };
        client.ensure_local_encryption_key("family", &key).unwrap();
        let requests = client.transport.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[1].0, HttpMethod::Put);
        assert!(requests[1]
            .1
            .ends_with("/v2/households/family/members/encryption-key"));
    }

    #[test]
    fn publication_poll_is_bounded_to_three_pages_and_three_hundred_items() {
        let pages = (0..3).map(|page| {
            let start = page * PAGE_SIZE + 1;
            response(serde_json::json!({
                "publications": (start..start + PAGE_SIZE).map(|sequence| publication(sequence as u64)).collect::<Vec<_>>(),
                "nextCursor": ((page + 1) * PAGE_SIZE).to_string()
            }))
        }).collect();
        let client = FamilyDeliveryHttpClient::new(
            "https://relay.example",
            "token",
            FakeTransport::new(pages),
        )
        .unwrap();
        let batch = client
            .list_publications("family", 0, "device-local")
            .unwrap();
        assert_eq!(batch.publications.len(), MAX_PUBLICATIONS_PER_POLL);
        assert_eq!(batch.next_cursor, 300);
        assert_eq!(client.transport.requests.lock().unwrap().len(), 3);
    }

    #[test]
    fn publication_download_requires_exact_size_and_sha256() {
        let bytes = b"encrypted-envelope".to_vec();
        let digest = format!("{:x}", Sha256::digest(&bytes));
        let client = FamilyDeliveryHttpClient::new(
            "https://relay.example",
            "token",
            FakeTransport::new(vec![HttpResponse {
                status: 200,
                body: bytes.clone(),
            }]),
        )
        .unwrap();
        assert_eq!(
            client
                .download_publication("family", "publication-1", bytes.len() as u64, &digest)
                .unwrap(),
            bytes
        );

        let client = FamilyDeliveryHttpClient::new(
            "https://relay.example",
            "token",
            FakeTransport::new(vec![HttpResponse {
                status: 200,
                body: b"wrong".to_vec(),
            }]),
        )
        .unwrap();
        assert_eq!(
            client.download_publication("family", "publication-1", 5, &digest),
            Err(FamilyDeliveryHttpError::InvalidArtifact)
        );
    }

    #[test]
    fn rejects_unknown_response_fields_and_non_monotonic_cursor() {
        let transport = FakeTransport::new(vec![response(serde_json::json!({
            "publications": [], "nextCursor": "4", "unexpected": true
        }))]);
        let client =
            FamilyDeliveryHttpClient::new("https://relay.example", "token", transport).unwrap();
        assert_eq!(
            client.list_publications("family", 5, "device-local"),
            Err(FamilyDeliveryHttpError::InvalidResponse)
        );
    }

    #[test]
    fn maps_auth_network_and_revoked_without_exposing_server_text() {
        let auth = FakeTransport::new(vec![HttpResponse {
            status: 401,
            body: b"secret".to_vec(),
        }]);
        let client = FamilyDeliveryHttpClient::new("https://relay.example", "token", auth).unwrap();
        assert_eq!(
            client.whoami(),
            Err(FamilyDeliveryHttpError::Authentication)
        );

        let revoked = FakeTransport::new(vec![HttpResponse {
            status: 404,
            body: br#"{"error":"HOUSEHOLD_NOT_FOUND","detail":"secret"}"#.to_vec(),
        }]);
        let client =
            FamilyDeliveryHttpClient::new("https://relay.example", "token", revoked).unwrap();
        assert_eq!(
            client.household_members("family"),
            Err(FamilyDeliveryHttpError::MembershipRevoked)
        );
        assert_eq!(
            FamilyDeliveryHttpError::Network.to_string(),
            "relay is temporarily unavailable"
        );

        let server = FakeTransport::new(vec![HttpResponse {
            status: 503,
            body: b"maintenance".to_vec(),
        }]);
        let client =
            FamilyDeliveryHttpClient::new("https://relay.example", "token", server).unwrap();
        assert_eq!(client.whoami(), Err(FamilyDeliveryHttpError::Network));
    }
}
