-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('NOT_REQUIRED', 'AWAITING_TOPIC', 'AWAITING_FORM', 'COMPLETE');

-- CreateEnum
CREATE TYPE "ClassificationMethod" AS ENUM ('KEYWORD', 'VISITOR_CHOICE', 'INTEGRATION', 'DEFAULT', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "ClassificationDecision" AS ENUM ('ROUTE', 'CONFIRM', 'ASK');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "topicCatalogVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "routing_settings" ADD COLUMN     "autoRouteThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
ADD COLUMN     "confirmThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
ADD COLUMN     "topicPromptTimeoutSeconds" INTEGER NOT NULL DEFAULT 60;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "intakeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "intakeStatus" "IntakeStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "topicId" UUID;

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "publicId" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "departmentId" UUID,
    "requiredSkillId" UUID,
    "requiredSkillMinProficiency" INTEGER,
    "priority" "ConversationPriority" NOT NULL DEFAULT 'NORMAL',
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "negativeKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "examples" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "showAsQuickReply" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_classifications" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "topicId" UUID,
    "method" "ClassificationMethod" NOT NULL,
    "decision" "ClassificationDecision",
    "confidence" DOUBLE PRECISION,
    "candidates" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "topics_publicId_key" ON "topics"("publicId");

-- CreateIndex
CREATE INDEX "topics_businessId_status_sortOrder_idx" ON "topics"("businessId", "status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "topics_businessId_name_key" ON "topics"("businessId", "name");

-- CreateIndex
CREATE INDEX "conversation_classifications_businessId_createdAt_idx" ON "conversation_classifications"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_classifications_conversationId_createdAt_idx" ON "conversation_classifications"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "conversations_intakeStatus_intakeExpiresAt_idx" ON "conversations"("intakeStatus", "intakeExpiresAt");

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_requiredSkillId_fkey" FOREIGN KEY ("requiredSkillId") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_classifications" ADD CONSTRAINT "conversation_classifications_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_classifications" ADD CONSTRAINT "conversation_classifications_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_classifications" ADD CONSTRAINT "conversation_classifications_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Keep classifier settings and topic skill levels inside the ranges the API accepts.
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_thresholds_check" CHECK ("confirmThreshold" > 0 AND "confirmThreshold" < "autoRouteThreshold" AND "autoRouteThreshold" < 1);
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_topicPromptTimeoutSeconds_check" CHECK ("topicPromptTimeoutSeconds" BETWEEN 15 AND 600);
ALTER TABLE "topics" ADD CONSTRAINT "topics_requiredSkillMinProficiency_check" CHECK ("requiredSkillMinProficiency" IS NULL OR "requiredSkillMinProficiency" BETWEEN 1 AND 5);

-- At most one default topic per tenant (Prisma cannot express a partial unique index).
CREATE UNIQUE INDEX "topics_one_default_per_business" ON "topics"("businessId") WHERE "isDefault";
