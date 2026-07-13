# Card settlement coverage

KakeFlow treats a credit-card purchase and the later bank debit as two different accounting events. The purchase recognizes the household expense and increases the card liability. The bank debit pays down that liability and changes cash, but it does not create a second expense.

## Explicit mapping only

Each active credit-card liability account may be mapped to one active bank asset account in the same household. The user must choose this relationship in the Cards workspace. KakeFlow does not infer it from issuer names, transaction descriptions, previous matches, or similar amounts.

Removing a mapping immediately removes its statements from bank-balance projection. The outstanding statements remain visible as unmapped obligations. A mapped card or bank account cannot be archived until the mapping is removed.

## Coverage calculation

For a requested as-of date and horizon, KakeFlow:

1. Calculates the bank balance from every `POSTED` journal entry effective on or before the as-of date.
2. Keeps transactions marked `calculation_target = false` in this balance because the flag changes analytics, not real assets or liabilities.
3. Selects every outstanding dated statement due on or before the horizon, including older overdue statements.
4. Subtracts only confirmed card payments effective on or before the as-of date.
5. Sorts statements by due date and projects them cumulatively for every card mapped to the same bank.

The resulting state is:

- `COVERED` when the cumulative projected bank balance remains non-negative.
- `SHORTFALL` when a future or current obligation makes the projected balance negative.
- `OVERDUE` when the statement due date is earlier than the as-of date; any associated shortfall is raised as a critical action.

Coverage has a hard row budget and rejects an oversized request instead of silently truncating obligations.

## Incomplete data

An outstanding statement without a bank mapping is returned separately as an unmapped obligation. A statement without a payment due date is also returned separately and excluded from chronological projection. Both states appear in the Cards workspace and Action Center so missing data cannot look like available payment capacity.

KakeFlow 0.29 lets the user resolve that exclusion by entering a due date on the statement or directly in the missing-date warning. The value must be a real ISO date on or after the statement period end. It is always labeled as user-confirmed; KakeFlow never derives it from the issuer or transaction text. Clearing the value returns the statement to the excluded missing-date group.

## Scope and safety boundary

Settlement coverage is household-wide and deliberately ignores analytical account-group and member filters. It is a read-only planning tool: it never transfers money, initiates a card payment, logs in to a bank, or changes a bank balance.
