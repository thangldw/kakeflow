# Portfolio Snapshot XLSX

## Purpose

Portfolio Snapshot XLSX is a source-backed export of one persisted investment
snapshot. It is intended for inspecting and sharing the values imported from an
`assetbalance(all)_*.csv`-style source without recalculating portfolio
performance or replacing the investment ledger.

The export reads `PortfolioSnapshotDetailDto` through the exact native request:

```json
{
  "command": "portfolio_snapshot_get",
  "householdId": "household-id",
  "snapshotId": "snapshot-id"
}
```

Both identifiers are required. The exporter must not infer the latest snapshot
from an account, date, filename, or household. The native query enforces that
the snapshot belongs to the requested household and fails when the scope does
not match.

## Snapshot semantics

- One workbook represents exactly one persisted snapshot, one investment
  account, one source document, and one source-provided `asOf` point in time.
- `asOf` is the valuation time reported by the source. It is not the time of a
  current price lookup.
- `accountName` is display metadata joined when the snapshot is read. It does
  not add member, account-group, or sharing scope to the export.
- `sourceDocumentId` identifies the source document for the entire snapshot.
  Child-row provenance is the pair `sourceDocumentId + sourceRow`.
- The source document and account were checked against the household when the
  snapshot was imported. Export does not repeat or weaken that ownership rule.
- Values are exported as persisted. The workbook must not synthesize missing
  values or silently correct source data.

## Workbook structure

The workbook contains exactly four sheets in this order.

### 1. `Summary`

`Summary` contains one data row with these columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `snapshotId` | text | Persisted snapshot ID |
| `householdId` | text | Household scope supplied in the export request |
| `accountId` | text | Investment account ID |
| `accountName` | text | Current display name of the account |
| `sourceDocumentId` | text | Source document for the snapshot |
| `asOf` | text/datetime | Source-provided snapshot time, preserved exactly |
| `marketValueJpy` | integer | Required non-negative total market value in JPY |
| `cashValueJpy` | integer | Required non-negative cash value in JPY |
| `unrealizedPnlJpy` | integer or blank | Signed unrealized P&L reported by the source |
| `realizedPnlJpy` | integer or blank | Signed realized P&L reported by the source |
| `positionCount` | integer | Persisted position count |
| `fxRateCount` | integer | Persisted FX-rate count |

### 2. `AssetClasses`

One row is written for each `assetClasses` element:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text | Persisted asset-class row ID |
| `name` | text | Source asset-class name |
| `marketValueJpy` | integer | Required non-negative value in JPY |
| `unrealizedPnlJpy` | integer or blank | Signed source-reported unrealized P&L |
| `sourceDocumentId` | text | Repeated snapshot source document ID |
| `sourceRow` | integer | Positive row number in the source document |

### 3. `Positions`

One row is written for each `positions` element:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text | Persisted position row ID |
| `productType` | text | Source product type |
| `accountType` | text | Source account or tax-wrapper type |
| `instrumentCode` | text | Source instrument code |
| `instrumentName` | text | Source instrument name |
| `currency` | text | Three-letter uppercase source currency |
| `quantity` | decimal or blank | Non-negative source quantity |
| `averageCost` | decimal or blank | Non-negative source average cost |
| `marketPrice` | decimal or blank | Non-negative source market price |
| `marketValueJpy` | integer or blank | Non-negative source-reported JPY value |
| `unrealizedPnlJpy` | integer or blank | Signed source-reported unrealized P&L |
| `realizedPnlJpy` | integer or blank | Signed source-reported realized P&L |
| `sourceDocumentId` | text | Repeated snapshot source document ID |
| `sourceRow` | integer | Positive row number in the source document |

### 4. `FXRates`

One row is written for each `fxRates` element:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | text | Persisted FX-rate row ID |
| `baseCurrency` | text | Three-letter uppercase source currency |
| `quoteCurrency` | text | Always `JPY` for this snapshot contract |
| `rate` | decimal | Required finite rate greater than zero |
| `sourceDocumentId` | text | Repeated snapshot source document ID |
| `sourceRow` | integer | Positive row number in the source document |

Child sheets may be empty, for example for a cash-only snapshot. Their headers
are still present.

## Null and numeric handling

- A blank cell means the source value is absent. Blank must never be converted
  to zero.
- The exporter must not calculate `quantity × marketPrice`, fill a missing
  `marketValueJpy`, derive P&L, or convert a position into JPY.
- JPY amounts use numeric cells and must remain within the native absolute bound
  of `9,000,000,000,000,000`.
- Quantity, cost, price, and FX-rate values use numeric cells. Non-finite values
  are rejected.
- `sourceRow`, `positionCount`, and `fxRateCount` use integer cells.
- `asOf` is preserved without changing its timezone or choosing a newer value.
- Workbook cells contain values only. Formulas, macros, and external links are
  not generated.

## Validation and export bounds

The export fails closed and writes no partial workbook when any condition is
violated.

- The native snapshot query fails or the requested household does not own the
  snapshot.
- The returned snapshot ID or requested household scope is inconsistent.
- `positions.length` differs from `positionCount`, or `fxRates.length` differs
  from `fxRateCount`.
- A required field is missing, a child ID is duplicated, or a source row is not
  a positive integer.
- A currency is not three uppercase ASCII letters, an FX quote currency is not
  `JPY`, or an FX rate is not finite and greater than zero.
- A numeric value is non-finite, negative where prohibited, or outside the JPY
  bound.
- Any identifier exceeds 64 characters or any other text cell exceeds 512
  characters.
- `AssetClasses` exceeds 1,000 rows, `Positions` exceeds 20,000 rows,
  `FXRates` exceeds 256 rows, or total data rows exceed 25,000.
- The completed workbook exceeds 8 MiB.

Bounds are applied before serialization where possible and again after workbook
generation. Data must never be silently truncated to meet a bound.

## Native save and cancellation

Workbook construction and filesystem writes belong to the native layer. XLSX
bytes are not returned through IPC.

1. The UI sends the exact `householdId + snapshotId` request.
2. Native code validates and loads the complete snapshot.
3. Native code builds the bounded workbook in memory.
4. The user chooses a destination with the platform save dialog.
5. Native code writes the completed in-memory workbook to the selected path.
6. The UI receives only export metadata such as filename, byte size, and row
   counts.

If the user cancels the save dialog, the operation reports cancellation and
writes nothing. Cancellation is not an error and must not create an empty or
partial file.

## Explicit exclusions

This contract does not include:

- brokerage event performance;
- FIFO, open lots, or realized-allocation computation;
- a current market valuation query or latest-quote selection;
- investment FX reporting conversion beyond the source FX rows;
- Money Forward aggregate asset history;
- multi-snapshot trend or change analysis;
- ROI, TWR, IRR, forecast, or benchmark calculations;
- brokerage trades, dividends, fees, or tax-event exports.

Those require separate event, lot, valuation, or time-series contracts. They
must not be inferred from this point-in-time snapshot workbook.
