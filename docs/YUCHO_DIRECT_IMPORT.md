# Yucho Direct transaction import

KakeFlow recognizes the personal-account transaction CSV exported by Yucho Direct. The adapter follows Japan Post Bank's published format rather than guessing aliases from third-party files.

Official references:

- [Yucho Direct transaction inquiry and CSV structure](https://www.jp-bank.japanpost.jp/direct/pc/guide/dr_pc_gd_meisai.html)
- [Japan Post Bank explanation of the CSV detail fields](https://faq.jp-bank.japanpost.jp/faq_detail.html?id=132)
- [Japan Post Bank download and file-size guidance](https://faq.jp-bank.japanpost.jp/faq_detail.html?id=134)

## Recognized columns

```text
取引日
入出金明細ID
受入金額(円)
払出金額(円)
詳細1
詳細2
現在(貸付)高
```

The header may follow an account-information preamble. KakeFlow searches only the first 32 physical rows and requires all seven official columns in their documented order. Full-width parentheses are normalized, but unknown column names or layouts remain unsupported instead of being guessed.

## Canonical mapping

- `取引日` is parsed as a real `YYYYMMDD` calendar date.
- `受入金額(円)` creates an incoming bank candidate.
- `払出金額(円)` creates an outgoing bank candidate.
- `詳細1` and `詳細2` remain separate in the candidate and are combined visibly during review.
- `現在(貸付)高` accepts a signed integer so a loan balance is not discarded.
- The KakeFlow bank account must be selected explicitly at import time.

Japan Post Bank describes `入出金明細ID` as a sequence assigned when the CSV is exported. KakeFlow therefore retains it in the immutable raw row for audit but never uses it as `externalTransactionId` or as a cross-export deduplication key.

## Validation

The adapter rejects malformed physical row width, impossible dates, missing or simultaneous incoming/outgoing amounts, non-positive transaction amounts, invalid balances, duplicate export sequences within one file, and running-balance discontinuity between oldest-first rows.

The official detail vocabulary can use `カード` for an ATM cash-card event. KakeFlow leaves such a row as `UNKNOWN`; it does not silently turn it into `CARD_PAYMENT`. The user can classify or reconcile it after reviewing the original row and account context.
