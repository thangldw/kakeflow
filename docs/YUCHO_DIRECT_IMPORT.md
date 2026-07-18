# Yucho Direct transaction import

KakeFlow implements the personal-account CSV published by Japan Post Bank: [transaction inquiry](https://www.jp-bank.japanpost.jp/direct/pc/guide/dr_pc_gd_meisai.html), [field explanation](https://faq.jp-bank.japanpost.jp/faq_detail.html?id=132), and [download guidance](https://faq.jp-bank.japanpost.jp/faq_detail.html?id=134).

## Recognized fields

```text
取引日,入出金明細ID,受入金額(円),払出金額(円),詳細1,詳細2,現在(貸付)高
```

The header may follow an account preamble but must occur within the first 32 physical rows and retain official order after width normalization.

Dates use real `YYYYMMDD` values. Exactly one positive safe-integer incoming or outgoing amount is required. `詳細1` and `詳細2` remain separate evidence and are combined only for display. Balance accepts signed integers.

`入出金明細ID` is export-local provenance, not a durable cross-export ID. Invalid widths, impossible dates, ambiguous directions, invalid balances, duplicate sequences, and oldest-first balance discontinuities block staging.

The user selects a bank asset account. `カード` text can describe an ATM cash-card event and therefore remains `UNKNOWN`; it is not silently classified as a card payment.
