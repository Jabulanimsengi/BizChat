import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TopicService } from './topic.service';

describe('TopicService', () => {
  const auth = { business: { id: 'business-1' }, user: { id: 'user-1' } } as never;
  const row = {
    id: 'topic-1',
    businessId: 'business-1',
    publicId: 'topic_abcdefghijkl',
    name: 'Company registration',
    description: null,
    departmentId: null,
    requiredSkillId: null,
    requiredSkillMinProficiency: null,
    priority: 'NORMAL',
    keywords: [{ phrase: 'register' }],
    negativeKeywords: [],
    examples: [],
    showAsQuickReply: true,
    isDefault: true,
    status: 'ACTIVE',
    sortOrder: 0,
    createdAt: new Date('2026-10-24T08:00:00Z'),
    updatedAt: new Date('2026-10-24T08:00:00Z'),
  };
  const input = {
    name: 'Company registration',
    priority: 'NORMAL' as const,
    keywords: [{ phrase: 'register' }],
    negativeKeywords: [],
    examples: [],
    showAsQuickReply: true,
    isDefault: true,
    sortOrder: 0,
    overflowSteps: [],
  };

  const setup = (): {
    service: TopicService;
    transaction: Record<string, Record<string, jest.Mock>>;
    prisma: Record<string, Record<string, jest.Mock>>;
    record: jest.Mock;
  } => {
    const transaction = {
      topic: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue(row),
      },
      business: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      topic: { findFirst: jest.fn().mockResolvedValue({ id: 'topic-1' }) },
      department: { count: jest.fn().mockResolvedValue(1) },
      skill: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const record = jest.fn().mockResolvedValue(undefined);
    return {
      service: new TopicService(prisma as never, { record } as never, {} as never),
      transaction,
      prisma: prisma as unknown as Record<string, Record<string, jest.Mock>>,
      record,
    };
  };

  it('creates a default topic, clears the previous default, and bumps the catalogue version', async () => {
    const { service, transaction, record } = setup();

    const created = await service.create(auth, input, 'request-1');

    expect(transaction.topic?.updateMany).toHaveBeenCalledWith({
      where: { businessId: 'business-1', isDefault: true },
      data: { isDefault: false },
    });
    expect(transaction.topic?.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'business-1',
        publicId: expect.stringMatching(/^topic_[A-Za-z0-9_-]{8,60}$/) as unknown,
      }) as unknown,
    });
    expect(transaction.business?.update).toHaveBeenCalledWith({
      where: { id: 'business-1' },
      data: { topicCatalogVersion: { increment: 1 } },
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'topic.created' }));
    expect(created).toMatchObject({ name: 'Company registration', isDefault: true });
  });

  it('rejects a department or skill from another tenant', async () => {
    const { service, prisma, transaction } = setup();
    prisma.department?.count?.mockResolvedValue(0);

    await expect(
      service.create(auth, { ...input, departmentId: 'other-department' }, 'request-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.topic?.create).not.toHaveBeenCalled();
  });

  it('reports a duplicate name as a conflict', async () => {
    const { service, transaction } = setup();
    transaction.topic?.create?.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.create(auth, input, 'request-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('stops a disabled topic from remaining the default', async () => {
    const { service, transaction } = setup();

    await service.update(auth, 'topic-1', { status: 'DISABLED' }, 'request-1');

    expect(transaction.topic?.update).toHaveBeenCalledWith({
      where: { id: 'topic-1' },
      data: { status: 'DISABLED', isDefault: false },
    });
  });

  it("refuses to update another tenant's topic", async () => {
    const { service, prisma } = setup();
    prisma.topic?.findFirst?.mockResolvedValue(null);

    await expect(
      service.update(auth, 'topic-other', { name: 'Renamed' }, 'request-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
