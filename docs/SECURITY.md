# Security

## Local data

- The desktop database uses SQLCipher.
- A random database key is stored in macOS Keychain or Windows Credential Manager.
- Original evidence and generated reports remain local unless the user exports or sends them.
- Backup and restore require explicit user action and validation.

## Import boundary

File type, size, encoding, archive paths, row counts, page counts, required fields and account roles are bounded. Unsupported semantics fail closed. Source bytes are not rewritten to make a parser succeed.

## Connectors and relays

Connector credentials belong in native credential storage, not the database, repository, screenshots, or logs. Relays authenticate requests but store opaque encrypted artifacts. Clients validate digest, schema, audience and membership before review.

## Reporting issues

Do not include real statements, account identifiers, credentials, evidence files, database copies, or recovery phrases in a public issue. Share a minimized fictional fixture and the exact version instead.
