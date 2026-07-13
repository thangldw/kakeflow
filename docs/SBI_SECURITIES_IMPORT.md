# SBI Securities trade-history import

KakeFlow 0.51 adds a dedicated adapter for the CSV downloaded from SBI
Securities' `口座管理` → `取引履歴` → `約定履歴` screen. SBI's official
[domestic trade-history help](https://search.sbisec.co.jp/v2/popwin/help/manage_10_01.html)
documents the CSV download, its 10,000-row file boundary, the available detail
fields, and the distinction between spot and margin transaction labels. The
[foreign trade-history help](https://search.sbisec.co.jp/v2/popwin/help/foreign/account_06.html)
separately documents its CSV download, product and order columns, spot/margin
labels, and foreign-currency settlement semantics. SBI also states that the
transaction report remains the authoritative record.

## Supported scope

`sbi-securities-trade-history-v1` deliberately supports **domestic and foreign
spot stock purchases and sales only**. Domestic rows must use `株式現物買` or
`株式現物売`. Foreign rows must use `現買`/`現売`, or an explicit `現物` order
marker together with `買付`/`売却`. It does not claim support for margin trades,
margin settlement, delivery/receipt, investment trusts, foreign-currency MMFs,
bonds, warrants, derivatives, dividends, cash transfers, or corporate actions.
A row containing one of those transaction types is rejected instead of being
reinterpreted as a spot trade.

The domestic contract requires the exact SBI field family for `約定日`, `銘柄`,
`取引`, `預り`, `約定数量`, `約定単価`, `受渡日`, and `受渡金額` or
`受渡金額／決済損益`. The separate foreign field family requires
`国内約定日`, `銘柄`, `商品区分`, `注文種別`, `取引`, `預り区分`,
`約定数量`, `約定単価`, `国内受渡日`, and the same settlement family. An
explicit `通貨` or `決済通貨` is retained when present; otherwise KakeFlow
accepts only a product label with one unambiguous supported market currency.
These fields preserve:

- trade date and settlement date;
- security code/ticker, name, and market parsed from SBI's combined security
  field;
- transaction type;
- custody/account classification;
- executed quantity and unit price; and
- settlement amount.

Unknown layouts, missing required fields, malformed dates or numbers, and
unsupported product/transaction labels remain visible import issues and do not
produce an event for the affected row. KakeFlow does not infer an account,
transaction type, security code, sign, fee, tax, currency, or settlement amount
from a filename or a nearby row.

## Investment-ledger semantics

- A supported spot purchase becomes a `BUY` brokerage event with security and
  brokerage-cash legs derived from the source values.
- A supported spot sale becomes a `SELL` event with the corresponding security
  disposal and net brokerage-cash receipt.
- The original physical row and source values remain immutable evidence.
- Brokerage events affect the investment ledger and portfolio analytics; they
  do not become household expenses.
- The selected destination must be an explicit active securities account.
  KakeFlow never chooses an account from the SBI name, filename, or holdings.

The source settlement arithmetic must reconcile. A mismatch becomes an
explicit `ADJUSTED` event with a warning and a balanced, auditable adjustment
leg; KakeFlow preserves SBI's settlement amount instead of silently replacing
it with a calculated value. Version 0.51 does not split that difference into
fee and tax legs because the supported field family does not establish those
components independently for every accepted domestic and foreign row.

## Desktop workflow

1. Download the desired SBI Securities `約定履歴` result as CSV.
2. Add the file to Import Inbox and confirm that
   `sbi-securities-trade-history-v1` was selected.
3. Select the corresponding active `Asset / Securities` account.
4. Inspect the local preview and any row-specific issues, then choose
   `証券取引に保存` explicitly.

File discovery and adapter detection never save an event. This source-only
investment workflow is not the household transaction-candidate approval flow:
the explicit save action writes the valid normalized brokerage events and their
immutable evidence to the selected investment account. Invalid or unsupported
rows remain issues and are not saved.

## Fixture and compatibility boundary

The domestic and foreign repository fixtures are synthetic and contain
fictitious securities and amounts. They are not customer data and are not
SBI-provided samples. The adapter is intentionally versioned because SBI can
change an export layout. A future layout or an unsupported transaction type
must receive an explicit parser and tests before KakeFlow can claim
compatibility.
