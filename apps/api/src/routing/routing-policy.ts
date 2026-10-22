import type { ConversationStatus } from '@prisma/client';

export const CAPACITY_STATUSES = [
  'ASSIGNED',
  'ACTIVE',
  'WAITING_FOR_CUSTOMER',
  'WAITING_FOR_AGENT',
] as const satisfies readonly ConversationStatus[];
export const ROUTABLE_STATUSES = ['NEW', 'QUEUED'] as const satisfies readonly ConversationStatus[];

export const PRIORITY_WEIGHT = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 } as const;

export interface RoutingCandidate {
  id: string;
  membershipId: string;
  activeChats: number;
  lastAssignedAt: Date | null;
}

export function orderCandidates<T extends RoutingCandidate>(
  candidates: T[],
  preferredMembershipId: string | null,
): T[] {
  return [...candidates].sort((left, right) => {
    const leftPreferred = left.membershipId === preferredMembershipId ? 1 : 0;
    const rightPreferred = right.membershipId === preferredMembershipId ? 1 : 0;
    if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
    if (left.activeChats !== right.activeChats) return left.activeChats - right.activeChats;
    const leftAssigned = left.lastAssignedAt?.getTime() ?? 0;
    const rightAssigned = right.lastAssignedAt?.getTime() ?? 0;
    if (leftAssigned !== rightAssigned) return leftAssigned - rightAssigned;
    return left.id.localeCompare(right.id);
  });
}

export function orderQueue<
  T extends { priority: keyof typeof PRIORITY_WEIGHT; enqueuedAt: Date; id: string },
>(entries: T[]): T[] {
  return [...entries].sort(
    (left, right) =>
      PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority] ||
      left.enqueuedAt.getTime() - right.enqueuedAt.getTime() ||
      left.id.localeCompare(right.id),
  );
}
