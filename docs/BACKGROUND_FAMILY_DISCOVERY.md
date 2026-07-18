# Background family-delivery discovery

Family publication discovery is optional, process-scoped, and disabled by default. Intervals are 15, 30, or 60 minutes and run only while KakeFlow is open.

Native credentials are stored in Keychain/Credential Manager, bound to household, endpoint, and principal. Tokens never enter SQLite or WebView IPC.

## One scheduled run

The worker claims a lease, authenticates membership, verifies local encryption identity, refreshes relay mapping, lists bounded metadata after the durable cursor, registers `AVAILABLE` items, and advances state atomically.

With a separate preparation opt-in, the same run may select at most one oldest encrypted `KFE1`, verify size/SHA, decrypt for the current membership, and stage it. Legacy plaintext remains manual. Network requests occur outside database transactions; leases and bounded backoff recover interruptions.

Metadata discovery, download, and decryption never send outbound data, resolve conflicts, or apply household facts. Prepared artifacts remain `WAITING_FOR_REVIEW`/`READY_TO_APPLY` until explicit user Apply.

Credential expiry or revoked membership suspends scheduling. Disabling keeps already discovered rows and local changes. This feature is not push, realtime, automatic send/apply, remote erasure, or an OS background service.
