# Synthetic OCR regression receipts

These JPEG fixtures are rendered from `ocr-fixture-renderer.html`. They contain invented merchants, dates, products, telephone numbers and totals; no customer, payment, loyalty or real business data is present.

- `receipt-spaced-yen.synthetic.jpg` protects parsing of visually spaced yen totals such as `￥2 3 3`.
- `receipt-tax-marker.synthetic.jpg` protects parsing of leading reduced-tax markers such as `*138`.

The accompanying model regression suite runs the bundled PP-OCRv5 models against these images and then checks the parsed date, total, tax and item values. Keep the synthetic source and expected values together when changing a fixture.

Verification:

```bash
npm test -- --run src/features/import/ocrRegressionCases.test.ts
npm run paddleocr:verify
```

Never replace these fixtures with a real receipt, even after redaction. Add a new deterministic case to `ocr-fixture-renderer.html` and its expected values to the regression catalog instead.
