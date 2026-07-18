# PayPay transaction-history import

The strict `paypay-history-v2` adapter accepts one exact seven-column wallet-history contract. Legacy alias-tolerant v1 remains available for backward compatibility. Repository fixtures are synthetic.

## Exact header

```text
Date & Time
Amount Outgoing (Yen)
Amount Incoming (Yen)
Transaction Type
Payment Option
Transaction ID
Description
```

The fields must appear in this order on the first physical row. BOM, width, and surrounding whitespace are normalized; aliases, preambles, extra/missing/reordered columns, and malformed rows do not match v2.

## Integrity and grouping

Each row requires a valid timestamp, exactly one positive safe-integer JPY direction, bounded type/ID/description fields, and unique physical content. Quoted multiline records preserve start/end row provenance.

Rows sharing a Transaction ID form one business event. Timestamp and description must agree; totals must remain safe integers; physical evidence rows remain distinct. Unknown transaction types remain review candidates without inferred accounting semantics.

Split funding uses complete `method (positive-integer yen)` components whose sum must equal the outgoing amount. Partial parsing or mismatched totals block the source.

## Workflow and limits

The user selects one active `ASSET / WALLET` account. The adapter never maps by filename or creates an account. Sources are bounded to 20,000 details, 10,000 events, and 64 legs per event. Malformed, duplicate, unsafe, or oversized input fails closed and never bypasses review.
