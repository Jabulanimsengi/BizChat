import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RoutingSettingsService } from './routing-settings.service';
import { SkillService } from './skill.service';

describe('routing configuration', () => {
  const auth = {
    business: { id: 'business-1' },
    user: { id: 'user-1' },
  } as never;
  const skillRow = {
    id: 'skill-1',
    name: 'Tax',
    description: null,
    status: 'ACTIVE' as const,
    createdAt: new Date('2026-10-24T08:00:00Z'),
    updatedAt: new Date('2026-10-24T08:00:00Z'),
    _count: { agents: 2 },
  };

  it('creates a tenant skill, reports its consultant count, and audits the change', async () => {
    const create = jest.fn().mockResolvedValue(skillRow);
    const record = jest.fn().mockResolvedValue(undefined);
    const service = new SkillService({ skill: { create } } as never, { record } as never);

    const skill = await service.create(auth, { name: 'Tax' }, 'request-1');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { businessId: 'business-1', name: 'Tax' } }),
    );
    expect(skill).toMatchObject({ id: 'skill-1', name: 'Tax', consultantCount: 2 });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'skill.created', targetId: 'skill-1' }),
    );
  });

  it('reports a duplicate skill name as a conflict', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const service = new SkillService(
      { skill: { create: jest.fn().mockRejectedValue(duplicate) } } as never,
      { record: jest.fn() } as never,
    );

    await expect(service.create(auth, { name: 'Tax' }, 'request-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses to update a skill that belongs to another tenant', async () => {
    const update = jest.fn();
    const service = new SkillService(
      { skill: { findFirst: jest.fn().mockResolvedValue(null), update } } as never,
      { record: jest.fn() } as never,
    );

    await expect(
      service.update(auth, 'skill-other', { status: 'DISABLED' }, 'request-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps tenants without stored settings on direct, least-busy assignment', async () => {
    const service = new RoutingSettingsService(
      { routingSettings: { findUnique: jest.fn().mockResolvedValue(null) } } as never,
      { record: jest.fn() } as never,
    );

    await expect(service.get(auth)).resolves.toEqual({
      routingStrategy: 'LEAST_BUSY',
      assignmentMode: 'AUTO',
      offerTimeoutSeconds: 30,
      missedOffersBeforeAway: 2,
      exclusionSeconds: 300,
      autoRouteThreshold: 0.6,
      confirmThreshold: 0.35,
      topicPromptTimeoutSeconds: 60,
      intakeFormTiming: 'AFTER_TOPIC',
      defaultIntakeFormId: null,
    });
  });

  it('stores routing settings per tenant, filling unspecified fields with defaults, and audits', async () => {
    const stored = { routingStrategy: 'BEST_SKILL', assignmentMode: 'OFFER' };
    const upsert = jest.fn().mockResolvedValue(stored);
    const record = jest.fn().mockResolvedValue(undefined);
    const service = new RoutingSettingsService(
      { routingSettings: { upsert } } as never,
      { record } as never,
    );

    await expect(
      service.update(auth, { routingStrategy: 'BEST_SKILL', assignmentMode: 'OFFER' }, 'request-1'),
    ).resolves.toEqual(stored);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'business-1' },
        update: { routingStrategy: 'BEST_SKILL', assignmentMode: 'OFFER' },
        create: {
          businessId: 'business-1',
          routingStrategy: 'BEST_SKILL',
          assignmentMode: 'OFFER',
          offerTimeoutSeconds: 30,
          missedOffersBeforeAway: 2,
          exclusionSeconds: 300,
          autoRouteThreshold: 0.6,
          confirmThreshold: 0.35,
          topicPromptTimeoutSeconds: 60,
          intakeFormTiming: 'AFTER_TOPIC',
          defaultIntakeFormId: null,
        },
      }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'routing.settings_updated' }),
    );
  });
});
