# AEON Card finalized-statement import

KakeFlow adds a deliberately narrow adapter for an AEON Card finalized
statement CSV. AEON's official support material confirms that finalized billing
statements can be downloaded as CSV or PDF, but it does not publish a literal
consumer CSV byte schema. The built-in contract is therefore clearly labeled
**screen-derived synthetic**: the checked-in fixture contains fictitious data,
and an unfamiliar layout is rejected instead of guessed.

Official billing behavior used to define the accounting boundary:

- AEON documents CSV/PDF export for finalized billing months and separates the
  available history in AEON Pay from the web statement service.
- The ordinary billing cycle closes on the 10th and is debited on the 2nd of the
  following month, or the next business day.
- The finalized amount can change after revolving-payment changes, early
  repayment, returns, or point application; refunds may instead arrive after the
  original bank debit.
- Foreign-currency details and conversion rates are statement evidence after
  finalization. A CSV is not qualified-invoice evidence.

Sources: [statement download](https://faq.aeon.co.jp/faq/show/226),
[billing cycle](https://faq.aeon.co.jp/faq/show/431),
[final amount timing](https://faq.aeon.co.jp/faq/show/248),
[refund handling](https://faq.aeon.co.jp/faq/show/2996),
[statement guide](https://www.aeon.co.jp/-/media/AeonCard/details/invoice.pdf),
[foreign currency](https://faq.aeon.co.jp/faq/show/3729?site_domain=default), and
[invoice evidence boundary](https://faq.aeon.co.jp/faq/show/23171).

## Supported synthetic contract

Detection is content-based and never uses the filename. A supported file has:

1. an AEON finalized-statement marker before the header;
2. the named date, merchant, usage amount, payment type, and current billed
   amount fields;
3. dated detail rows using one-time payment semantics; and
4. exactly one explicit statement total equal to the sum of detail amounts.

Negative billed amounts are retained as refunds. The total row never becomes a
purchase. Quoted commas/newlines, complete raw fields, and physical source-row
lineage remain available as evidence.

Installment, revolving, bonus, skipped, carried, or partially billed rows fail
closed. KakeFlow does not treat the original purchase amount as the current
liability when the two differ. Positive refund-like rows, unmasked card-number
metadata, multiple statement sections, malformed dates/amounts, and total
mismatches also block the import.

An actual AEON export whose fields differ from this synthetic contract should be
handled through the explicit custom CSV/TSV rescue workflow until a sanitized
sample can establish a new versioned adapter. This release does not claim that
the fixture is AEON's official export format.

## Review and accounting boundary

The user must explicitly select an active `LIABILITY / CREDIT_CARD` account.
KakeFlow never infers the destination from the issuer, filename, masked number,
or account name. Import creates immutable source evidence, one statement, and
pending purchase/refund candidates; posting still requires explicit review.

The later bank debit is a card payment that reduces the card liability. It is
cash outflow, not a second household expense.
