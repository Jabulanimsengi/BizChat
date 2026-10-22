-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('NEW', 'QUEUED', 'ASSIGNED', 'ACTIVE', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_AGENT', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConversationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ConversationSource" AS ENUM ('WEB_WIDGET', 'WHATSAPP', 'EMAIL', 'FACEBOOK', 'INSTAGRAM', 'SMS', 'MOBILE_APP');

-- CreateEnum
CREATE TYPE "ParticipantType" AS ENUM ('VISITOR', 'CUSTOMER', 'AGENT', 'SUPERVISOR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('VISITOR', 'CUSTOMER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'SYSTEM_EVENT', 'INTERNAL_NOTE');

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "visitorId" UUID,
    "customerId" UUID,
    "departmentId" UUID,
    "assignedAgentMembershipId" UUID,
    "status" "ConversationStatus" NOT NULL DEFAULT 'NEW',
    "priority" "ConversationPriority" NOT NULL DEFAULT 'NORMAL',
    "source" "ConversationSource" NOT NULL DEFAULT 'WEB_WIDGET',
    "subject" VARCHAR(240),
    "nextSequence" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignedAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "participantType" "ParticipantType" NOT NULL,
    "participantId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderType" "MessageSenderType" NOT NULL,
    "senderUserId" UUID,
    "senderVisitorId" UUID,
    "senderCustomerId" UUID,
    "clientMessageId" UUID NOT NULL,
    "sequenceNumber" BIGINT NOT NULL,
    "messageType" "MessageType" NOT NULL DEFAULT 'TEXT',
    "content" VARCHAR(4000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_receipts" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "participantType" "ParticipantType" NOT NULL,
    "participantId" UUID NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_businessId_status_lastMessageAt_idx" ON "conversations"("businessId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_businessId_visitorId_status_idx" ON "conversations"("businessId", "visitorId", "status");

-- CreateIndex
CREATE INDEX "conversations_businessId_assignedAgentMembershipId_status_idx" ON "conversations"("businessId", "assignedAgentMembershipId", "status");

-- CreateIndex
CREATE INDEX "conversation_participants_businessId_participantType_partic_idx" ON "conversation_participants"("businessId", "participantType", "participantId", "leftAt");

-- CreateIndex
CREATE INDEX "conversation_participants_conversationId_joinedAt_idx" ON "conversation_participants"("conversationId", "joinedAt");

-- CreateIndex
CREATE INDEX "messages_businessId_conversationId_createdAt_idx" ON "messages"("businessId", "conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversationId_clientMessageId_key" ON "messages"("conversationId", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversationId_sequenceNumber_key" ON "messages"("conversationId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "messages_businessId_senderVisitorId_clientMessageId_key" ON "messages"("businessId", "senderVisitorId", "clientMessageId");

-- CreateIndex
CREATE INDEX "message_receipts_businessId_participantType_participantId_r_idx" ON "message_receipts"("businessId", "participantType", "participantId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_receipts_messageId_participantType_participantId_key" ON "message_receipts"("messageId", "participantType", "participantId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignedAgentMembershipId_fkey" FOREIGN KEY ("assignedAgentMembershipId") REFERENCES "business_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderVisitorId_fkey" FOREIGN KEY ("senderVisitorId") REFERENCES "visitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
