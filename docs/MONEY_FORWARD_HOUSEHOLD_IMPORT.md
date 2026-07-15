# Money Forward ME household-ledger import

KakeFlow supports the household-ledger CSV that Money Forward ME documents with these ten columns:

`計算対象`, `日付`, `内容`, `金額（円）`, `保有金融機関`, `大項目`, `中項目`, `メモ`, `振替`, `ID`.

Money Forward documents annual app exports and monthly or institution-specific web exports in its [official download guide](https://support.me.moneyforward.com/hc/ja/articles/49505374073497-%E5%AE%B6%E8%A8%88%E7%B0%BF%E3%83%87%E3%83%BC%E3%82%BF%E3%81%AF%E3%83%80%E3%82%A6%E3%83%B3%E3%83%AD%E3%83%BC%E3%83%89%E3%81%A7%E3%81%8D%E3%81%BE%E3%81%99%E3%81%8B). The source service also documents that calculation-target-off rows leave household income/expense totals and that transfers are excluded from those totals.

## Import contract

- Column order may change, but every documented header must be present exactly after Unicode normalization.
- CSV quoting, embedded commas/newlines, UTF-8 BOM, and CP932 are handled by the existing local decoder and tokenizer.
- Dates must be real calendar dates; amounts must be non-zero safe integer JPY values. Negative values are outflows and positive values are inflows.
- Calculation and transfer flags accept only explicit supported values. Unknown flags, invalid dates, invalid amounts, and missing institutions block staging instead of dropping a row.
- A blank external `ID` is allowed with a warning, but stable cross-export deduplication is unavailable for that row.

Every raw row is stored as immutable evidence with both the original ordered fields and a named map of all ten source columns.

## Explicit institution mapping

KakeFlow accepts between one and 50 distinct normalized `保有金融機関`
values in one file. Names are normalized with NFKC and surrounding whitespace is
removed, then displayed in deterministic first-appearance order. A blank value
on any detail row or more than 50 distinct values blocks the file.

Import Inbox renders a separate selector for every source institution. Each one
must reference an active KakeFlow Asset or Liability account before staging is
enabled. The mapper rejects missing mappings and keys that are not present in
the parsed file. KakeFlow does not infer a relationship from transaction text,
reuse a default account, or create an account automatically.

The mapping belongs to the current file preview and each candidate receives the
account selected for its own source institution. It is discarded when the
preview or household changes. Multiple institutions may intentionally point to
the same canonical account, but that remains an explicit user choice.

## Review and posting

The review row displays the source institution, major/minor category, external ID, amount, direction, and calculation-target state. `内容` becomes the payee suggestion and `メモ` becomes the description suggestion. Money Forward categories remain visible source taxonomy; the user chooses the matching KakeFlow Income or Expense account rather than relying on a guessed category mapping.

A source transfer is always suggested as `TRANSFER`, always calculation-excluded, and must use only Asset/Liability journal accounts. The backend rejects attempts to turn it into income or expense.

## Overlapping exports

For rows with an external ID, KakeFlow stores a household/provider key and a canonical hash of the source facts. A later row with the same ID and identical facts is not posted again; its source row is linked as additional evidence to the existing transaction. If the same ID arrives with changed facts, the whole import fails atomically for review. Exact-file SHA deduplication remains an additional first line of protection.
