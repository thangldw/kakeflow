# AEON Card statement import

KakeFlow provides a narrow adapter for finalized AEON Card statement CSV files. AEON documents CSV/PDF statement downloads, billing cycles, finalization, refunds, and foreign-currency details, but does not publish a literal consumer CSV schema. The checked-in contract and fixture are therefore screen-derived and synthetic.

Official references: [statement download](https://faq.aeon.co.jp/faq/show/226), [billing cycle](https://faq.aeon.co.jp/faq/show/431), [final amount](https://faq.aeon.co.jp/faq/show/248), [refunds](https://faq.aeon.co.jp/faq/show/2996), and [statement guide](https://www.aeon.co.jp/-/media/AeonCard/details/invoice.pdf).

## Accepted contract

Detection uses file content, never the filename. A supported source contains:

- an AEON finalized-statement marker before the header;
- named usage date, merchant, usage amount, payment type, and billed amount fields;
- dated one-time-payment details; and
- exactly one total equal to the sum of billed details.

Negative billed values remain refunds. The total row is evidence only and never becomes a purchase. Quoted content, raw fields, and physical row ranges remain immutable provenance.

## Blocking conditions

KakeFlow rejects installment, revolving, bonus, skipped, carried, partial, ambiguous, multi-section, malformed, or total-mismatched sources. Positive refund-like rows and unmasked card metadata also block staging. An unfamiliar real export must use the custom parser rescue flow until a sanitized sample supports a new versioned adapter.

## Review and accounting

The user must choose an active `LIABILITY / CREDIT_CARD` account. KakeFlow does not infer it from issuer text, filename, or masked identity. Staging creates evidence, a statement, and review-required purchase/refund candidates; posting remains explicit.

The later bank debit settles the card liability. It affects cash flow but is not a second household expense.
