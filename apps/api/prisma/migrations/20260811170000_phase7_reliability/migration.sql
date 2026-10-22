ALTER TABLE "widget_settings"
ADD COLUMN "agentDisconnectGraceSeconds" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "conversations"
ADD COLUMN "agentDisconnectedAt" TIMESTAMP(3),
ADD COLUMN "reassignmentDueAt" TIMESTAMP(3),
ADD COLUMN "reassignmentAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "reassignmentLastError" VARCHAR(500);

CREATE INDEX "conversations_businessId_reassignmentDueAt_status_idx"
ON "conversations"("businessId", "reassignmentDueAt", "status");
