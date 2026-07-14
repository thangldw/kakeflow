//! Native loopback runtime for the desktop Google Drive OAuth flow.

use crate::google_drive_oauth::{
    loopback_error_html, loopback_success_html, parse_loopback_callback, AuthorizationAttempt,
    AuthorizationCallback, GoogleDriveOAuthError, LoopbackInput,
};
use reqwest::Url;
use std::{
    collections::HashMap,
    io::{ErrorKind, Read, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream},
    thread,
    time::{Duration, Instant},
};
use thiserror::Error;

const MAX_REQUEST_BYTES: usize = 8 * 1024;
const ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(10);
const MAX_SESSION_TIMEOUT: Duration = Duration::from_secs(10 * 60);
pub const DEFAULT_SESSION_TIMEOUT: Duration = Duration::from_secs(3 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum BrowserOpenError {
    #[error("system browser could not be opened")]
    Failed,
}

pub trait BrowserOpener: Send + Sync {
    fn open(&self, authorization_url: &str) -> Result<(), BrowserOpenError>;
}

#[derive(Debug, Error)]
pub enum LoopbackRuntimeError {
    #[error(transparent)]
    OAuth(#[from] GoogleDriveOAuthError),
    #[error("OAuth loopback listener could not be started")]
    ListenerUnavailable,
    #[error("OAuth callback could not be read")]
    CallbackIo,
    #[error(transparent)]
    Browser(#[from] BrowserOpenError),
}

/// A listener is bound before an authorization URL is generated, guaranteeing
/// that its random port is already reserved when the system browser opens.
pub struct BoundLoopbackSession {
    listener: TcpListener,
    callback_path: String,
    timeout: Duration,
}

impl BoundLoopbackSession {
    pub fn bind(callback_path: &str, timeout: Duration) -> Result<Self, LoopbackRuntimeError> {
        validate_callback_path(callback_path)?;
        if timeout.is_zero() || timeout > MAX_SESSION_TIMEOUT {
            return Err(GoogleDriveOAuthError::InvalidConfiguration.into());
        }
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| LoopbackRuntimeError::ListenerUnavailable)?;
        listener
            .set_nonblocking(true)
            .map_err(|_| LoopbackRuntimeError::ListenerUnavailable)?;
        Ok(Self {
            listener,
            callback_path: callback_path.to_owned(),
            timeout,
        })
    }

    pub fn port(&self) -> u16 {
        self.listener
            .local_addr()
            .map(|address| address.port())
            .unwrap_or(0)
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}{}", self.port(), self.callback_path)
    }

    pub fn open_and_wait(
        self,
        attempt: &AuthorizationAttempt,
        browser: &impl BrowserOpener,
    ) -> Result<AuthorizationCallback, LoopbackRuntimeError> {
        self.validate_attempt(attempt)?;
        browser.open(&attempt.authorization_url)?;
        let deadline = Instant::now() + self.timeout;
        let mut stream = self.accept_until(deadline)?;
        let request = match read_request(&mut stream, deadline) {
            Ok(request) => request,
            Err(error) => {
                write_response(&mut stream, false);
                return Err(error);
            }
        };
        let parsed = parse_loopback_callback(
            LoopbackInput::Request(&request),
            &self.callback_path,
            &attempt.state,
        );
        write_response(&mut stream, parsed.is_ok());
        parsed.map_err(LoopbackRuntimeError::from)
    }

    fn validate_attempt(&self, attempt: &AuthorizationAttempt) -> Result<(), LoopbackRuntimeError> {
        if attempt.redirect_uri != self.redirect_uri() {
            return Err(GoogleDriveOAuthError::InvalidConfiguration.into());
        }
        let url = Url::parse(&attempt.authorization_url)
            .map_err(|_| GoogleDriveOAuthError::InvalidConfiguration)?;
        if url.scheme() != "https"
            || url.host_str() != Some("accounts.google.com")
            || url.path() != "/o/oauth2/v2/auth"
            || url.username() != ""
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err(GoogleDriveOAuthError::InvalidConfiguration.into());
        }
        let mut query = HashMap::new();
        for (key, value) in url.query_pairs() {
            if query.insert(key.into_owned(), value.into_owned()).is_some() {
                return Err(GoogleDriveOAuthError::InvalidConfiguration.into());
            }
        }
        if query.get("redirect_uri").map(String::as_str) != Some(attempt.redirect_uri.as_str())
            || query.get("state").map(String::as_str) != Some(attempt.state.as_str())
        {
            return Err(GoogleDriveOAuthError::InvalidConfiguration.into());
        }
        Ok(())
    }

    fn accept_until(&self, deadline: Instant) -> Result<TcpStream, LoopbackRuntimeError> {
        loop {
            match self.listener.accept() {
                Ok((stream, _)) => return Ok(stream),
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    let now = Instant::now();
                    if now >= deadline {
                        return Err(GoogleDriveOAuthError::CallbackTimeout.into());
                    }
                    thread::sleep(ACCEPT_POLL_INTERVAL.min(deadline.duration_since(now)));
                }
                Err(_) => return Err(LoopbackRuntimeError::CallbackIo),
            }
        }
    }
}

fn read_request(
    stream: &mut TcpStream,
    deadline: Instant,
) -> Result<Vec<u8>, LoopbackRuntimeError> {
    let mut request = Vec::with_capacity(1024);
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(GoogleDriveOAuthError::CallbackTimeout.into());
        }
        stream
            .set_read_timeout(Some(deadline.duration_since(now)))
            .map_err(|_| LoopbackRuntimeError::CallbackIo)?;
        let mut chunk = [0_u8; 1024];
        let remaining = (MAX_REQUEST_BYTES + 1).saturating_sub(request.len());
        if remaining == 0 {
            break;
        }
        let read_limit = remaining.min(chunk.len());
        match stream.read(&mut chunk[..read_limit]) {
            Ok(0) => break,
            Ok(read) => {
                request.extend_from_slice(&chunk[..read]);
                if request.len() > MAX_REQUEST_BYTES || request.windows(4).any(|v| v == b"\r\n\r\n")
                {
                    break;
                }
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                return Err(GoogleDriveOAuthError::CallbackTimeout.into());
            }
            Err(_) => return Err(LoopbackRuntimeError::CallbackIo),
        }
    }
    Ok(request)
}

fn write_response(stream: &mut TcpStream, success: bool) {
    let body = if success {
        loopback_success_html()
    } else {
        loopback_error_html()
    };
    let status = if success { "200 OK" } else { "400 Bad Request" };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn validate_callback_path(path: &str) -> Result<(), LoopbackRuntimeError> {
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.len() > 128
        || path
            .chars()
            .any(|character| matches!(character, '?' | '#' | '\\'))
        || !path
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.'))
    {
        Err(GoogleDriveOAuthError::InvalidConfiguration.into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Read,
        net::{Shutdown, SocketAddr},
        sync::{Arc, Mutex},
    };
    use zeroize::Zeroizing;

    const PATH: &str = "/oauth/callback";
    const STATE: &str = "abcdefghijklmnopqrstuvwxyzABCDEF";

    struct ConnectingBrowser {
        address: SocketAddr,
        request: Vec<u8>,
        stall_after_send: Duration,
        opened_url: Mutex<Option<String>>,
        response: Arc<Mutex<Vec<u8>>>,
        worker: Mutex<Option<thread::JoinHandle<()>>>,
    }

    impl ConnectingBrowser {
        fn new(address: SocketAddr, request: Vec<u8>) -> Self {
            Self {
                address,
                request,
                stall_after_send: Duration::ZERO,
                opened_url: Mutex::new(None),
                response: Arc::new(Mutex::new(Vec::new())),
                worker: Mutex::new(None),
            }
        }

        fn with_stall(mut self, delay: Duration) -> Self {
            self.stall_after_send = delay;
            self
        }

        fn join(&self) -> Vec<u8> {
            if let Some(worker) = self.worker.lock().unwrap().take() {
                worker.join().unwrap();
            }
            self.response.lock().unwrap().clone()
        }
    }

    impl BrowserOpener for ConnectingBrowser {
        fn open(&self, authorization_url: &str) -> Result<(), BrowserOpenError> {
            *self.opened_url.lock().unwrap() = Some(authorization_url.to_owned());
            let address = self.address;
            let request = self.request.clone();
            let stall = self.stall_after_send;
            let response = Arc::clone(&self.response);
            *self.worker.lock().unwrap() = Some(thread::spawn(move || {
                let mut stream = TcpStream::connect(address).unwrap();
                if stream.write_all(&request).is_err() {
                    return;
                }
                if !stall.is_zero() {
                    thread::sleep(stall);
                }
                let _ = stream.shutdown(Shutdown::Write);
                let _ = stream.read_to_end(&mut response.lock().unwrap());
            }));
            Ok(())
        }
    }

    struct NoConnectionBrowser;
    impl BrowserOpener for NoConnectionBrowser {
        fn open(&self, _authorization_url: &str) -> Result<(), BrowserOpenError> {
            Ok(())
        }
    }

    struct FailingBrowser;
    impl BrowserOpener for FailingBrowser {
        fn open(&self, _authorization_url: &str) -> Result<(), BrowserOpenError> {
            Err(BrowserOpenError::Failed)
        }
    }

    fn authorization_attempt(session: &BoundLoopbackSession) -> AuthorizationAttempt {
        let redirect_uri = session.redirect_uri();
        let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
        url.query_pairs_mut()
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("state", STATE);
        AuthorizationAttempt {
            authorization_url: url.into(),
            redirect_uri,
            state: STATE.to_owned(),
            code_verifier: Zeroizing::new("v".repeat(43)),
        }
    }

    fn address(session: &BoundLoopbackSession) -> SocketAddr {
        SocketAddr::from((Ipv4Addr::LOCALHOST, session.port()))
    }

    #[test]
    fn valid_local_callback_returns_code_and_static_success_page() {
        let session = BoundLoopbackSession::bind(PATH, Duration::from_secs(1)).unwrap();
        assert_ne!(session.port(), 0);
        assert!(session.redirect_uri().starts_with("http://127.0.0.1:"));
        let attempt = authorization_attempt(&session);
        let request =
            format!("GET {PATH}?code=code-123&state={STATE} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        let browser = ConnectingBrowser::new(address(&session), request.into_bytes());
        let callback = session.open_and_wait(&attempt, &browser).unwrap();
        assert_eq!(callback.code, "code-123");
        assert_eq!(
            browser.opened_url.lock().unwrap().as_deref(),
            Some(attempt.authorization_url.as_str())
        );
        let response = String::from_utf8(browser.join()).unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains(loopback_success_html()));
        assert!(response.contains("Cache-Control: no-store"));
    }

    #[test]
    fn wrong_state_is_rejected_with_static_error_page() {
        let session = BoundLoopbackSession::bind(PATH, Duration::from_secs(1)).unwrap();
        let attempt = authorization_attempt(&session);
        let request = format!(
            "GET {PATH}?code=code-123&state={} HTTP/1.1\r\n\r\n",
            "z".repeat(32)
        );
        let browser = ConnectingBrowser::new(address(&session), request.into_bytes());
        assert!(matches!(
            session.open_and_wait(&attempt, &browser),
            Err(LoopbackRuntimeError::OAuth(
                GoogleDriveOAuthError::InvalidCallback
            ))
        ));
        let response = String::from_utf8(browser.join()).unwrap();
        assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        assert!(response.contains(loopback_error_html()));
    }

    #[test]
    fn callback_read_is_bounded_and_connected_timeout_gets_error_page() {
        let session = BoundLoopbackSession::bind(PATH, Duration::from_secs(1)).unwrap();
        let attempt = authorization_attempt(&session);
        let browser =
            ConnectingBrowser::new(address(&session), vec![b'x'; MAX_REQUEST_BYTES + 1024]);
        assert!(matches!(
            session.open_and_wait(&attempt, &browser),
            Err(LoopbackRuntimeError::OAuth(
                GoogleDriveOAuthError::InvalidCallback
            ))
        ));
        let _ = browser.join();

        let session = BoundLoopbackSession::bind(PATH, Duration::from_millis(40)).unwrap();
        let attempt = authorization_attempt(&session);
        let browser = ConnectingBrowser::new(address(&session), b"GET /".to_vec())
            .with_stall(Duration::from_millis(80));
        assert!(matches!(
            session.open_and_wait(&attempt, &browser),
            Err(LoopbackRuntimeError::OAuth(
                GoogleDriveOAuthError::CallbackTimeout
            ))
        ));
        assert!(String::from_utf8(browser.join())
            .unwrap()
            .starts_with("HTTP/1.1 400 Bad Request\r\n"));
    }

    #[test]
    fn no_connection_times_out_and_browser_failure_returns_immediately() {
        let session = BoundLoopbackSession::bind(PATH, Duration::from_millis(30)).unwrap();
        let attempt = authorization_attempt(&session);
        assert!(matches!(
            session.open_and_wait(&attempt, &NoConnectionBrowser),
            Err(LoopbackRuntimeError::OAuth(
                GoogleDriveOAuthError::CallbackTimeout
            ))
        ));

        let session = BoundLoopbackSession::bind(PATH, Duration::from_secs(1)).unwrap();
        let attempt = authorization_attempt(&session);
        assert!(matches!(
            session.open_and_wait(&attempt, &FailingBrowser),
            Err(LoopbackRuntimeError::Browser(BrowserOpenError::Failed))
        ));
    }

    #[test]
    fn attempt_must_match_bound_redirect_before_browser_opens() {
        let session = BoundLoopbackSession::bind(PATH, Duration::from_secs(1)).unwrap();
        let mut attempt = authorization_attempt(&session);
        attempt.redirect_uri = "http://127.0.0.1:1/oauth/callback".to_owned();
        assert!(matches!(
            session.open_and_wait(&attempt, &FailingBrowser),
            Err(LoopbackRuntimeError::OAuth(
                GoogleDriveOAuthError::InvalidConfiguration
            ))
        ));
    }
}
