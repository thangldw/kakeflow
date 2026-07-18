# Money Forward ME household-ledger import

KakeFlow supports the ten-column household-ledger export documented in Money Forward ME's [download guide](https://support.me.moneyforward.com/hc/ja/articles/49505374073497-%E5%AE%B6%E8%A8%88%E7%B0%BF%E3%83%87%E3%83%BC%E3%82%BF%E3%81%AF%E3%83%80%E3%82%A6%E3%83%B3%E3%83%AD%E3%83%BC%E3%83%89%E3%81%A7%E3%81%8D%E3%81%BE%E3%81%99%E3%81%8B):

```text
計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID
```

Column order may change, but all normalized headers are required. UTF-8/CP932, BOM, quoted commas, and multiline fields use the common local decoder/tokenizer. Dates must be real; amounts must be non-zero safe-integer JPY; calculation and transfer flags must use supported explicit values.

## Institution mapping

A file may contain 1–50 normalized `保有金融機関` values. Import Inbox requires one explicit active Asset/Liability account mapping for every institution before staging. KakeFlow does not guess, reuse a default, or create accounts. Multiple institutions may map to one account only by explicit choice.

## Review semantics

The review keeps institution, categories, external ID, amount, direction, calculation target, memo, and all ten raw fields visible. Source categories are hints, not automatic KakeFlow account mappings.

Transfers are calculation-excluded and may use only Asset/Liability journal accounts. Rows with a stable external ID deduplicate by provider ID plus canonical source facts: identical facts attach evidence to the existing transaction; changed facts fail atomically. Blank IDs remain importable with a warning and only source/file deduplication.
