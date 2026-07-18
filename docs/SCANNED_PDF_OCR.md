# Scanned PDF OCR

KakeFlow provides explicit offline OCR for image-only and hybrid PDFs. Embedded text extraction runs first; the user starts local OCR only for pages that need it. No document is sent to a remote service and OCR never posts a transaction.

```text
PDF
  -> bounded text extraction
  -> explicit local OCR
  -> immutable full-document source
  -> page-level receipt interpretation
  -> REVIEW_REQUIRED candidate
  -> explicit approval
```

Each page is evaluated independently. Only a non-statement page with a valid receipt date and total can create a candidate. Blank and statement pages create no expense. Candidate evidence links its page as primary and the full document as supporting; a document with no eligible page remains source-only.

## Evidence and bounds

- Original PDF bytes remain immutable.
- Every page has an outcome, including empty OCR.
- OCR regions preserve one-based page, pixel bounds, confidence, and `PADDLEOCR_V5_LINE` provenance.
- Passwords are ephemeral and never become evidence.
- Limits: 25 MiB, 32 pages, 32 million rendered pixels, and bounded dimensions/regions.
- Timeout, missing engine/model, password, oversized, and no-text outcomes remain distinct.

The primary engine uses checksum-pinned PP-OCRv5 models and lazy-loaded ONNX Runtime Web assets staged under `public/ocr/paddleocr`. Native code rasterizes pages; the shared OCR pipeline recognizes direct images, Capture originals, and rendered pages. Packaged Tesseract remains a compatibility fallback during migration.
