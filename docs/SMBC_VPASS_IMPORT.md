# SMBC Card Vpass statement import

KakeFlow supports the confirmed headerless Vpass layout shown in SMBC Card's [official CSV guide](https://www.smbc-card.com/mem/oshiharai/meisai_about.jsp):

```text
ご利用日,ご利用店名,ご利用金額,支払区分,分割回数,お支払い金額,
現地通貨額,略称,換算レート,換算日,備考
```

## Detection

The source starts with metadata containing a cardholder, masked card number, and SMBC/三井住友 marker, followed by detail rows and one total. Filename text alone never selects the adapter. Amazon Mastercard sources remain owned by their separate adapter.

## Accounting rules

- `お支払い金額` is the canonical current-statement value.
- `ご利用金額` remains evidence and must equal billed amount for supported one-time rows.
- Negative billed values are refunds; positive refund/cancellation wording is blocking.
- Currency, conversion, payment, note, and raw-row fields remain provenance.
- Detail values must equal the explicit statement total; the total is never a purchase.

Installment, revolving, bonus, deferred, malformed, ambiguous, or total-mismatched sources fail closed. A user may route an unrecognized layout through custom parser rescue, but a recognized invalid Vpass source remains blocked.

The user selects an active credit-card liability account. Staging creates evidence and review-required candidates. A later bank debit settles the liability and does not count expense twice.
