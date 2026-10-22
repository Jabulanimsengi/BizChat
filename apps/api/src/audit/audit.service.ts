import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import type { AuditLogPage } from '@bizchat/types';
import type { AuditLogQuery } from '@bizchat/validation';
import { PrismaService } from '../database/prisma.service';

export interface AuditInput {
  businessId: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  ipAddress?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  public constructor(private readonly prisma: PrismaService) {}

  public async record(input: AuditInput): Promise<void> {
    await this.prisma.auditLog.create({ data: input });
  }

  public async list(businessId: string, query: AuditLogQuery): Promise<AuditLogPage> {
    let cursorCreatedAt: Date | undefined;
    if (query.cursor) {
      const cursor = await this.prisma.auditLog.findFirst({
        where: { id: query.cursor, businessId },
        select: { createdAt: true },
      });
      if (!cursor)
        throw new NotFoundException({
          code: 'AUDIT_CURSOR_NOT_FOUND',
          message: 'Audit cursor not found',
        });
      cursorCreatedAt = cursor.createdAt;
    }
    const logs = await this.prisma.auditLog.findMany({
      where: {
        businessId,
        ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
        ...(query.cursor && cursorCreatedAt
          ? {
              OR: [
                { createdAt: { lt: cursorCreatedAt } },
                { createdAt: cursorCreatedAt, id: { lt: query.cursor } },
              ],
            }
          : {}),
      },
      include: { actor: { select: { id: true, displayName: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = logs.length > query.limit;
    const page = logs.slice(0, query.limit);
    return {
      logs: page.map((log) => ({
        id: log.id,
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        actor: log.actor,
        requestId: log.requestId,
        ipAddress: log.ipAddress,
        metadata: log.metadata,
        createdAt: log.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }
}
