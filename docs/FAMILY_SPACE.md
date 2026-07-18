# Local Family Space

Family Space organizes local household members, account ownership, transaction attribution, source audience, and explicit data-delivery reviews.

- Ownership identifies the household member associated with an account.
- Attribution scopes analytical transaction facts.
- Audience controls family-delivery partitioning.
- None of these fields authenticates a local desktop user or provides same-device access control.

Receive and Send tabs display artifact identity, audience, digest, size, retry state, conflicts, and apply status. Transport configuration remains in Settings. Receiving/staging is non-mutating; every conflict and omission requires review before one atomic Apply.

Personal relay packages are same-principal whole-household artifacts. Cross-principal family delivery uses relay-derived membership and SHARED/PERSONAL partitions. Portable evidence and pending-review packages remain separate formats with separate trust boundaries.
