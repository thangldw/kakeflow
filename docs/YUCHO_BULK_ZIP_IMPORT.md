# Yucho Direct bulk ZIP import

KakeFlow 0.28 can open a ZIP produced by Yucho Direct's bulk CSV download as a manual import. The archive is a transport container only: each CSV becomes an independent child preview and is parsed by the normal adapter pipeline.

Official references:

- [Yucho Direct transaction inquiry and CSV structure](https://www.jp-bank.japanpost.jp/direct/pc/guide/dr_pc_gd_meisai.html)
- [Japan Post Bank CSV download and size guidance](https://faq.jp-bank.japanpost.jp/faq_detail.html?id=134)

## Review workflow

```text
Select or drop archive.zip
  -> validate the complete archive
  -> expand distinct CSV payloads in deterministic filename order
  -> preview archive.zip › entry.csv
  -> select the destination account when required
  -> review every candidate
  -> post explicitly through the existing import workflow
```

The child source document retains both the archive filename and entry name in its displayed provenance. Its extracted bytes are hashed, stored, staged, deduplicated, and reviewed like an ordinary CSV. Byte-identical CSV entries collapse to the first deterministic filename and produce a visible `duplicate → canonical` warning, matching the content-addressed source store instead of silently losing a second preview. A ZIP never bypasses adapter detection or creates a ledger transaction by itself.

This capability is intentionally limited to manual file selection and drag-and-drop. Registered folder watchers continue to accept their existing standalone file formats and do not claim ZIP support.

## Atomic validation

KakeFlow validates the complete central directory before decompressing any entry. If one entry is unsafe or inconsistent, the entire archive produces one error preview and no safe-looking siblings are retained.

The importer rejects:

- malformed end records, central directories, local headers, names, boundaries, CRCs, or trailing data;
- split/multidisk and ZIP64 archives;
- encrypted entries, strong-encryption flags, and compression other than stored or deflated;
- directories, nested paths, drive-qualified paths, traversal names, control characters, and names that collide after Unicode/case normalization;
- non-ASCII entry names whose ZIP metadata does not explicitly declare UTF-8, because ambiguous CP932/legacy names cannot be decoded consistently across ZIP readers;
- archives over 25 MB, more than 20 entries, entries over 10 MB, or more than 50 MB declared expanded data.

Expanded CSV entries count toward the existing 20-preview limit for the whole selected batch. Non-CSV entries are ignored only after validation succeeds and are disclosed once to the user. An archive with no CSV is rejected.

## Accounting boundary

ZIP expansion changes only source ingestion. The Yucho CSV adapter still applies its seven-column validation, requires an explicit bank-account selection for every distinct child, preserves immutable raw-row evidence, and uses the same pending-review workflow described in [Yucho Direct transaction import](YUCHO_DIRECT_IMPORT.md). No archive or child file is posted automatically.
