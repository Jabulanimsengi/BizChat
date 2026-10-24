import { Injectable, Module, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import type { IntegrationPrincipal } from './integration.contracts';

const proofSchema = z
  .object({
    businessId: z.string().uuid(),
    visitorId: z.string().uuid(),
    keyId: z.string().uuid(),
    expiresAt: z.number().int(),
  })
  .strict();
@Injectable()
export class CustomerIdentityService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  public async customer(
    tx: Prisma.TransactionClient,
    businessId: string,
    externalId: string,
  ): Promise<string> {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customer:${businessId}:${externalId}`}, 0)) IS NULL AS acquired`;
    const existing = await tx.integrationCustomer.findUnique({
      where: { businessId_externalId: { businessId, externalId } },
    });
    if (existing) return existing.visitorId;
    const visitor = await tx.visitor.create({
      data: { businessId, anonymousIdentifier: `int_${randomBytes(24).toString('hex')}` },
    });
    await tx.integrationCustomer.create({
      data: { businessId, externalId, visitorId: visitor.id },
    });
    return visitor.id;
  }

  public async issue(
    principal: IntegrationPrincipal,
    input: { externalId: string; name?: string; email?: string },
  ): Promise<{ identityToken: string; expiresAt: string }> {
    const visitorId = await this.prisma.$transaction(async (tx) => {
      const id = await this.customer(tx, principal.businessId, input.externalId);
      // The latest claims win; omitted claims leave stored values unchanged.
      if (input.name !== undefined || input.email !== undefined)
        await tx.integrationCustomer.update({
          where: { visitorId: id },
          data: {
            ...(input.name !== undefined ? { displayName: input.name } : {}),
            ...(input.email !== undefined ? { email: input.email } : {}),
          },
        });
      return id;
    });
    const expiresAt = Date.now() + 300_000;
    const payload = Buffer.from(
      JSON.stringify({
        businessId: principal.businessId,
        visitorId,
        keyId: principal.keyId,
        expiresAt,
      }),
    ).toString('base64url');
    return {
      identityToken: `${payload}.${this.sign(payload)}`,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  public async verify(
    token: string,
    businessId: string,
  ): Promise<{ visitorId: string; expiresAt: Date }> {
    const [payload, signature, extra] = token.split('.');
    const expected = Buffer.from(this.sign(payload ?? ''));
    const supplied = Buffer.from(signature ?? '');
    if (
      !payload ||
      extra ||
      supplied.length !== expected.length ||
      !timingSafeEqual(expected, supplied)
    )
      throw this.invalid();
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      throw this.invalid();
    }
    const parsed = proofSchema.safeParse(decoded);
    if (
      !parsed.success ||
      parsed.data.businessId !== businessId ||
      parsed.data.expiresAt <= Date.now() ||
      parsed.data.expiresAt > Date.now() + 301_000
    )
      throw this.invalid();
    const key = await this.prisma.integrationKey.findFirst({
      where: {
        id: parsed.data.keyId,
        businessId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        scopes: { has: 'customers:identify' },
      },
    });
    if (!key) throw this.invalid();
    return { visitorId: parsed.data.visitorId, expiresAt: new Date(parsed.data.expiresAt) };
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.config.get('WIDGET_TOKEN_SECRET', { infer: true }))
      .update(`bizchat.customer.v1.${payload}`)
      .digest('base64url');
  }
  private invalid(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'IDENTITY_INVALID',
      message: 'Customer identity proof is invalid or expired',
    });
  }
}
@Module({ providers: [CustomerIdentityService], exports: [CustomerIdentityService] })
export class CustomerIdentityModule {}
