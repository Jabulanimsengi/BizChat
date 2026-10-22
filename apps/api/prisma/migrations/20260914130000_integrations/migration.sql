-- AlterEnum
ALTER TYPE "ConversationSource" ADD VALUE 'INTEGRATION';

-- AlterEnum
ALTER TYPE "MessageSenderType" ADD VALUE 'INTEGRATION';

-- AlterEnum
ALTER TYPE "ConversationEventActorType" ADD VALUE 'INTEGRATION';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "integrationKeyId" UUID;

-- CreateTable
CREATE TABLE "integration_keys" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "prefix" VARCHAR(20) NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "integration_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_customers" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "externalId" VARCHAR(200) NOT NULL,
    "visitorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_requests" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" UUID,
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_keys_tokenHash_key" ON "integration_keys"("tokenHash");

-- CreateIndex
CREATE INDEX "integration_keys_businessId_createdAt_idx" ON "integration_keys"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_customers_visitorId_key" ON "integration_customers"("visitorId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_customers_businessId_externalId_key" ON "integration_customers"("businessId", "externalId");

-- CreateIndex
CREATE INDEX "integration_requests_createdAt_idx" ON "integration_requests"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_requests_businessId_key_key" ON "integration_requests"("businessId", "key");

-- CreateIndex
CREATE INDEX "webhook_endpoints_businessId_enabled_idx" ON "webhook_endpoints"("businessId", "enabled");

-- CreateIndex
CREATE INDEX "webhook_deliveries_deliveredAt_failedAt_nextAttemptAt_idx" ON "webhook_deliveries"("deliveredAt", "failedAt", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_endpointId_eventId_key" ON "webhook_deliveries"("endpointId", "eventId");

-- AddForeignKey
ALTER TABLE "integration_keys" ADD CONSTRAINT "integration_keys_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_customers" ADD CONSTRAINT "integration_customers_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_customers" ADD CONSTRAINT "integration_customers_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_requests" ADD CONSTRAINT "integration_requests_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Insert one stable event envelope per mutation and one outbox delivery per active subscription.
-- Triggers cover widget, dashboard, API, and system writes, including transaction rollback.
CREATE FUNCTION bizchat_enqueue_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_type text; event_id uuid := gen_random_uuid(); tenant_id uuid; event_data jsonb;
BEGIN
  tenant_id := NEW."businessId";
  IF TG_TABLE_NAME = 'messages' THEN
    IF NEW."messageType" = 'INTERNAL_NOTE' OR NEW."deletedAt" IS NOT NULL THEN RETURN NEW; END IF;
    event_type := 'message.created';
    event_data := jsonb_build_object('id', NEW.id, 'conversationId', NEW."conversationId", 'sequenceNumber', NEW."sequenceNumber"::text, 'senderType', NEW."senderType", 'integrationKeyId', NEW."integrationKeyId", 'messageType', NEW."messageType", 'content', NEW.content, 'createdAt', NEW."createdAt");
  ELSIF TG_OP = 'INSERT' THEN
    event_type := 'conversation.created';
    event_data := jsonb_build_object('id', NEW.id, 'status', NEW.status, 'source', NEW.source, 'subject', NEW.subject, 'createdAt', NEW."createdAt");
  ELSE
    IF NEW.status <> 'RESOLVED' OR OLD.status = 'RESOLVED' THEN RETURN NEW; END IF;
    event_type := 'conversation.resolved';
    event_data := jsonb_build_object('id', NEW.id, 'status', NEW.status, 'resolvedAt', NEW."resolvedAt");
  END IF;
  INSERT INTO webhook_deliveries (id, "endpointId", "eventId", payload)
  SELECT gen_random_uuid(), e.id, event_id, jsonb_build_object('id', event_id, 'type', event_type, 'version', '1', 'createdAt', CURRENT_TIMESTAMP, 'data', event_data)
  FROM webhook_endpoints e WHERE e."businessId" = tenant_id AND e.enabled AND event_type = ANY(e.events);
  RETURN NEW;
END;
$$;
CREATE TRIGGER bizchat_message_webhook AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION bizchat_enqueue_webhook();
CREATE TRIGGER bizchat_conversation_webhook AFTER INSERT OR UPDATE OF status ON conversations FOR EACH ROW EXECUTE FUNCTION bizchat_enqueue_webhook();
