# Yucho Direct bulk ZIP import

KakeFlow can expand a manually selected Yucho Direct bulk-download ZIP. The archive is a transport container; each CSV becomes an independent child preview and still uses the normal adapter, account mapping, review, and posting workflow.

## Workflow

```text
archive selection
  -> complete ZIP validation
  -> deterministic CSV expansion
  -> child preview and account mapping
  -> candidate review
  -> explicit posting
```

Child provenance retains the archive and entry names. Exact duplicate payloads collapse to the first deterministic filename with a visible warning. The source store hashes and encrypts extracted bytes like direct CSV uploads.

## Security limits

Validation is atomic and rejects malformed structures, trailing data, split/multidisk, ZIP64, encryption, unsupported compression, nested/traversal/control-character names, normalized-name collisions, ambiguous legacy filenames, archives over 25 MiB, more than 20 entries, entries over 10 MiB, or more than 50 MiB declared expansion.

Only stored/deflated CSV entries are eligible. Non-CSV entries are disclosed after successful validation; an archive with no CSV is rejected. Folder watchers do not claim ZIP support.

ZIP handling never creates a transaction. Each child remains subject to [Yucho Direct import](YUCHO_DIRECT_IMPORT.md) and explicit review.
