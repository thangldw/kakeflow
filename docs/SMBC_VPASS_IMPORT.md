# SMBC Card Vpass statement import

KakeFlow 0.44 adds a deliberately narrow built-in adapter for a confirmed,
headerless SMBC Card Vpass CSV layout. SMBC's official guide confirms that Vpass
can export a comma-separated statement and publishes the field order in its
[CSV illustration](https://www.smbc-card.com/mem/oshiharai/meisai_about.jsp):

```text
ご利用日, ご利用店名, ご利用金額, 支払区分, 分割回数, お支払い金額,
現地通貨額, 略称, 換算レート, 換算日, 備考
```

The file itself is headerless. A supported file must start with a metadata row
containing a non-empty cardholder, a masked card number, and an SMBC/三井住友
product marker. Detail rows and one explicit statement-total row must follow.
Amazon Mastercard metadata remains owned by the separate Amazon adapter.
Filename text alone never selects this adapter.

## Accounting contract

- `お支払い金額` is the JPY amount due in the current statement and is the
  canonical statement line amount.
- `ご利用金額` is retained as source context and must equal the billed amount
  for the currently supported one-time-payment rows.
- A negative billed amount is a refund. Refund/cancellation wording paired with
  a positive billed amount is rejected as ambiguous.
- `現地通貨額`, currency abbreviation, rate, conversion date, payment fields,
  notes, and the complete raw row remain available as evidence.
- Detail lines must sum exactly to the explicit statement total. The total row
  never becomes a purchase.

Installment, revolving, bonus and other deferred-payment rows are rejected in
this version. Their purchase amount and current-cycle liability can differ, and
KakeFlow does not silently turn either value into an expense or bank-settlement
obligation. Layouts that do not match the built-in detector can use the explicit
custom CSV/TSV rescue workflow. A file that matches Vpass but fails sign, total,
or row-integrity checks stays blocked until the source/export is corrected; it
is not silently rerouted around those checks.

## Review boundary

The user must select an active `LIABILITY / CREDIT_CARD` account for every file.
KakeFlow does not infer it from the product, masked number, filename or account
name. `取込開始` then creates immutable source evidence and pending candidates;
posting still requires explicit review and approval. A later matching bank debit
reduces this card liability and never counts the purchases twice.
