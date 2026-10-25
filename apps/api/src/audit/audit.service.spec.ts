import type { AuthContext } from '../common/http.types';
import { AuditService, auditActor } from './audit.service';

describe('audit attribution', () => {
  const person = { user: { id: 'user-1' } } as AuthContext;
  const key = { user: { id: '' }, integrationKeyId: 'key-1' } as AuthContext;

  it('names the signed-in person, or the integration key that made a change', () => {
    expect(auditActor(person)).toEqual({ actorUserId: 'user-1' });
    expect(auditActor(key)).toEqual({ integrationKeyId: 'key-1' });
  });

  it('keeps an integration key in metadata, since only users can be the actor', async () => {
    const create = jest.fn().mockResolvedValue(undefined);
    const service = new AuditService({ auditLog: { create } } as never);

    await service.record({
      businessId: 'b',
      action: 'topic.created',
      integrationKeyId: 'key-1',
      metadata: { name: 'Tax' },
    });
    await service.record({ businessId: 'b', action: 'topic.updated', integrationKeyId: 'key-1' });
    await service.record({
      businessId: 'b',
      action: 'skill.created',
      actorUserId: 'user-1',
      metadata: ['x'],
    });

    expect(create.mock.calls.map(([call]) => (call as { data: unknown }).data)).toEqual([
      {
        businessId: 'b',
        action: 'topic.created',
        metadata: { name: 'Tax', integrationKeyId: 'key-1' },
      },
      { businessId: 'b', action: 'topic.updated', metadata: { integrationKeyId: 'key-1' } },
      { businessId: 'b', action: 'skill.created', actorUserId: 'user-1', metadata: ['x'] },
    ]);
  });
});
