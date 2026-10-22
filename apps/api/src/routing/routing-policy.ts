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

/**
 * Tracks queue scopes during one drain pass. Capacity only shrinks within a pass, so a department with
 * no eligible consultant stays exhausted, and a miss for a department-less conversation (which may go
 * to any consultant) exhausts every department.
 */
export class DrainScopeTracker {
  private readonly exhausted = new Set<string | null>();
  private readonly changed = new Set<string | null>();

  public shouldAttempt(departmentId: string | null): boolean {
    return !this.exhausted.has(null) && !this.exhausted.has(departmentId);
  }

  public recordAssigned(departmentId: string | null): void {
    this.changed.add(departmentId);
  }

  public recordExhausted(departmentId: string | null): void {
    this.exhausted.add(departmentId);
  }

  /** Departments whose queue positions moved because a conversation left them. */
  public changedDepartments(): Set<string | null> {
    return new Set(this.changed);
  }
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
