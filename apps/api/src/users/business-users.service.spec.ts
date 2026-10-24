import { NotFoundException } from '@nestjs/common';
import { BusinessUsersService } from './business-users.service';

describe('BusinessUsersService skills', () => {
  const auth = {
    business: { id: 'business-1' },
    user: { id: 'admin-user' },
    membership: { id: 'admin-membership', role: 'ADMIN' },
  } as never;
  const existing = {
    id: 'membership-1',
    userId: 'user-1',
    role: 'CONSULTANT',
    agentProfile: { id: 'profile-1' },
  };
  const updated = {
    ...existing,
    status: 'ACTIVE',
    createdAt: new Date('2026-10-24T08:00:00Z'),
    user: { email: 'agent@example.com', displayName: 'Agent', lastLoginAt: null },
    agentProfile: {
      id: 'profile-1',
      maxConcurrentChats: 5,
      routingEnabled: true,
      departments: [],
      skills: [{ skillId: 'skill-1', proficiency: 4 }],
    },
  };

  const setup = (
    activeSkillCount: number,
  ): {
    service: BusinessUsersService;
    transaction: { agentSkill: { deleteMany: jest.Mock; createMany: jest.Mock } };
  } => {
    const transaction = {
      user: { update: jest.fn() },
      businessMembership: {
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updated),
      },
      agentProfile: { update: jest.fn() },
      agentSkill: { deleteMany: jest.fn(), createMany: jest.fn() },
      session: { updateMany: jest.fn() },
    };
    const prisma = {
      businessMembership: { findFirst: jest.fn().mockResolvedValue(existing) },
      skill: { count: jest.fn().mockResolvedValue(activeSkillCount) },
      $transaction: jest.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    return {
      service: new BusinessUsersService(prisma as never, { record: jest.fn() } as never),
      transaction,
    };
  };

  it('replaces a consultant skill set and returns it', async () => {
    const { service, transaction } = setup(1);

    const user = await service.update(
      auth,
      'membership-1',
      { skills: [{ skillId: 'skill-1', proficiency: 4 }] },
      'request-1',
    );

    expect(transaction.agentSkill.deleteMany).toHaveBeenCalledWith({
      where: { businessId: 'business-1', agentProfileId: 'profile-1' },
    });
    expect(transaction.agentSkill.createMany).toHaveBeenCalledWith({
      data: [
        {
          businessId: 'business-1',
          agentProfileId: 'profile-1',
          skillId: 'skill-1',
          proficiency: 4,
        },
      ],
    });
    expect(user.skills).toEqual([{ skillId: 'skill-1', proficiency: 4 }]);
  });

  it('rejects skills that are disabled or belong to another tenant', async () => {
    const { service, transaction } = setup(0);

    await expect(
      service.update(
        auth,
        'membership-1',
        { skills: [{ skillId: 'skill-other', proficiency: 2 }] },
        'request-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.agentSkill.deleteMany).not.toHaveBeenCalled();
  });
});
