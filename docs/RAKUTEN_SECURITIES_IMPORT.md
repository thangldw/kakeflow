# Rakuten Securities domestic trade-history import

The `rakuten-securities-domestic-trade-history-v1` adapter supports the domestic-stock history described by Rakuten Securities' [trade-history guide](https://www.rakuten-sec.co.jp/ITS/qaAssTrad0001.html) and [CSV walkthrough](https://www.rakuten-sec.co.jp/web/domestic/stock/demo/history1.html).

## Supported contract

Required fields are:

```text
約定日,銘柄,口座,取引,売買,数量,単価,手数料,税金,諸費用,税区分,受渡金額
```

Only explicit domestic `現物` or `現物（単元未満）` buys/sells are accepted. Source evidence preserves dates, security identity, market, custody type, quantity, execution price, fees/tax/expenses, settlement value, and the complete physical row.

Margin/credit, settlement, `現引`, `現渡`, cash/position movements, offerings, foreign products, derivatives, malformed layouts, and ambiguous semantics are rejected.

Rakuten's settlement amount remains authoritative. If source arithmetic differs from represented execution and fees, KakeFlow records a visible `ADJUSTED` event with a balanced adjustment rather than rewriting the settlement.

The user explicitly selects an active securities account and chooses `証券取引に保存`. Discovery and preview never save events. Accepted events affect only the investment ledger and portfolio analytics. Repository fixtures are synthetic.
