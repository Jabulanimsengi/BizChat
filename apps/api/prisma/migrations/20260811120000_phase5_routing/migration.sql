-- CreateEnum
CREATE TYPE "DepartmentStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('AUTO', 'MANUAL', 'TRANSFER', 'REASSIGNMENT');

-- AlterTable
ALTER TABLE "widget_settings"
ADD COLUMN "departmentSelectionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "preferPreviousConsultant" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "queueMessage" VARCHAR(240) NOT NULL DEFAULT 'All consultants are busy. You''re in the queue and we''ll be with you shortly.';

-- AlterTable
ALTER TABLE "agent_profiles" ADD COLUMN "lastAssignedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "publicId" VARCHAR(64) NOT NULL,
    "businessId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "status" "DepartmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_departments" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "agentProfileId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_assignments" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "agentProfileId" UUID NOT NULL,
    "departmentId" UUID,
    "assignedByMembershipId" UUID,
    "assignmentType" "AssignmentType" NOT NULL DEFAULT 'AUTO',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "reason" VARCHAR(240),
    CONSTRAINT "conversation_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_queue_entries" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "departmentId" UUID,
    "priority" "ConversationPriority" NOT NULL DEFAULT 'NORMAL',
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    CONSTRAINT "conversation_queue_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "departments_publicId_key" ON "departments"("publicId");
CREATE UNIQUE INDEX "departments_businessId_name_key" ON "departments"("businessId", "name");
CREATE INDEX "departments_businessId_status_createdAt_idx" ON "departments"("businessId", "status", "createdAt");
CREATE UNIQUE INDEX "agent_departments_agentProfileId_departmentId_key" ON "agent_departments"("agentProfileId", "departmentId");
CREATE INDEX "agent_departments_businessId_departmentId_agentProfileId_idx" ON "agent_departments"("businessId", "departmentId", "agentProfileId");
CREATE INDEX "conversation_assignments_businessId_conversationId_assignedAt_idx" ON "conversation_assignments"("businessId", "conversationId", "assignedAt");
CREATE INDEX "conversation_assignments_businessId_agentProfileId_releasedAt_idx" ON "conversation_assignments"("businessId", "agentProfileId", "releasedAt");
CREATE UNIQUE INDEX "conversation_queue_entries_conversationId_key" ON "conversation_queue_entries"("conversationId");
CREATE INDEX "conversation_queue_entries_businessId_departmentId_assignedAt_removedAt_priority_enqueuedAt_idx" ON "conversation_queue_entries"("businessId", "departmentId", "assignedAt", "removedAt", "priority", "enqueuedAt");
CREATE INDEX "conversations_businessId_departmentId_status_idx" ON "conversations"("businessId", "departmentId", "status");

ALTER TABLE "departments" ADD CONSTRAINT "departments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_departments" ADD CONSTRAINT "agent_departments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_departments" ADD CONSTRAINT "agent_departments_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "agent_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_departments" ADD CONSTRAINT "agent_departments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "agent_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "conversation_queue_entries" ADD CONSTRAINT "conversation_queue_entries_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversation_queue_entries" ADD CONSTRAINT "conversation_queue_entries_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_queue_entries" ADD CONSTRAINT "conversation_queue_entries_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
