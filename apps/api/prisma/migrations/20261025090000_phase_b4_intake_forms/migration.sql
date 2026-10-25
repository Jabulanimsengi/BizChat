-- CreateEnum
CREATE TYPE "IntakeFormTiming" AS ENUM ('AFTER_TOPIC', 'BEFORE_CHAT');

-- AlterTable
ALTER TABLE "topics" ADD COLUMN     "intakeFormId" UUID;

-- AlterTable
ALTER TABLE "routing_settings" ADD COLUMN     "defaultIntakeFormId" UUID,
ADD COLUMN     "intakeFormTiming" "IntakeFormTiming" NOT NULL DEFAULT 'AFTER_TOPIC';

-- AlterTable
ALTER TABLE "integration_customers" ADD COLUMN     "displayName" VARCHAR(100),
ADD COLUMN     "email" VARCHAR(254);

-- CreateTable
CREATE TABLE "intake_forms" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fields" JSONB NOT NULL,
    "consentText" VARCHAR(1000),
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_intakes" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "formId" UUID,
    "formVersion" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "consentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intake_forms_businessId_status_idx" ON "intake_forms"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "intake_forms_businessId_name_key" ON "intake_forms"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_intakes_conversationId_key" ON "conversation_intakes"("conversationId");

-- CreateIndex
CREATE INDEX "conversation_intakes_businessId_submittedAt_idx" ON "conversation_intakes"("businessId", "submittedAt");

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_intakeFormId_fkey" FOREIGN KEY ("intakeFormId") REFERENCES "intake_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_intakes" ADD CONSTRAINT "conversation_intakes_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_intakes" ADD CONSTRAINT "conversation_intakes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_intakes" ADD CONSTRAINT "conversation_intakes_formId_fkey" FOREIGN KEY ("formId") REFERENCES "intake_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_settings" ADD CONSTRAINT "routing_settings_defaultIntakeFormId_fkey" FOREIGN KEY ("defaultIntakeFormId") REFERENCES "intake_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Forms hold at most 10 fields; the API validates each field's shape.
ALTER TABLE "intake_forms" ADD CONSTRAINT "intake_forms_fields_check" CHECK (jsonb_typeof("fields") = 'array' AND jsonb_array_length("fields") BETWEEN 1 AND 10);
