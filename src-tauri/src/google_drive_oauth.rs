//! Google Drive desktop OAuth protocol primitives.
//!
//! This module is intentionally independent from commands and persistence. It
//! fixes the connector to the read-only Drive scope, uses the installed-app
//! loopback + PKCE flow, and keeps HTTP injectable for deterministic tests.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::{blocking::Client as ReqwestClient, header::CONTENT_TYPE, Url};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, io::Read, time::Duration};
use thiserror::Error;
use zeroize::Zeroizing;

pub const DRIVE_READONLY_SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";
const AUTHORIZATION_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REVOCATION_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const MAX_CALLBACK_BYTES: usize = 8 * 1024;
const MAX_RESPONSE_BYTES: u64 = 64 * 1024;
const MAX_TOKEN_BYTES: usize = 8 * 1024;
const MAX_CODE_BYTES: usize = 4 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum GoogleDriveOAuthError {
    #[error("Google Drive OAuth configuration is invalid")]
    InvalidConfiguration,
    #[error("Google Drive authorization response is invalid")]
    InvalidCallback,
    #[error("Google Drive authorization timed out")]
    CallbackTimeout,
    #[error("Google Drive authorization was cancelled")]
    AuthorizationDenied,
    #[error("Google Drive authorization failed")]
    AuthorizationFailed,
    #[error("Google Drive OAuth service is temporarily unavailable")]
    Network,
    #[error("Google Drive OAuth service returned an invalid response")]
    InvalidResponse,
    #[error("Google Drive must be connected again")]
    ReauthorizationRequired,
    #[error("Google Drive authorization could not be revoked")]
    RevocationFailed,
}

pub struct AuthorizationAttempt {
    pub authorization_url: String,
    pub redirect_uri: String,
    pub state: String,
    pub code_verifier: Zeroizing<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizationCallback {
    pub code: String,
}

pub enum LoopbackInput<'a> {
    Request(&'a [u8]),
    TimedOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OAuthHttpMethod {
    Post,
}

pub struct OAuthHttpRequest {
    pub method: OAuthHttpMethod,
    pub url: &'static str,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthHttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

pub trait GoogleOAuthTransport: Send + Sync {
    fn execute(
        &self,
        request: OAuthHttpRequest,
    ) -> Result<OAuthHttpResponse, GoogleDriveOAuthError>;
}

#[derive(Debug, Clone)]
pub struct ReqwestOAuthTransport {
    client: ReqwestClient,
}

impl ReqwestOAuthTransport {
    pub fn new() -> Result<Self, GoogleDriveOAuthError> {
        let client = ReqwestClient::builder()
            .connect_timeout(REQUEST_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|_| GoogleDriveOAuthError::Network)?;
        Ok(Self { client })
    }
}

impl GoogleOAuthTransport for ReqwestOAuthTransport {
    fn execute(
        &self,
        request: OAuthHttpRequest,
    ) -> Result<OAuthHttpResponse, GoogleDriveOAuthError> {
        if request.method != OAuthHttpMethod::Post {
            return Err(GoogleDriveOAuthError::InvalidConfiguration);
        }
        let mut response = self
            .client
            .post(request.url)
            .header(CONTENT_TYPE, request.content_type)
            .body(request.body)
            .send()
            .map_err(|_| GoogleDriveOAuthError::Network)?;
        let status = response.status().as_u16();
        let mut body = Vec::new();
        response
            .by_ref()
            .take(MAX_RESPONSE_BYTES + 1)
            .read_to_end(&mut body)
            .map_err(|_| GoogleDriveOAuthError::Network)?;
        if body.len() as u64 > MAX_RESPONSE_BYTES {
            return Err(GoogleDriveOAuthError::InvalidResponse);
        }
        Ok(OAuthHttpResponse { status, body })
    }
}

pub struct TokenSet {
    pub access_token: Zeroizing<String>,
    pub refresh_token: Zeroizing<String>,
    pub expires_in_seconds: u64,
}

pub struct RefreshedAccessToken {
    pub access_token: Zeroizing<String>,
    pub expires_in_seconds: u64,
}

pub struct GoogleDriveOAuthClient<T> {
    client_id: String,
    transport: T,
}

impl GoogleDriveOAuthClient<ReqwestOAuthTransport> {
    pub fn production(client_id: &str) -> Result<Self, GoogleDriveOAuthError> {
        Self::new(client_id, ReqwestOAuthTransport::new()?)
    }
}

impl<T: GoogleOAuthTransport> GoogleDriveOAuthClient<T> {
    pub fn new(client_id: &str, transport: T) -> Result<Self, GoogleDriveOAuthError> {
        validate_client_id(client_id)?;
        Ok(Self {
            client_id: client_id.to_owned(),
            transport,
        })
    }

    pub fn authorization_attempt(
        &self,
        loopback_port: u16,
        callback_path: &str,
    ) -> Result<AuthorizationAttempt, GoogleDriveOAuthError> {
        if loopback_port == 0 || !valid_callback_path(callback_path) {
            return Err(GoogleDriveOAuthError::InvalidConfiguration);
        }
        let verifier = random_urlsafe(32)?;
        let state = random_urlsafe(32)?;
        self.authorization_attempt_with_values(loopback_port, callback_path, verifier, state)
    }

    fn authorization_attempt_with_values(
        &self,
        loopback_port: u16,
        callback_path: &str,
        code_verifier: String,
        state: String,
    ) -> Result<AuthorizationAttempt, GoogleDriveOAuthError> {
        validate_verifier(&code_verifier)?;
        validate_state(&state)?;
        let redirect_uri = format!("http://127.0.0.1:{loopback_port}{callback_path}");
        let mut url = Url::parse(AUTHORIZATION_ENDPOINT)
            .map_err(|_| GoogleDriveOAuthError::InvalidConfiguration)?;
        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", DRIVE_READONLY_SCOPE)
            .append_pair("access_type", "offline")
            .append_pair("code_challenge", &pkce_challenge(&code_verifier)?)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state);
        Ok(AuthorizationAttempt {
            authorization_url: url.into(),
            redirect_uri,
            state,
            code_verifier: Zeroizing::new(code_verifier),
        })
    }

    pub fn exchange_code(
        &self,
        code: &str,
        code_verifier: &str,
        redirect_uri: &str,
    ) -> Result<TokenSet, GoogleDriveOAuthError> {
        validate_token_like(code, MAX_CODE_BYTES)?;
        validate_verifier(code_verifier)?;
        validate_loopback_redirect(redirect_uri)?;
        let body = form_body(&[
            ("client_id", &self.client_id),
            ("code", code),
            ("code_verifier", code_verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])?;
        let response = self.execute_form(TOKEN_ENDPOINT, body)?;
        let wire: TokenResponse = parse_success(response)?;
        validate_access_response(&wire, true)?;
        Ok(TokenSet {
            access_token: Zeroizing::new(wire.access_token),
            refresh_token: Zeroizing::new(wire.refresh_token.unwrap()),
            expires_in_seconds: wire.expires_in,
        })
    }

    pub fn refresh(
        &self,
        refresh_token: &str,
    ) -> Result<RefreshedAccessToken, GoogleDriveOAuthError> {
        validate_token_like(refresh_token, MAX_TOKEN_BYTES)?;
        let body = form_body(&[
            ("client_id", &self.client_id),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])?;
        let response = self.execute_form(TOKEN_ENDPOINT, body)?;
        if !matches!(response.status, 200..=299) {
            return Err(map_oauth_error(&response.body, true));
        }
        let wire: TokenResponse = parse_json(&response.body)?;
        validate_access_response(&wire, false)?;
        Ok(RefreshedAccessToken {
            access_token: Zeroizing::new(wire.access_token),
            expires_in_seconds: wire.expires_in,
        })
    }

    pub fn revoke(&self, token: &str) -> Result<(), GoogleDriveOAuthError> {
        validate_token_like(token, MAX_TOKEN_BYTES)?;
        let body = form_body(&[("token", token)])?;
        let response = self.execute_form(REVOCATION_ENDPOINT, body)?;
        if response.status == 200 {
            Ok(())
        } else {
            Err(GoogleDriveOAuthError::RevocationFailed)
        }
    }

    fn execute_form(
        &self,
        url: &'static str,
        body: Vec<u8>,
    ) -> Result<OAuthHttpResponse, GoogleDriveOAuthError> {
        self.transport.execute(OAuthHttpRequest {
            method: OAuthHttpMethod::Post,
            url,
            content_type: "application/x-www-form-urlencoded",
            body,
        })
    }
}

pub fn pkce_challenge(verifier: &str) -> Result<String, GoogleDriveOAuthError> {
    validate_verifier(verifier)?;
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())))
}

pub fn parse_loopback_callback(
    input: LoopbackInput<'_>,
    expected_path: &str,
    expected_state: &str,
) -> Result<AuthorizationCallback, GoogleDriveOAuthError> {
    if !valid_callback_path(expected_path) || validate_state(expected_state).is_err() {
        return Err(GoogleDriveOAuthError::InvalidConfiguration);
    }
    let request = match input {
        LoopbackInput::Request(request) => request,
        LoopbackInput::TimedOut => return Err(GoogleDriveOAuthError::CallbackTimeout),
    };
    if request.is_empty() {
        return Err(GoogleDriveOAuthError::CallbackTimeout);
    }
    if request.len() > MAX_CALLBACK_BYTES || request.contains(&0) {
        return Err(GoogleDriveOAuthError::InvalidCallback);
    }
    let text = std::str::from_utf8(request).map_err(|_| GoogleDriveOAuthError::InvalidCallback)?;
    if !text.contains("\r\n\r\n") {
        return Err(GoogleDriveOAuthError::InvalidCallback);
    }
    let first_line = text
        .split("\r\n")
        .next()
        .ok_or(GoogleDriveOAuthError::InvalidCallback)?;
    let mut parts = first_line.split(' ');
    let method = parts.next();
    let target = parts.next();
    let version = parts.next();
    if method != Some("GET")
        || !matches!(version, Some("HTTP/1.1" | "HTTP/1.0"))
        || parts.next().is_some()
    {
        return Err(GoogleDriveOAuthError::InvalidCallback);
    }
    let target = target.ok_or(GoogleDriveOAuthError::InvalidCallback)?;
    if !target.starts_with('/') || target.starts_with("//") || target.contains('#') {
        return Err(GoogleDriveOAuthError::InvalidCallback);
    }
    let parsed = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| GoogleDriveOAuthError::InvalidCallback)?;
    if parsed.path() != expected_path {
        return Err(GoogleDriveOAuthError::InvalidCallback);
    }
    let mut query = HashMap::new();
    for (key, value) in parsed.query_pairs() {
        if query.insert(key.into_owned(), value.into_owned()).is_some() {
            return Err(GoogleDriveOAuthError::InvalidCallback);
        }
    }
    if query.get("state").map(String::as_str) != Some(expected_state) {
        return Err(GoogleDriveOAuthError::InvalidCallback);
    }
    if let Some(error) = query.get("error") {
        return Err(if error == "access_denied" {
            GoogleDriveOAuthError::AuthorizationDenied
        } else {
            GoogleDriveOAuthError::AuthorizationFailed
        });
    }
    let code = query
        .get("code")
        .ok_or(GoogleDriveOAuthError::InvalidCallback)?;
    validate_token_like(code, MAX_CODE_BYTES)
        .map_err(|_| GoogleDriveOAuthError::InvalidCallback)?;
    Ok(AuthorizationCallback { code: code.clone() })
}

pub fn loopback_success_html() -> &'static str {
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>KakeFlow connected</title><body><h1>Google Drive connected</h1><p>You can close this window and return to KakeFlow.</p></body></html>"
}

pub fn loopback_error_html() -> &'static str {
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>KakeFlow connection failed</title><body><h1>Google Drive was not connected</h1><p>Return to KakeFlow and try again.</p></body></html>"
}

fn random_urlsafe(bytes: usize) -> Result<String, GoogleDriveOAuthError> {
    let mut value = vec![0_u8; bytes];
    getrandom::getrandom(&mut value).map_err(|_| GoogleDriveOAuthError::InvalidConfiguration)?;
    Ok(URL_SAFE_NO_PAD.encode(value))
}

fn validate_client_id(value: &str) -> Result<(), GoogleDriveOAuthError> {
    if value.is_empty()
        || value.len() > 512
        || value.chars().any(char::is_whitespace)
        || !value.ends_with(".apps.googleusercontent.com")
    {
        Err(GoogleDriveOAuthError::InvalidConfiguration)
    } else {
        Ok(())
    }
}

fn valid_callback_path(value: &str) -> bool {
    value.starts_with('/')
        && !value.starts_with("//")
        && value.len() <= 128
        && !value
            .chars()
            .any(|character| matches!(character, '?' | '#' | '\\'))
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.'))
}

fn validate_loopback_redirect(value: &str) -> Result<(), GoogleDriveOAuthError> {
    let url = Url::parse(value).map_err(|_| GoogleDriveOAuthError::InvalidConfiguration)?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !valid_callback_path(url.path())
    {
        return Err(GoogleDriveOAuthError::InvalidConfiguration);
    }
    Ok(())
}

fn validate_verifier(value: &str) -> Result<(), GoogleDriveOAuthError> {
    if !(43..=128).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'))
    {
        Err(GoogleDriveOAuthError::InvalidConfiguration)
    } else {
        Ok(())
    }
}

fn validate_state(value: &str) -> Result<(), GoogleDriveOAuthError> {
    if !(32..=256).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Err(GoogleDriveOAuthError::InvalidConfiguration)
    } else {
        Ok(())
    }
}

fn validate_token_like(value: &str, max: usize) -> Result<(), GoogleDriveOAuthError> {
    if value.is_empty()
        || value.len() > max
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        Err(GoogleDriveOAuthError::InvalidResponse)
    } else {
        Ok(())
    }
}

fn form_body(values: &[(&str, &str)]) -> Result<Vec<u8>, GoogleDriveOAuthError> {
    let mut url = Url::parse("https://form.invalid/")
        .map_err(|_| GoogleDriveOAuthError::InvalidConfiguration)?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in values {
            query.append_pair(key, value);
        }
    }
    Ok(url
        .query()
        .ok_or(GoogleDriveOAuthError::InvalidConfiguration)?
        .as_bytes()
        .to_vec())
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    token_type: String,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct OAuthErrorResponse {
    error: String,
}

fn parse_success(response: OAuthHttpResponse) -> Result<TokenResponse, GoogleDriveOAuthError> {
    if !matches!(response.status, 200..=299) {
        return Err(map_oauth_error(&response.body, false));
    }
    parse_json(&response.body)
}

fn parse_json<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, GoogleDriveOAuthError> {
    if body.is_empty() || body.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(GoogleDriveOAuthError::InvalidResponse);
    }
    serde_json::from_slice(body).map_err(|_| GoogleDriveOAuthError::InvalidResponse)
}

fn validate_access_response(
    response: &TokenResponse,
    require_refresh: bool,
) -> Result<(), GoogleDriveOAuthError> {
    validate_token_like(&response.access_token, MAX_TOKEN_BYTES)?;
    if response.token_type != "Bearer"
        || response.expires_in == 0
        || response.expires_in > 7 * 24 * 60 * 60
        || (require_refresh && response.scope.as_deref() != Some(DRIVE_READONLY_SCOPE))
        || (!require_refresh
            && response
                .scope
                .as_deref()
                .is_some_and(|scope| scope != DRIVE_READONLY_SCOPE))
        || (require_refresh && response.refresh_token.is_none())
    {
        return Err(GoogleDriveOAuthError::InvalidResponse);
    }
    if let Some(refresh) = response.refresh_token.as_deref() {
        validate_token_like(refresh, MAX_TOKEN_BYTES)?;
    }
    Ok(())
}

fn map_oauth_error(body: &[u8], refreshing: bool) -> GoogleDriveOAuthError {
    let Ok(error) = parse_json::<OAuthErrorResponse>(body) else {
        return GoogleDriveOAuthError::InvalidResponse;
    };
    match error.error.as_str() {
        "invalid_grant" if refreshing => GoogleDriveOAuthError::ReauthorizationRequired,
        "access_denied" => GoogleDriveOAuthError::AuthorizationDenied,
        _ => GoogleDriveOAuthError::AuthorizationFailed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, sync::Mutex};

    const CLIENT_ID: &str = "123-example.apps.googleusercontent.com";
    const VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const STATE: &str = "abcdefghijklmnopqrstuvwxyzABCDEF";

    struct FakeTransport {
        responses: Mutex<VecDeque<Result<OAuthHttpResponse, GoogleDriveOAuthError>>>,
        requests: Mutex<Vec<OAuthHttpRequest>>,
    }

    impl FakeTransport {
        fn new(responses: Vec<OAuthHttpResponse>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().map(Ok).collect()),
                requests: Mutex::new(Vec::new()),
            }
        }
    }

    impl GoogleOAuthTransport for &FakeTransport {
        fn execute(
            &self,
            request: OAuthHttpRequest,
        ) -> Result<OAuthHttpResponse, GoogleDriveOAuthError> {
            self.requests.lock().unwrap().push(request);
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected OAuth request")
        }
    }

    fn response(status: u16, body: serde_json::Value) -> OAuthHttpResponse {
        OAuthHttpResponse {
            status,
            body: serde_json::to_vec(&body).unwrap(),
        }
    }

    #[test]
    fn pkce_matches_rfc7636_s256_vector() {
        assert_eq!(
            pkce_challenge(VERIFIER).unwrap(),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn authorization_url_is_fixed_to_loopback_pkce_and_drive_readonly() {
        let transport = FakeTransport::new(vec![]);
        let client = GoogleDriveOAuthClient::new(CLIENT_ID, &transport).unwrap();
        let attempt = client
            .authorization_attempt_with_values(
                49152,
                "/oauth/callback",
                VERIFIER.into(),
                STATE.into(),
            )
            .unwrap();
        let url = Url::parse(&attempt.authorization_url).unwrap();
        let query = url.query_pairs().into_owned().collect::<HashMap<_, _>>();
        assert_eq!(
            url.as_str().split('?').next().unwrap(),
            AUTHORIZATION_ENDPOINT
        );
        assert_eq!(query.get("client_id").map(String::as_str), Some(CLIENT_ID));
        assert_eq!(
            query.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:49152/oauth/callback")
        );
        assert_eq!(
            query.get("scope").map(String::as_str),
            Some(DRIVE_READONLY_SCOPE)
        );
        assert_eq!(query.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(
            query.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(query.get("state").map(String::as_str), Some(STATE));
        assert!(!query.contains_key("client_secret"));
    }

    #[test]
    fn loopback_parser_requires_exact_state_path_and_single_code() {
        let request = format!(
            "GET /oauth/callback?code=code-1&state={STATE} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
        );
        assert_eq!(
            parse_loopback_callback(
                LoopbackInput::Request(request.as_bytes()),
                "/oauth/callback",
                STATE
            )
            .unwrap()
            .code,
            "code-1"
        );
        assert_eq!(
            parse_loopback_callback(LoopbackInput::Request(request.as_bytes()), "/wrong", STATE),
            Err(GoogleDriveOAuthError::InvalidCallback)
        );
        let wrong_state = "GET /oauth/callback?code=code-1&state=wrongwrongwrongwrongwrongwrongwrongwrong HTTP/1.1\r\n\r\n";
        assert_eq!(
            parse_loopback_callback(
                LoopbackInput::Request(wrong_state.as_bytes()),
                "/oauth/callback",
                STATE
            ),
            Err(GoogleDriveOAuthError::InvalidCallback)
        );
    }

    #[test]
    fn loopback_parser_sanitizes_denial_oversize_and_timeout() {
        let denied = format!("GET /oauth/callback?error=access_denied&error_description=private-data&state={STATE} HTTP/1.1\r\n\r\n");
        assert_eq!(
            parse_loopback_callback(
                LoopbackInput::Request(denied.as_bytes()),
                "/oauth/callback",
                STATE
            ),
            Err(GoogleDriveOAuthError::AuthorizationDenied)
        );
        assert_eq!(
            parse_loopback_callback(
                LoopbackInput::Request(&vec![b'a'; MAX_CALLBACK_BYTES + 1]),
                "/oauth/callback",
                STATE
            ),
            Err(GoogleDriveOAuthError::InvalidCallback)
        );
        assert_eq!(
            parse_loopback_callback(LoopbackInput::TimedOut, "/oauth/callback", STATE),
            Err(GoogleDriveOAuthError::CallbackTimeout)
        );
        assert_eq!(
            parse_loopback_callback(LoopbackInput::Request(&[]), "/oauth/callback", STATE),
            Err(GoogleDriveOAuthError::CallbackTimeout)
        );
    }

    #[test]
    fn exchange_uses_public_client_contract_and_validates_scope() {
        let transport = FakeTransport::new(vec![response(
            200,
            serde_json::json!({
                "access_token":"access-1","refresh_token":"refresh-1","expires_in":3600,
                "token_type":"Bearer","scope":DRIVE_READONLY_SCOPE
            }),
        )]);
        let client = GoogleDriveOAuthClient::new(CLIENT_ID, &transport).unwrap();
        let tokens = client
            .exchange_code("code-1", VERIFIER, "http://127.0.0.1:49152/oauth/callback")
            .unwrap();
        assert_eq!(tokens.access_token.as_str(), "access-1");
        let requests = transport.requests.lock().unwrap();
        let body = std::str::from_utf8(&requests[0].body).unwrap();
        assert!(body.contains("grant_type=authorization_code"));
        assert!(body.contains("code_verifier="));
        assert!(!body.contains("client_secret"));
    }

    #[test]
    fn token_and_scope_bounds_reject_malformed_success() {
        for body in [
            serde_json::json!({"access_token":"a","refresh_token":"r","expires_in":3600,"token_type":"Bearer","scope":"https://www.googleapis.com/auth/drive.file"}),
            serde_json::json!({"access_token":"a","refresh_token":"r","expires_in":0,"token_type":"Bearer","scope":DRIVE_READONLY_SCOPE}),
            serde_json::json!({"access_token":"a b","refresh_token":"r","expires_in":3600,"token_type":"Bearer","scope":DRIVE_READONLY_SCOPE}),
            serde_json::json!({"access_token":"a","expires_in":3600,"token_type":"Bearer","scope":DRIVE_READONLY_SCOPE}),
        ] {
            let transport = FakeTransport::new(vec![response(200, body)]);
            let client = GoogleDriveOAuthClient::new(CLIENT_ID, &transport).unwrap();
            assert_eq!(
                client
                    .exchange_code("code-1", VERIFIER, "http://127.0.0.1:49152/oauth/callback")
                    .err(),
                Some(GoogleDriveOAuthError::InvalidResponse)
            );
        }
    }

    #[test]
    fn refresh_invalid_grant_is_terminal_and_sanitized() {
        let transport = FakeTransport::new(vec![response(
            400,
            serde_json::json!({
                "error":"invalid_grant","error_description":"user@example.com token detail"
            }),
        )]);
        let client = GoogleDriveOAuthClient::new(CLIENT_ID, &transport).unwrap();
        assert_eq!(
            client.refresh("refresh-1").err(),
            Some(GoogleDriveOAuthError::ReauthorizationRequired)
        );
    }

    #[test]
    fn refresh_success_accepts_absent_scope_but_not_scope_escalation() {
        let transport = FakeTransport::new(vec![response(
            200,
            serde_json::json!({
                "access_token":"access-2","expires_in":3600,"token_type":"Bearer"
            }),
        )]);
        let client = GoogleDriveOAuthClient::new(CLIENT_ID, &transport).unwrap();
        assert_eq!(
            client.refresh("refresh-1").unwrap().access_token.as_str(),
            "access-2"
        );
    }

    #[test]
    fn revoke_uses_form_post_and_maps_non_success() {
        let transport = FakeTransport::new(vec![OAuthHttpResponse {
            status: 200,
            body: vec![],
        }]);
        let client = GoogleDriveOAuthClient::new(CLIENT_ID, &transport).unwrap();
        client.revoke("refresh-1").unwrap();
        let requests = transport.requests.lock().unwrap();
        assert_eq!(requests[0].url, REVOCATION_ENDPOINT);
        assert_eq!(requests[0].body, b"token=refresh-1");

        let failing = FakeTransport::new(vec![response(
            400,
            serde_json::json!({"error":"invalid_token"}),
        )]);
        let client = GoogleDriveOAuthClient::new(CLIENT_ID, &failing).unwrap();
        assert_eq!(
            client.revoke("refresh-1"),
            Err(GoogleDriveOAuthError::RevocationFailed)
        );
    }

    #[test]
    fn callback_html_is_static_and_contains_no_remote_error_detail() {
        assert!(loopback_success_html().contains("return to KakeFlow"));
        assert!(loopback_error_html().contains("try again"));
        assert!(!loopback_error_html().contains("error_description"));
    }
}
