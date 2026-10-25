import { Injectable } from '@nestjs/common';
import { Prisma, type ConversationSource } from '@prisma/client';
import type {
  AnalyticsBreakdownRow,
  AnalyticsDuration,
  AnalyticsOverviewResponse,
  ConsultantAnalyticsRow,
} from '@bizchat/types';
import type { AnalyticsQueryInput } from '@bizchat/validation';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

interface DurationColumns {
  count: number;
  median: number | null;
  p90: number | null;
  average: number | null;
}

/** Aggregate columns for a duration in seconds; NULL inputs (not yet reached) are ignored. */
function durationColumns(prefix: string, seconds: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    count(${seconds})::int AS ${Prisma.raw(`"${prefix}Count"`)},
    percentile_cont(0.5) WITHIN GROUP (ORDER BY ${seconds}) AS ${Prisma.raw(`"${prefix}Median"`)},
    percentile_cont(0.9) WITHIN GROUP (ORDER BY ${seconds}) AS ${Prisma.raw(`"${prefix}P90"`)},
    avg(${seconds})::float8 AS ${Prisma.raw(`"${prefix}Average"`)}`;
}

function duration(row: Record<string, unknown>, prefix: string): AnalyticsDuration {
  const columns: DurationColumns = {
    count: Number(row[`${prefix}Count`] ?? 0),
    median: row[`${prefix}Median`] as number | null,
    p90: row[`${prefix}P90`] as number | null,
    average: row[`${prefix}Average`] as number | null,
  };
  const round = (value: number | null): number | null =>
    value === null || value === undefined ? null : Math.round(Number(value));
  return {
    count: columns.count,
    medianSeconds: round(columns.median),
    p90Seconds: round(columns.p90),
    averageSeconds: round(columns.average),
  };
}

const WAIT = Prisma.sql`extract(epoch FROM (e."assignedAt" - e."createdAt"))::float8`;
const FIRST_RESPONSE = Prisma.sql`extract(epoch FROM (e."repliedAt" - e."createdAt"))::float8`;
const HANDLE = Prisma.sql`extract(epoch FROM (e."resolvedAt" - e."assignedAt"))::float8`;

/** Every local day from `from` to `to` inclusive, as YYYY-MM-DD. */
export function localDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (
    let day = new Date(`${from}T00:00:00Z`);
    day <= new Date(`${to}T00:00:00Z`);
    day = new Date(day.getTime() + 86_400_000)
  )
    days.push(day.toISOString().slice(0, 10));
  return days;
}

/**
 * Reporting over the conversations a tenant received in a range of its local days. Aggregation runs
 * in PostgreSQL; each query starts from the same cohort so the figures agree with one another.
 */
@Injectable()
export class AnalyticsService {
  public constructor(private readonly prisma: PrismaService) {}

  public async overview(
    auth: AuthContext,
    query: AnalyticsQueryInput,
  ): Promise<AnalyticsOverviewResponse> {
    const timezone = auth.business.timezone;
    const enriched = this.enriched(auth.business.id, query, timezone);
    const [totals, daily, sources, topics, departments, offers, classification] = await Promise.all(
      [
        this.prisma.$queryRaw<Record<string, unknown>[]>`${enriched}
          SELECT count(*)::int AS conversations,
                 count(e."assignedAt")::int AS assigned,
                 count(*) FILTER (WHERE e."resolvedAt" IS NOT NULL)::int AS resolved,
                 count(*) FILTER (WHERE e.abandoned)::int AS abandoned,
                 count(*) FILTER (WHERE e."followUpRequestedAt" IS NOT NULL)::int AS "followUps",
                 count(*) FILTER (WHERE e."overflowLevel" > 0)::int AS overflowed,
                 ${durationColumns('wait', WAIT)},
                 ${durationColumns('reply', FIRST_RESPONSE)},
                 ${durationColumns('handle', HANDLE)}
          FROM enriched e`,
        this.prisma.$queryRaw<
          { day: Date; created: number; resolved: number; abandoned: number }[]
        >`${enriched}
          SELECT ((e."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::date AS day,
                 count(*)::int AS created,
                 count(*) FILTER (WHERE e."resolvedAt" IS NOT NULL)::int AS resolved,
                 count(*) FILTER (WHERE e.abandoned)::int AS abandoned
          FROM enriched e GROUP BY 1 ORDER BY 1`,
        this.prisma.$queryRaw<{ source: ConversationSource; conversations: number }[]>`${enriched}
          SELECT e.source, count(*)::int AS conversations
          FROM enriched e GROUP BY 1 ORDER BY 2 DESC`,
        this.breakdown(enriched, Prisma.sql`topics`, Prisma.sql`"topicId"`, 'No topic'),
        this.breakdown(
          enriched,
          Prisma.sql`departments`,
          Prisma.sql`"departmentId"`,
          'No department',
        ),
        this.prisma.$queryRaw<Record<string, number>[]>`${enriched}
          SELECT count(*)::int AS offered,
                 count(*) FILTER (WHERE o.outcome = 'ACCEPTED')::int AS accepted,
                 count(*) FILTER (WHERE o.outcome = 'DECLINED')::int AS declined,
                 count(*) FILTER (WHERE o.outcome = 'EXPIRED')::int AS expired,
                 count(*) FILTER (WHERE o.outcome = 'CANCELLED')::int AS cancelled
          FROM conversation_offers o JOIN enriched e ON e.id = o."conversationId"`,
        this.prisma.$queryRaw<Record<string, number>[]>`${enriched},
          keyword AS (
            SELECT DISTINCT ON (k."conversationId") k."conversationId", k.decision, k."topicId"
            FROM conversation_classifications k JOIN enriched e ON e.id = k."conversationId"
            WHERE k.method = 'KEYWORD' ORDER BY k."conversationId", k."createdAt"
          )
          SELECT count(*)::int AS classified,
                 count(*) FILTER (WHERE kw.decision = 'ROUTE')::int AS "autoRouted",
                 count(*) FILTER (WHERE kw.decision = 'CONFIRM')::int AS confirmed,
                 count(*) FILTER (WHERE kw.decision = 'ASK')::int AS asked,
                 (SELECT count(DISTINCT d."conversationId")::int
                    FROM conversation_classifications d JOIN enriched e ON e.id = d."conversationId"
                   WHERE d.method IN ('DEFAULT', 'TIMEOUT')) AS defaulted,
                 count(*) FILTER (
                   WHERE kw.decision IN ('ROUTE', 'CONFIRM') AND EXISTS (
                     SELECT 1 FROM conversation_classifications v
                      WHERE v."conversationId" = kw."conversationId"
                        AND v.method = 'VISITOR_CHOICE'
                        AND v."topicId" IS DISTINCT FROM kw."topicId")
                 )::int AS "changedByVisitor"
          FROM keyword kw`,
      ],
    );
    const total = totals[0] ?? {};
    const offer = offers[0] ?? {};
    const byDay = new Map(daily.map((row) => [row.day.toISOString().slice(0, 10), row]));
    const decided = (offer.accepted ?? 0) + (offer.declined ?? 0) + (offer.expired ?? 0);
    return {
      from: query.from,
      to: query.to,
      timezone,
      totals: {
        conversations: Number(total.conversations ?? 0),
        assigned: Number(total.assigned ?? 0),
        resolved: Number(total.resolved ?? 0),
        abandoned: Number(total.abandoned ?? 0),
        followUps: Number(total.followUps ?? 0),
        overflowed: Number(total.overflowed ?? 0),
      },
      daily: localDays(query.from, query.to).map((date) => ({
        date,
        created: byDay.get(date)?.created ?? 0,
        resolved: byDay.get(date)?.resolved ?? 0,
        abandoned: byDay.get(date)?.abandoned ?? 0,
      })),
      waitToAssignment: duration(total, 'wait'),
      firstResponse: duration(total, 'reply'),
      handleTime: duration(total, 'handle'),
      offers: {
        offered: offer.offered ?? 0,
        accepted: offer.accepted ?? 0,
        declined: offer.declined ?? 0,
        expired: offer.expired ?? 0,
        cancelled: offer.cancelled ?? 0,
        // Cancelled offers (visitor left, consultant disconnected) say nothing about willingness.
        acceptRate: decided ? (offer.accepted ?? 0) / decided : null,
      },
      bySource: sources,
      byTopic: topics,
      byDepartment: departments,
      classification: {
        classified: classification[0]?.classified ?? 0,
        autoRouted: classification[0]?.autoRouted ?? 0,
        confirmed: classification[0]?.confirmed ?? 0,
        asked: classification[0]?.asked ?? 0,
        defaulted: classification[0]?.defaulted ?? 0,
        changedByVisitor: classification[0]?.changedByVisitor ?? 0,
      },
    };
  }

  /**
   * Per consultant over the same cohort. A conversation's wait and first response belong to its
   * first assignee; offers belong to whoever was offered them.
   */
  public async consultants(
    auth: AuthContext,
    query: AnalyticsQueryInput,
  ): Promise<ConsultantAnalyticsRow[]> {
    const enriched = this.enriched(auth.business.id, query, auth.business.timezone);
    const [profiles, work, offers] = await Promise.all([
      this.prisma.agentProfile.findMany({
        where: { businessId: auth.business.id, status: 'ACTIVE' },
        select: { id: true, user: { select: { displayName: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.$queryRaw<Record<string, unknown>[]>`${enriched},
        assignee AS (
          SELECT a."conversationId", a."agentProfileId",
                 row_number() OVER (PARTITION BY a."conversationId" ORDER BY a."assignedAt") AS first,
                 row_number() OVER (PARTITION BY a."conversationId" ORDER BY a."assignedAt" DESC) AS last
          FROM conversation_assignments a JOIN enriched e ON e.id = a."conversationId"
        )
        SELECT s."agentProfileId",
               count(DISTINCT s."conversationId")::int AS assigned,
               count(DISTINCT s."conversationId") FILTER (
                 WHERE s.last = 1 AND e."resolvedAt" IS NOT NULL)::int AS resolved,
               ${durationColumns(
                 'reply',
                 Prisma.sql`CASE WHEN s.first = 1 THEN extract(epoch FROM (e."repliedAt" - e."createdAt"))::float8 END`,
               )}
        FROM assignee s JOIN enriched e ON e.id = s."conversationId"
        GROUP BY s."agentProfileId"`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`${enriched}
        SELECT o."agentProfileId",
               count(*)::int AS offered,
               count(*) FILTER (WHERE o.outcome = 'ACCEPTED')::int AS accepted,
               count(*) FILTER (WHERE o.outcome = 'DECLINED')::int AS declined,
               count(*) FILTER (WHERE o.outcome = 'EXPIRED')::int AS expired
        FROM conversation_offers o JOIN enriched e ON e.id = o."conversationId"
        GROUP BY o."agentProfileId"`,
    ]);
    const workBy = new Map(work.map((row) => [row.agentProfileId as string, row]));
    const offersBy = new Map(offers.map((row) => [row.agentProfileId as string, row]));
    return profiles.map((profile) => {
      const row = workBy.get(profile.id) ?? {};
      const offer = offersBy.get(profile.id) ?? {};
      return {
        agentProfileId: profile.id,
        displayName: profile.user.displayName,
        assigned: Number(row.assigned ?? 0),
        resolved: Number(row.resolved ?? 0),
        firstResponse: duration(row, 'reply'),
        offers: {
          offered: Number(offer.offered ?? 0),
          accepted: Number(offer.accepted ?? 0),
          declined: Number(offer.declined ?? 0),
          expired: Number(offer.expired ?? 0),
        },
      };
    });
  }

  /**
   * `WITH cohort, enriched`: the tenant's conversations created in the local date range, with when
   * each was first assigned, first answered by a consultant (internal notes excluded), and whether it
   * was abandoned in the queue.
   */
  private enriched(businessId: string, query: AnalyticsQueryInput, timezone: string): Prisma.Sql {
    return Prisma.sql`
      WITH cohort AS (
        SELECT c.id, c."createdAt", c."resolvedAt", c."topicId", c."departmentId", c.source,
               c."followUpRequestedAt", c."overflowLevel"
        FROM conversations c
        WHERE c."businessId" = ${businessId}::uuid
          AND c."createdAt" >= ((${query.from}::date)::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC'
          AND c."createdAt" < ((${query.to}::date + 1)::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC'
          AND (${query.departmentId ?? null}::uuid IS NULL OR c."departmentId" = ${query.departmentId ?? null}::uuid)
          AND (${query.topicId ?? null}::uuid IS NULL OR c."topicId" = ${query.topicId ?? null}::uuid)
      ),
      enriched AS (
        SELECT c.*,
               (SELECT min(a."assignedAt") FROM conversation_assignments a
                 WHERE a."businessId" = ${businessId}::uuid AND a."conversationId" = c.id) AS "assignedAt",
               (SELECT min(m."createdAt") FROM messages m
                 WHERE m."businessId" = ${businessId}::uuid AND m."conversationId" = c.id
                   AND m."senderType" = 'AGENT' AND m."messageType" <> 'INTERNAL_NOTE') AS "repliedAt",
               EXISTS (SELECT 1 FROM conversation_events v
                 WHERE v."businessId" = ${businessId}::uuid AND v."conversationId" = c.id
                   AND v.type = 'CLOSED' AND v.metadata->>'reason' = 'VISITOR_LEFT_QUEUE') AS abandoned
        FROM cohort c
      )`;
  }

  private async breakdown(
    enriched: Prisma.Sql,
    table: Prisma.Sql,
    column: Prisma.Sql,
    unnamed: string,
  ): Promise<AnalyticsBreakdownRow[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string | null; name: string | null; conversations: number; medianWait: number | null }[]
    >`${enriched}
      SELECT e.${column} AS id, t.name, count(*)::int AS conversations,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ${WAIT}) AS "medianWait"
      FROM enriched e LEFT JOIN ${table} t ON t.id = e.${column}
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`;
    return rows.map((row) => ({
      id: row.id,
      name: row.name ?? unnamed,
      conversations: row.conversations,
      medianWaitSeconds: row.medianWait === null ? null : Math.round(row.medianWait),
    }));
  }
}
