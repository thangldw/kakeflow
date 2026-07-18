# Local email attachment import

KakeFlow can import one supported tabular attachment from a locally saved RFC 5322 `.eml` message. It does not connect to a mailbox or retain email credentials. Watched folders may discover `.eml` files already present on the device.

## Evidence model

The complete message remains the encrypted immutable source. The decoded attachment is recorded as a source part:

```text
message.eml
  -> attachment.csv
  -> physical source row
  -> review candidate
```

Approval, account mapping, deduplication, rollback, and evidence review match direct file imports. Parsing an email never posts a transaction.

## MIME limits

PostalMime parsing is bounded to a 25 MiB message, 20 decoded attachments, 10 MiB per attachment, 25 MiB total decoded bytes, and one non-inline `.csv`, `.tsv`, or `.xlsx` attachment. Multiple tabular attachments, unsafe names, malformed MIME, excessive nesting/headers, or missing supported attachments fail closed.

PDF and image parts are not promoted through this path; save and import them through the document/OCR workflow. The [Gmail connector](GMAIL_CONNECTOR.md) reuses the same parser and review boundary.
