# MUFG BizSTATION deposit/withdrawal import

This fail-closed adapter implements MUFG's business-account `入出金明細` export from the [official CSV specification](https://web.bizstn.bk.mufg.jp/biz/help/pdf/nyuushukkin_csv.pdf). It does not claim compatibility with personal MUFG Direct files.

## Source contract

The source is Shift_JIS, quoted CSV with CRLF records, one exact twenty-column header, and twenty-column details. Validation includes:

- institution code `0005` and official half-width-kana name;
- three-digit branch, account type `1` or `2`, and ten-digit account number;
- one source account per file;
- deposit/payment code `1` or `2`;
- transaction class `10`, `11`, `12`, `13`, `14`, `18`, or `19`;
- positive zero-padded safe-integer JPY amount; and
- non-negative other-bank instrument amount no greater than the transaction amount.

The source provides neither balance nor durable transaction ID. Both remain absent; physical row provenance and normal source-row deduplication carry the audit boundary.

The era-less six-digit Japanese-calendar date is accepted only for the unambiguous Reiwa 1–8 window (2019–2026). Other values fail instead of being guessed.

## Review

The user must select an existing `ASSET / BANK` account. Every row remains review-required. Known card-issuer descriptions may suggest `CARD_PAYMENT`; other transfer-like classes remain `UNKNOWN` unless the source proves both sides belong to the household.
