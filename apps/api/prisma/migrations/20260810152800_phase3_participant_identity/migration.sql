-- A participant identity can only join a conversation once; leaving and rejoining
-- updates the existing row so room authorization remains unambiguous.
CREATE UNIQUE INDEX "conversation_participants_conversationId_participantType_participantId_key"
ON "conversation_participants"("conversationId", "participantType", "participantId");
