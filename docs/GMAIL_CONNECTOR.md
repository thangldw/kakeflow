# Gmail Connector Contract

KakeFlow's Gmail connector is a read-only desktop ingestion channel for raw
RFC 5322 messages. It is designed to feed the existing `.eml` parser and
canonical Import Inbox; receiving a message never posts a ledger transaction.

## Current implementation status

The desktop connector is implemented and locally tested:

- installed-app loopback OAuth with PKCE and the fixed
  `https://www.googleapis.com/auth/gmail.readonly` scope;
- a separate operating-system credential-store namespace bound to the exact
  household, connection, OAuth client fingerprint, and scope;
- bounded Gmail profile, message-list, raw-message, and history clients;
- label-scoped history additions and removals;
- exact base64url decoding of bounded raw RFC 5322 bytes;
- durable account, label, query, cursor, schedule, lease, retry, Inbox, and
  canonical source-link persistence; and
- bounded initial/history synchronization, exact raw-message hydration into the
  document vault, idempotent message identity, omission reconciliation, review
  staging, retry, ignore, and exact rollback state;
- desktop commands for connection, label binding, manual synchronization,
  schedule control, Inbox lifecycle, and disconnect;
- opt-in 15/30/60-minute incremental polling while KakeFlow is open; and
- Settings and Import Inbox presentation that reuse the existing `.eml`
  preview and explicit review workflow.

These capabilities are present on `main` after `v0.90.0` and are planned for
the next major release. The public stable release must not claim live Gmail
availability until the `v1.0.0` release gates and external provider
qualification described below are complete.

## Connector boundary

Each connection belongs to one household and one Google account. The user
binds one Gmail label and a bounded search query. Initial synchronization lists
matching messages under that label. Incremental synchronization consumes the
Gmail history feed for the same label and handles:

- newly delivered messages;
- messages newly assigned to the selected label;
- selected-label removal; and
- permanent message deletion.

A Gmail message ID is the durable provider identity. Gmail messages are
immutable, so repeated history or label events never create another source
generation. Removal changes only the unreviewed remote Inbox state; it never
deletes an immutable source document or posted ledger evidence.

## Evidence and review

The connector retrieves `users.messages.get` with `format=raw`, decodes the
provider's base64url value, and stores the exact RFC 5322 bytes in the local
document vault. SQLite stores bounded metadata and the content digest, not the
message body.

```text
Gmail message ID
  -> exact raw .eml bytes
  -> immutable GMAIL source document
  -> existing RFC 5322 attachment parser
  -> explicit account mapping
  -> canonical REVIEW_REQUIRED import
  -> user approval or rollback
```

The existing `.eml` rules remain authoritative: exactly one supported
CSV/TSV/XLSX attachment is selected, ambiguous or unsupported messages fail
closed, and the attachment name remains `sourcePart` beneath the original
message evidence.

## Synchronization invariants

- A history cursor is published only after all corresponding metadata changes
  have been committed.
- An expired Gmail history cursor atomically marks the connection for a fresh
  bounded full reconciliation under a new lease.
- Message discovery and hydration use separate leases.
- Refresh credentials and provider message identifiers never cross the WebView
  IPC boundary. Exact EML bytes can cross only through an explicit,
  household-scoped local Inbox read so the existing local parser can generate
  a review preview; the native side authenticates the vault object first.
- Automatic polling is opt-in and runs only while KakeFlow is open.
- No Gmail API operation sends, labels, archives, deletes, or otherwise mutates
  mail.

## External production blockers

Public availability requires a Google Cloud project with the Gmail API
enabled, a desktop OAuth client, an approved consent screen, required
restricted-scope verification, and packaged real-account validation on macOS
and Windows. Local deterministic tests and unverified test-user access do not
prove production availability.

Official references:

- [List Gmail messages](https://developers.google.com/workspace/gmail/api/guides/list-messages)
- [Retrieve raw messages](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)
- [Synchronize Gmail clients](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Gmail history API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)
