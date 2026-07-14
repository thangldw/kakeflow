# PayPay Card finalized-statement import

KakeFlow 0.66 adds a deliberately narrow adapter for a finalized PayPay Card
billing CSV. PayPay Card officially confirms that a statement can be downloaded
as CSV from the PayPay app or web member menu, one billing month at a time. It
also states that unfinalized statements cannot be downloaded and that older
history eventually leaves the download window.

The official material establishes the product capability and billing lifecycle;
it does **not** publish a literal consumer CSV header/byte specification. The
built-in v1 contract is therefore labeled **community-derived synthetic**. Its
field family is informed by public statement examples and community conversion
tools, while the checked-in fixture contains only fictitious values. Neither the
fixture nor this adapter is represented as a PayPay Card-issued sample.

Sources:

- [official CSV download announcement](https://www.paypay-card.co.jp/info/001104.html);
- [official statement download/printing help](https://www.paypay-card.co.jp/service/000247.html);
- [official statement finalization and amount guide](https://www.paypay-card.co.jp/service/008032.html);
- [official closing and payment schedule](https://www.paypay-card.co.jp/service/000173.html);
- [community CSV converter with PayPay Card support](https://github.com/yukihiko-shinoda/zaim-csv-converter).

The community link is provenance for the schema research boundary, not an
official specification or a compatibility guarantee.

## Supported synthetic v1 contract

Detection is based only on file contents; the filename cannot qualify a file.
The supported file has exactly these eleven headers in this order:

```text
利用日/キャンセル日,利用店名・商品名,利用者,支払区分,利用金額,手数料,
支払総額,当月支払金額,翌月以降繰越金額,調整額,当月お支払日
```

An extra, missing, or reordered column is a different contract and is rejected.

Version 1 supports only finalized, JPY, one-time-payment rows for which the
current-cycle billed amount has safe expense/liability semantics. For an accepted
detail row:

- `支払区分` is exactly `1回`, `1回払い`, or `一括`;
- `手数料`, `翌月以降繰越金額`, and `調整額` are zero;
- `利用金額 + 手数料 = 支払総額 = 当月支払金額`;
- the current billed amount is the canonical statement-line amount;
- the original usage amount, fee, payment text, user, and other supplied fields
  remain immutable source evidence;
- a negative billed amount remains a refund;
- all money fields are safe-integer JPY values; and
- the statement total is calculated from `当月支払金額`, must be positive, and
  never becomes a separate purchase row.

Every row must also contain a valid merchant and usage/cancellation date. All
accepted rows must carry the same valid `当月お支払日`; that exact source date
becomes the statement due date.

Quoted commas/newlines and physical CSV row lineage are preserved. Unicode width
normalization may be used for matching known labels, but it does not authorize
guessing an unfamiliar layout.

## Fail-closed boundary

The adapter blocks, rather than approximates:

- any pending or unfinalized layout that differs from the exact contract above;
- installment, revolving, bonus, carried, skipped, or partial-payment rows;
- a positive amount described as a cancellation, return, or refund;
- multiple statement sections or a non-positive calculated statement total;
- missing or malformed dates and amounts;
- any failure of `利用金額 + 手数料 = 支払総額 = 当月支払金額`;
- non-zero fee, carry-forward, or adjustment values;
- inconsistent or invalid `当月お支払日` values;
- non-integer billed values; and
- any extra, missing, or reordered header.

An actual PayPay Card export that differs from this synthetic contract should use
the explicit custom CSV/TSV rescue workflow until a sanitized sample can justify
a new versioned adapter. A file that is recognized as this contract but fails its
integrity rules remains blocked; it is not silently routed around those checks.

## Account mapping and review

The user must explicitly select an active `LIABILITY / CREDIT_CARD` account for
every preview. KakeFlow never infers the account from `PayPay`, the filename, a
masked number, or an existing account name. This matters when a household has
multiple PayPay cards or when PayPay Card and PayPay Credit activity appear in
related source histories.

Selecting the account does not post anything. Staging creates immutable source
evidence, one card statement, and pending purchase/refund candidates. Every
candidate still requires explicit review and a balanced posting decision.

The later debit from a bank account is a card-liability settlement. It affects
cash flow and reduces the PayPay Card liability; it is not a second household
expense.

## Due-date behavior

PayPay Card describes a normal month-end closing cycle and payment on the 27th,
with statement finalization timing depending on the registered financial
institution. KakeFlow does not calculate a date from that general schedule.
Instead, this adapter requires a valid `当月お支払日` on every detail row, requires
all rows to agree, and preserves that exact source date as `paymentDueOn`.

Missing, invalid, or inconsistent dates block the file; no generic 27th is
substituted. After import, the user can still correct or clear the date in the
existing card-statement workflow after checking the issuer's finalized statement.
That edit changes forecast/coverage timing only; it does not change the statement
amount, purchases, evidence, or reconciliation.
