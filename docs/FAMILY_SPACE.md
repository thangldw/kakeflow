# Local Family Space

KakeFlow v0.11 introduces stable household members and account ownership as a
foundation for family organization. These records contain no login, device, or
cloud-provider identity. A future synchronization service can map authenticated
principals to the same member IDs without rewriting financial ownership data.

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
permissions.

KakeFlow intentionally does not infer transaction or source-document visibility
from account ownership. A transfer can touch multiple owners, and a receipt can
support several financial legs. The next family-data phase must add explicit
transaction attribution and resource audiences before member-filtered reports,
multi-device identity, or access control are enabled.
