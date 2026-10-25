-- Analytics reads a tenant's conversations by creation date.
CREATE INDEX "conversations_businessId_createdAt_idx" ON "conversations"("businessId", "createdAt");
