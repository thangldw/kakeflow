# Monex U.S. stock trade-history import

KakeFlow adds a dedicated, fail-closed parser for the current Monex
Securities U.S.-stock **Trade History** field family. It is an investment-ledger
import. It never creates household income or expense transactions.

## Evidence boundary

Monex documents that the current Trade History screen can download the displayed
rows as CSV and publishes the fields shown by its detail view:

- <https://info.monex.co.jp/help/us-stock/deal-archive.html>

That public page does **not** publish a literal CSV header row, filename,
encoding, delimiter, date serialization, null representation, or settlement
sign convention. KakeFlow therefore does not identify this source from a
filename. the detector requires the complete normalized 16-field family
in the published detail-view order,
including the independent USD and JPY execution/settlement values, tax-basis
settlement value, USD fee, transaction currency, and FX rate. A missing or
different Monex field family remains unsupported instead of falling through to
the permissive generic brokerage parser.

The checked-in fixture is deliberately named `*.synthetic.csv`. It validates
parser mechanics and collision boundaries; it is not represented as a Monex-
issued sample. A sanitized current export is still required to confirm literal
byte-level compatibility and extend the versioned header allowlist if needed.

The adapter does not handle the separate Order List CSV/order-upload format,
the generic **All transaction history** export, or the pre-renewal foreign-stock
site export. Monex documents those as different screens or generations.

## Supported subset

The initial dedicated contract accepts one physical row as one brokerage event
only when all of these conditions are explicit:

- trade and settlement dates are valid and the trade belongs to the current
  post-2026-02-16 history generation;
- transaction type is `現物`;
- side is exactly `買` or `売`;
- account type is `一般`, `特定`, or `NISA`;
- transaction currency is explicitly U.S. dollars;
- the combined security field starts with an unambiguous U.S. ticker and has a
  non-empty name;
- quantity, exported USD unit price, gross amount, settlement amount, and fee
  are valid finite values.

KakeFlow uses the exported gross, settlement, and fee values as independent
facts. It does not recompute the authoritative gross from quantity × price and
does not infer transaction currency from the presence of an FX rate. A source
settlement difference is retained as an auditable adjustment and warning; all
ledger legs still balance per currency.

## Intentionally blocked rows

The following values produce blocking issues instead of guessed investment
events:

- yen-settled rows: the source publishes a USD fee but the current canonical
  event has no general dual-currency execution/settlement model;
- `信用`, FX, transfers, deposits/withdrawals, position movements, account
  transfers, and dividends;
- unknown sides, accounts, currencies, sparse values, malformed dates, or an
  ambiguous ticker/name;
- trades before the current history generation.

To import with the current implementation, export the screen filtered to `現物` and U.S.-dollar
settlement. Unsupported rows remain visible during preview and must not be
silently coerced.

## Import and provenance

The user must select an existing active `ASSET / SECURITIES` account for each
file. KakeFlow never guesses or creates that account. It stores the immutable
source document, physical row number, and raw fields, then writes balanced
brokerage events to the separate investment ledger. Re-importing the same
source is idempotent. The household ledger, household expense metrics, and
cash-flow reports are not posted by this workflow.

The public page states that current screen history begins on 2026-02-16 and is
available for up to 18 months. Older history is a separate export-generation
problem and is not interpreted by this adapter.
