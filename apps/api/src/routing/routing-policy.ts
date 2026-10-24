import type { ConversationStatus, RoutingStrategy } from '@prisma/client';

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
  /** Proficiency in the conversation's required skill; absent when no skill is required. */
  proficiency?: number;
}

export function orderCandidates<T extends RoutingCandidate>(
  candidates: T[],
  preferredMembershipId: string | null,
  strategy: RoutingStrategy = 'LEAST_BUSY',
): T[] {
  return [...candidates].sort((left, right) => {
    const leftPreferred = left.membershipId === preferredMembershipId ? 1 : 0;
    const rightPreferred = right.membershipId === preferredMembershipId ? 1 : 0;
    if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
    const byLoad = left.activeChats - right.activeChats;
    const bySkill = (right.proficiency ?? 0) - (left.proficiency ?? 0);
    const [first, second] = strategy === 'BEST_SKILL' ? [bySkill, byLoad] : [byLoad, bySkill];
    if (first !== 0) return first;
    if (second !== 0) return second;
    const leftAssigned = left.lastAssignedAt?.getTime() ?? 0;
    const rightAssigned = right.lastAssignedAt?.getTime() ?? 0;
    if (leftAssigned !== rightAssigned) return leftAssigned - rightAssigned;
    return left.id.localeCompare(right.id);
  });
}

/** Who may take a conversation: a department (null = any) and a skill at a minimum proficiency. */
export interface EligibilityScope {
  departmentId: string | null;
  skillId: string | null;
  minProficiency: number;
}

/** True when every consultant eligible for `narrower` is also eligible for `broader`. */
function covers(broader: EligibilityScope, narrower: EligibilityScope): boolean {
  const department =
    broader.departmentId === null || broader.departmentId === narrower.departmentId;
  const skill =
    broader.skillId === null ||
    (broader.skillId === narrower.skillId && broader.minProficiency <= narrower.minProficiency);
  return department && skill;
}

/**
 * Tracks eligibility scopes during one drain pass. Capacity only shrinks within a pass, so a scope
 * with no eligible consultant stays exhausted, and so does every narrower scope (an unconstrained
 * miss exhausts everything).
 */
export class DrainScopeTracker {
  private readonly exhausted: EligibilityScope[] = [];
  private readonly changed = new Set<string | null>();

  public shouldAttempt(scope: EligibilityScope): boolean {
    return !this.exhausted.some((exhausted) => covers(exhausted, scope));
  }

  public recordAssigned(departmentId: string | null): void {
    this.changed.add(departmentId);
  }

  public recordExhausted(scope: EligibilityScope): void {
    this.exhausted.push(scope);
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
