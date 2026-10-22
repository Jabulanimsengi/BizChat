# ADR 0006: Allocate ordered messages in PostgreSQL

## Status

Accepted

## Decision

Every conversation owns a `nextSequence` BIGINT. Creating a message occurs in one transaction that
atomically increments that value and writes the returned sequence to the message. PostgreSQL unique
constraints protect both `(conversationId, sequenceNumber)` and `(conversationId, clientMessageId)`.
Visitor messages additionally constrain `(businessId, senderVisitorId, clientMessageId)` so concurrent
first-message retries cannot create multiple conversations. Conversation creation uses a transaction-
scoped advisory lock for the tenant/visitor pair.

## Consequences

- Sequence numbers are monotonic and unique per conversation under concurrent writers.
- A retry reuses its UUID client message ID and receives the existing committed message.
- Gaps are not introduced by failed message inserts because sequence allocation and insertion roll back together.
- Socket broadcasts occur only after commit and are deduplicated by clients using server/client message IDs.
- PostgreSQL remains the durable ordering authority; Redis is not required to preserve messages.
