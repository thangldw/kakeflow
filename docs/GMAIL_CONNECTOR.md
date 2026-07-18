# Gmail connector contract

KakeFlow's Gmail connector is a read-only desktop ingestion channel for exact RFC 5322 messages. It feeds the existing `.eml` parser and Import Inbox; receiving mail never posts a ledger transaction.

## Availability

The native connector is implemented and locally tested for Google test users. General availability remains blocked on Google project configuration, restricted-scope verification, consent approval, and packaged real-account validation on macOS and Windows.

## Authorization

- Installed-app OAuth uses the system browser, loopback redirect, PKCE, and fixed `gmail.readonly` scope.
- Refresh credentials live in an OS credential-store namespace bound to household, connection, OAuth client fingerprint, and scope.
- Authorization codes, tokens, PKCE verifier, raw provider IDs, and credentials do not cross normal WebView IPC.
- KakeFlow never sends, labels, archives, deletes, or otherwise mutates mail.

## Synchronization

Each connection binds one Google account, one Gmail label, and a bounded query. Initial sync lists matching messages; incremental sync consumes label-scoped history for additions, label removal, and deletion.

Gmail message ID is the durable provider identity. Repeated events are idempotent. Remote removal affects only unreviewed inbox state and never deletes immutable local evidence or posted transactions. History cursors advance only after metadata changes commit; expired cursors schedule a bounded full reconciliation.

Automatic polling is opt-in at 15, 30, or 60 minutes and runs only while KakeFlow is open.

## Evidence and review

```text
Gmail message ID
  -> exact raw .eml bytes
  -> immutable GMAIL source
  -> bounded attachment parsing
  -> explicit account mapping
  -> REVIEW_REQUIRED import
  -> approval or rollback
```

SQLite retains bounded metadata and the digest, while exact message bytes live in the document vault. The `.eml` contract permits exactly one supported CSV/TSV/XLSX attachment and preserves its name as `sourcePart`.

Official references: [list messages](https://developers.google.com/workspace/gmail/api/guides/list-messages), [retrieve raw messages](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get), and [history synchronization](https://developers.google.com/workspace/gmail/api/guides/sync).
