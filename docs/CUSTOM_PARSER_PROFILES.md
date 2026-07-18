# Custom CSV and TSV parser profiles

Parser profiles normalize unsupported JPY transaction files into ordinary review candidates. Profiles are household-scoped, encrypted, versioned, and applied only after explicit selection.

## Profile contract

A profile defines delimiter, encoding, one-based header row, date column/format, description/payee fields, and either one signed amount or separate debit/credit columns. Signed profiles declare whether positive means incoming or outgoing. External ID and account hint are optional.

Profiles cover integer-JPY bank/card-like rows only. Multi-currency, portfolio, and brokerage sources require dedicated adapters.

## Rescue flow

Unsupported CSV/TSV opens a local dialog that:

1. proposes headers from the first 12 physical rows;
2. limits mapping choices to the selected header;
3. clears stale mappings when the header changes;
4. previews encoding, delimiter, matches, counts, exclusions, and row issues; and
5. saves a named profile only after validation.

Duplicate headers, invalid encoding/dates, zero or ambiguous sides, missing fields, and any row error block staging. Account hints may preselect but never confirm a destination account.

The stored profile ID/version becomes adapter provenance. Optimistic concurrency protects profile update/delete. A clean preview still enters immutable staging and explicit candidate approval; profiles never auto-post.
