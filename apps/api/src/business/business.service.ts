import { Injectable, NotFoundException } from '@nestjs/common';
import type { UpdateBusinessInput } from '@bizchat/validation';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';

export interface BusinessResponse {
  id: string;
  name: string;
  slug: string;
  publicId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'TRIAL';
  timezone: string;
  defaultLocale: string;
}

@Injectable()
export class BusinessService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  public async update(
    auth: AuthContext,
    input: UpdateBusinessInput,
    requestId: string,
    ipAddress?: string,
  ): Promise<BusinessResponse> {
    const result = await this.prisma.business.updateMany({
      where: { id: auth.business.id },
      data: input,
    });
    if (result.count !== 1)
      throw new NotFoundException({ code: 'BUSINESS_NOT_FOUND', message: 'Business not found' });
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.business.id },
    });
    await this.audit.record({
      businessId: auth.business.id,
      actorUserId: auth.user.id,
      action: 'business.updated',
      targetType: 'Business',
      targetId: business.id,
      requestId,
      ipAddress,
      metadata: input,
    });
    return {
      id: business.id,
      name: business.name,
      slug: business.slug,
      publicId: business.publicId,
      status: business.status,
      timezone: business.timezone,
      defaultLocale: business.defaultLocale,
    };
  }
}
