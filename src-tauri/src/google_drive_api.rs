//! Bounded, injectable Google Drive v3 read-only client.

use reqwest::{
    blocking::Client as ReqwestClient,
    header::{HeaderName, HeaderValue, AUTHORIZATION},
    Method, Url,
};
use serde::Deserialize;
use std::{io::Read, time::Duration};
use thiserror::Error;
use zeroize::Zeroizing;

const API_ROOT: &str = "https://www.googleapis.com/drive/v3/";
const MAX_JSON_BYTES: u64 = 512 * 1024;
pub const MAX_DOWNLOAD_BYTES: u64 = 50 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
const RESOURCE_KEYS: HeaderName = HeaderName::from_static("x-goog-drive-resource-keys");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum DriveApiError {
    #[error("Google Drive authorization expired")]
    ReauthorizationRequired,
    #[error("Google Drive access was denied")]
    Forbidden,
    #[error("Google Drive item was not found")]
    NotFound,
    #[error("Google Drive request was rate limited")]
    RateLimited,
    #[error("Google Drive is temporarily unavailable")]
    Retryable,
    #[error("Google Drive network request failed")]
    Network,
    #[error("Google Drive returned an invalid response")]
    InvalidResponse,
    #[error("Google Drive request input is invalid")]
    InvalidInput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriveHttpMethod {
    Get,
}

pub struct DriveHttpRequest<'a> {
    pub method: DriveHttpMethod,
    pub url: String,
    pub bearer_token: &'a str,
    pub resource_key_header: Option<String>,
    pub max_response_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveHttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

pub trait DriveTransport: Send + Sync {
    fn execute(&self, request: DriveHttpRequest<'_>) -> Result<DriveHttpResponse, DriveApiError>;
}

#[derive(Clone, Debug)]
pub struct ReqwestDriveTransport {
    client: ReqwestClient,
}

impl ReqwestDriveTransport {
    pub fn new() -> Result<Self, DriveApiError> {
        Ok(Self {
            client: ReqwestClient::builder()
                .connect_timeout(TIMEOUT)
                .timeout(TIMEOUT)
                .build()
                .map_err(|_| DriveApiError::Network)?,
        })
    }
}

impl DriveTransport for ReqwestDriveTransport {
    fn execute(&self, request: DriveHttpRequest<'_>) -> Result<DriveHttpResponse, DriveApiError> {
        let authorization = Zeroizing::new(format!("Bearer {}", request.bearer_token));
        let authorization =
            HeaderValue::from_str(&authorization).map_err(|_| DriveApiError::InvalidInput)?;
        let method = match request.method {
            DriveHttpMethod::Get => Method::GET,
        };
        let mut builder = self
            .client
            .request(method, &request.url)
            .header(AUTHORIZATION, authorization);
        if let Some(value) = request.resource_key_header {
            builder = builder.header(
                RESOURCE_KEYS.clone(),
                HeaderValue::from_str(&value).map_err(|_| DriveApiError::InvalidInput)?,
            );
        }
        let mut response = builder.send().map_err(|_| DriveApiError::Network)?;
        let status = response.status().as_u16();
        let mut body = Vec::new();
        response
            .by_ref()
            .take(request.max_response_bytes + 1)
            .read_to_end(&mut body)
            .map_err(|_| DriveApiError::Network)?;
        if body.len() as u64 > request.max_response_bytes {
            return Err(DriveApiError::InvalidResponse);
        }
        Ok(DriveHttpResponse { status, body })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    #[serde(default)]
    pub parents: Vec<String>,
    pub modified_time: Option<String>,
    #[serde(default, deserialize_with = "optional_u64_string")]
    pub size: Option<u64>,
    pub md5_checksum: Option<String>,
    #[serde(default, deserialize_with = "optional_u64_string")]
    pub version: Option<u64>,
    #[serde(default)]
    pub trashed: bool,
    pub drive_id: Option<String>,
    #[serde(default)]
    pub capabilities: DriveCapabilities,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveCapabilities {
    #[serde(default)]
    pub can_download: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveFilePage {
    pub files: Vec<DriveFile>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveChange {
    pub file_id: String,
    #[serde(default)]
    pub removed: bool,
    pub file: Option<DriveFile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveChangePage {
    pub changes: Vec<DriveChange>,
    pub next_page_token: Option<String>,
    pub new_start_page_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveUser {
    pub permission_id: String,
    pub email_address: String,
    pub display_name: String,
}

pub struct DriveApiClient<T> {
    access_token: Zeroizing<String>,
    transport: T,
}

impl DriveApiClient<ReqwestDriveTransport> {
    pub fn production(access_token: &str) -> Result<Self, DriveApiError> {
        Self::new(access_token, ReqwestDriveTransport::new()?)
    }
}

impl<T: DriveTransport> DriveApiClient<T> {
    pub fn new(access_token: &str, transport: T) -> Result<Self, DriveApiError> {
        validate_token(access_token)?;
        Ok(Self {
            access_token: Zeroizing::new(access_token.to_owned()),
            transport,
        })
    }

    pub fn file_metadata(
        &self,
        file_id: &str,
        resource_key: Option<&str>,
    ) -> Result<DriveFile, DriveApiError> {
        validate_id(file_id)?;
        let mut url = api_url(&format!("files/{file_id}"))?;
        append_common_file_params(&mut url);
        self.get_json(url, resource_header(file_id, resource_key)?)
    }

    pub fn about_user(&self) -> Result<DriveUser, DriveApiError> {
        let mut url = api_url("about")?;
        url.query_pairs_mut()
            .append_pair("fields", "user(permissionId,emailAddress,displayName)");
        let wire: AboutWire = self.get_json(url, None)?;
        if validate_id(&wire.user.permission_id).is_err()
            || !valid_email(&wire.user.email_address)
            || wire.user.display_name.trim().is_empty()
            || wire.user.display_name.len() > 256
            || wire.user.display_name.chars().any(char::is_control)
        {
            return Err(DriveApiError::InvalidResponse);
        }
        Ok(wire.user)
    }

    pub fn list_children_page(
        &self,
        folder_id: &str,
        drive_id: Option<&str>,
        page_token: Option<&str>,
        page_size: u16,
        resource_key: Option<&str>,
    ) -> Result<DriveFilePage, DriveApiError> {
        validate_id(folder_id)?;
        validate_optional_id(drive_id)?;
        validate_page(page_token, page_size)?;
        let mut url = api_url("files")?;
        {
            let mut q = url.query_pairs_mut();
            q.append_pair(
                "q",
                &format!("'{folder_id}' in parents and trashed = false"),
            )
            .append_pair("pageSize", &page_size.to_string())
            .append_pair("supportsAllDrives", "true")
            .append_pair("includeItemsFromAllDrives", "true")
            .append_pair("fields", &format!("nextPageToken,files({})", file_fields()));
            if let Some(token) = page_token {
                q.append_pair("pageToken", token);
            }
            if let Some(drive) = drive_id {
                q.append_pair("corpora", "drive")
                    .append_pair("driveId", drive);
            }
        }
        let wire: FileListWire = self.get_json(url, resource_header(folder_id, resource_key)?)?;
        validate_page_token(wire.next_page_token.as_deref())?;
        if wire.files.len() > usize::from(page_size) || wire.files.iter().any(|f| !valid_file(f)) {
            return Err(DriveApiError::InvalidResponse);
        }
        Ok(DriveFilePage {
            files: wire.files,
            next_page_token: wire.next_page_token,
        })
    }

    pub fn start_page_token(&self, drive_id: Option<&str>) -> Result<String, DriveApiError> {
        validate_optional_id(drive_id)?;
        let mut url = api_url("changes/startPageToken")?;
        url.query_pairs_mut()
            .append_pair("supportsAllDrives", "true");
        if let Some(drive) = drive_id {
            url.query_pairs_mut().append_pair("driveId", drive);
        }
        let wire: StartTokenWire = self.get_json(url, None)?;
        validate_page_token(Some(&wire.start_page_token))?;
        Ok(wire.start_page_token)
    }

    pub fn list_changes_page(
        &self,
        page_token: &str,
        drive_id: Option<&str>,
        page_size: u16,
    ) -> Result<DriveChangePage, DriveApiError> {
        validate_page(Some(page_token), page_size)?;
        validate_optional_id(drive_id)?;
        let mut url = api_url("changes")?;
        {
            let mut q = url.query_pairs_mut();
            q.append_pair("pageToken", page_token)
                .append_pair("pageSize", &page_size.to_string())
                .append_pair("includeRemoved", "true")
                .append_pair("supportsAllDrives", "true")
                .append_pair("includeItemsFromAllDrives", "true")
                .append_pair(
                    "fields",
                    &format!(
                        "nextPageToken,newStartPageToken,changes(fileId,removed,file({}))",
                        file_fields()
                    ),
                );
            if let Some(drive) = drive_id {
                q.append_pair("driveId", drive);
            }
        }
        let wire: ChangeListWire = self.get_json(url, None)?;
        validate_page_token(wire.next_page_token.as_deref())?;
        validate_page_token(wire.new_start_page_token.as_deref())?;
        if wire.changes.len() > usize::from(page_size)
            || wire.changes.iter().any(|change| {
                validate_id(&change.file_id).is_err()
                    || (!change.removed && change.file.as_ref().is_none_or(|f| !valid_file(f)))
            })
        {
            return Err(DriveApiError::InvalidResponse);
        }
        Ok(DriveChangePage {
            changes: wire.changes,
            next_page_token: wire.next_page_token,
            new_start_page_token: wire.new_start_page_token,
        })
    }

    pub fn download(
        &self,
        file_id: &str,
        resource_key: Option<&str>,
        max_bytes: u64,
    ) -> Result<Vec<u8>, DriveApiError> {
        validate_id(file_id)?;
        if max_bytes == 0 || max_bytes > MAX_DOWNLOAD_BYTES {
            return Err(DriveApiError::InvalidInput);
        }
        let mut url = api_url(&format!("files/{file_id}"))?;
        url.query_pairs_mut()
            .append_pair("alt", "media")
            .append_pair("supportsAllDrives", "true");
        self.execute(url, resource_header(file_id, resource_key)?, max_bytes)
    }

    fn get_json<R: for<'de> Deserialize<'de>>(
        &self,
        url: Url,
        resource_key_header: Option<String>,
    ) -> Result<R, DriveApiError> {
        let body = self.execute(url, resource_key_header, MAX_JSON_BYTES)?;
        serde_json::from_slice(&body).map_err(|_| DriveApiError::InvalidResponse)
    }

    fn execute(
        &self,
        url: Url,
        resource_key_header: Option<String>,
        max_response_bytes: u64,
    ) -> Result<Vec<u8>, DriveApiError> {
        let response = self.transport.execute(DriveHttpRequest {
            method: DriveHttpMethod::Get,
            url: url.into(),
            bearer_token: &self.access_token,
            resource_key_header,
            max_response_bytes,
        })?;
        match response.status {
            200..=299 => Ok(response.body),
            401 => Err(DriveApiError::ReauthorizationRequired),
            403 => Err(DriveApiError::Forbidden),
            404 => Err(DriveApiError::NotFound),
            429 => Err(DriveApiError::RateLimited),
            500..=599 => Err(DriveApiError::Retryable),
            _ => Err(DriveApiError::InvalidResponse),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileListWire {
    #[serde(default)]
    files: Vec<DriveFile>,
    next_page_token: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeListWire {
    #[serde(default)]
    changes: Vec<DriveChange>,
    next_page_token: Option<String>,
    new_start_page_token: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartTokenWire {
    start_page_token: String,
}
#[derive(Deserialize)]
struct AboutWire {
    user: DriveUser,
}

fn api_url(path: &str) -> Result<Url, DriveApiError> {
    Url::parse(API_ROOT)
        .and_then(|base| base.join(path))
        .map_err(|_| DriveApiError::InvalidInput)
}
fn file_fields() -> &'static str {
    "id,name,mimeType,parents,modifiedTime,size,md5Checksum,version,trashed,driveId,capabilities(canDownload)"
}
fn append_common_file_params(url: &mut Url) {
    url.query_pairs_mut()
        .append_pair("supportsAllDrives", "true")
        .append_pair("fields", file_fields());
}
fn resource_header(file_id: &str, key: Option<&str>) -> Result<Option<String>, DriveApiError> {
    let Some(key) = key else { return Ok(None) };
    validate_resource_key(key)?;
    Ok(Some(format!("{file_id}/{key}")))
}
fn validate_token(value: &str) -> Result<(), DriveApiError> {
    if value.is_empty()
        || value.len() > 16_384
        || value
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
    {
        Err(DriveApiError::InvalidInput)
    } else {
        Ok(())
    }
}
fn validate_id(value: &str) -> Result<(), DriveApiError> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        Err(DriveApiError::InvalidInput)
    } else {
        Ok(())
    }
}
fn validate_optional_id(value: Option<&str>) -> Result<(), DriveApiError> {
    value.map_or(Ok(()), validate_id)
}
fn validate_resource_key(value: &str) -> Result<(), DriveApiError> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        Err(DriveApiError::InvalidInput)
    } else {
        Ok(())
    }
}
fn validate_page(token: Option<&str>, size: u16) -> Result<(), DriveApiError> {
    if !(1..=1000).contains(&size) {
        return Err(DriveApiError::InvalidInput);
    }
    validate_page_token(token)
}
fn validate_page_token(token: Option<&str>) -> Result<(), DriveApiError> {
    if token.is_some_and(|v| v.is_empty() || v.len() > 8192 || v.chars().any(char::is_control)) {
        Err(DriveApiError::InvalidResponse)
    } else {
        Ok(())
    }
}
fn valid_file(file: &DriveFile) -> bool {
    validate_id(&file.id).is_ok()
        && !file.name.trim().is_empty()
        && file.name.len() <= 255
        && file.mime_type.len() <= 127
        && !file.mime_type.is_empty()
        && file.parents.len() <= 100
        && file.parents.iter().all(|p| validate_id(p).is_ok())
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
fn optional_u64_string<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    Option::<String>::deserialize(d)?
        .map(|v| v.parse().map_err(serde::de::Error::custom))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Fake {
        responses: Mutex<Vec<DriveHttpResponse>>,
        requests: Mutex<Vec<(String, Option<String>, u64)>>,
    }
    impl Fake {
        fn new(responses: Vec<DriveHttpResponse>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().rev().collect()),
                requests: Mutex::new(vec![]),
            }
        }
    }
    impl DriveTransport for &Fake {
        fn execute(&self, r: DriveHttpRequest<'_>) -> Result<DriveHttpResponse, DriveApiError> {
            assert_eq!(r.bearer_token, "access");
            self.requests.lock().unwrap().push((
                r.url,
                r.resource_key_header,
                r.max_response_bytes,
            ));
            self.responses
                .lock()
                .unwrap()
                .pop()
                .ok_or(DriveApiError::Network)
        }
    }
    fn json(value: serde_json::Value) -> DriveHttpResponse {
        DriveHttpResponse {
            status: 200,
            body: serde_json::to_vec(&value).unwrap(),
        }
    }

    #[test]
    fn metadata_carries_resource_key_without_token_in_url() {
        let fake = Fake::new(vec![json(
            serde_json::json!({"id":"file_1","name":"Folder","mimeType":"application/vnd.google-apps.folder","version":"7"}),
        )]);
        let client = DriveApiClient::new("access", &fake).unwrap();
        assert_eq!(
            client
                .file_metadata("file_1", Some("resource_1"))
                .unwrap()
                .version,
            Some(7)
        );
        let req = fake.requests.lock().unwrap();
        assert_eq!(req[0].1.as_deref(), Some("file_1/resource_1"));
        assert!(!req[0].0.contains("access"));
    }

    #[test]
    fn about_user_returns_bounded_identity() {
        let fake = Fake::new(vec![json(serde_json::json!({"user": {
            "permissionId": "permission_1",
            "emailAddress": "home@example.com",
            "displayName": "Home"
        }}))]);
        let client = DriveApiClient::new("access", &fake).unwrap();
        let user = client.about_user().unwrap();
        assert_eq!(user.permission_id, "permission_1");
        assert_eq!(user.email_address, "home@example.com");
        let requests = fake.requests.lock().unwrap();
        assert!(requests[0]
            .0
            .contains("fields=user%28permissionId%2CemailAddress%2CdisplayName%29"));
    }

    #[test]
    fn children_and_changes_encode_pagination_and_shared_drive() {
        let fake = Fake::new(vec![
            json(serde_json::json!({"files":[],"nextPageToken":"next"})),
            json(
                serde_json::json!({"changes":[{"fileId":"gone_1","removed":true}],"newStartPageToken":"terminal"}),
            ),
        ]);
        let client = DriveApiClient::new("access", &fake).unwrap();
        assert_eq!(
            client
                .list_children_page("root_1", Some("drive_1"), Some("page_1"), 100, None)
                .unwrap()
                .next_page_token
                .as_deref(),
            Some("next")
        );
        assert_eq!(
            client
                .list_changes_page("next", Some("drive_1"), 100)
                .unwrap()
                .new_start_page_token
                .as_deref(),
            Some("terminal")
        );
        let req = fake.requests.lock().unwrap();
        assert!(req[0].0.contains("driveId=drive_1") && req[0].0.contains("pageToken=page_1"));
        assert!(req[1].0.contains("includeRemoved=true"));
    }

    #[test]
    fn start_token_and_download_are_bounded() {
        let fake = Fake::new(vec![
            json(serde_json::json!({"startPageToken":"start"})),
            DriveHttpResponse {
                status: 200,
                body: b"bytes".to_vec(),
            },
        ]);
        let client = DriveApiClient::new("access", &fake).unwrap();
        assert_eq!(client.start_page_token(None).unwrap(), "start");
        assert_eq!(client.download("file_1", None, 1024).unwrap(), b"bytes");
        assert_eq!(fake.requests.lock().unwrap()[1].2, 1024);
        assert_eq!(
            client.download("file_1", None, MAX_DOWNLOAD_BYTES + 1),
            Err(DriveApiError::InvalidInput)
        );
    }

    #[test]
    fn status_errors_are_sanitized_and_classified() {
        for (status, expected) in [
            (401, DriveApiError::ReauthorizationRequired),
            (403, DriveApiError::Forbidden),
            (404, DriveApiError::NotFound),
            (429, DriveApiError::RateLimited),
            (503, DriveApiError::Retryable),
        ] {
            let fake = Fake::new(vec![DriveHttpResponse {
                status,
                body: b"provider detail".to_vec(),
            }]);
            assert_eq!(
                DriveApiClient::new("access", &fake)
                    .unwrap()
                    .start_page_token(None),
                Err(expected)
            );
        }
    }

    #[test]
    fn rejects_malformed_pages_and_inputs() {
        let fake = Fake::new(vec![json(
            serde_json::json!({"files":[],"nextPageToken":""}),
        )]);
        let client = DriveApiClient::new("access", &fake).unwrap();
        assert_eq!(
            client.list_children_page("root", None, None, 100, None),
            Err(DriveApiError::InvalidResponse)
        );
        assert!(DriveApiClient::new("bad token", &fake).is_err());
    }
}
