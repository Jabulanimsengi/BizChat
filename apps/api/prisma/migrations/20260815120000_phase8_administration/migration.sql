ALTER TABLE "widget_settings"
ADD COLUMN "offlineMessage" VARCHAR(240) NOT NULL DEFAULT 'We''re currently offline. Leave us a message and we''ll respond when we''re back.',
ADD COLUMN "resolvedMessage" VARCHAR(240) NOT NULL DEFAULT 'Thanks for chatting with us. This conversation has been resolved.';

CREATE TABLE "business_hours" (
  "id" UUID NOT NULL,
  "businessId" UUID NOT NULL,
  "weekday" INTEGER NOT NULL,
  "openingMinute" INTEGER NOT NULL,
  "closingMinute" INTEGER NOT NULL,
  "isClosed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_hours_businessId_weekday_key" ON "business_hours"("businessId", "weekday");
CREATE INDEX "business_hours_businessId_weekday_idx" ON "business_hours"("businessId", "weekday");
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
