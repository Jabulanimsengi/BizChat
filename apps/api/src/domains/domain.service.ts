import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type BusinessDomain } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import type { BusinessDomainResponse } from '@bizchat/types';
import type { CreateDomainInput, UpdateDomainStatusInput } from '@bizchat/validation';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { isLocalhost, normalizeDomain } from './domain-normalization';

@Injectable()
export class DomainService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  public async list(businessId: string): Promise<BusinessDomainResponse[]> {
    const domains = await this.prisma.businessDomain.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
    });
    return domains.map((domain) => this.serialize(domain));
  }

  public async create(
    auth: AuthContext,
    input: CreateDomainInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<BusinessDomainResponse> {
    const domainName = normalizeDomain(input.domain, this.isDevelopment());
    const challenge = this.createChallenge();
    try {
      const domain = await this.prisma.businessDomain.create({
        data: {
          businessId: auth.business.id,
          domain: domainName,
          verificationTokenHash: this.hashChallenge(challenge),
        },
      });
      await this.audit.record({
        businessId: auth.business.id,
        actorUserId: auth.user.id,
        action: 'domain.created',
        targetType: 'BusinessDomain',
        targetId: domain.id,
        requestId,
        ipAddress,
        metadata: { domain: domainName },
      });
      return this.serialize(domain, challenge);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'DOMAIN_ALREADY_REGISTERED',
          message: 'This domain is already registered',
        });
      }
      throw error;
    }
  }

  public async regenerateChallenge(auth: AuthContext, id: string): Promise<BusinessDomainResponse> {
    const existing = await this.findOwned(auth.business.id, id);
    if (existing.status === 'VERIFIED')
      throw new ConflictException({
        code: 'DOMAIN_ALREADY_VERIFIED',
        message: 'This domain is already verified',
      });
    const challenge = this.createChallenge();
    const domain = await this.prisma.businessDomain.update({
      where: { id: existing.id },
      data: {
        verificationTokenHash: this.hashChallenge(challenge),
        status: 'PENDING',
        verifiedAt: null,
      },
    });
    return this.serialize(domain, challenge);
  }

  public async verify(
    auth: AuthContext,
    id: string,
    requestId: string,
    ipAddress?: string,
  ): Promise<BusinessDomainResponse> {
    const existing = await this.findOwned(auth.business.id, id);
    if (existing.status === 'VERIFIED') return this.serialize(existing);
    let verified = this.isDevelopment() && isLocalhost(existing.domain);
    if (!verified) {
      try {
        const records = await resolveTxt(`_bizchat-verification.${existing.domain}`);
        verified = records.some(
          (segments) => this.hashChallenge(segments.join('')) === existing.verificationTokenHash,
        );
      } catch {
        verified = false;
      }
    }
    if (!verified)
      throw new ConflictException({
        code: 'DOMAIN_VERIFICATION_FAILED',
        message: 'The expected DNS TXT record was not found',
      });
    const domain = await this.prisma.businessDomain.update({
      where: { id: existing.id },
      data: { status: 'VERIFIED', verifiedAt: new Date() },
    });
    await this.audit.record({
      businessId: auth.business.id,
      actorUserId: auth.user.id,
      action: 'domain.verified',
      targetType: 'BusinessDomain',
      targetId: domain.id,
      requestId,
      ipAddress,
      metadata: { domain: domain.domain },
    });
    return this.serialize(domain);
  }

  public async updateStatus(
    auth: AuthContext,
    id: string,
    input: UpdateDomainStatusInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<BusinessDomainResponse> {
    const existing = await this.findOwned(auth.business.id, id);
    const domain = await this.prisma.businessDomain.update({
      where: { id: existing.id },
      data: { status: input.status, verifiedAt: null },
    });
    await this.audit.record({
      businessId: auth.business.id,
      actorUserId: auth.user.id,
      action: 'domain.status_changed',
      targetType: 'BusinessDomain',
      targetId: domain.id,
      requestId,
      ipAddress,
      metadata: { domain: domain.domain, status: input.status },
    });
    return this.serialize(domain);
  }

  private async findOwned(businessId: string, id: string): Promise<BusinessDomain> {
    const domain = await this.prisma.businessDomain.findFirst({ where: { id, businessId } });
    if (!domain)
      throw new NotFoundException({ code: 'DOMAIN_NOT_FOUND', message: 'Domain not found' });
    return domain;
  }

  private serialize(domain: BusinessDomain, challenge?: string): BusinessDomainResponse {
    return {
      id: domain.id,
      domain: domain.domain,
      status: domain.status,
      verifiedAt: domain.verifiedAt?.toISOString() ?? null,
      createdAt: domain.createdAt.toISOString(),
      ...(challenge
        ? {
            verification: {
              recordName: `_bizchat-verification.${domain.domain}`,
              recordType: 'TXT' as const,
              recordValue: challenge,
            },
          }
        : {}),
    };
  }

  private createChallenge(): string {
    return `bizchat-verify=${randomBytes(24).toString('base64url')}`;
  }
  private hashChallenge(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
  private isDevelopment(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) !== 'production';
  }
}
