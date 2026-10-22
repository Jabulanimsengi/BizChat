CREATE TYPE "AttachmentStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'REJECTED');
CREATE TYPE "AttachmentActorType" AS ENUM ('BUSINESS_USER', 'VISITOR');

CREATE TABLE "attachments" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "messageId" UUID,
  "uploadedByType" "AttachmentActorType" NOT NULL,
  "uploadedById" UUID NOT NULL,
  "originalFileName" VARCHAR(255) NOT NULL,
  "storageKey" VARCHAR(180) NOT NULL,
  "mimeType" VARCHAR(100) NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "status" "AttachmentStatus" NOT NULL DEFAULT 'UPLOADING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");
CREATE INDEX "attachments_businessId_conversationId_createdAt_idx" ON "attachments"("businessId", "conversationId", "createdAt");
CREATE INDEX "attachments_messageId_idx" ON "attachments"("messageId");
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
