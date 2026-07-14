# MUFG BizSTATION all-details import

KakeFlow provides a dedicated, fail-closed adapter for the MUFG BizSTATION
`全明細` CSV export. This is a business-account export contract; it is not a
claim of support for a personal MUFG Direct download.

The contract is based on MUFG's official
[All-details CSV specification](https://web.bizstn.bk.mufg.jp/biz/ikou2026/contents/guide/pdf/mei_syoukai_zen_csv.pdf).
The source is Shift_JIS CSV with CRLF records and four record types:

- `1`: one 15-field header containing branch, account, requested period, and
  export operation metadata;
- `2`: seven-field transaction details containing date, transaction class,
  description, payment, deposit, and running balance;
- `8`: one footer marker;
- `9`: one eight-field final record containing debit/deposit counts and totals,
  plus opening and closing balances.

## Validation boundary

Detection is content-based and requires the complete record family. The parser
then validates:

- the official record widths and ordering;
- the `全明細` marker, requested date range, operation date, and operation time;
- the documented account-type code/name pairs (`10`/`普通`, `20`/`当座`, and
  `11`/`BCL`) and a seven-digit account number;
- safe-integer JPY values with exactly one non-zero debit or credit per detail;
- detail counts and totals against the final record; and
- every running balance, opening balance, and closing balance in either the
  oldest-first or newest-first source order.

An unfamiliar, incomplete, or inconsistent file remains blocked instead of
falling through to the generic bank parser. Physical source-row order and raw
fields remain immutable evidence. Account-holder and account-number values are
used only for source validation and are not copied into adapter metadata.

## Import and accounting behavior

The user must select an existing `ASSET/BANK` account before staging. KakeFlow
does not infer or create an account from branch, holder, filename, or account
number. Every candidate still enters Import Inbox and requires explicit review;
the adapter never posts automatically.

Known card-issuer descriptions are suggested as `CARD_PAYMENT`. The later bank
debit settles the selected credit-card liability and affects cash flow, but it
must not become a second expense. All other rows retain conservative bank
semantics for review and classification.

The adapter does not claim transaction IDs, live bank connectivity, automatic
institution ownership verification, or support for BizSTATION export families
other than the documented `全明細` structure.
