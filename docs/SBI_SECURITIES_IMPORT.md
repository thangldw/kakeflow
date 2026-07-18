# SBI Securities trade-history import

The `sbi-securities-trade-history-v1` adapter supports domestic and foreign spot stock buys/sells from SBI's `約定履歴` exports. References: [domestic history](https://search.sbisec.co.jp/v2/popwin/help/manage_10_01.html) and [foreign history](https://search.sbisec.co.jp/v2/popwin/help/foreign/account_06.html).

## Supported scope

- Domestic: `株式現物買` or `株式現物売` with the documented trade date, security, transaction, custody, quantity, unit price, settlement date, and settlement value family.
- Foreign: `現買`/`現売`, or explicit `現物` plus `買付`/`売却`, with the foreign field family and an unambiguous supported market currency.

Margin, delivery/receipt, funds, MMFs, bonds, warrants, derivatives, dividends, cash transfers, corporate actions, unknown layouts, and malformed values are rejected. Filename or neighboring rows never determine account, side, security, fee, tax, currency, or settlement.

The source settlement value remains authoritative. A reconciled difference becomes an explicit `ADJUSTED` event with a balanced audit leg; KakeFlow does not invent a fee/tax split.

The user selects an active `ASSET / SECURITIES` account and explicitly saves valid events. Physical source rows remain immutable, household expense metrics remain unchanged, and repository fixtures are synthetic.
