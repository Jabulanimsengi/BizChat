-- Routing lifecycle webhooks. The outbox design is unchanged: one stable event envelope per change,
-- inserted in the originating transaction, one delivery per subscribed active endpoint. Existing
-- events keep their fields. Follow-up contact details are not sent; read them through the API with
-- the intake:read scope.

-- Columns hold UTC without a zone. Payload timestamps previously omitted the zone; they now end in
-- "Z", matching the REST API.
CREATE OR REPLACE FUNCTION bizchat_iso(value timestamp) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(value, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

CREATE OR REPLACE FUNCTION bizchat_insert_webhook(tenant_id uuid, event_type text, event_data jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE event_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO webhook_deliveries (id, "endpointId", "eventId", payload)
  SELECT gen_random_uuid(), e.id, event_id,
         jsonb_build_object('id', event_id, 'type', event_type, 'version', '1',
                            'createdAt', bizchat_iso((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp), 'data', event_data)
  FROM webhook_endpoints e
  WHERE e."businessId" = tenant_id AND e.enabled AND event_type = ANY(e.events);
END;
$$;

CREATE OR REPLACE FUNCTION bizchat_enqueue_webhook() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE routing jsonb; consultant jsonb;
BEGIN
  IF TG_TABLE_NAME = 'messages' THEN
    IF NEW."messageType" = 'INTERNAL_NOTE' OR NEW."deletedAt" IS NOT NULL THEN RETURN NEW; END IF;
    PERFORM bizchat_insert_webhook(NEW."businessId", 'message.created', jsonb_build_object(
      'id', NEW.id, 'conversationId', NEW."conversationId",
      'sequenceNumber', NEW."sequenceNumber"::text, 'senderType', NEW."senderType",
      'integrationKeyId', NEW."integrationKeyId", 'messageType', NEW."messageType",
      'content', NEW.content, 'createdAt', bizchat_iso(NEW."createdAt")));
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM bizchat_insert_webhook(NEW."businessId", 'conversation.created', jsonb_build_object(
      'id', NEW.id, 'status', NEW.status, 'source', NEW.source, 'subject', NEW.subject,
      'createdAt', bizchat_iso(NEW."createdAt")));
    RETURN NEW;
  END IF;

  routing := jsonb_build_object(
    'id', NEW.id, 'status', NEW.status, 'priority', NEW.priority,
    'departmentId', NEW."departmentId", 'topicId', NEW."topicId", 'overflowLevel', NEW."overflowLevel");
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'RESOLVED' THEN
      PERFORM bizchat_insert_webhook(NEW."businessId", 'conversation.resolved', jsonb_build_object(
        'id', NEW.id, 'status', NEW.status, 'resolvedAt', bizchat_iso(NEW."resolvedAt")));
    ELSIF NEW.status = 'QUEUED' THEN
      PERFORM bizchat_insert_webhook(NEW."businessId", 'conversation.queued', routing);
    ELSIF NEW.status IN ('OFFERED', 'ASSIGNED') THEN
      SELECT jsonb_build_object('membershipId', m.id, 'displayName', u."displayName")
        INTO consultant
        FROM business_memberships m JOIN users u ON u.id = m."userId"
       WHERE m.id = NEW."assignedAgentMembershipId";
      PERFORM bizchat_insert_webhook(NEW."businessId",
        CASE NEW.status WHEN 'OFFERED' THEN 'conversation.offered' ELSE 'conversation.assigned' END,
        routing || jsonb_build_object('consultant', consultant,
                                      'offerExpiresAt', bizchat_iso(NEW."offerExpiresAt"),
                                      'assignedAt', bizchat_iso(NEW."assignedAt")));
    ELSIF NEW.status = 'CLOSED' THEN
      PERFORM bizchat_insert_webhook(NEW."businessId", 'conversation.closed', jsonb_build_object(
        'id', NEW.id, 'status', NEW.status, 'closedAt', bizchat_iso(NEW."closedAt")));
    END IF;
  END IF;
  IF NEW."overflowLevel" > OLD."overflowLevel" THEN
    PERFORM bizchat_insert_webhook(NEW."businessId", 'conversation.overflowed',
      routing || jsonb_build_object('fromLevel', OLD."overflowLevel"));
  END IF;
  IF NEW."followUpRequestedAt" IS NOT NULL AND OLD."followUpRequestedAt" IS NULL THEN
    PERFORM bizchat_insert_webhook(NEW."businessId", 'conversation.follow_up_requested',
      routing || jsonb_build_object('followUpRequestedAt', bizchat_iso(NEW."followUpRequestedAt")));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER bizchat_conversation_webhook ON conversations;
CREATE TRIGGER bizchat_conversation_webhook
  AFTER INSERT OR UPDATE OF status, "overflowLevel", "followUpRequestedAt" ON conversations
  FOR EACH ROW EXECUTE FUNCTION bizchat_enqueue_webhook();
