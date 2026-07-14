# Scanned PDF OCR

KakeFlow 0.62 adds an explicit, offline OCR path for image-only and hybrid PDF
documents. PDF text extraction remains the first step. When one or more pages
need OCR, Import Inbox asks the user to start local OCR; it never sends the
document to a remote service and never posts a transaction automatically.

## Review boundary

```text
PDF selected
  -> bounded embedded-text extraction
  -> explicit local OCR when required
  -> immutable full-document source record
  -> page-wise receipt interpretation
  -> REVIEW_REQUIRED candidates
  -> explicit user approval
  -> ledger
```

A multi-page document is not treated as one purchase. KakeFlow creates one
candidate only for a page that independently contains a valid receipt date and
total and is not statement-like. Blank pages and statement pages create no
expense. Every candidate links its page evidence as `PRIMARY` and the complete
document as `SUPPORTING`; a document with no eligible pages is retained as a
source-only import.

## Evidence and limits

- Original PDF bytes remain the immutable source document.
- Every page has an explicit outcome, including empty OCR pages.
- OCR line and word regions retain one-based page numbers, pixel coordinates,
  confidence, and Tesseract provenance for source-viewer overlays.
- Passwords are ephemeral and are not added to import evidence.
- OCR is limited to 25 MiB, 32 pages, 80 million rendered pixels, 120 seconds
  total, and 30 seconds per page.
- Oversized, timed-out, engine-missing, model-missing, password, and no-text
  outcomes remain distinguishable in Import Inbox.

## Runtime packaging

Development builds may discover Tesseract 5.5.2 from `PATH`. A release bundle
is considered OCR-ready only when its resource directory contains an executable
`ocr/tesseract` (or `tesseract.exe`), `eng.traineddata`, `jpn.traineddata`, and
`tessdata/configs/tsv`. The macOS release staging script uses a pinned static
vcpkg build and verifies the staged resource manifest before packaging.

Windows OCR is not claimed until the corresponding static executable and
installer have been built and exercised on Windows. Current public installers
remain unsigned/ad-hoc macOS Apple Silicon artifacts.
