# Architecture

KakeFlow separates evidence, extracted business events, review state, ledger postings, and analytical read models. A successful extraction is never equivalent to a confirmed transaction.

![Local-first processing pipeline](assets/infographics/data-pipeline.svg)

## Components

| Component | Responsibility |
| --- | --- |
| React application | Review workflows, navigation, local presentation state, typed IPC clients |
| Tauri/Rust core | SQLCipher persistence, filesystem access, credentials, OCR orchestration, exports, backup and restore |
| Import adapters | Strict format detection, decoding, validation, normalization and source-row lineage |
| Evidence vault | Encrypted originals, digests, page/row references and derived previews |
| Read models | Monthly totals, cards, investments, reports and action-center projections |
| Reference relay | Authenticated transport for opaque personal or family artifacts |

## Data ownership

The desktop database and evidence vault are authoritative. Browser preview data is fictional. Relays are transport, not accounting systems, and do not interpret or mutate ledger data.

## Invariants

1. Preserve the source document and its digest.
2. Fail closed when the format or accounting meaning is ambiguous.
3. Require explicit approval before posting or applying received data.
4. Keep transfers and liability settlements out of expense and income totals.
5. Keep native currencies separate unless a source-backed FX rate exists.
6. Make displayed and exported numbers traceable to scope and source.
