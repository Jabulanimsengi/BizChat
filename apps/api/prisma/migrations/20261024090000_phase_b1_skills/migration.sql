-- CreateEnum
CREATE TYPE "RoutingStrategy" AS ENUM ('LEAST_BUSY', 'BEST_SKILL');

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "requiredSkillId" UUID,
ADD COLUMN     "requiredSkillMinProficiency" INTEGER;

-- CreateTable
CREATE TABLE "skills" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(240),
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_skills" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "agentProfileId" UUID NOT NULL,
    "skillId" UUID NOT NULL,
    "proficiency" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_settings" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "routingStrategy" "RoutingStrategy" NOT NULL DEFAULT 'LEAST_BUSY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "skills_businessId_status_name_idx" ON "skills"("businessId", "status", "name");

-- CreateIndex
CREATE UNIQUE INDEX "skills_businessId_name_key" ON "skills"("businessId", "name");

-- CreateIndex
CREATE INDEX "agent_skills_businessId_skillId_proficiency_idx" ON "agent_skills"("businessId", "skillId", "proficiency");

-- CreateIndex
CREATE UNIQUE INDEX "agent_skills_agentProfileId_skillId_key" ON "agent_skills"("agentProfileId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "routing_settings_businessId_key" ON "routing_settings"("businessId");

-- CreateIndex
CREATE INDEX "conversations_status_createdAt_idx" ON "conversations"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "agent_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_requiredSkillId_fkey" FOREIGN KEY ("requiredSkillId") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Proficiency is a 1-5 scale for consultants and for a conversation's minimum requirement.
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_proficiency_check" CHECK ("proficiency" BETWEEN 1 AND 5);
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_requiredSkillMinProficiency_check" CHECK ("requiredSkillMinProficiency" IS NULL OR "requiredSkillMinProficiency" BETWEEN 1 AND 5);
