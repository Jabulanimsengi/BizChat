import type { PrismaService } from '../database/prisma.service';
import type { AuditService } from '../audit/audit.service';
import { BusinessHoursService } from './business-hours.service';

describe('BusinessHoursService', () => {
  const prisma = {
    businessHour: { findMany: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { record: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.businessHour.findMany.mockResolvedValue([]);
    prisma.$transaction.mockResolvedValue([]);
    audit.record.mockResolvedValue(undefined);
  });

  it('preserves always-available behavior until a schedule is configured', async () => {
    const service = new BusinessHoursService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    const response = await service.get('business-1', 'Africa/Johannesburg');
    expect(response.isOpenNow).toBe(true);
    expect(response.hours).toHaveLength(7);
    expect(response.timezone).toBe('Africa/Johannesburg');
  });

  it('persists all seven days and records an audit event', async () => {
    const service = new BusinessHoursService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
    const hours = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      openingTime: '08:30',
      closingTime: '18:00',
      isClosed: weekday === 0,
    }));
    await service.update(
      { business: { id: 'business-1', timezone: 'UTC' }, user: { id: 'user-1' } } as never,
      { hours },
      'request-1',
      '127.0.0.1',
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'business-1', action: 'business.hours_updated' }),
    );
  });
});
