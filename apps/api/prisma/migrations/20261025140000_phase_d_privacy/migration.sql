-- CreateTable
CREATE TABLE "privacy_settings" (
    "businessId" UUID NOT NULL,
    "conversationRetentionDays" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "privacy_settings_pkey" PRIMARY KEY ("businessId")
);

-- AddForeignKey
ALTER TABLE "privacy_settings" ADD CONSTRAINT "privacy_settings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At least 30 days, so a mistaken setting cannot wipe recent history; at most 10 years.
ALTER TABLE "privacy_settings" ADD CONSTRAINT "privacy_settings_retention_check"
  CHECK ("conversationRetentionDays" IS NULL OR "conversationRetentionDays" BETWEEN 30 AND 3650);

-- The retention sweep finds finished conversations by age.
CREATE INDEX "conversations_status_updatedAt_idx" ON "conversations"("status", "updatedAt");
