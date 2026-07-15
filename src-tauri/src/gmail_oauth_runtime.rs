//! Native loopback runtime dedicated to Gmail's desktop OAuth callback.

use crate::gmail_oauth::{
    gmail_loopback_error_html, gmail_loopback_success_html, parse_gmail_loopback_callback,
    GmailAuthorizationAttempt, GmailAuthorizationCallback, GmailLoopbackInput, GmailOAuthError,
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
pub enum GmailLoopbackRuntimeError {
    #[error(transparent)]
    OAuth(#[from] GmailOAuthError),
    #[error("OAuth loopback listener could not be started")]
    ListenerUnavailable,
    #[error("OAuth callback could not be read")]
    CallbackIo,
    #[error(transparent)]
    Browser(#[from] BrowserOpenError),
}

pub struct BoundGmailLoopbackSession {
    listener: TcpListener,
    callback_path: String,
    timeout: Duration,
}

impl BoundGmailLoopbackSession {
    pub fn bind(callback_path: &str, timeout: Duration) -> Result<Self, GmailLoopbackRuntimeError> {
        if !valid_path(callback_path) || timeout.is_zero() || timeout > Duration::from_secs(600) {
            return Err(GmailOAuthError::InvalidConfiguration.into());
        }
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| GmailLoopbackRuntimeError::ListenerUnavailable)?;
        listener
            .set_nonblocking(true)
            .map_err(|_| GmailLoopbackRuntimeError::ListenerUnavailable)?;
        Ok(Self {
            listener,
            callback_path: callback_path.into(),
            timeout,
        })
    }

    pub fn port(&self) -> u16 {
        self.listener
            .local_addr()
            .map_or(0, |address| address.port())
    }

    fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}{}", self.port(), self.callback_path)
    }

    pub fn open_and_wait(
        self,
        attempt: &GmailAuthorizationAttempt,
        browser: &impl BrowserOpener,
    ) -> Result<GmailAuthorizationCallback, GmailLoopbackRuntimeError> {
        self.validate_attempt(attempt)?;
        browser.open(&attempt.authorization_url)?;
        let deadline = Instant::now() + self.timeout;
        let mut stream = self.accept(deadline)?;
        let request = read_request(&mut stream, deadline)?;
        let parsed = parse_gmail_loopback_callback(
            GmailLoopbackInput::Request(&request),
            &self.callback_path,
            &attempt.state,
        );
        write_response(&mut stream, parsed.is_ok());
        parsed.map_err(Into::into)
    }

    fn validate_attempt(
        &self,
        attempt: &GmailAuthorizationAttempt,
    ) -> Result<(), GmailLoopbackRuntimeError> {
        if attempt.redirect_uri != self.redirect_uri() {
            return Err(GmailOAuthError::InvalidConfiguration.into());
        }
        let url = Url::parse(&attempt.authorization_url)
            .map_err(|_| GmailOAuthError::InvalidConfiguration)?;
        if url.scheme() != "https"
            || url.host_str() != Some("accounts.google.com")
            || url.path() != "/o/oauth2/v2/auth"
        {
            return Err(GmailOAuthError::InvalidConfiguration.into());
        }
        let query = url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect::<HashMap<_, _>>();
        if query.get("redirect_uri") != Some(&attempt.redirect_uri)
            || query.get("state") != Some(&attempt.state)
        {
            return Err(GmailOAuthError::InvalidConfiguration.into());
        }
        Ok(())
    }

    fn accept(&self, deadline: Instant) -> Result<TcpStream, GmailLoopbackRuntimeError> {
        loop {
            match self.listener.accept() {
                Ok((stream, _)) => return Ok(stream),
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    let now = Instant::now();
                    if now >= deadline {
                        return Err(GmailOAuthError::CallbackTimeout.into());
                    }
                    thread::sleep(ACCEPT_POLL_INTERVAL.min(deadline.duration_since(now)));
                }
                Err(_) => return Err(GmailLoopbackRuntimeError::CallbackIo),
            }
        }
    }
}

fn read_request(
    stream: &mut TcpStream,
    deadline: Instant,
) -> Result<Vec<u8>, GmailLoopbackRuntimeError> {
    let mut request = Vec::with_capacity(1024);
    while request.len() <= MAX_REQUEST_BYTES && !request.windows(4).any(|v| v == b"\r\n\r\n") {
        let now = Instant::now();
        if now >= deadline {
            return Err(GmailOAuthError::CallbackTimeout.into());
        }
        stream
            .set_read_timeout(Some(deadline.duration_since(now)))
            .map_err(|_| GmailLoopbackRuntimeError::CallbackIo)?;
        let mut chunk = [0_u8; 1024];
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => request.extend_from_slice(&chunk[..count]),
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                return Err(GmailOAuthError::CallbackTimeout.into())
            }
            Err(_) => return Err(GmailLoopbackRuntimeError::CallbackIo),
        }
    }
    if request.len() > MAX_REQUEST_BYTES {
        return Err(GmailOAuthError::InvalidCallback.into());
    }
    Ok(request)
}

fn write_response(stream: &mut TcpStream, success: bool) {
    let body = if success {
        gmail_loopback_success_html()
    } else {
        gmail_loopback_error_html()
    };
    let status = if success { "200 OK" } else { "400 Bad Request" };
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn valid_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.starts_with("//")
        && path.len() <= 128
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.'))
}
