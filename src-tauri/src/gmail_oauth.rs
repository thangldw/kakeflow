//! Gmail desktop OAuth protocol primitives.
//!
//! This module is independent from commands and persistence. It fixes consent
//! to Gmail's read-only scope and uses the installed-app loopback + PKCE flow.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::{blocking::Client as ReqwestClient, header::CONTENT_TYPE, Url};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, io::Read, time::Duration};
use thiserror::Error;
use zeroize::Zeroizing;

pub const GMAIL_READONLY_SCOPE: &str = "https://www.googleapis.com/auth/gmail.readonly";
const AUTHORIZATION_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REVOCATION_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const MAX_CALLBACK_BYTES: usize = 8 * 1024;
const MAX_RESPONSE_BYTES: u64 = 64 * 1024;
const MAX_TOKEN_BYTES: usize = 8 * 1024;
const MAX_CODE_BYTES: usize = 4 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum GmailOAuthError {
    #[error("Gmail OAuth configuration is invalid")]
    InvalidConfiguration,
    #[error("Gmail authorization response is invalid")]
    InvalidCallback,
    #[error("Gmail authorization timed out")]
    CallbackTimeout,
    #[error("Gmail authorization was cancelled")]
    AuthorizationDenied,
    #[error("Gmail authorization failed")]
    AuthorizationFailed,
    #[error("Gmail OAuth service is temporarily unavailable")]
    Network,
    #[error("Gmail OAuth service returned an invalid response")]
    InvalidResponse,
    #[error("Gmail must be connected again")]
    ReauthorizationRequired,
    #[error("Gmail authorization could not be revoked")]
    RevocationFailed,
}

pub struct GmailAuthorizationAttempt {
    pub authorization_url: String,
    pub redirect_uri: String,
    pub state: String,
    pub code_verifier: Zeroizing<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailAuthorizationCallback {
    pub code: String,
}

pub enum GmailLoopbackInput<'a> {
    Request(&'a [u8]),
    TimedOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GmailOAuthHttpMethod {
    Post,
}

pub struct GmailOAuthHttpRequest {
    pub method: GmailOAuthHttpMethod,
    pub url: &'static str,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailOAuthHttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

pub trait GmailOAuthTransport: Send + Sync {
    fn execute(
        &self,
        request: GmailOAuthHttpRequest,
    ) -> Result<GmailOAuthHttpResponse, GmailOAuthError>;
}

#[derive(Debug, Clone)]
pub struct ReqwestGmailOAuthTransport {
    client: ReqwestClient,
}

impl ReqwestGmailOAuthTransport {
    pub fn new() -> Result<Self, GmailOAuthError> {
        let client = ReqwestClient::builder()
            .connect_timeout(REQUEST_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|_| GmailOAuthError::Network)?;
        Ok(Self { client })
    }
}

impl GmailOAuthTransport for ReqwestGmailOAuthTransport {
    fn execute(
        &self,
        request: GmailOAuthHttpRequest,
    ) -> Result<GmailOAuthHttpResponse, GmailOAuthError> {
        if request.method != GmailOAuthHttpMethod::Post {
            return Err(GmailOAuthError::InvalidConfiguration);
        }
        let mut response = self
            .client
            .post(request.url)
            .header(CONTENT_TYPE, request.content_type)
            .body(request.body)
            .send()
            .map_err(|_| GmailOAuthError::Network)?;
        let status = response.status().as_u16();
        let mut body = Vec::new();
        response
            .by_ref()
            .take(MAX_RESPONSE_BYTES + 1)
            .read_to_end(&mut body)
            .map_err(|_| GmailOAuthError::Network)?;
        if body.len() as u64 > MAX_RESPONSE_BYTES {
            return Err(GmailOAuthError::InvalidResponse);
        }
        Ok(GmailOAuthHttpResponse { status, body })
    }
}

pub struct GmailTokenSet {
    pub access_token: Zeroizing<String>,
    pub refresh_token: Zeroizing<String>,
    pub expires_in_seconds: u64,
}

pub struct GmailRefreshedAccessToken {
    pub access_token: Zeroizing<String>,
    pub expires_in_seconds: u64,
}

pub struct GmailOAuthClient<T> {
    client_id: String,
    transport: T,
}

impl GmailOAuthClient<ReqwestGmailOAuthTransport> {
    pub fn production(client_id: &str) -> Result<Self, GmailOAuthError> {
        Self::new(client_id, ReqwestGmailOAuthTransport::new()?)
    }
}

impl<T: GmailOAuthTransport> GmailOAuthClient<T> {
    pub fn new(client_id: &str, transport: T) -> Result<Self, GmailOAuthError> {
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
    ) -> Result<GmailAuthorizationAttempt, GmailOAuthError> {
        if loopback_port == 0 || !valid_callback_path(callback_path) {
            return Err(GmailOAuthError::InvalidConfiguration);
        }
        self.authorization_attempt_with_values(
            loopback_port,
            callback_path,
            random_urlsafe(32)?,
            random_urlsafe(32)?,
        )
    }

    fn authorization_attempt_with_values(
        &self,
        loopback_port: u16,
        callback_path: &str,
        code_verifier: String,
        state: String,
    ) -> Result<GmailAuthorizationAttempt, GmailOAuthError> {
        validate_verifier(&code_verifier)?;
        validate_state(&state)?;
        let redirect_uri = format!("http://127.0.0.1:{loopback_port}{callback_path}");
        let mut url = Url::parse(AUTHORIZATION_ENDPOINT)
            .map_err(|_| GmailOAuthError::InvalidConfiguration)?;
        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", GMAIL_READONLY_SCOPE)
            .append_pair("access_type", "offline")
            .append_pair("code_challenge", &gmail_pkce_challenge(&code_verifier)?)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state);
        Ok(GmailAuthorizationAttempt {
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
    ) -> Result<GmailTokenSet, GmailOAuthError> {
        validate_token_like(code, MAX_CODE_BYTES)?;
        validate_verifier(code_verifier)?;
        validate_loopback_redirect(redirect_uri)?;
        let response = self.execute_form(
            TOKEN_ENDPOINT,
            form_body(&[
                ("client_id", &self.client_id),
                ("code", code),
                ("code_verifier", code_verifier),
                ("grant_type", "authorization_code"),
                ("redirect_uri", redirect_uri),
            ])?,
        )?;
        let wire = parse_success(response)?;
        validate_access_response(&wire, true)?;
        Ok(GmailTokenSet {
            access_token: Zeroizing::new(wire.access_token),
            refresh_token: Zeroizing::new(wire.refresh_token.unwrap()),
            expires_in_seconds: wire.expires_in,
        })
    }

    pub fn refresh(
        &self,
        refresh_token: &str,
    ) -> Result<GmailRefreshedAccessToken, GmailOAuthError> {
        validate_token_like(refresh_token, MAX_TOKEN_BYTES)?;
        let response = self.execute_form(
            TOKEN_ENDPOINT,
            form_body(&[
                ("client_id", &self.client_id),
                ("refresh_token", refresh_token),
                ("grant_type", "refresh_token"),
            ])?,
        )?;
        if !matches!(response.status, 200..=299) {
            return Err(map_oauth_error(&response.body, true));
        }
        let wire: TokenResponse = parse_json(&response.body)?;
        validate_access_response(&wire, false)?;
        Ok(GmailRefreshedAccessToken {
            access_token: Zeroizing::new(wire.access_token),
            expires_in_seconds: wire.expires_in,
        })
    }

    pub fn revoke(&self, token: &str) -> Result<(), GmailOAuthError> {
        validate_token_like(token, MAX_TOKEN_BYTES)?;
        let response = self.execute_form(REVOCATION_ENDPOINT, form_body(&[("token", token)])?)?;
        if response.status == 200 {
            Ok(())
        } else {
            Err(GmailOAuthError::RevocationFailed)
        }
    }

    fn execute_form(
        &self,
        url: &'static str,
        body: Vec<u8>,
    ) -> Result<GmailOAuthHttpResponse, GmailOAuthError> {
        self.transport.execute(GmailOAuthHttpRequest {
            method: GmailOAuthHttpMethod::Post,
            url,
            content_type: "application/x-www-form-urlencoded",
            body,
        })
    }
}

pub fn gmail_pkce_challenge(verifier: &str) -> Result<String, GmailOAuthError> {
    validate_verifier(verifier)?;
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())))
}

pub fn parse_gmail_loopback_callback(
    input: GmailLoopbackInput<'_>,
    expected_path: &str,
    expected_state: &str,
) -> Result<GmailAuthorizationCallback, GmailOAuthError> {
    if !valid_callback_path(expected_path) || validate_state(expected_state).is_err() {
        return Err(GmailOAuthError::InvalidConfiguration);
    }
    let request = match input {
        GmailLoopbackInput::Request(request) => request,
        GmailLoopbackInput::TimedOut => return Err(GmailOAuthError::CallbackTimeout),
    };
    if request.is_empty() {
        return Err(GmailOAuthError::CallbackTimeout);
    }
    if request.len() > MAX_CALLBACK_BYTES || request.contains(&0) {
        return Err(GmailOAuthError::InvalidCallback);
    }
    let text = std::str::from_utf8(request).map_err(|_| GmailOAuthError::InvalidCallback)?;
    if !text.contains("\r\n\r\n") {
        return Err(GmailOAuthError::InvalidCallback);
    }
    let mut parts = text
        .split("\r\n")
        .next()
        .ok_or(GmailOAuthError::InvalidCallback)?
        .split(' ');
    if parts.next() != Some("GET") {
        return Err(GmailOAuthError::InvalidCallback);
    }
    let target = parts.next().ok_or(GmailOAuthError::InvalidCallback)?;
    if !matches!(parts.next(), Some("HTTP/1.1" | "HTTP/1.0"))
        || parts.next().is_some()
        || !target.starts_with('/')
        || target.starts_with("//")
        || target.contains('#')
    {
        return Err(GmailOAuthError::InvalidCallback);
    }
    let parsed = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| GmailOAuthError::InvalidCallback)?;
    if parsed.path() != expected_path {
        return Err(GmailOAuthError::InvalidCallback);
    }
    let mut query = HashMap::new();
    for (key, value) in parsed.query_pairs() {
        if query.insert(key.into_owned(), value.into_owned()).is_some() {
            return Err(GmailOAuthError::InvalidCallback);
        }
    }
    if query.get("state").map(String::as_str) != Some(expected_state) {
        return Err(GmailOAuthError::InvalidCallback);
    }
    if let Some(error) = query.get("error") {
        return Err(if error == "access_denied" {
            GmailOAuthError::AuthorizationDenied
        } else {
            GmailOAuthError::AuthorizationFailed
        });
    }
    let code = query.get("code").ok_or(GmailOAuthError::InvalidCallback)?;
    validate_token_like(code, MAX_CODE_BYTES).map_err(|_| GmailOAuthError::InvalidCallback)?;
    Ok(GmailAuthorizationCallback { code: code.clone() })
}

pub fn gmail_loopback_success_html() -> &'static str {
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>KakeFlow connected</title><body><h1>Gmail connected</h1><p>You can close this window and return to KakeFlow.</p></body></html>"
}

pub fn gmail_loopback_error_html() -> &'static str {
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>KakeFlow connection failed</title><body><h1>Gmail was not connected</h1><p>Return to KakeFlow and try again.</p></body></html>"
}

fn random_urlsafe(bytes: usize) -> Result<String, GmailOAuthError> {
    let mut value = vec![0_u8; bytes];
    getrandom::getrandom(&mut value).map_err(|_| GmailOAuthError::InvalidConfiguration)?;
    Ok(URL_SAFE_NO_PAD.encode(value))
}

fn validate_client_id(value: &str) -> Result<(), GmailOAuthError> {
    if value.is_empty()
        || value.len() > 512
        || value.chars().any(char::is_whitespace)
        || !value.ends_with(".apps.googleusercontent.com")
    {
        Err(GmailOAuthError::InvalidConfiguration)
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

fn validate_loopback_redirect(value: &str) -> Result<(), GmailOAuthError> {
    let url = Url::parse(value).map_err(|_| GmailOAuthError::InvalidConfiguration)?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !valid_callback_path(url.path())
    {
        return Err(GmailOAuthError::InvalidConfiguration);
    }
    Ok(())
}

fn validate_verifier(value: &str) -> Result<(), GmailOAuthError> {
    if !(43..=128).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'))
    {
        Err(GmailOAuthError::InvalidConfiguration)
    } else {
        Ok(())
    }
}

fn validate_state(value: &str) -> Result<(), GmailOAuthError> {
    if !(32..=256).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Err(GmailOAuthError::InvalidConfiguration)
    } else {
        Ok(())
    }
}

fn validate_token_like(value: &str, max: usize) -> Result<(), GmailOAuthError> {
    if value.is_empty()
        || value.len() > max
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        Err(GmailOAuthError::InvalidResponse)
    } else {
        Ok(())
    }
}

fn form_body(values: &[(&str, &str)]) -> Result<Vec<u8>, GmailOAuthError> {
    let mut url =
        Url::parse("https://form.invalid/").map_err(|_| GmailOAuthError::InvalidConfiguration)?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in values {
            query.append_pair(key, value);
        }
    }
    Ok(url
        .query()
        .ok_or(GmailOAuthError::InvalidConfiguration)?
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

fn parse_success(response: GmailOAuthHttpResponse) -> Result<TokenResponse, GmailOAuthError> {
    if !matches!(response.status, 200..=299) {
        return Err(map_oauth_error(&response.body, false));
    }
    parse_json(&response.body)
}

fn parse_json<R: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<R, GmailOAuthError> {
    if body.is_empty() || body.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(GmailOAuthError::InvalidResponse);
    }
    serde_json::from_slice(body).map_err(|_| GmailOAuthError::InvalidResponse)
}

fn validate_access_response(
    response: &TokenResponse,
    require_refresh: bool,
) -> Result<(), GmailOAuthError> {
    validate_token_like(&response.access_token, MAX_TOKEN_BYTES)?;
    if response.token_type != "Bearer"
        || response.expires_in == 0
        || response.expires_in > 7 * 24 * 60 * 60
        || (require_refresh && response.scope.as_deref() != Some(GMAIL_READONLY_SCOPE))
        || (!require_refresh
            && response
                .scope
                .as_deref()
                .is_some_and(|scope| scope != GMAIL_READONLY_SCOPE))
        || (require_refresh && response.refresh_token.is_none())
    {
        return Err(GmailOAuthError::InvalidResponse);
    }
    if let Some(refresh) = response.refresh_token.as_deref() {
        validate_token_like(refresh, MAX_TOKEN_BYTES)?;
    }
    Ok(())
}

fn map_oauth_error(body: &[u8], refreshing: bool) -> GmailOAuthError {
    let Ok(error) = parse_json::<OAuthErrorResponse>(body) else {
        return GmailOAuthError::InvalidResponse;
    };
    match error.error.as_str() {
        "invalid_grant" if refreshing => GmailOAuthError::ReauthorizationRequired,
        "access_denied" => GmailOAuthError::AuthorizationDenied,
        _ => GmailOAuthError::AuthorizationFailed,
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
        responses: Mutex<VecDeque<GmailOAuthHttpResponse>>,
        requests: Mutex<Vec<GmailOAuthHttpRequest>>,
    }

    impl FakeTransport {
        fn new(responses: Vec<GmailOAuthHttpResponse>) -> Self {
            Self {
                responses: Mutex::new(responses.into()),
                requests: Mutex::new(Vec::new()),
            }
        }
    }

    impl GmailOAuthTransport for &FakeTransport {
        fn execute(
            &self,
            request: GmailOAuthHttpRequest,
        ) -> Result<GmailOAuthHttpResponse, GmailOAuthError> {
            self.requests.lock().unwrap().push(request);
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .ok_or(GmailOAuthError::Network)
        }
    }

    fn response(status: u16, body: serde_json::Value) -> GmailOAuthHttpResponse {
        GmailOAuthHttpResponse {
            status,
            body: serde_json::to_vec(&body).unwrap(),
        }
    }

    #[test]
    fn authorization_is_fixed_to_gmail_readonly_loopback_and_pkce() {
        let fake = FakeTransport::new(vec![]);
        let client = GmailOAuthClient::new(CLIENT_ID, &fake).unwrap();
        let attempt = client
            .authorization_attempt_with_values(
                49152,
                "/gmail/callback",
                VERIFIER.into(),
                STATE.into(),
            )
            .unwrap();
        let url = Url::parse(&attempt.authorization_url).unwrap();
        let query = url.query_pairs().into_owned().collect::<HashMap<_, _>>();
        assert_eq!(
            query.get("scope").map(String::as_str),
            Some(GMAIL_READONLY_SCOPE)
        );
        assert_eq!(
            query.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:49152/gmail/callback")
        );
        assert_eq!(
            query.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert!(!query.contains_key("client_secret"));
        assert_eq!(
            gmail_pkce_challenge(VERIFIER).unwrap(),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn callback_requires_exact_path_state_and_single_code() {
        let request = format!(
            "GET /gmail/callback?code=code-1&state={STATE} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
        );
        assert_eq!(
            parse_gmail_loopback_callback(
                GmailLoopbackInput::Request(request.as_bytes()),
                "/gmail/callback",
                STATE,
            )
            .unwrap()
            .code,
            "code-1"
        );
        assert_eq!(
            parse_gmail_loopback_callback(
                GmailLoopbackInput::Request(request.as_bytes()),
                "/wrong",
                STATE,
            ),
            Err(GmailOAuthError::InvalidCallback)
        );
    }

    #[test]
    fn exchange_and_refresh_enforce_gmail_scope() {
        let fake = FakeTransport::new(vec![response(
            200,
            serde_json::json!({
                "access_token":"access-1","refresh_token":"refresh-1",
                "expires_in":3600,"token_type":"Bearer","scope":GMAIL_READONLY_SCOPE
            }),
        )]);
        let client = GmailOAuthClient::new(CLIENT_ID, &fake).unwrap();
        let tokens = client
            .exchange_code("code-1", VERIFIER, "http://127.0.0.1:49152/gmail/callback")
            .unwrap();
        assert_eq!(tokens.access_token.as_str(), "access-1");
        let body = String::from_utf8(fake.requests.lock().unwrap()[0].body.clone()).unwrap();
        assert!(body.contains("grant_type=authorization_code"));
        assert!(!body.contains("client_secret"));

        let wrong_scope = FakeTransport::new(vec![response(
            200,
            serde_json::json!({
                "access_token":"access","refresh_token":"refresh","expires_in":3600,
                "token_type":"Bearer","scope":"https://mail.google.com/"
            }),
        )]);
        assert_eq!(
            GmailOAuthClient::new(CLIENT_ID, &wrong_scope)
                .unwrap()
                .exchange_code("code-1", VERIFIER, "http://127.0.0.1:49152/gmail/callback")
                .err(),
            Some(GmailOAuthError::InvalidResponse)
        );
    }

    #[test]
    fn refresh_invalid_grant_is_terminal_and_provider_detail_is_not_exposed() {
        let fake = FakeTransport::new(vec![response(
            400,
            serde_json::json!({"error":"invalid_grant","error_description":"private detail"}),
        )]);
        assert_eq!(
            GmailOAuthClient::new(CLIENT_ID, &fake)
                .unwrap()
                .refresh("refresh-1")
                .err(),
            Some(GmailOAuthError::ReauthorizationRequired)
        );
    }

    #[test]
    fn callback_timeout_denial_and_duplicate_parameters_are_rejected() {
        assert_eq!(
            parse_gmail_loopback_callback(GmailLoopbackInput::TimedOut, "/gmail/callback", STATE),
            Err(GmailOAuthError::CallbackTimeout)
        );
        let denied =
            format!("GET /gmail/callback?error=access_denied&state={STATE} HTTP/1.1\r\n\r\n");
        assert_eq!(
            parse_gmail_loopback_callback(
                GmailLoopbackInput::Request(denied.as_bytes()),
                "/gmail/callback",
                STATE,
            ),
            Err(GmailOAuthError::AuthorizationDenied)
        );
        let duplicate =
            format!("GET /gmail/callback?code=one&code=two&state={STATE} HTTP/1.1\r\n\r\n");
        assert_eq!(
            parse_gmail_loopback_callback(
                GmailLoopbackInput::Request(duplicate.as_bytes()),
                "/gmail/callback",
                STATE,
            ),
            Err(GmailOAuthError::InvalidCallback)
        );
    }
}
