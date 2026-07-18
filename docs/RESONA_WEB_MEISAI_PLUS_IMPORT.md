# Resona Web入出金明細PLUS import

The `resona-web-meisai-plus-v1` adapter implements the fourteen-column record family in Resona Bank's [official CSV format](https://www.resonabank.co.jp/hojin/b_direct/recordformat/pdf/meisaiplus_csv.pdf).

## Exact header

```text
照会口座,番号,勘定日,(起算日),出金金額(円),入金金額(円),小切手区分,
残高(円),取引区分,明細区分,金融機関名,支店名,摘要,メモ
```

The first physical record must match this order after NFKC normalization. Preambles, aliases, multiline headers, and missing/extra/reordered fields are rejected.

## Detail rules

Each row requires one consistent account descriptor, a decimal sequence beginning at 1, valid dates, exactly one positive safe-integer JPY debit or credit, unsigned balance, matching `入金`/`出金` direction, blank published-only fields, and bounded description/memo content.

Physical dates and balances must prove exactly one source order. Sequence numbers remain provenance and are not durable transaction IDs.

## Cancellation boundary

`取消`, unknown detail classifications, nonblank fields documented as blank, malformed values, negative balances, grouped/fractional values, mixed accounts, or continuity failures block the complete source. The public format does not prove reversal linkage, so KakeFlow never negates, pairs, or silently removes cancellation rows.

The user selects one active bank asset account. Every accepted row retains all fourteen raw fields and follows normal review, deduplication, posting, and rollback.
