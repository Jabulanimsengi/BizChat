-- CreateEnum
CREATE TYPE "AssignmentMode" AS ENUM ('AUTO', 'OFFER');

-- CreateEnum
CREATE TYPE "OfferOutcome" AS ENUM ('ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "agent_profiles" ADD COLUMN     "missedOfferStreak" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "routing_settings" ADD COLUMN     "assignmentMode" "AssignmentMode" NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "exclusionSeconds" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "missedOffersBeforeAway" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "offerTimeoutSeconds" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "currentOfferId" UUID,
ADD COLUMN     "offerExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "conversation_offers" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "agentProfileId" UUID NOT NULL,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "outcome" "OfferOutcome",
    "reason" VARCHAR(240),
    "assignmentType" "AssignmentType" NOT NULL DEFAULT 'AUTO',

    CONSTRAINT "conversation_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_offers_conversationId_agentProfileId_responded_idx" ON "conversation_offers"("conversationId", "agentProfileId", "respondedAt");

-- CreateIndex
CREATE INDEX "conversation_offers_businessId_agentProfileId_offeredAt_idx" ON "conversation_offers"("businessId", "agentProfileId", "offeredAt");

-- CreateIndex
CREATE INDEX "conversations_status_offerExpiresAt_idx" ON "conversations"("status", "offerExpiresAt");

-- AddForeignKey
ALTER TABLE "conversation_offers" ADD CONSTRAINT "conversation_offers_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_offers" ADD CONSTRAINT "conversation_offers_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_offers" ADD CONSTRAINT "conversation_offers_agentProfileId_fkey" FOREIGN KEY ("agentProfileId") REFERENCES "agent_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Keep offer settings inside the ranges the API accepts.
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_offerTimeoutSeconds_check" CHECK ("offerTimeoutSeconds" BETWEEN 10 AND 120);
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_missedOffersBeforeAway_check" CHECK ("missedOffersBeforeAway" BETWEEN 0 AND 10);
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_exclusionSeconds_check" CHECK ("exclusionSeconds" BETWEEN 60 AND 3600);
