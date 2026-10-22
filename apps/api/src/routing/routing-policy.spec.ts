import {
  CAPACITY_STATUSES,
  orderCandidates,
  orderQueue,
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
});
