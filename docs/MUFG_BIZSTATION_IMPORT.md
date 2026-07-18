# MUFG BizSTATION all-details import

The dedicated adapter supports the MUFG BizSTATION `全明細` business-account export defined by the [official CSV specification](https://web.bizstn.bk.mufg.jp/biz/ikou2026/contents/guide/pdf/mei_syoukai_zen_csv.pdf). It does not cover MUFG Direct personal-account downloads.

## Record family

The Shift_JIS/CRLF source contains:

- type `1`: one 15-field account and export header;
- type `2`: seven-field transaction details;
- type `8`: one footer marker; and
- type `9`: one eight-field count, total, opening-balance, and closing-balance record.

Detection requires the complete family. The parser validates record widths/order, the `全明細` marker, requested and operation dates, official account type pairs, seven-digit account number, one non-zero JPY side per detail, final counts/totals, and continuous balances in the provable source direction.

Incomplete, unfamiliar, unsafe, or inconsistent files remain blocked. Raw rows and physical order remain immutable evidence. Holder and account numbers validate the source but are not copied into adapter metadata.

## Workflow

The user selects an existing `ASSET / BANK` account. The adapter never creates or infers an account from source identity. Candidates require review and approval.

Known card-issuer debits may receive a `CARD_PAYMENT` suggestion. A confirmed card payment affects cash flow and settles liability without becoming a second expense.
