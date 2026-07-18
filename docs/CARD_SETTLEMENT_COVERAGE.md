# Card settlement coverage

Coverage projects whether mapped bank balances can satisfy outstanding card statements. It is read-only and never initiates transfers or payments.

Each active card liability may map to one active bank asset in the same household. Mapping is explicit; issuer names, descriptions, prior matches, and similar amounts are not sufficient. Mapped accounts cannot be archived until the relation is removed.

For an `asOf` date and horizon, KakeFlow calculates posted bank balance, includes analytically excluded transactions in real balance, selects dated outstanding statements, subtracts confirmed payments effective by `asOf`, then projects obligations by due date across cards sharing the bank.

- `COVERED`: cumulative projected balance stays non-negative.
- `SHORTFALL`: an obligation makes it negative.
- `OVERDUE`: due date precedes `asOf`; related shortfall becomes critical.

Unmapped statements and missing due dates remain separate visible obligations and are excluded from chronological projection. Coverage is household-wide, bounded, and independent from analytical group/member filters.
