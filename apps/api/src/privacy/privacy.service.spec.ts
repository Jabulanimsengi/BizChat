import { PrivacyService } from './privacy.service';

describe('PrivacyService retention sweep', () => {
  const create = (
    leaseHeld: boolean,
    policies: { businessId: string; conversationRetentionDays: number }[],
  ): { service: PrivacyService; expire: jest.SpyInstance } => {
    const service = new PrivacyService(
      { privacySettings: { findMany: jest.fn().mockResolvedValue(policies) } } as never,
      {} as never,
      { record: jest.fn() } as never,
      { eval: jest.fn().mockResolvedValue(leaseHeld ? 1 : 0) } as never,
      { get: jest.fn(() => 3_600_000) } as never,
    );
    const expire = jest.spyOn(service, 'expire');
    return { service, expire };
  };

  it('does nothing on an instance without the sweep lease', async () => {
    const { service, expire } = create(false, [
      { businessId: 'b1', conversationRetentionDays: 30 },
    ]);
    await expect(service.runRetention()).resolves.toBe(0);
    expect(expire).not.toHaveBeenCalled();
  });

  it('applies each tenant’s own cutoff and keeps going when one tenant fails', async () => {
    const now = new Date('2026-10-25T00:00:00Z');
    const { service, expire } = create(true, [
      { businessId: 'b1', conversationRetentionDays: 30 },
      { businessId: 'b2', conversationRetentionDays: 365 },
    ]);
    expire.mockRejectedValueOnce(new Error('storage down')).mockResolvedValueOnce(4);

    await expect(service.runRetention(now)).resolves.toBe(4);
    expect(expire).toHaveBeenNthCalledWith(1, 'b1', new Date('2026-09-25T00:00:00Z'));
    expect(expire).toHaveBeenNthCalledWith(2, 'b2', new Date('2025-10-25T00:00:00Z'));
  });
});
