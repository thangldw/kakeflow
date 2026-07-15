# JCB MyJCB statement import

KakeFlow adds a dedicated adapter for a narrow JCB statement CSV contract.
JCB officially confirms that statements can be downloaded in CSV format by
billing month and that installment/revolving exports can include both the new
usage amount and the amount due for the month:
[JCB CSV download notes](https://www.jcb.co.jp/processing/share/csv.html).
JCB also confirms CSV availability for finalized statements through MyJCB:
[JCB statement download FAQ](https://j-faq.jcb.co.jp/faq/show/357?site_domain=default).

## Accepted contract

The two official pages establish availability, not a universal column schema.
KakeFlow therefore defines the following narrow v1 contract and rejects every
unknown variant. Detection first requires either `JCB`/`MyJCB` in the filename
or a `JCB`, `MyJCB`, or `ジェーシービー` provider marker within the first twelve
physical rows. It also requires a header row within those first twelve rows
with:

- `ご利用日` or `利用日`;
- `ご利用先など` or `ご利用先など(漢字)`; and
- an explicit JPY amount column: `お支払い金額(円)`, `お支払い金額`,
  `今回のお支払い金額(円)`, `今回のお支払金額(円)`, `ご利用金額(円)`, or
  `ご利用金額`.

Unicode width is normalized, columns may be reordered, and quoted merchant
names are preserved. Unknown layouts are rejected. KakeFlow does not guess a
date, merchant, amount, payment due date, card account, or column position.

When both usage and billed amounts exist, the billed amount is the canonical
statement-line amount; the original usage amount remains in `rawExtra`. This
keeps the imported statement aligned with the bank settlement while preserving
the source fields needed for later installment/revolving modeling.

## Detail semantics

- Negative billed amounts are refunds and receive an explicit normalized
  `REFUND` review hint. A positive amount containing `取消`, `返品`, or `返金` is
  ambiguous and blocks staging instead of being silently re-signed.
- `支払区分`, `今回回数`, and `支払方法` remain visible as payment-method text.
- Explicit `通貨`, `現地通貨利用金額`/`現地通貨額`, and
  `円換算レート`/`換算レート` fields are retained when valid.
- Metadata and total rows never become purchases.
- An explicit statement total is compared with the sum of detail billed
  amounts. A mismatch is a visible blocking error, not an automatic correction.
- Every accepted detail keeps its original physical CSV row as immutable
  evidence.

## Desktop workflow

1. Add the JCB CSV to Import Inbox.
2. Confirm that `jcb-myjcb-statement-v1` was selected.
3. Choose the corresponding active `Liability / Credit card` account.
4. Start the import and review every pending purchase/refund candidate.
5. Post only explicitly approved candidates.

The later bank debit remains a card-liability settlement and does not create a
second household expense. This adapter does not infer installment schedules,
revolving balances, fees absent from the source, or a statement due date.
