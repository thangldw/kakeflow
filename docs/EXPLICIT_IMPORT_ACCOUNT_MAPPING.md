# Explicit import account mapping

KakeFlow requires the user to select the canonical destination account for each transactional source file before staging it for review. This applies to the strict [provider-neutral personal Japanese bank ledger](PERSONAL_JAPANESE_BANK_IMPORT.md), legacy generic Japanese bank, PayPay history, Rakuten e-NAVI, Amazon Mastercard, JCB MyJCB, SMBC Vpass, AEON finalized-statement, and [PayPay Card finalized-statement](PAYPAY_CARD_IMPORT.md) adapters.

## Why selection is explicit

A source format identifies the shape of a file, not the household account that owns it. A filename, issuer label, or account name is insufficient evidence when a household has multiple bank accounts, wallets, cards, or similarly named accounts. Assigning the wrong account would distort balances, card liabilities, and later settlement reconciliation even if every amount were parsed correctly.

KakeFlow therefore does not use:

- a household default bank, wallet, or card ID;
- card issuer keywords in account names;
- the source filename as an account identifier;
- the first compatible account as a silent fallback.

## Compatible account types

| Source adapter | Selectable canonical account |
| --- | --- |
| Strict personal Japanese bank ledger v2 | `ASSET / BANK` |
| Legacy generic Japanese bank ledger v1 | `ASSET / BANK` |
| PayPay transaction history | `ASSET / WALLET` |
| Rakuten e-NAVI statement | `LIABILITY / CREDIT_CARD` |
| Amazon Mastercard statement | `LIABILITY / CREDIT_CARD` |
| JCB MyJCB statement | `LIABILITY / CREDIT_CARD` |
| SMBC Vpass statement | `LIABILITY / CREDIT_CARD` |
| AEON finalized statement | `LIABILITY / CREDIT_CARD` |
| PayPay Card finalized statement | `LIABILITY / CREDIT_CARD` |

The mapping is stored in the in-progress preview state and passed to every normalized candidate from that file. For card files, the same selected liability account is also assigned to the statement and all of its statement lines.

Each preview has an independent selection, so two files of the same format can be routed to different household accounts in one batch. Selections are discarded when their preview disappears or the active household changes; they are not reusable institution rules.

## Review boundary

Selecting an account does not post transactions. The file is still encrypted and staged as immutable evidence, every candidate remains pending review, and posting still requires explicit per-candidate decisions. To correct a mapping before staging, choose the proper account in Import Inbox. After staging, roll back the pending import and stage the source again with the corrected account.
