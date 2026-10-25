import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Plan } from '@prisma/client';
import type {
  PlanMetric,
  PlanResponse,
  PlanUsageResponse,
  PlatformTenantResponse,
} from '@bizchat/types';
import type {
  CreatePlanInput,
  PlatformTenantQuery,
  UpdatePlanInput,
  UpdateTenantInput,
} from '@bizchat/validation';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

type Client = Pick<
  Prisma.TransactionClient,
  'business' | 'usageCounter' | 'businessMembership' | 'integrationKey' | 'webhookEndpoint'
>;

const LIMIT_FIELD: Record<PlanMetric, keyof Plan> = {
  consultants: 'maxConsultants',
  conversations: 'maxConversationsPerMonth',
  integrationKeys: 'maxIntegrationKeys',
  webhookEndpoints: 'maxWebhookEndpoints',
};
const METRIC_LABEL: Record<PlanMetric, string> = {
  consultants: 'active users',
  conversations: 'conversations this month',
  integrationKeys: 'integration keys',
  webhookEndpoints: 'webhook endpoints',
};

/** The current UTC month, matching how the usage trigger buckets conversations. */
export function usagePeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Plans and limits. Conversations are counted by a database trigger; the other metrics are live
 * counts. Checks run before a create, inside the creating transaction where one exists, so two
 * concurrent creates can overshoot a conversation limit by a few but never the other limits, which
 * are created under per-tenant locks.
 */
@Injectable()
export class PlanService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Throws `PLAN_LIMIT_REACHED` when one more of `metric` would exceed the tenant's plan. */
  public async assertWithin(
    businessId: string,
    metric: PlanMetric,
    client: Client = this.prisma,
  ): Promise<void> {
    const business = await client.business.findUnique({
      where: { id: businessId },
      select: { plan: true },
    });
    const limit = business?.plan ? (business.plan[LIMIT_FIELD[metric]] as number | null) : null;
    if (limit === null) return;
    const used = await this.used(businessId, metric, client);
    if (used >= limit)
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        message: `Your plan allows ${limit} ${METRIC_LABEL[metric]}. Contact support to change your plan.`,
        details: { metric, limit, used },
      });
  }

  public async usage(businessId: string): Promise<PlanUsageResponse> {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { plan: true },
    });
    const metrics = Object.keys(LIMIT_FIELD) as PlanMetric[];
    const used = await Promise.all(metrics.map((metric) => this.used(businessId, metric)));
    return {
      plan: business.plan ? { code: business.plan.code, name: business.plan.name } : null,
      period: usagePeriod(),
      usage: Object.fromEntries(
        metrics.map((metric, index) => [
          metric,
          {
            used: used[index]!,
            limit: business.plan ? (business.plan[LIMIT_FIELD[metric]] as number | null) : null,
          },
        ]),
      ) as PlanUsageResponse['usage'],
    };
  }

  /** The plan code configured for new registrations, resolved to a plan ID (null when unset). */
  public async defaultPlanId(code: string): Promise<string | null> {
    if (!code) return null;
    const plan = await this.prisma.plan.findUnique({ where: { code }, select: { id: true } });
    return plan?.id ?? null;
  }

  public async listPlans(): Promise<PlanResponse[]> {
    const plans = await this.prisma.plan.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { businesses: true } } },
    });
    return plans.map(({ _count, ...plan }) => serializePlan(plan, _count.businesses));
  }

  public async createPlan(auth: AuthContext, input: CreatePlanInput): Promise<PlanResponse> {
    try {
      const plan = await this.prisma.plan.create({ data: input });
      await this.record(auth, 'platform.plan_created', 'Plan', plan.id, { ...input });
      return serializePlan(plan, 0);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException({
          code: 'PLAN_EXISTS',
          message: 'A plan with this code exists',
        });
      throw error;
    }
  }

  public async updatePlan(
    auth: AuthContext,
    id: string,
    input: UpdatePlanInput,
  ): Promise<PlanResponse> {
    const existing = await this.prisma.plan.findUnique({ where: { id } });
    if (!existing)
      throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'Plan not found' });
    const plan = await this.prisma.plan.update({
      where: { id },
      data: input,
      include: { _count: { select: { businesses: true } } },
    });
    await this.record(auth, 'platform.plan_updated', 'Plan', id, { ...input });
    const { _count, ...rest } = plan;
    return serializePlan(rest, _count.businesses);
  }

  public async listTenants(query: PlatformTenantQuery): Promise<PlatformTenantResponse[]> {
    const search = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { slug: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const tenants = await this.prisma.business.findMany({
      where: search,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: { id: true, name: true, slug: true, status: true, createdAt: true, planId: true },
    });
    return Promise.all(
      tenants.map(async (tenant) => ({
        ...tenant,
        createdAt: tenant.createdAt.toISOString(),
        usage: (await this.usage(tenant.id)).usage,
      })),
    );
  }

  /** Assigns a plan (null removes limits) or changes a tenant's status, e.g. to suspend it. */
  public async updateTenant(
    auth: AuthContext,
    businessId: string,
    input: UpdateTenantInput,
  ): Promise<PlatformTenantResponse> {
    const existing = await this.prisma.business.findUnique({ where: { id: businessId } });
    if (!existing)
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found' });
    if (input.planId) {
      const plan = await this.prisma.plan.count({ where: { id: input.planId } });
      if (!plan) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'Plan not found' });
    }
    const updated = await this.prisma.business.update({
      where: { id: businessId },
      data: {
        ...(input.planId !== undefined ? { planId: input.planId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: { id: true, name: true, slug: true, status: true, createdAt: true, planId: true },
    });
    // Recorded in the tenant's own audit log, so its owners can see what the platform changed.
    await this.audit.record({
      businessId,
      actorUserId: auth.user.id,
      action: 'platform.tenant_updated',
      targetType: 'Business',
      targetId: businessId,
      metadata: { ...input, previousStatus: existing.status, previousPlanId: existing.planId },
    });
    return {
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      usage: (await this.usage(businessId)).usage,
    };
  }

  private async used(
    businessId: string,
    metric: PlanMetric,
    client: Client = this.prisma,
  ): Promise<number> {
    switch (metric) {
      case 'conversations': {
        const counter = await client.usageCounter.findUnique({
          where: {
            businessId_period_metric: {
              businessId,
              period: usagePeriod(),
              metric: 'conversations',
            },
          },
        });
        return counter?.count ?? 0;
      }
      case 'consultants':
        return client.businessMembership.count({ where: { businessId, status: 'ACTIVE' } });
      case 'integrationKeys':
        return client.integrationKey.count({
          where: { businessId, revokedAt: null, expiresAt: { gt: new Date() } },
        });
      case 'webhookEndpoints':
        return client.webhookEndpoint.count({ where: { businessId, enabled: true } });
    }
  }

  /** Plans belong to no tenant, so plan changes go to the platform administrator's own audit log. */
  private async record(
    auth: AuthContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.audit.record({
      businessId: auth.business.id,
      actorUserId: auth.user.id,
      action,
      targetType,
      targetId,
      metadata,
    });
  }
}

function serializePlan(plan: Plan, tenants: number): PlanResponse {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    maxConsultants: plan.maxConsultants,
    maxConversationsPerMonth: plan.maxConversationsPerMonth,
    maxIntegrationKeys: plan.maxIntegrationKeys,
    maxWebhookEndpoints: plan.maxWebhookEndpoints,
    tenants,
  };
}
