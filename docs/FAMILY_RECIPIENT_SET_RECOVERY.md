# Family recipient-set recovery

An explicitly prepared encrypted send can become stale when active relay membership generations change. Recovery preserves exact retry semantics.

- Ordinary retry always replays the same persisted `KFE1` bytes.
- Only an exact relay `RECIPIENT_SET_CHANGED` rejection can reset the prepared envelope.
- Reset does not send; the next explicit Send reseals against the current recipient set.
- Ambiguous/network failures retain the immutable envelope.
- Multi-partition results reconcile independently.
- Restart resumes the same persisted state without automatic delivery or Apply.

The desktop reauthenticates membership and encryption identities before resealing. A recipient-set change is routing metadata, not permission to alter the inner family artifact, audience, or review contract. Background inbound discovery never resets or reseals outbound work.
