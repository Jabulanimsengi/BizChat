import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { AuthContext } from '../common/http.types';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class SessionAuthenticationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  public async authenticate(token: string | undefined): Promise<AuthContext> {
    if (!token)
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
      });
    const tokenHash = createHmac('sha256', this.config.get('SESSION_SECRET', { infer: true }))
      .update(token)
      .digest('hex');
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true, membership: { include: { business: true } } },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.status !== 'ACTIVE' ||
      session.membership.status !== 'ACTIVE' ||
      !['ACTIVE', 'TRIAL'].includes(session.membership.business.status)
    ) {
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        message: 'Session is invalid or expired',
      });
    }
    return {
      sessionId: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
        status: session.user.status,
        emailVerified: session.user.emailVerifiedAt !== null,
      },
      membership: {
        id: session.membership.id,
        role: session.membership.role,
        status: session.membership.status,
      },
      business: {
        id: session.membership.business.id,
        name: session.membership.business.name,
        slug: session.membership.business.slug,
        publicId: session.membership.business.publicId,
        status: session.membership.business.status,
        timezone: session.membership.business.timezone,
        defaultLocale: session.membership.business.defaultLocale,
      },
    };
  }
}
