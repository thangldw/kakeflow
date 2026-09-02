# CodeQL triage — 31 August 2026

Scope: CodeQL Rust analysis `1690842243` on default-branch commit `70e195c75950d3c9e50160d7de342443571ea5e0`.

## Alert 8 — cleartext logging

- Rule: `rust/cleartext-logging` (high).
- Source: `src-tauri/src/document_extract.rs`, inside the unit test `extracts_password_protected_pdf_only_with_the_ephemeral_password`.
- Trace: synthetic extracted PDF text flowed into a custom `assert!` failure message. The flow did not reach production telemetry or an application log sink.
- Action: remove the extracted text from the assertion message. The test still verifies the expected synthetic marker without emitting the document body on failure.

Disposition after exact-head analysis: expected to close because the source flow is removed.

## Alert 9 — hard-coded cryptographic value

- Rule: `rust/hard-coded-cryptographic-value` (critical).
- Source: `crates/kakeflow-core/tests/wasm_contract.rs`, inside `argon2id_derivation_rejects_invalid_parameters`.
- Trace: the literal `b"short"` was intentionally passed as an invalid Argon2id salt in a negative test. It was not a production salt or secret.
- Action: derive the undersized test slice from the existing generated fixture buffer instead of passing a fixed byte literal.

Disposition after exact-head analysis: expected to close because the flagged literal is removed.

## Alert 10 — hard-coded cryptographic value

- Rule: `rust/hard-coded-cryptographic-value` (critical).
- Reported sink: `src-tauri/src/lib.rs`, the `tauri::generate_handler!` invocation.
- SARIF trace: four identical flows contain only the boolean literal `true` and a generated `match` expression at the macro invocation. The trace contains no string, password, credential, cryptographic API or secret-bearing source.
- Source review: the reported line registers Tauri commands; it does not create or consume a password.
- Action: retain the handler registration unchanged and classify the alert as a macro-expansion false positive after the replacement analysis confirms the same trace.

Disposition after exact-head analysis: dismiss as `false positive` with this document and the exact analysis identifier in the audit comment.

## Residual boundary

This triage does not dismiss the Linux-only `glib` advisory. That dependency remains documented separately because it is present in the Linux GUI graph and no compatible patched GTK/Tauri graph is currently available.
