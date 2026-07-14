# Annual Investment Performance XLSX

KakeFlow exports the annual Investment Performance report as a native Excel workbook generated from the existing `InvestmentPerformanceRequest` and `InvestmentPerformanceDto`. The workbook does not introduce another investment calculation model: native code runs the same `investment_performance_query` used by the visible annual investment report and writes only the validated facts returned by that query.

## Request and period semantics

The export reuses the exact request fields:

```text
householdId
accountId?
dateFrom?
dateTo?
```

The annual desktop action supplies the selected calendar year's first and last dates as inclusive `dateFrom` and `dateTo` boundaries. Workbook generation rejects a missing, invalid, reversed, or non-calendar-year annual range rather than assigning a year itself.

`accountId` remains optional in the native request. When supplied it must identify one securities account in the same household. The current annual-report UI does not expose an account selector and omits `accountId`, so its workbook contains all securities accounts in the household. It is not a saved-account-group or household-member attribution export.

FIFO performance for the selected period still scans acquisitions before `dateFrom` to establish the cost basis of sales inside the period. Only period totals, realized allocations, uncovered sales, and corporate-action allocations are filtered to the inclusive annual range. Diagnostic skipped-event and corporate-action event IDs may originate from the prior acquisition history scanned through `dateTo`; they must not be labeled as annual transactions without an in-period date supplied by the DTO.

## Native currencies remain separate

Every currency bucket remains independent. The workbook must not add JPY, USD, or any other currencies together, convert them through an implicit rate, or display one mixed-currency grand total. Amount cells stay numeric and always have an adjacent currency field.

This export does not query or include:

- current holdings or open lots;
- current market valuation or unrealized P&L;
- market prices or FX conversions;
- portfolio snapshots or Money Forward aggregate asset history;
- ROI, time-weighted return, money-weighted return, IRR, or investment forecasts.

Those facts require different requests and time semantics and must not be inferred from annual cash flows or realized P&L.

## Workbook contents

The workbook has four fixed sheets.

### `Summary`

The sheet records household ID, account ID or `ALL_SECURITIES_ACCOUNTS`, inclusive `dateFrom` and `dateTo`, and cost-basis method. `costBasisMethod` must be `FIFO`.

It then writes one row per `totalsByCurrency` item with these typed measures:

- currency;
- buy gross;
- sell gross;
- realized P&L;
- dividend gross;
- fees; and
- taxes.

No cross-currency total or Excel formula is added.

### `Realized`

The sheet writes every `RealizedAllocationDto` row returned for the annual period:

- sell and buy event IDs;
- account ID;
- instrument code and name;
- currency;
- sold and acquired dates;
- quantity;
- allocated cost basis;
- allocated net proceeds;
- realized P&L;
- buy source document ID and row; and
- sell source document ID and row.

These source fields provide the buy-to-sell audit trail. The workbook does not replace them with a filename or other lineage that is absent from the DTO.

### `CorporateActions`

The sheet writes every `CorporateActionAllocationDto` row returned for the annual period, including action ID/type/date, source and target instrument codes, source and output currencies, source cost basis, explicit conversion rate when present, quantity, allocated cost basis, cash amount, realized P&L, action source document/row, and optional source-buy event/document/row.

Nullable source-buy or conversion fields remain blank only when the DTO permits them for that action type. They are never changed to zero or described as confirmed provenance.

### `Exceptions`

The sheet presents calculation limitations as explicit typed records:

- each `UncoveredSaleDto`, including event, account, instrument, currency, sold date, uncovered quantity, source document ID, and source row;
- each `skippedEventId`; and
- each `corporateActionEventId` that does not have a corresponding allocation row in the DTO.

Skipped and unmatched corporate-action IDs have no source document or source row in the current DTO. Their provenance cells remain blank with a disclosure that lineage is unavailable in this report DTO; the workbook must not manufacture it.

## Generation and save boundary

The native desktop process queries, generates, and writes the workbook. Binary XLSX bytes never cross WebView IPC. The UI receives only the saved filename, exported data-row count, byte size, and cancellation result. Cancelling the native save dialog writes nothing.

Generation is bounded to:

- exactly four sheets;
- at most 64 native-currency summary rows;
- at most 10,000 realized-allocation rows;
- at most 5,000 corporate-action rows;
- at most 5,000 exception rows and 20,000 exported data rows overall;
- at most 512 characters in a text cell;
- finite numeric values that can be represented by Excel; and
- an 8 MiB workbook.

The exporter fails instead of truncating records, rounding an out-of-range value, dropping an exception, or splitting the report into an undisclosed partial workbook.

Invalid household/account scope, invalid annual boundaries, a non-FIFO response, malformed currency/date/provenance, non-finite numbers, impossible corporate-action source requirements, row/text/output limits, and native workbook errors all fail closed. An annual period with no investment facts may be shown as empty in the UI, but it is not saved as a workbook that appears to contain a completed investment report.
