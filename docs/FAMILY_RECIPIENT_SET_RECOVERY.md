# Family recipient-set recovery

KakeFlow preserves two requirements that can otherwise conflict: an
accepted publication must be retried with byte-identical encrypted transport,
while an envelope rejected before storage because its recipient set is stale
must eventually be encrypted for the current recipients.

## Immutable-first retry

Preparing an explicit Send first asks the native delivery store for any cached
`KFE1` envelope matching the immutable inner artifact. This happens before the
WebView derives current recipients. A cached envelope is uploaded unchanged,
including its original transport SHA-256 and recipient-set digest.

This ordering covers a lost-response sequence:

1. the relay accepts and stores an encrypted publication;
2. the desktop does not receive the success response;
3. a membership key is later added or rotated;
4. the user retries Send;
5. KakeFlow replays the exact old envelope;
6. the relay recognizes the already accepted immutable publication and returns
   the existing receipt.

KakeFlow then acknowledges the local delivery. It does not widen the historical
publication to a member or membership generation that was not an original
recipient.

## Exact stale-recipient rejection

For a new publication, the relay compares the envelope's canonical recipient-
set digest with its current active recipient snapshot before storing any bytes.
Only HTTP 409 with the exact `RECIPIENT_SET_CHANGED` error code authorizes the
desktop to reset that cached envelope.

The native reset command requires the exact delivery ID, transport SHA-256, and
recipient-set digest that the relay rejected. It validates the whole request in
one transaction, clears only the rejected encrypted-envelope fields, preserves
the inner family artifact and lineage, and leaves the delivery retryable. The
next explicit Send derives current recipients and creates a new envelope.

Timeouts, connection failures, malformed responses, unrelated status codes, and
all other ambiguous outcomes retain the cached bytes. Re-encrypting after an
ambiguous outcome would make it impossible to distinguish a rejected upload
from one the relay accepted before the response was lost.

## Partial batches and process recovery

`SHARED` and `PERSONAL(member)` artifacts can have different outcomes in one
explicit Send. KakeFlow first acknowledges every valid relay receipt, then
resets only exact stale-recipient tuples. Other retryable artifacts remain
cached. A synchronous in-flight guard prevents two user actions from racing the
same local delivery state.

If the desktop exits while a row is `SENDING`, startup moves it to
`FAILED_RETRYABLE` without changing its inner package, envelope, or digests.
The next explicit Send therefore follows the same immutable-first logic. An
exact reset whose native response was lost is also idempotent when retried.

## Manual boundary

Recipient-set recovery does not add automatic synchronization. The background
metadata schedule never sends or resets an outbound envelope. Creating or
retrying delivery still requires explicit Send, and receiving still requires
explicit download, review, conflict decisions, and Apply. No recovery path
automatically changes household ledger, planning, card, investment, or evidence
data.
