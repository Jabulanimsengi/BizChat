-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "planId" UUID;

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "maxConsultants" INTEGER,
    "maxConversationsPerMonth" INTEGER,
    "maxIntegrationKeys" INTEGER,
    "maxWebhookEndpoints" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_counters" (
    "businessId" UUID NOT NULL,
    "period" CHAR(7) NOT NULL,
    "metric" VARCHAR(40) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("businessId","period","metric")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Limits are counts of at least one; null is unlimited.
ALTER TABLE "plans" ADD CONSTRAINT "plans_limits_check" CHECK (
  ("maxConsultants" IS NULL OR "maxConsultants" >= 1) AND
  ("maxConversationsPerMonth" IS NULL OR "maxConversationsPerMonth" >= 1) AND
  ("maxIntegrationKeys" IS NULL OR "maxIntegrationKeys" >= 1) AND
  ("maxWebhookEndpoints" IS NULL OR "maxWebhookEndpoints" >= 1));

-- Starting plans; a platform administrator edits them or adds more. Existing tenants keep no plan.
INSERT INTO "plans" ("id", "code", "name", "maxConsultants", "maxConversationsPerMonth", "maxIntegrationKeys", "maxWebhookEndpoints", "updatedAt") VALUES
  (gen_random_uuid(), 'free', 'Free', 2, 200, 1, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'starter', 'Starter', 10, 3000, 5, 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'business', 'Business', 50, 30000, 20, 5, CURRENT_TIMESTAMP);

-- Every new conversation counts toward its tenant's month, whichever path created it.
CREATE FUNCTION bizchat_count_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO usage_counters ("businessId", "period", "metric", "count")
  VALUES (NEW."businessId", to_char(NEW."createdAt", 'YYYY-MM'), 'conversations', 1)
  ON CONFLICT ("businessId", "period", "metric")
  DO UPDATE SET "count" = usage_counters."count" + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bizchat_conversation_usage AFTER INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION bizchat_count_conversation();
