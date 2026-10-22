import type { CustomerIdentityService } from '../integrations/customer-identity.service';
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../database/prisma.service';
import type { Environment } from '../config/environment';
import { WidgetService } from './widget.service';

describe('WidgetService', () => {
  const visitorToken = 'v'.repeat(40);
  let visitorLookupInput: unknown;
  let widgetCreateInput: unknown;
  const business = {
    id: 'business-1',
    name: 'Example Business',
    status: 'TRIAL',
    domains: [{ id: 'domain-1' }],
    widgetSettings: {
      displayName: null,
      primaryColor: '#155f43',
      greeting: 'Welcome',
      launcherPosition: 'BOTTOM_RIGHT',
      enabled: true,
      reopenWindowMinutes: 1440,
    },
  };
  const prisma = {
    business: { findUnique: jest.fn() },
    department: { findMany: jest.fn() },
    visitorSession: {
      findFirst: jest.fn<Promise<{ id: string; visitorId: string } | null>, [unknown]>(),
      update: jest.fn(),
    },
    visitor: { update: jest.fn() },
    widgetSession: { create: jest.fn<Promise<Record<string, never>>, [unknown]>() },
    $transaction: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string): string | number | undefined => {
      if (key === 'NODE_ENV') return 'test';
      if (key === 'WIDGET_TOKEN_SECRET') return 'w'.repeat(32);
      if (key === 'WIDGET_SESSION_TTL_MINUTES') return 30;
      return undefined;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.business.findUnique.mockResolvedValue(business);
    prisma.department.findMany.mockResolvedValue([{ publicId: 'dept_12345678', name: 'Support' }]);
    prisma.visitorSession.findFirst.mockImplementation((input: unknown) => {
      visitorLookupInput = input;
      return Promise.resolve({ id: 'visitor-session-1', visitorId: 'visitor-1' });
    });
    prisma.visitorSession.update.mockResolvedValue({});
    prisma.visitor.update.mockResolvedValue({});
    prisma.widgetSession.create.mockImplementation((input: unknown) => {
      widgetCreateInput = input;
      return Promise.resolve({});
    });
    prisma.$transaction.mockResolvedValue([]);
  });

  it('scopes returning visitor lookup to the resolved tenant', async () => {
    const service = new WidgetService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService<Environment, true>,
      {} as CustomerIdentityService,
    );
    const result = await service.bootstrap(
      { businessPublicId: 'pub_12345678', visitorToken },
      'https://example.com',
    );
    expect(result.visitorToken).toBe(visitorToken);
    const visitorLookup = visitorLookupInput as { where: { businessId: string } };
    const widgetCreate = widgetCreateInput as { data: { businessId: string; origin: string } };
    expect(visitorLookup.where.businessId).toBe('business-1');
    expect(widgetCreate.data).toMatchObject({
      businessId: 'business-1',
      origin: 'https://example.com',
    });
    expect(result.departments).toEqual([{ publicId: 'dept_12345678', name: 'Support' }]);
  });

  it('rejects an origin that is not verified for the selected business', async () => {
    prisma.business.findUnique.mockResolvedValue({ ...business, domains: [] });
    const service = new WidgetService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService<Environment, true>,
      {} as CustomerIdentityService,
    );
    await expect(
      service.bootstrap({ businessPublicId: 'pub_12345678' }, 'https://attacker.example'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.widgetSession.create).not.toHaveBeenCalled();
  });
});
