# Resona Web入出金明細PLUS CSV import

KakeFlow supports the fourteen-column **Web入出金明細PLUS** CSV record family published by Resona Bank. The dedicated `resona-web-meisai-plus-v1` adapter is based on the bank's May 2026 [official CSV record-format sheet](https://www.resonabank.co.jp/hojin/b_direct/recordformat/pdf/meisaiplus_csv.pdf), not on an inferred filename or third-party sample.

## Exact source contract

The first physical CSV record must contain exactly these fields in this order:

```text
照会口座,番号,勘定日,(起算日),出金金額(円),入金金額(円),小切手区分,
残高(円),取引区分,明細区分,金融機関名,支店名,摘要,メモ
```

Header comparison applies Unicode NFKC normalization, so the full-width parentheses printed in Japanese material and their ASCII equivalents are the same header. Aliases, reordered/extra/missing fields, a multiline header, and any preamble before the header are rejected. The published format says every field is double-quoted and comma-separated; KakeFlow's common RFC-style tokenizer handles those quotes and embedded escaped content, while the semantic detector relies on the complete field family.

## Supported detail semantics

Each accepted detail must satisfy all of these rules:

- exactly fourteen fields and the same non-empty inquiry-account descriptor throughout the file;
- a decimal `番号` sequence starting at `1` and increasing by one in physical source order;
- a valid Gregorian accounting date; an optional value date must also be valid;
- exactly one positive safe-integer JPY debit or credit using the published numeric field;
- an unsigned safe-integer JPY running balance;
- `取引区分` is exactly `入金` or `出金` and agrees with the populated amount;
- `明細区分` is blank;
- the published blank-only check, financial-institution, and branch fields remain blank; and
- description and memo remain within the published 69- and 40-character limits, with at least one present for review.

The official sheet gives a maximum character length for both date fields but does not publish one literal date presentation. KakeFlow accepts only the common Gregorian forms already validated by its Japanese date parser (`YYYY/MM/DD`, `YYYY-MM-DD`, `YYYY.MM.DD`, or a Japanese year/month/day form). It does not infer eras, two-digit years, or malformed dates.

For two or more details, source order and every adjacent balance must prove exactly one continuous `OLDEST_FIRST` or `NEWEST_FIRST` sequence. KakeFlow preserves the physical order; it never sorts rows to make balances reconcile. A single valid detail is reported as `SINGLE_ROW`.

`番号` is an export-local sequence and is retained only in immutable source-row provenance. It is not used as a durable external transaction ID. A card-like debit may be suggested as a card payment for review, but it is never posted automatically.

## Cancellation boundary

The official format permits `取消` in `明細区分`, but the record-format sheet does not define enough reversal linkage to prove which earlier detail is canceled. KakeFlow therefore reports `RESONA_PLUS_CANCELLATION_UNSUPPORTED` and blocks the entire source. It does not convert the row into income, negate an amount, pair by description, or silently omit it.

Unknown non-empty detail classifications and violations of fields documented as blank also fail closed. This keeps future layout or semantic changes visible instead of importing them under the v1 contract.

## Account mapping and provenance

The source inquiry-account text is checked for single-account consistency but is not persisted as parser metadata and is never used to select a ledger account. Before staging, the user must choose one existing active `ASSET / BANK` account. The adapter does not create an account or extract bank, branch, and account identifiers into the canonical ledger.

Every accepted candidate retains its complete immutable fourteen-field physical row and original source-row range. The account descriptor and export sequence remain available there for audit. The normalized transaction receives accounting date, amount direction, balance, description, optional value-date note, and memo; normal Import Inbox review and explicit approval are still required.

## Deliberate limits

- This adapter covers the published Resona Web入出金明細PLUS CSV family only; it does not claim compatibility with other Resona products or group-bank exports.
- At most 100,000 physical details are accepted in one file.
- Negative balances, fractions, zero amounts, digit grouping, currency markers, and unsafe integers are rejected under the published numeric-field contract.
- Cancellation/reversal repair and provider-specific transaction IDs are not inferred.
- Import never bypasses explicit destination-account mapping, review, approval, deduplication, or rollback.
