# MUFG BizSTATION deposit/withdrawal import

KakeFlow provides a dedicated, fail-closed adapter for the MUFG BizSTATION
`入出金明細` CSV export. It is a business-account export contract and does not
claim support for personal MUFG Direct files.

The adapter follows MUFG's official
[deposit/withdrawal CSV specification](https://web.bizstn.bk.mufg.jp/biz/help/pdf/nyuushukkin_csv.pdf).
That specification defines Shift_JIS, comma-separated, double-quoted fields and
CRLF records with one exact twenty-column header and twenty-column details.

## Supported source contract

Each detail is validated against the published fixed-width semantics:

- MUFG institution code `0005` and official half-width-kana name;
- three-digit branch, account type `1` (ordinary) or `2` (current), and a
  ten-digit zero-padded account number;
- one source account per file;
- deposit/payment code `1` or `2`;
- transaction class `10`, `11`, `12`, `13`, `14`, `18`, or `19`;
- positive twelve-digit zero-padded JPY transaction amount; and
- non-negative twelve-digit other-bank instrument amount that does not exceed
  the transaction amount.

The source has no balance and no documented durable transaction ID. KakeFlow
therefore leaves both absent, preserves every physical row as immutable
evidence, and relies on the normal source-document/row deduplication boundary.
Account-holder and account-number values validate the source only; adapter
metadata does not expose them.

## Japanese-calendar boundary

The official `取引日` is an era-less six-digit Japanese-calendar date. Without
an era marker, older archival dates can be ambiguous. Adapter v1 therefore
accepts only the unambiguous Reiwa 1-8 window (2019-2026) that was current when
the contract shipped. Other era-year values fail with
`MUFG_BIZSTATION_DW_DATE_UNSUPPORTED` instead of being guessed. A future adapter
revision must explicitly extend this boundary.

## Review and accounting

The user must select an existing `ASSET/BANK` account before staging. KakeFlow
does not infer or create an account from the source branch, holder, filename, or
account number. Every row remains review-required and is never posted
automatically.

An outgoing row whose description names a known card issuer is suggested as
`CARD_PAYMENT`. It settles a card liability and affects bank cash flow without
creating a second expense. Other transfer-like source classes remain
`UNKNOWN`, because the export does not prove that both ends belong to the same
household.
