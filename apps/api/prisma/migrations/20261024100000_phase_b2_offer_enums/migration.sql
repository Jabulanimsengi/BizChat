-- New enum values live in their own migration: PostgreSQL cannot use a value added to an enum in the
-- same transaction, and each migration file runs in one transaction.

-- AlterEnum
ALTER TYPE "ConversationStatus" ADD VALUE 'OFFERED' AFTER 'QUEUED';

-- AlterEnum
ALTER TYPE "ConversationEventType" ADD VALUE 'OFFERED';
