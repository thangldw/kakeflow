# Local Family Space

KakeFlow introduced stable household members and account ownership as a
foundation for family organization. KakeFlow adds an explicit mapping
from a local logical principal to one of these member IDs. That mapping is
portable sync metadata, not a login, authenticated cloud identity, or permission.

## Model

- Every household has at least one active member. Existing and newly created
  households receive a primary local member automatically.
- Members are archived rather than deleted so ownership history remains stable.
- A member who owns an account cannot be archived until the account is moved to
  the household or another active member.
- Account ownership is `HOUSEHOLD` or `MEMBER`.
- Visibility is `SHARED` or `PERSONAL`. Member-owned shared accounts are valid;
  personal accounts require an active owner in the same household.

The database and restore validator reject cross-household or archived ownership,
personal household accounts, and households with no active member.

## Product boundary

Family Space is local classification and organization. It is not authentication,
authorization, or a promise that another person using the same desktop cannot
view a personal account. Account groups also remain analytical scopes, not
permissions. the local principal mapping is preparation for a future
transport and does not change this boundary.

KakeFlow adds two independent transaction dimensions:

- Attribution (`HOUSEHOLD` or one member) answers whose household activity a
  transaction represents.
- Audience (`SHARED` or one personal member) is a local organization label.

Source documents have their own audience tuple. Changing a source label never
changes a linked transaction, and neither tuple is inferred from account
ownership. A transfer can touch multiple owners, while one statement can support
transactions attributed to several members.

KakeFlow enables member analytics with one tagged attribution scope across
dashboard activity, ledger, calendar, reports, intelligence, forecast history,
Action Center actuals, and transaction export. The available scopes are the
whole household, household-common activity, or one member—including an archived
member for historical reporting. Account groups and attribution are independent
filters and combine using logical AND.

Net worth, account and investment balances, goals, import status, and unallocated
household obligations remain household-wide because they are not transaction
attribution facts. The UI labels that boundary instead of presenting a partial
balance as a member balance. Audience labels still do not provide access control.
Authenticated multi-device enforcement requires a future remote-principal
mapping, transport, and backend authorization; the local mapping does not
satisfy those requirements.
