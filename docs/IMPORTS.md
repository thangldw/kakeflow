# Imports

All imports follow one lifecycle:

1. Preserve the original bytes and detect encoding and format.
2. Parse with a strict source adapter or an explicit custom profile.
3. Normalize rows into review candidates with source lineage.
4. Resolve destination accounts, duplicates, categories, and posting splits.
5. Require explicit approval before balanced ledger entries are created.

## Supported source families

| Family | Examples |
| --- | --- |
| Bank | MUFG BizSTATION, Mizuho Business Web, Resona Web, ゆうちょ Direct, personal Japanese bank CSV |
| Card and wallet | Rakuten Card PDF, SMBC Vpass, JCB MyJCB, AEON, PayPay Card, PayPay history |
| Investments | SBI, Rakuten Securities, Monex US stocks, Japanese brokerage transaction files, `assetbalance(all)` snapshots |
| Aggregators | Money Forward household ledger and asset history |
| Documents | CSV, TSV, Excel, text PDF, password PDF, scanned PDF, receipt image, ZIP, EML |
| Connectors | Gmail labels, Google Drive folders, watched local or iCloud Drive folders |

## Strict behavior

- Shift-JIS and UTF encodings are detected without rewriting the source.
- Required headers, account roles, dates, amounts, currencies, and row bounds are validated.
- Unsupported statement PDFs are not collapsed into one expense.
- Exact and probable duplicates require a decision.
- A custom parser profile is versioned and must still pass preview validation.
- OCR is local; page failures remain visible and do not create transactions.

## Category taxonomy

The category tree reflects common Japanese 家計簿 use: food and dining, daily goods, housing, utilities, communications, transport, automobile, health, insurance, education, children, leisure, beauty and clothing, gifts and social costs, taxes and social insurance, business, investment, transfers, refunds, and uncategorized review. Rules may suggest a category; the user confirms the result.
