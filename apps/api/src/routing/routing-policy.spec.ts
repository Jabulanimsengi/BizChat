import {
  CAPACITY_STATUSES,
  DrainScopeTracker,
  orderCandidates,
  orderQueue,
  type EligibilityScope,
  type RoutingCandidate,
} from './routing-policy';

describe('routing policy', () => {
  const candidate = (
    id: string,
    membershipId: string,
    activeChats: number,
    lastAssignedAt: string | null,
  ): RoutingCandidate => ({
    id,
    membershipId,
    activeChats,
    lastAssignedAt: lastAssignedAt ? new Date(lastAssignedAt) : null,
  });

  it('centralizes the statuses that consume consultant capacity', () => {
    expect(CAPACITY_STATUSES).toEqual([
      'ASSIGNED',
      'ACTIVE',
      'WAITING_FOR_CUSTOMER',
      'WAITING_FOR_AGENT',
    ]);
  });

  it('prefers an eligible previous consultant before least-busy ordering', () => {
    const candidates = [
      candidate('a', 'membership-a', 0, null),
      candidate('b', 'membership-b', 2, '2026-08-10T12:00:00Z'),
    ];
    expect(orderCandidates(candidates, 'membership-b').map(({ id }) => id)).toEqual(['b', 'a']);
  });

  it('uses least active chats then oldest assignment for fair ties', () => {
    const candidates = [
      candidate('newer', 'm1', 1, '2026-08-10T12:00:00Z'),
      candidate('busy', 'm2', 2, null),
      candidate('older', 'm3', 1, '2026-08-09T12:00:00Z'),
      candidate('never', 'm4', 1, null),
    ];
    expect(orderCandidates(candidates, null).map(({ id }) => id)).toEqual([
      'never',
      'older',
      'newer',
      'busy',
    ]);
  });

  it('orders queues by priority, then oldest wait, with a stable tie break', () => {
    const queue = [
      { id: 'normal', priority: 'NORMAL' as const, enqueuedAt: new Date('2026-08-10T10:00:00Z') },
      {
        id: 'urgent-new',
        priority: 'URGENT' as const,
        enqueuedAt: new Date('2026-08-10T11:00:00Z'),
      },
      {
        id: 'urgent-old',
        priority: 'URGENT' as const,
        enqueuedAt: new Date('2026-08-10T09:00:00Z'),
      },
    ];
    expect(orderQueue(queue).map(({ id }) => id)).toEqual(['urgent-old', 'urgent-new', 'normal']);
  });

  const scope = (
    departmentId: string | null,
    skillId: string | null = null,
    minProficiency = 1,
  ): EligibilityScope => ({ departmentId, skillId, minProficiency });

  it('skips a department once it has no eligible consultant in the drain pass', () => {
    const scopes = new DrainScopeTracker();
    scopes.recordExhausted(scope('sales'));
    expect(scopes.shouldAttempt(scope('sales'))).toBe(false);
    expect(scopes.shouldAttempt(scope('support'))).toBe(true);
    expect(scopes.shouldAttempt(scope(null))).toBe(true);
  });

  it('treats an unconstrained miss as exhausting every scope', () => {
    const scopes = new DrainScopeTracker();
    scopes.recordExhausted(scope(null));
    expect(scopes.shouldAttempt(scope(null))).toBe(false);
    expect(scopes.shouldAttempt(scope('sales'))).toBe(false);
    expect(scopes.shouldAttempt(scope('sales', 'tax', 5))).toBe(false);
  });

  it('exhausts only narrower skill scopes after a skill miss', () => {
    const scopes = new DrainScopeTracker();
    scopes.recordExhausted(scope('sales', 'tax', 3));
    // Same skill at a higher minimum, or the same requirement in the department: still exhausted.
    expect(scopes.shouldAttempt(scope('sales', 'tax', 4))).toBe(false);
    expect(scopes.shouldAttempt(scope('sales', 'tax', 3))).toBe(false);
    // A lower minimum, another skill, no skill, or another department may still find someone.
    expect(scopes.shouldAttempt(scope('sales', 'tax', 2))).toBe(true);
    expect(scopes.shouldAttempt(scope('sales', 'payroll', 3))).toBe(true);
    expect(scopes.shouldAttempt(scope('sales'))).toBe(true);
    expect(scopes.shouldAttempt(scope('support', 'tax', 3))).toBe(true);
  });

  it('applies a department-wide skill miss to that skill in every department', () => {
    const scopes = new DrainScopeTracker();
    scopes.recordExhausted(scope(null, 'tax', 2));
    expect(scopes.shouldAttempt(scope('sales', 'tax', 2))).toBe(false);
    expect(scopes.shouldAttempt(scope('sales', 'tax', 1))).toBe(true);
  });

  it('reports only the departments whose queue positions moved', () => {
    const scopes = new DrainScopeTracker();
    scopes.recordAssigned('sales');
    scopes.recordAssigned(null);
    scopes.recordExhausted(scope('support'));
    expect([...scopes.changedDepartments()]).toEqual(['sales', null]);
  });

  it('orders by load then proficiency by default, and by proficiency first for BEST_SKILL', () => {
    const candidates = [
      { ...candidate('idle-novice', 'm1', 0, null), proficiency: 1 },
      { ...candidate('busy-expert', 'm2', 2, null), proficiency: 5 },
      { ...candidate('idle-skilled', 'm3', 0, null), proficiency: 3 },
    ];
    expect(orderCandidates(candidates, null).map(({ id }) => id)).toEqual([
      'idle-skilled',
      'idle-novice',
      'busy-expert',
    ]);
    expect(orderCandidates(candidates, null, 'BEST_SKILL').map(({ id }) => id)).toEqual([
      'busy-expert',
      'idle-skilled',
      'idle-novice',
    ]);
  });

  it('keeps the previous consultant first under either strategy', () => {
    const candidates = [
      { ...candidate('expert', 'm1', 0, null), proficiency: 5 },
      { ...candidate('previous', 'm2', 3, null), proficiency: 1 },
    ];
    expect(orderCandidates(candidates, 'm2', 'BEST_SKILL')[0]?.id).toBe('previous');
  });
});
