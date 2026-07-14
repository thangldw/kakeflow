# Local email attachment import

KakeFlow can import a locally saved RFC 5322 `.eml` message containing one
supported tabular financial attachment. This is a local-first evidence path; it
does not connect to, scan, or retain credentials for an email account.

## Evidence model

The complete `.eml` bytes are hashed, encrypted, and stored as the immutable
source document. KakeFlow does not replace that source with the decoded
attachment. Rows parsed from the attachment carry its decoded filename as
`sourcePart`, so transaction drill-down retains this relationship:

```text
statement.eml (immutable source document)
└── bank.csv (sourcePart)
    └── physical CSV row
        └── review-required transaction candidate
```

The source filename and media type remain `statement.eml` and
`message/rfc822`. Candidate approval, account selection, deduplication, posting,
rollback, and evidence review use the same boundaries as a direct CSV/XLSX
upload. Receiving or parsing an email never posts a transaction automatically.

## Bounded MIME behavior

KakeFlow uses the browser-compatible
[PostalMime parser](https://postal-mime.postalsys.com/) with bounded header and
nesting depth. The import boundary allows:

- one `.eml` source up to the ordinary 25 MiB file limit;
- at most 20 decoded MIME attachments;
- at most 10 MiB per decoded attachment and 25 MiB total;
- inline presentation parts to remain non-importable; and
- exactly one non-inline `.csv`, `.tsv`, or `.xlsx` attachment.

If multiple tabular attachments are present, KakeFlow blocks the message rather
than choosing a destination account implicitly. The user can save and import
each attachment separately. Duplicate or unsafe non-inline filenames, malformed
MIME, excessive nesting/headers, and missing supported attachments also fail
closed with an explicit issue code.

## Current boundary

PDF and receipt-image attachments are not decoded into document-viewer or OCR
sources in this version. They can still be saved and imported directly through
the existing PDF/image workflow. Unsupported tabular schemas remain blocked;
the email container does not bypass adapter validation.

Direct mailbox APIs, background email polling, server-side forwarding, and
provider OAuth are separate future connector work. KakeFlow currently requires
the user to export or save the message as `.eml` and select or drop it locally.
