# PayPay Card statement import

PayPay Card documents monthly CSV downloads for finalized statements but does not publish a literal consumer schema. KakeFlow therefore labels its exact v1 layout **community-derived synthetic**. The fixture is fictional and is not represented as a provider-issued sample.

References: [CSV announcement](https://www.paypay-card.co.jp/info/001104.html), [download help](https://www.paypay-card.co.jp/service/000247.html), [statement finalization](https://www.paypay-card.co.jp/service/008032.html), and [payment schedule](https://www.paypay-card.co.jp/service/000173.html).

## Exact header

```text
利用日/キャンセル日,利用店名・商品名,利用者,支払区分,利用金額,手数料,
支払総額,当月支払金額,翌月以降繰越金額,調整額,当月お支払日
```

All eleven columns must appear in this order. Detection uses content only.

## Accepted rows

- Payment type is one-time (`1回`, `1回払い`, or `一括`).
- Fee, carry-forward, and adjustment are zero.
- `利用金額 + 手数料 = 支払総額 = 当月支払金額`.
- Money values are safe-integer JPY; negative billed values remain refunds.
- Every row has a valid date, merchant, and identical valid due date.
- The calculated statement total is positive and is not imported as a purchase.

Installment, revolving, bonus, partial, pending, ambiguous cancellation, malformed, inconsistent, or unfamiliar sources block staging. No generic 27th-day due date is invented.

The user explicitly maps an active credit-card liability account. Staging preserves all raw fields and physical rows, and candidates still require review. A later bank debit settles the liability without duplicating expense.
