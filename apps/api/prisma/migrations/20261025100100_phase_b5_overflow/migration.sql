-- AlterTable
ALTER TABLE "topics" ADD COLUMN     "maxWaitSeconds" INTEGER,
ADD COLUMN     "overflowSteps" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "followUpContact" JSONB,
ADD COLUMN     "followUpRequestedAt" TIMESTAMP(3),
ADD COLUMN     "maxWaitAt" TIMESTAMP(3),
ADD COLUMN     "maxWaitNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "nextOverflowAt" TIMESTAMP(3),
ADD COLUMN     "overflowLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "routingCycleStartedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "conversations_status_nextOverflowAt_idx" ON "conversations"("status", "nextOverflowAt");

-- CreateIndex
CREATE INDEX "conversations_status_maxWaitAt_idx" ON "conversations"("status", "maxWaitAt");

-- The API validates these too; the database keeps them sane if a write bypasses it.
ALTER TABLE "topics" ADD CONSTRAINT "topics_overflowSteps_check"
  CHECK (jsonb_typeof("overflowSteps") = 'array' AND jsonb_array_length("overflowSteps") <= 5);
ALTER TABLE "topics" ADD CONSTRAINT "topics_maxWaitSeconds_check"
  CHECK ("maxWaitSeconds" IS NULL OR "maxWaitSeconds" BETWEEN 30 AND 86400);
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_overflowLevel_check"
  CHECK ("overflowLevel" BETWEEN 0 AND 5);
