# Personal Japanese bank ledger import

The provider-neutral `personal-japanese-bank-ledger-v2` adapter accepts a strict nine-column personal-account ledger. The permissive `japanese-bank-ledger-v1` remains available for compatibility.

## Exact header

```text
日付,摘要,摘要内容,支払い金額,預かり金額,差引残高,メモ,未資金化区分,入払区分
```

NFKC, BOM, and whitespace normalization are allowed. Field aliases, extra/missing/reordered columns, multiline headers, or headers after more than eight preamble rows are rejected.

## Detail rules

Every row must contain exactly nine fields, a supported Gregorian date, exactly one positive safe-integer JPY debit or credit, a signed balance, useful description text, and a direction label consistent with the populated side. Duplicated physical details, summaries, unsafe values, malformed grouping, fractions, and two-sided rows block the source.

Source order is preserved. For multiple details, dates and every adjacent balance must prove exactly one `OLDEST_FIRST` or `NEWEST_FIRST` sequence. A single row is `SINGLE_ROW`. Mixed, ambiguous, or discontinuous sequences are rejected rather than sorted.

## Provenance and mapping

Every candidate retains complete raw fields and physical start/end rows, including multiline quoted content. The user maps the preview to one existing active `ASSET / BANK` account. Provider identity, destination account, and durable external IDs are not inferred. Review and rollback remain mandatory.
