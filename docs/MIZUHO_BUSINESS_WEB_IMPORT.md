# Mizuho Business Web statement import

The `mizuho-business-web-statement-v1` adapter implements the thirteen-field Shift_JIS CSV described in Mizuho's [official deposit/withdrawal inquiry manual](https://www.mizuhobank.co.jp/corporate/ebservice/b_web/pdf/zandaka.pdf). Filename text and unrelated Mizuho product names do not qualify a source.

## Exact header

```text
照会口座,番号,勘定日,(起算日),出金(円),入金(円),小切手区分,
残高(円),取引区分,明細区分,金融機関名,支店名,摘要
```

The header must be the first physical record and retain field order. NFKC-normalized parentheses are accepted; aliases, preambles, multiline headers, missing, extra, or reordered fields are rejected.

## Detail rules

Each row requires one consistent inquiry account, a bounded transaction number, valid Gregorian dates, exactly one positive safe-integer JPY debit or credit, a signed JPY balance, one official transaction type, a blank detail classification, and valid published field lengths. The populated amount determines direction.

For multiple rows, physical dates and adjacent balances must prove exactly one `OLDEST_FIRST` or `NEWEST_FIRST` order. Rows are never sorted to manufacture continuity. `(date, number)` must be unique, but the number is retained only as provenance.

## Fail-closed boundary

Negative amounts, `取消`, `欠番`, unknown classifications, mixed accounts, unsafe values, unsupported dates, or unresolved balance order block the complete source. KakeFlow does not infer reversal linkage or silently repair sequence gaps.

The user must map the source to one active `ASSET / BANK` account. Every candidate then follows normal review, deduplication, balanced posting, and rollback.
