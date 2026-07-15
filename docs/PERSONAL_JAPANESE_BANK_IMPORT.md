# Personal Japanese bank ledger import

KakeFlow provides the provider-neutral `personal-japanese-bank-ledger-v2`
adapter for a strict nine-column personal-account ledger contract. It is a new
adapter: the more permissive `japanese-bank-ledger-v1` remains available for
backward compatibility and is not silently rewritten or removed.

## Exact source contract

The header must contain exactly these columns, in this order:

```text
日付,摘要,摘要内容,支払い金額,預かり金額,差引残高,メモ,未資金化区分,入払区分
```

Header comparison applies Unicode NFKC normalization, removes a UTF-8 BOM,
and normalizes whitespace. It does not accept aliases, missing columns, extra
columns, or reordered columns. The header may follow at most eight physical
preamble rows. A header hidden beyond that bound, or spread over multiple
physical lines, is not detected.

The adapter is intentionally provider-neutral. It does not infer a bank,
branch, account number, or destination account from the filename or memo.

## Detail validation

Every non-empty physical record after the header is treated as a prospective
detail and must satisfy all of these rules:

- exactly nine columns;
- a valid Gregorian `YYYY/MM/DD`, `YYYY-MM-DD`, `YYYY.MM.DD`, or Japanese
  year/month/day date accepted by the common date parser;
- exactly one of `支払い金額` and `預かり金額` populated;
- that amount is a positive safe-integer JPY value;
- `差引残高` is a signed safe-integer JPY value;
- `摘要` or `摘要内容` is present;
- `入払区分` agrees with the populated debit or credit column;
- the physical detail row is not duplicated elsewhere in the file.

JPY values may use valid thousands grouping and a yen marker. Fractions,
zero/negative transaction amounts, unsafe integers, malformed grouping, and
two-sided rows fail closed. A balance may be negative. Recognized summary
rows are rejected rather than imported as transactions. The parser accepts at
most 100,000 detail rows in one source.

Any rejected detail produces a blocking parse error. Valid neighbors may be
shown for diagnosis, but the Import Inbox will not stage a source with an
error.

## Chronology and running balance

KakeFlow preserves source order. It never sorts rows to make reconciliation
pass. For two or more valid details, it evaluates both possible source orders:

```text
oldest first: current balance = previous balance + credit - debit
newest first: newer balance   = older balance + newer credit - newer debit
```

Dates must be monotonic for the selected order and every adjacent balance must
reconcile exactly. Exactly one order must be provable. Mixed chronology,
equally plausible orders, and running-balance discontinuities are blocking
errors. A single detail is marked `SINGLE_ROW`; no ordering claim is needed.

The chosen value is exposed as parser metadata:

```text
SINGLE_ROW | OLDEST_FIRST | NEWEST_FIRST
```

## Provenance and review

Each candidate retains the original physical start/end row numbers and every
raw field. This includes a quoted field that spans multiple physical lines.
Canonical staging hashes that complete lineage payload and links it as primary
evidence. The source document remains immutable.

Before staging, the user must select an existing active `ASSET / BANK`
account. Selection is per preview. KakeFlow never chooses the first bank
account, creates an account, or maps by filename/provider text. All candidates
remain pending until explicit review and approval.

## Detection isolation

The v2 adapter is ranked before generic v1 when the exact contract matches.
Its exact nine-column signature does not match the dedicated twenty-field
BizSTATION deposit/withdrawal format, the record-family BizSTATION all-details
format, or the dedicated seven-column Yucho Direct format. Those adapters keep
their own contracts and ranking.

## Deliberate limits

- No provider identity or durable transaction ID is claimed.
- No account identity is extracted from the preamble.
- No summary/footer repair is attempted.
- No malformed amount, date, direction, balance, or chronology is inferred.
- Import does not post automatically and does not bypass normal rollback and
  review boundaries.
