-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'DISABLED');

-- CreateEnum
CREATE TYPE "WidgetPosition" AS ENUM ('BOTTOM_RIGHT', 'BOTTOM_LEFT');

-- CreateTable
CREATE TABLE "business_domains" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "domain" VARCHAR(253) NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'PENDING',
    "verificationTokenHash" CHAR(64) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "widget_settings" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "displayName" VARCHAR(120),
    "primaryColor" CHAR(7) NOT NULL DEFAULT '#155f43',
    "greeting" VARCHAR(240) NOT NULL DEFAULT 'How can we help?',
    "launcherPosition" "WidgetPosition" NOT NULL DEFAULT 'BOTTOM_RIGHT',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "widget_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "anonymousIdentifier" VARCHAR(64) NOT NULL,
    "convertedCustomerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_sessions" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "visitorId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" VARCHAR(512),

    CONSTRAINT "visitor_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "widget_sessions" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "visitorSessionId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "origin" VARCHAR(300) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "widget_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_domains_domain_key" ON "business_domains"("domain");

-- CreateIndex
CREATE INDEX "business_domains_businessId_status_idx" ON "business_domains"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "widget_settings_businessId_key" ON "widget_settings"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "visitors_anonymousIdentifier_key" ON "visitors"("anonymousIdentifier");

-- CreateIndex
CREATE INDEX "visitors_businessId_lastSeenAt_idx" ON "visitors"("businessId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "visitor_sessions_tokenHash_key" ON "visitor_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "visitor_sessions_businessId_visitorId_idx" ON "visitor_sessions"("businessId", "visitorId");

-- CreateIndex
CREATE INDEX "visitor_sessions_businessId_expiresAt_idx" ON "visitor_sessions"("businessId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "widget_sessions_tokenHash_key" ON "widget_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "widget_sessions_businessId_expiresAt_idx" ON "widget_sessions"("businessId", "expiresAt");

-- CreateIndex
CREATE INDEX "widget_sessions_visitorSessionId_expiresAt_idx" ON "widget_sessions"("visitorSessionId", "expiresAt");

-- AddForeignKey
ALTER TABLE "business_domains" ADD CONSTRAINT "business_domains_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "widget_settings" ADD CONSTRAINT "widget_settings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_sessions" ADD CONSTRAINT "visitor_sessions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_sessions" ADD CONSTRAINT "visitor_sessions_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "widget_sessions" ADD CONSTRAINT "widget_sessions_visitorSessionId_fkey" FOREIGN KEY ("visitorSessionId") REFERENCES "visitor_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
