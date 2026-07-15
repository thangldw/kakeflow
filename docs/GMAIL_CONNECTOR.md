# Gmail Connector Contract

KakeFlow's Gmail connector is a read-only desktop ingestion channel for raw
RFC 5322 messages. It is designed to feed the existing `.eml` parser and
canonical Import Inbox; receiving a message never posts a ledger transaction.

## Current implementation status

The native foundation is implemented and locally tested:

- installed-app loopback OAuth with PKCE and the fixed
  `https://www.googleapis.com/auth/gmail.readonly` scope;
- a separate operating-system credential-store namespace bound to the exact
  household, connection, OAuth client fingerprint, and scope;
- bounded Gmail profile, message-list, raw-message, and history clients;
- label-scoped history additions and removals;
- exact base64url decoding of bounded raw RFC 5322 bytes;
- durable account, label, query, cursor, schedule, lease, retry, Inbox, and
  canonical source-link persistence; and
- idempotent message identity, review staging, retry, ignore, exact rollback,
  and full-reconciliation state.

Desktop commands, background execution, raw-message hydration, Settings, and
Import Inbox presentation remain the next implementation milestone. Therefore
the current stable release must not claim that a live Gmail connection is
available.

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
- Raw bytes and refresh credentials never cross the WebView IPC boundary.
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
