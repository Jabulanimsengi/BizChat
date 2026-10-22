import { ConflictException } from '@nestjs/common';
import { ConversationStateService } from './conversation-state';

describe('ConversationStateService', () => {
  const states = new ConversationStateService();

  it('allows documented forward and reopen transitions', () => {
    expect(() => states.assertTransition('NEW', 'QUEUED')).not.toThrow();
    expect(() => states.assertTransition('ACTIVE', 'RESOLVED')).not.toThrow();
    expect(() => states.assertTransition('RESOLVED', 'ACTIVE')).not.toThrow();
    expect(() => states.assertTransition('CLOSED', 'CLOSED')).not.toThrow();
  });

  it('rejects skipping required lifecycle states', () => {
    expect(() => states.assertTransition('NEW', 'CLOSED')).toThrow(ConflictException);
    expect(() => states.assertTransition('CLOSED', 'ACTIVE')).toThrow(ConflictException);
  });

  it('sets timestamps only for lifecycle milestones', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(states.timestampData('ASSIGNED', now)).toEqual({ assignedAt: now });
    expect(states.timestampData('RESOLVED', now)).toEqual({ resolvedAt: now });
    expect(states.timestampData('CLOSED', now)).toEqual({ closedAt: now });
    expect(states.timestampData('ACTIVE', now)).toEqual({});
  });
});
