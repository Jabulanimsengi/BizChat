import { ConflictException, Injectable } from '@nestjs/common';
import type { ConversationStatus, Prisma } from '@prisma/client';

const transitions: Record<ConversationStatus, ReadonlySet<ConversationStatus>> = {
  NEW: new Set(['QUEUED', 'OFFERED', 'ASSIGNED']),
  QUEUED: new Set(['OFFERED', 'ASSIGNED']),
  OFFERED: new Set(['ASSIGNED', 'QUEUED', 'CLOSED']),
  ASSIGNED: new Set(['ACTIVE', 'RESOLVED']),
  ACTIVE: new Set(['WAITING_FOR_CUSTOMER', 'WAITING_FOR_AGENT', 'RESOLVED']),
  WAITING_FOR_CUSTOMER: new Set(['ACTIVE', 'RESOLVED']),
  WAITING_FOR_AGENT: new Set(['ACTIVE', 'RESOLVED']),
  RESOLVED: new Set(['ACTIVE', 'CLOSED']),
  CLOSED: new Set(),
};

@Injectable()
export class ConversationStateService {
  public assertTransition(from: ConversationStatus, to: ConversationStatus): void {
    if (from === to) return;
    if (!transitions[from].has(to)) {
      throw new ConflictException({
        code: 'INVALID_CONVERSATION_TRANSITION',
        message: `Conversation cannot transition from ${from} to ${to}`,
      });
    }
  }

  public timestampData(
    status: ConversationStatus,
    now = new Date(),
  ): Prisma.ConversationUpdateInput {
    if (status === 'RESOLVED') return { resolvedAt: now };
    if (status === 'CLOSED') return { closedAt: now };
    if (status === 'ASSIGNED') return { assignedAt: now };
    return {};
  }
}
