# Receipt item review and split posting

KakeFlow brings structured receipt evidence into Import Inbox before a
candidate is approved. The original image or PDF remains immutable; the preview
receives only a bounded projection of the primary evidence, never raw OCR text,
page pixels, extraction regions, or the original payload JSON.

The review can show:

- item description, quantity, amount, confidence, source line, and an explicit
  8% or 10% marker when the receipt itself establishes that marker;
- tax summary rows, tax mode, subtotal, payment method, and change;
- each detected coupon/discount and redeemed-point line with its own confidence
  and provenance; and
- whether the positive item amounts equal the canonical receipt payment total.

Unmapped symbols and ambiguous tax markers remain unconfirmed. KakeFlow does not
infer that a redeemed point is a discount, reward asset, or funding leg, because
that treatment is a household accounting-policy choice.

## Exact item split

`品目から分割` is available only when all of these conditions hold:

1. the candidate is an outgoing `EXPENSE` or `CARD_PURCHASE`;
2. at least two bounded positive-integer item rows are present;
3. the item sum exactly equals the candidate amount; and
4. the existing posting is one balanced purchase debit and one payment credit.

The user selects an expense account for each item. KakeFlow replaces the single
purchase debit with one debit per item and preserves the original payment-side
credit. The result still posts one transaction, so the receipt total and source
evidence are not duplicated.

If the item sum differs because of tax, coupons, points, OCR uncertainty, or any
other reason, automatic allocation is disabled. The signed delta is disclosed
and the user may build an explicit manual split. No adjustment is silently
distributed across products.

## Manual journal boundary

Import Review supports between 2 and 128 journal entries. Before approval and
again in the native commit transaction, KakeFlow requires:

- non-empty, household-owned account IDs;
- unique entry IDs and positive integer JPY amounts;
- equal debit and credit totals; and
- both totals to equal the immutable candidate amount.

Changing a split does not alter OCR evidence. Approval remains explicit, and a
recovered review after restart exposes the same sanitized primary-receipt facts.
