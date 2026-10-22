-- CreateEnum
CREATE TYPE "ConversationEventType" AS ENUM ('CREATED', 'QUEUED', 'ASSIGNED', 'ACCEPTED', 'TRANSFERRED', 'REASSIGNED', 'RESOLVED', 'REOPENED', 'CLOSED', 'AGENT_JOINED', 'AGENT_LEFT', 'TAGS_CHANGED', 'INTERNAL_NOTE_ADDED');

-- CreateEnum
CREATE TYPE "ConversationEventActorType" AS ENUM ('BUSINESS_USER', 'VISITOR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "widget_settings" ADD COLUMN "reopenWindowMinutes" INTEGER NOT NULL DEFAULT 1440;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "reopenedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "conversation_events" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "type" "ConversationEventType" NOT NULL,
    "actorType" "ConversationEventActorType" NOT NULL,
    "actorId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "color" CHAR(7) NOT NULL DEFAULT '#64748b',
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_tags" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "tagId" UUID NOT NULL,
    "addedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canned_responses" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "departmentId" UUID,
    "title" VARCHAR(120) NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "shortcut" VARCHAR(40),
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_events_businessId_conversationId_createdAt_idx" ON "conversation_events"("businessId", "conversationId", "createdAt");
CREATE INDEX "conversation_events_businessId_type_createdAt_idx" ON "conversation_events"("businessId", "type", "createdAt");
CREATE UNIQUE INDEX "tags_businessId_name_key" ON "tags"("businessId", "name");
CREATE INDEX "tags_businessId_status_name_idx" ON "tags"("businessId", "status", "name");
CREATE UNIQUE INDEX "conversation_tags_conversationId_tagId_key" ON "conversation_tags"("conversationId", "tagId");
CREATE INDEX "conversation_tags_businessId_tagId_createdAt_idx" ON "conversation_tags"("businessId", "tagId", "createdAt");
CREATE UNIQUE INDEX "canned_responses_businessId_shortcut_key" ON "canned_responses"("businessId", "shortcut");
CREATE INDEX "canned_responses_businessId_status_departmentId_title_idx" ON "canned_responses"("businessId", "status", "departmentId", "title");

ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_events" ADD CONSTRAINT "conversation_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tags" ADD CONSTRAINT "tags_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
