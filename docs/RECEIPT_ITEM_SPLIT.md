# Receipt item review and split posting

Import Inbox exposes a bounded projection of structured receipt evidence: items, quantities, amounts, confidence, source lines, tax markers, totals, payment method, coupons, points, and item-sum status. Original bytes, OCR regions, and raw payloads remain behind the evidence viewer.

KakeFlow does not infer the accounting treatment of tax, coupons, or redeemed points when the receipt does not prove it.

## Exact item split

`品目から分割` is available only when:

1. the candidate is an outgoing `EXPENSE` or `CARD_PURCHASE`;
2. at least two positive-integer item rows exist;
3. item total equals the immutable candidate amount; and
4. the draft contains one purchase debit and one payment credit.

The user maps each item to an expense account. KakeFlow replaces the single purchase debit with item debits and preserves the original payment credit. It remains one transaction and one receipt total.

If item sum differs, the signed delta is shown and automatic allocation is disabled. The user may create an explicit manual split; no value is distributed silently.

Manual drafts contain 2–128 entries, household-owned accounts, unique entry IDs, positive integer JPY values, equal debit/credit totals, and totals equal to the candidate amount. Validation runs in the UI and again during native commit.
