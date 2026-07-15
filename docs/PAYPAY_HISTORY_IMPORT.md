# PayPay transaction-history import

KakeFlow provides the strict `paypay-history-v2` adapter for the exact
seven-column transaction-history contract already represented by the
repository's import fixtures and tests. The legacy alias-tolerant
`paypay-history-v1` adapter remains available and is not rewritten or removed.

The checked-in test data is synthetic. It demonstrates the structural contract
and does not claim to be a provider-issued customer export.

## Exact contract

The first physical CSV row must contain exactly these fields, in this order:

```text
Date & Time
Amount Outgoing (Yen)
Amount Incoming (Yen)
Transaction Type
Payment Option
Transaction ID
Description
```

Unicode width, BOM, and surrounding whitespace are normalized for header
comparison. Aliases, reordered fields, missing fields, extra fields, and a
preamble do not match v2. Each non-empty detail must also contain exactly seven
fields.

## Row integrity

Every accepted source row requires:

- a valid Gregorian date and valid 24-hour clock time;
- exactly one populated incoming or outgoing amount;
- a positive safe-integer JPY amount with valid optional thousands grouping;
- a non-empty bounded Transaction Type, Transaction ID, and Description;
- a bounded Payment Option;
- a physical row that is not duplicated elsewhere in the source.

The parser supports at most 20,000 details, 10,000 business events, 64 legs per
event, 256 characters for an ID/type, and 4,096 characters for descriptive
fields. Exceeding a bound is a blocking error rather than a partial-success
claim.

Quoted commas and newlines are handled by the shared RFC-4180 tokenizer. Each
leg retains its exact raw fields plus physical `sourceRow` and `sourceRowEnd`.
That lineage becomes immutable source evidence during canonical staging.

## Business-event grouping

`Transaction ID` identifies a business event, not a unique physical row. Rows
with one ID are grouped in source order. Their date/time and Description must
agree exactly after normalization, and the grouped incoming/outgoing totals
must remain safe integers. KakeFlow does not collapse the group's distinct
physical evidence rows.

Transaction Type remains source data. Known point/balance evidence rows are
supporting evidence for the event's review candidates. An unfamiliar non-empty
Transaction Type is retained as its own incoming/outgoing review candidate;
KakeFlow does not guess that it is income, expense, transfer, refund, or another
accounting type. Posting still requires an explicit user decision.

## Split funding

A plain Payment Option such as a wallet name remains an opaque source hint. If
the field contains funding components, every component must use the complete
form:

```text
method (positive-integer yen)
```

Comma, Japanese comma, or semicolon may separate components. Thousands commas
inside an amount are retained. Every component must be valid and their total
must exactly equal the outgoing row amount. Partial parsing and funding-sum
warnings are not accepted by v2; they block the preview.

## Detection and account mapping

The exact v2 adapter is ranked before legacy v1. Its seven English fields do
not collide with the separate eleven-column PayPay Card finalized-statement
adapter. Wallet history and card billing remain distinct source/account types.

Before staging, the user must select an existing active `ASSET / WALLET`
account. KakeFlow never chooses the first wallet, maps by filename, or creates
an account. The canonical source records `adapterId = paypay-history-v2` and
`adapterVersion = 2`; every candidate remains review-required and rollbackable.

## Deliberate limits

- No provider API or live synchronization is implied.
- No unknown Transaction Type receives inferred accounting semantics.
- No malformed event, amount, funding component, or duplicate row is repaired.
- The adapter does not auto-post, auto-approve, or bypass canonical review.
