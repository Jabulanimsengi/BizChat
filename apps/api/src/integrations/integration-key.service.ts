import { PlanService } from '../plans/plan.service';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { IntegrationKey, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { AuthContext } from '../common/http.types';
import type { IntegrationPrincipal, KeyInput } from './integration.contracts';

export function hashIntegrationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
const keySelect = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
} as const;
export type KeyMetadata = Pick<IntegrationKey, keyof typeof keySelect>;

@Injectable()
export class IntegrationKeyService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanService,
  ) {}

  public list(businessId: string): Promise<KeyMetadata[]> {
    return this.prisma.integrationKey.findMany({
      where: { businessId },
      select: keySelect,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  public async create(
    auth: AuthContext,
    input: KeyInput,
  ): Promise<KeyMetadata & { token: string }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`integration-keys:${auth.business.id}`}, 0)) IS NULL AS acquired`;
      const count = await tx.integrationKey.count({
        where: { businessId: auth.business.id, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      await this.plans.assertWithin(auth.business.id, 'integrationKeys', tx);
      if (count >= 20)
        throw new ConflictException({
          code: 'KEY_LIMIT',
          message: 'Revoke an unused key before creating another',
        });
      return this.issue(tx, auth, input);
    });
  }

  public async revoke(auth: AuthContext, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.integrationKey.findFirst({
        where: { id, businessId: auth.business.id },
      });
      if (!row)
        throw new NotFoundException({
          code: 'KEY_NOT_FOUND',
          message: 'Integration key not found',
        });
      await tx.integrationKey.update({
        where: { id },
        data: { revokedAt: row.revokedAt ?? new Date() },
      });
      await this.audit(tx, auth, 'integration.key.revoked', id);
    });
  }

  public async rotate(auth: AuthContext, id: string): Promise<KeyMetadata & { token: string }> {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.integrationKey.updateMany({
        where: { id, businessId: auth.business.id, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });
      if (changed.count !== 1)
        throw new NotFoundException({
          code: 'KEY_NOT_FOUND',
          message: 'Active integration key not found',
        });
      const old = await tx.integrationKey.findUniqueOrThrow({ where: { id } });
      await this.audit(tx, auth, 'integration.key.rotated', id);
      return this.issue(
        tx,
        auth,
        {
          name: old.name,
          scopes: old.scopes as KeyInput['scopes'],
          expiresInDays: Math.max(
            1,
            Math.ceil((old.expiresAt.getTime() - Date.now()) / 86_400_000),
          ),
        },
        old.expiresAt,
      );
    });
  }

  public async authenticate(token: string | undefined): Promise<IntegrationPrincipal> {
    if (!token || !/^bzc_[A-Za-z0-9_-]{43}$/.test(token)) throw this.unauthorized();
    const row = await this.prisma.integrationKey.findUnique({
      where: { tokenHash: hashIntegrationToken(token) },
      include: { business: { select: { status: true } } },
    });
    if (
      !row ||
      row.revokedAt ||
      row.expiresAt <= new Date() ||
      !['ACTIVE', 'TRIAL'].includes(row.business.status)
    )
      throw this.unauthorized();
    await this.prisma.integrationKey.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });
    return { keyId: row.id, businessId: row.businessId, scopes: row.scopes };
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INTEGRATION_AUTH_REQUIRED',
      message: 'A valid integration bearer token is required',
    });
  }

  private async issue(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    input: KeyInput,
    expiresAt?: Date,
  ): Promise<KeyMetadata & { token: string }> {
    const token = `bzc_${randomBytes(32).toString('base64url')}`;
    const row = await tx.integrationKey.create({
      data: {
        businessId: auth.business.id,
        name: input.name,
        scopes: input.scopes,
        tokenHash: hashIntegrationToken(token),
        prefix: token.slice(0, 12),
        expiresAt: expiresAt ?? new Date(Date.now() + input.expiresInDays * 86_400_000),
      },
      select: keySelect,
    });
    await this.audit(tx, auth, 'integration.key.created', row.id);
    return { ...row, token };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    action: string,
    targetId: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        businessId: auth.business.id,
        actorUserId: auth.user.id,
        action,
        targetType: 'IntegrationKey',
        targetId,
      },
    });
  }
}
