# Explicit import account mapping

Every transactional source must be mapped to its canonical KakeFlow account before staging. A file format proves structure, not ownership; issuer text, filenames, defaults, and “first compatible account” are insufficient evidence.

| Source family | Required account |
| --- | --- |
| Personal or generic bank ledger | `ASSET / BANK` |
| PayPay wallet history | `ASSET / WALLET` |
| Card statements | `LIABILITY / CREDIT_CARD` |
| Brokerage trade history | `ASSET / SECURITIES` |
| Money Forward household ledger | Explicit Asset/Liability mapping per institution |

Mapping belongs to the current preview. Separate files of the same type may select different accounts, and selections are discarded with the preview or household change. Card mapping applies consistently to the statement and its lines.

Selection does not post data. The source is still stored as immutable evidence, candidates remain pending, and explicit approval is required. To correct a staged mapping, roll back the pending import and stage again with the correct account.
