-- New enum values live in their own migration: PostgreSQL cannot use a value added to an enum in the
-- same transaction, and each migration file runs in one transaction.

-- AlterEnum
ALTER TYPE "ConversationEventType" ADD VALUE 'OVERFLOWED';
ALTER TYPE "ConversationEventType" ADD VALUE 'MAX_WAIT_REACHED';
ALTER TYPE "ConversationEventType" ADD VALUE 'FOLLOW_UP_REQUESTED';
