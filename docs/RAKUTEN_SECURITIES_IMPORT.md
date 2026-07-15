# Rakuten Securities domestic trade-history import

KakeFlow adds a dedicated adapter for the domestic-stock CSV exported from
Rakuten Securities. Rakuten Securities' official
[Japanese stock trade-history guide](https://www.rakuten-sec.co.jp/ITS/qaAssTrad0001.html)
documents the selectable spot, odd-lot, and credit categories, the CSV filename
pattern, the displayed transaction fields, and the settlement-amount semantics.
Its official
[CSV download walkthrough](https://www.rakuten-sec.co.jp/web/domestic/stock/demo/history1.html)
shows the `口座管理` → `取引履歴（商品別売買履歴）` workflow and the explicit
`CSV形式で保存` action.

## Supported scope

`rakuten-securities-domestic-trade-history-v1` deliberately accepts only an
explicit domestic spot or odd-lot purchase/sale. The supported source trade
category is `現物` or `現物（単元未満）`, paired with an explicit
`買付`/`買` or `売付`/`売` side. KakeFlow rejects credit/margin trades, credit settlement,
`現引`, `現渡`, deposits, withdrawals, offerings, transfers, foreign products,
derivatives, and every other unsupported row instead of guessing its accounting
treatment.

The exact required header family is:

```text
約定日, 銘柄, 口座, 取引, 売買, 数量, 単価,
手数料, 税金, 諸費用, 税区分, 受渡金額
```

Additional columns such as `信用区分` and `弁済期限` remain in the immutable
raw row but do not broaden the supported spot-trade scope. The accepted
contract preserves the source's:

- trade date;
- security name, code, and execution market;
- trade category and buy/sell side;
- custody/account classification, with the tax label retained in the immutable
  source row;
- quantity and executed unit price;
- commission, tax, and other expenses when represented by the supported row;
- settlement amount; and
- exact physical CSV row as immutable evidence.

Unknown layouts, missing required fields, malformed dates or values, ambiguous
security identity, and unsupported transaction semantics remain visible import
issues and do not produce an event for the affected row. Filename text never
selects an adapter variant, securities account, side, or sign.

## Settlement and investment-ledger semantics

Rakuten Securities documents `受渡金額` for spot shares as the settlement
amount after adding commission and other costs to a purchase, or subtracting
them from a sale. KakeFlow keeps that source amount and compares it with the
executed value plus or minus the represented commission, tax, and other
expenses. It never silently replaces the source settlement amount with
`quantity × unit price`.

When the source arithmetic differs, the event is marked `ADJUSTED`, a visible
`RAKUTEN_SECURITIES_SETTLEMENT_MISMATCH` warning is emitted, and the balanced
legs include an auditable adjustment. The source settlement amount is retained.

An accepted purchase becomes a `BUY` brokerage event; an accepted sale becomes
a `SELL` event. Each produces balanced investment-ledger legs with source-row
lineage. Brokerage activity updates the investment ledger and portfolio
analytics, not household-expense metrics.

## Desktop workflow

1. In Rakuten Securities, open `口座管理` →
   `取引履歴（商品別売買履歴）`, choose the domestic-stock conditions, and use
   `CSV形式で保存`.
2. Add the CSV to KakeFlow's Import Inbox and confirm that
   `rakuten-securities-domestic-trade-history-v1` was selected.
3. Select the corresponding active `Asset / Securities` account. KakeFlow does
   not infer or create it from the provider, filename, or holdings.
4. Inspect the local preview and row-specific issues, then choose
   `証券取引に保存` explicitly.

File discovery and preview do not save an event. This is a source-only
investment workflow, separate from the household transaction-candidate approval
flow. The explicit save action writes only valid normalized brokerage events
and their immutable evidence to the selected investment account.

## Fixture and compatibility boundary

Every checked-in Rakuten Securities fixture is synthetic and uses fictitious
securities and amounts. It is not customer data and is not a Rakuten
Securities-provided sample. The versioned adapter does not claim compatibility
with future layouts or unsupported transaction types until they receive an
explicit parser contract and tests.
