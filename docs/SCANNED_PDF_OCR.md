# Scanned PDF OCR

KakeFlow adds an explicit, offline OCR path for image-only and hybrid PDF
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
- OCR line regions retain one-based page numbers, pixel coordinates,
  confidence, and `PADDLEOCR_V5_LINE` provenance for source-viewer overlays.
- Passwords are ephemeral and are not added to import evidence.
- OCR is limited to 25 MiB, 32 pages, 32 million rendered pixels, and bounded
  page/region dimensions before data is accepted back by the native layer.
- Oversized, timed-out, engine-missing, model-missing, password, and no-text
  outcomes remain distinguishable in Import Inbox.

## Runtime packaging

The primary OCR path uses `@paddleocr/paddleocr-js` with checksum-pinned
PP-OCRv5 mobile detection and recognition models. ONNX Runtime Web assets are
staged under `public/ocr/paddleocr` and loaded lazily so application startup does
not parse or preload the OCR engine. `npm run paddleocr:verify` checks model
size/checksum and the bundled WASM runtime before packaging.

Native code rasterizes bounded PDF pages but does not recognize them. The same
PP-OCRv5 pipeline then handles direct images, Capture Inbox originals, and every
rendered PDF page, preserving blank-page outcomes and page numbering. The
legacy packaged Tesseract runtime remains only as a compatibility/rollback path
during migration and can be removed after native Windows and Linux validation.

Windows and Linux OCR are not claimed as release evidence until their packaged
applications have been exercised on those operating systems. Current public
installers remain unsigned/ad-hoc macOS Apple Silicon artifacts.
