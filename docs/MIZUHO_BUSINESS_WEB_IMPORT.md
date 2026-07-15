# Mizuho Business Web deposit/withdrawal CSV import

KakeFlow supports the thirteen-field CSV exported by **みずほビジネスWEB** deposit/withdrawal inquiry. The dedicated `mizuho-business-web-statement-v1` adapter follows the bank's [official inquiry-service manual](https://www.mizuhobank.co.jp/corporate/ebservice/b_web/pdf/zandaka.pdf), including the CSV structure and record format documented in section III-2②. It does not detect the source from a filename or an unrelated Mizuho product name.

## Exact source contract

The official format is Shift_JIS CSV with CRLF records. The first physical record must contain exactly these fields in order:

```text
照会口座,番号,勘定日,(起算日),出金(円),入金(円),小切手区分,
残高(円),取引区分,明細区分,金融機関名,支店名,摘要
```

Header comparison applies Unicode NFKC normalization, so the manual's full-width parentheses and their ASCII equivalents match. Aliases, reordered/extra/missing fields, multiline headers, and a preamble before the header fail detection. KakeFlow's byte decoder handles Shift_JIS before the common RFC-style CSV tokenizer parses quoted fields.

Each accepted normal detail must have:

- exactly thirteen fields and one consistent, non-empty inquiry-account descriptor;
- a non-empty transaction number of at most five characters;
- a valid Gregorian accounting date and, when present, a valid value date;
- exactly one positive safe-integer JPY debit or credit;
- a signed safe-integer JPY running balance;
- one official transaction type;
- a blank detail classification;
- a blank, `小切手`, or `他店券` check classification; and
- institution, branch, and summary values within their published limits.

The accepted official transaction-type set is:

```text
振込入金  取立入金  入金  出金  現金  振替入金  取立
振込      他券振込  振替支払  交換払  小切手    他店券
```

The populated amount field, not a guessed translation of that label, determines canonical debit or credit direction. Institution, branch, check type, and value date remain review context; every original field stays in immutable source-row provenance.

## Date, order, and balance evidence

The manual gives a 14-character maximum for the two date fields but does not establish one literal CSV date presentation. KakeFlow accepts only its existing verified Gregorian forms: `YYYY/MM/DD`, `YYYY-MM-DD`, `YYYY.MM.DD`, or Japanese year/month/day text. Era dates, two-digit years, and malformed dates are rejected.

For multiple supported details, dates and every adjacent running balance must prove exactly one continuous `OLDEST_FIRST` or `NEWEST_FIRST` physical order. KakeFlow never sorts source rows to manufacture a valid sequence. A one-detail file is marked `SINGLE_ROW`.

The manual describes transaction numbers as date-scoped inquiry numbers. KakeFlow therefore requires `(accounting date, number)` to be unique within the source but does not use the number as a durable external transaction ID. It remains available in raw provenance for audit and deduplication evidence.

## Correction boundary

The official format allows a leading minus sign for some amount categories and permits `取消` or `欠番` in `明細区分`. The public record layout does not provide enough linkage for KakeFlow to prove the original transaction and reversal relationship. The v1 adapter therefore blocks:

- every negative debit or credit amount;
- `取消` and `欠番` details; and
- any unknown non-empty detail classification.

It does not turn a negative amount into income, silently omit a correction, pair by description, or repair a missing sequence. A file containing one of these rows remains visible with a blocking parse issue and is not staged.

## Explicit account mapping

One CSV can technically contain results for more than one queried account, but KakeFlow's canonical import decision maps a source to one explicitly selected destination account. The v1 adapter therefore blocks mixed inquiry-account descriptors. The account text is checked for consistency but is not persisted in parser metadata or used to auto-select/create a ledger account.

Before staging, the user must select an existing active `ASSET / BANK` account. Every candidate then follows the normal Import Inbox review, explicit approval, deduplication, balanced posting, and rollback workflow. A card-like debit is only a review suggestion; it is never posted automatically.

## Deliberate limits

- The adapter covers this official Mizuho Business Web CSV only, not its API text, XML, PDF, personal Direct, e-Business Site, or other products.
- At most 100,000 physical details are accepted per source.
- Unsafe integers, fractional/zero transaction amounts, grouped digits, currency markers, unsupported values, and unresolved source order fail closed.
- Multi-account files require separation into one source per destination account.
- Corrections and missing-number semantics remain unsupported until an authoritative linkage contract is available.
