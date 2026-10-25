import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ClassificationDecision,
  ClassificationMethod,
  ConversationPriority,
  IntakeStatus,
  Prisma,
  Topic,
} from '@prisma/client';
import type { TopicTestResponse, WidgetTopic } from '@bizchat/types';
import { PrismaService } from '../database/prisma.service';
import { DEFAULT_ROUTING_SETTINGS } from '../routing-config/routing-settings.defaults';
import { classify, compileCatalog, type CompiledCatalog } from './topic-classifier';

export type CatalogTopic = Topic & { department: { status: string } | null };

interface TenantCatalog {
  version: number;
  topics: CatalogTopic[];
  compiled: CompiledCatalog;
}

/** Where a topic sends a conversation; the caller substitutes the default department for null. */
export interface TopicRouting {
  topicId: string | null;
  departmentId: string | null;
  priority: ConversationPriority;
  requiredSkillId: string | null;
  requiredSkillMinProficiency: number | null;
}

export interface IntakeDecision {
  topic: CatalogTopic | null;
  method: ClassificationMethod;
  decision: ClassificationDecision;
  confidence: number | null;
  candidates: { topicId: string; score: number }[];
  routing: TopicRouting;
  intakeStatus: IntakeStatus;
  /** Set when the visitor is asked to choose; the default topic applies after it passes. */
  intakeExpiresAt: Date | null;
  /** Topics to offer the visitor when asking or confirming. */
  options: CatalogTopic[];
}

const PROMPT_OPTIONS = 3;

/**
 * Each tenant's active topics, compiled for the classifier and cached per API instance. Topic edits
 * bump `businesses.topicCatalogVersion`, so every instance refreshes on its next classification.
 */
@Injectable()
export class TopicCatalogService {
  private readonly cache = new Map<string, TenantCatalog>();

  public constructor(private readonly prisma: PrismaService) {}

  public async catalog(businessId: string): Promise<TenantCatalog> {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { topicCatalogVersion: true },
    });
    const cached = this.cache.get(businessId);
    if (cached?.version === business.topicCatalogVersion) return cached;
    const topics = await this.prisma.topic.findMany({
      where: { businessId, status: 'ACTIVE' },
      include: { department: { select: { status: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const catalog = {
      version: business.topicCatalogVersion,
      topics,
      compiled: compileCatalog(
        topics.map((topic) => ({
          id: topic.id,
          keywords: topic.keywords as { phrase: string; weight?: number }[],
          negativeKeywords: topic.negativeKeywords,
          examples: topic.examples,
        })),
      ),
    };
    this.cache.set(businessId, catalog);
    return catalog;
  }

  /**
   * Picks a topic for a new conversation, or returns null when the tenant has no active topics (the
   * pre-Phase-B behaviour applies). An explicit topic wins; otherwise the message is classified.
   * Without a visitor to ask (`canAsk` false), an uncertain result falls back to the default topic.
   */
  public async decide(
    businessId: string,
    text: string,
    options: { topicPublicId?: string; explicitMethod?: ClassificationMethod; canAsk: boolean },
  ): Promise<IntakeDecision | null> {
    const { topics, compiled } = await this.catalog(businessId);
    if (topics.length === 0) return null;
    if (options.topicPublicId) {
      const chosen = topics.find((topic) => topic.publicId === options.topicPublicId);
      if (!chosen)
        throw new NotFoundException({
          code: 'TOPIC_NOT_FOUND',
          message: 'The selected topic is unavailable',
        });
      return this.complete(chosen, options.explicitMethod ?? 'VISITOR_CHOICE', 'ROUTE', 1, []);
    }
    const settings = await this.settings(businessId);
    const result = classify(compiled, text, settings);
    const matched = topics.find((topic) => topic.id === result.topicId) ?? null;
    if (result.decision !== 'ASK' && matched)
      return {
        ...this.complete(matched, 'KEYWORD', result.decision, result.confidence, result.candidates),
        options: this.options(topics, result.candidates),
      };
    if (!options.canAsk)
      return this.complete(
        defaultTopic(topics),
        'DEFAULT',
        'ASK',
        result.confidence,
        result.candidates,
      );
    return {
      topic: null,
      method: 'KEYWORD',
      decision: 'ASK',
      confidence: result.confidence,
      candidates: result.candidates,
      routing: topicRouting(null),
      intakeStatus: 'AWAITING_TOPIC',
      intakeExpiresAt: new Date(Date.now() + settings.topicPromptTimeoutSeconds * 1_000),
      options: this.options(topics, result.candidates),
    };
  }

  /** The "Test a message" preview for the topic editor. */
  public async preview(businessId: string, text: string): Promise<TopicTestResponse> {
    const { topics, compiled } = await this.catalog(businessId);
    const result = classify(compiled, text, await this.settings(businessId));
    const name = (id: string): string => topics.find((topic) => topic.id === id)?.name ?? id;
    return {
      decision: result.decision,
      confidence: result.confidence,
      topic: result.topicId ? { id: result.topicId, name: name(result.topicId) } : null,
      candidates: result.candidates.map((candidate) => ({
        ...candidate,
        name: name(candidate.topicId),
      })),
    };
  }

  public async quickReplies(businessId: string): Promise<WidgetTopic[]> {
    const { topics } = await this.catalog(businessId);
    return topics.filter((topic) => topic.showAsQuickReply).map(widgetTopic);
  }

  public async findActive(
    businessId: string,
    topicPublicId: string | null,
  ): Promise<CatalogTopic | null> {
    const { topics } = await this.catalog(businessId);
    if (topicPublicId === null) return defaultTopic(topics);
    const topic = topics.find((item) => item.publicId === topicPublicId);
    if (!topic)
      throw new NotFoundException({
        code: 'TOPIC_NOT_FOUND',
        message: 'The selected topic is unavailable',
      });
    return topic;
  }

  /** Topics to show the visitor: the best matches first, then the other quick-reply topics. */
  private options(topics: CatalogTopic[], candidates: { topicId: string }[]): CatalogTopic[] {
    const ranked = candidates
      .map(({ topicId }) => topics.find((topic) => topic.id === topicId))
      .filter((topic): topic is CatalogTopic => Boolean(topic));
    const rest = topics.filter((topic) => topic.showAsQuickReply && !ranked.includes(topic));
    return [...ranked, ...rest].slice(0, PROMPT_OPTIONS);
  }

  private complete(
    topic: CatalogTopic | null,
    method: ClassificationMethod,
    decision: ClassificationDecision,
    confidence: number | null,
    candidates: { topicId: string; score: number }[],
  ): IntakeDecision {
    return {
      topic,
      method,
      decision,
      confidence,
      candidates,
      routing: topicRouting(topic),
      intakeStatus: 'COMPLETE',
      intakeExpiresAt: null,
      options: [],
    };
  }

  private async settings(businessId: string): Promise<{
    autoRouteThreshold: number;
    confirmThreshold: number;
    topicPromptTimeoutSeconds: number;
  }> {
    const settings = await this.prisma.routingSettings.findUnique({
      where: { businessId },
      select: { autoRouteThreshold: true, confirmThreshold: true, topicPromptTimeoutSeconds: true },
    });
    return settings ?? DEFAULT_ROUTING_SETTINGS;
  }
}

export function topicRouting(topic: CatalogTopic | null): TopicRouting {
  return {
    topicId: topic?.id ?? null,
    // A topic pointing at a disabled department falls back to the default department.
    departmentId: topic?.department?.status === 'ACTIVE' ? topic.departmentId : null,
    priority: topic?.priority ?? 'NORMAL',
    requiredSkillId: topic?.requiredSkillId ?? null,
    requiredSkillMinProficiency: topic?.requiredSkillId
      ? (topic.requiredSkillMinProficiency ?? 1)
      : null,
  };
}

/** The tenant's default topic, or null when none is marked default. */
export function defaultTopic(topics: CatalogTopic[]): CatalogTopic | null {
  return topics.find((topic) => topic.isDefault) ?? null;
}

export function widgetTopic(topic: Pick<Topic, 'publicId' | 'name'>): WidgetTopic {
  return { publicId: topic.publicId, name: topic.name };
}

/** The classification row recorded for every intake decision. */
export function classificationRecord(
  businessId: string,
  conversationId: string,
  decision: Pick<IntakeDecision, 'topic' | 'method' | 'decision' | 'confidence' | 'candidates'>,
): Prisma.ConversationClassificationUncheckedCreateInput {
  return {
    businessId,
    conversationId,
    topicId: decision.topic?.id ?? null,
    method: decision.method,
    decision: decision.decision,
    confidence: decision.confidence,
    candidates: decision.candidates,
  };
}
