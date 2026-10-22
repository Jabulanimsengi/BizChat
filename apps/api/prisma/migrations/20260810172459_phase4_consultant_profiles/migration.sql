-- CreateEnum
CREATE TYPE "AgentProfileStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "agent_profiles" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "maxConcurrentChats" INTEGER NOT NULL DEFAULT 5,
    "routingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "AgentProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_profiles_membershipId_key" ON "agent_profiles"("membershipId");

-- CreateIndex
CREATE INDEX "agent_profiles_businessId_status_routingEnabled_idx" ON "agent_profiles"("businessId", "status", "routingEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "agent_profiles_businessId_userId_key" ON "agent_profiles"("businessId", "userId");

-- AddForeignKey
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "business_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "conversation_participants_conversationId_participantType_partic" RENAME TO "conversation_participants_conversationId_participantType_pa_key";
