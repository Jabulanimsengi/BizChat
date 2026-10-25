import { PlanService, usagePeriod } from './plan.service';

describe('PlanService limits', () => {
  const client = (plan: Record<string, number | null> | null, used: number): unknown => ({
    business: { findUnique: jest.fn().mockResolvedValue({ plan }) },
    usageCounter: { findUnique: jest.fn().mockResolvedValue({ count: used }) },
    businessMembership: { count: jest.fn().mockResolvedValue(used) },
    integrationKey: { count: jest.fn().mockResolvedValue(used) },
    webhookEndpoint: { count: jest.fn().mockResolvedValue(used) },
  });
  const service = new PlanService({} as never, { record: jest.fn() } as never);

  it('allows anything without a plan, or with an unlimited metric', async () => {
    await expect(
      service.assertWithin('b', 'conversations', client(null, 10_000) as never),
    ).resolves.toBeUndefined();
    await expect(
      service.assertWithin(
        'b',
        'conversations',
        client({ maxConversationsPerMonth: null }, 10_000) as never,
      ),
    ).resolves.toBeUndefined();
  });

  it('allows the last unit and refuses the next with the limit in the details', async () => {
    await expect(
      service.assertWithin('b', 'integrationKeys', client({ maxIntegrationKeys: 2 }, 1) as never),
    ).resolves.toBeUndefined();
    await expect(
      service.assertWithin('b', 'integrationKeys', client({ maxIntegrationKeys: 2 }, 2) as never),
    ).rejects.toMatchObject({
      response: {
        code: 'PLAN_LIMIT_REACHED',
        details: { metric: 'integrationKeys', limit: 2, used: 2 },
      },
    });
  });

  it('meters conversations by UTC month', () => {
    expect(usagePeriod(new Date('2026-10-31T23:30:00Z'))).toBe('2026-10');
    expect(usagePeriod(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11');
  });
});
