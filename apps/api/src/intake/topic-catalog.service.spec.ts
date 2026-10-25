import { NotFoundException } from '@nestjs/common';
import { TopicCatalogService } from './topic-catalog.service';

describe('TopicCatalogService', () => {
  const topic = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    id: 'topic-x',
    businessId: 'business-1',
    publicId: 'topic_xxxxxxxxxxxx',
    name: 'Topic',
    departmentId: null,
    department: null,
    requiredSkillId: null,
    requiredSkillMinProficiency: null,
    priority: 'NORMAL',
    keywords: [],
    negativeKeywords: [],
    examples: [],
    showAsQuickReply: true,
    isDefault: false,
    ...overrides,
  });
  const registration = topic({
    id: 'registration',
    publicId: 'topic_registration01',
    name: 'Company registration',
    departmentId: 'sales',
    department: { status: 'ACTIVE' },
    requiredSkillId: 'skill-cipro',
    requiredSkillMinProficiency: 3,
    priority: 'HIGH',
    keywords: [{ phrase: 'register' }, { phrase: 'new company' }],
  });
  const returns = topic({
    id: 'returns',
    publicId: 'topic_returns000001',
    name: 'Annual returns',
    departmentId: 'retired',
    department: { status: 'DISABLED' },
    keywords: [{ phrase: 'penalty' }],
  });
  const general = topic({
    id: 'general',
    publicId: 'topic_general000001',
    name: 'General',
    isDefault: true,
  });

  const setup = (
    topics: Record<string, unknown>[],
  ): { service: TopicCatalogService; findTopics: jest.Mock; business: jest.Mock } => {
    const findTopics = jest.fn().mockResolvedValue(topics);
    const business = jest.fn().mockResolvedValue({ topicCatalogVersion: 1 });
    const prisma = {
      business: { findUniqueOrThrow: business },
      topic: { findMany: findTopics },
      routingSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    return { service: new TopicCatalogService(prisma as never), findTopics, business };
  };

  it('returns null for tenants without topics, keeping the old routing', async () => {
    const { service } = setup([]);
    await expect(service.decide('business-1', 'register', { canAsk: true })).resolves.toBeNull();
  });

  it('routes a confident match with its department, priority, and skill', async () => {
    const { service } = setup([registration, returns, general]);

    const decision = await service.decide('business-1', 'How do I register a new company?', {
      canAsk: true,
    });

    expect(decision).toMatchObject({
      method: 'KEYWORD',
      decision: 'ROUTE',
      intakeStatus: 'COMPLETE',
      routing: {
        topicId: 'registration',
        departmentId: 'sales',
        priority: 'HIGH',
        requiredSkillId: 'skill-cipro',
        requiredSkillMinProficiency: 3,
      },
    });
  });

  it('confirms a weak match and offers the best matches first', async () => {
    const { service } = setup([registration, returns, general]);

    const decision = await service.decide('business-1', 'a question about a penalty', {
      canAsk: true,
    });

    expect(decision).toMatchObject({ decision: 'CONFIRM', intakeStatus: 'COMPLETE' });
    expect(decision?.topic?.id).toBe('returns');
    // A topic pointing at a disabled department falls back to the default department.
    expect(decision?.routing.departmentId).toBeNull();
    expect(decision?.options.map(({ id }) => id)).toEqual(['returns', 'registration', 'general']);
  });

  it('asks the visitor when nothing matches and sets the prompt deadline', async () => {
    const { service } = setup([registration, returns, general]);

    const before = Date.now();
    const decision = await service.decide('business-1', 'hello there', { canAsk: true });

    expect(decision).toMatchObject({
      decision: 'ASK',
      topic: null,
      intakeStatus: 'AWAITING_TOPIC',
      routing: { topicId: null, departmentId: null, priority: 'NORMAL' },
    });
    const deadline = decision?.intakeExpiresAt?.getTime() ?? 0;
    expect(deadline - before).toBeGreaterThanOrEqual(60_000);
    expect(deadline - before).toBeLessThan(61_000);
  });

  it('uses the default topic when nobody can be asked', async () => {
    const { service } = setup([registration, returns, general]);

    const decision = await service.decide('business-1', 'hello there', { canAsk: false });

    expect(decision).toMatchObject({
      method: 'DEFAULT',
      intakeStatus: 'COMPLETE',
      routing: { topicId: 'general' },
    });
  });

  it('honours an explicit topic and rejects an unknown one', async () => {
    const { service } = setup([registration, returns, general]);

    await expect(
      service.decide('business-1', 'anything', {
        topicPublicId: 'topic_returns000001',
        explicitMethod: 'INTEGRATION',
        canAsk: true,
      }),
    ).resolves.toMatchObject({
      method: 'INTEGRATION',
      decision: 'ROUTE',
      topic: { id: 'returns' },
    });
    await expect(
      service.decide('business-1', 'anything', {
        topicPublicId: 'topic_unknown000001',
        canAsk: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reuses the compiled catalogue until the tenant version changes', async () => {
    const { service, findTopics, business } = setup([registration, general]);

    await service.decide('business-1', 'register', { canAsk: true });
    await service.decide('business-1', 'register', { canAsk: true });
    expect(findTopics).toHaveBeenCalledTimes(1);

    business.mockResolvedValue({ topicCatalogVersion: 2 });
    await service.decide('business-1', 'register', { canAsk: true });
    expect(findTopics).toHaveBeenCalledTimes(2);
  });
});
