import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { hash, verify } from 'argon2';
import { createHmac, randomBytes } from 'node:crypto';
import type { LoginInput, RegisterInput } from '@bizchat/validation';
import type { Environment } from '../config/environment';
import { PrismaService } from '../database/prisma.service';
import { escapeHtml, MailerService, type MailMessage } from '../mail/mailer.service';

interface ClientMetadata {
  ipAddress?: string;
  userAgent?: string;
}
interface SessionResult {
  token: string;
  expiresAt: Date;
}

type TokenPurpose = 'password-reset' | 'email-verify';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    private readonly mailer: MailerService,
  ) {}

  public async register(input: RegisterInput, metadata: ClientMetadata): Promise<SessionResult> {
    const passwordHash = await hash(input.password, { type: 2 });
    const suffix = randomBytes(4).toString('hex');
    const baseSlug =
      input.businessName
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'business';
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const business = await transaction.business.create({
          data: {
            name: input.businessName,
            slug: `${baseSlug}-${suffix}`,
            publicId: `pub_${randomBytes(18).toString('base64url')}`,
            timezone: input.timezone,
          },
        });
        const user = await transaction.user.create({
          data: { email: input.email, displayName: input.displayName, passwordHash },
        });
        const membership = await transaction.businessMembership.create({
          data: { businessId: business.id, userId: user.id, role: 'OWNER' },
        });
        const profile = await transaction.agentProfile.create({
          data: { businessId: business.id, userId: user.id, membershipId: membership.id },
        });
        await transaction.department.create({
          data: {
            businessId: business.id,
            publicId: `dept_${randomBytes(18).toString('base64url')}`,
            name: 'General Support',
            description: 'General customer enquiries',
            isDefault: true,
            agents: { create: { businessId: business.id, agentProfileId: profile.id } },
          },
        });
        await transaction.widgetSettings.create({ data: { businessId: business.id } });
        await transaction.routingSettings.create({
          data: {
            businessId: business.id,
            assignmentMode: this.config.get('NEW_TENANT_ASSIGNMENT_MODE', { infer: true }),
          },
        });
        return { business, user, membership };
      });
      await this.sendVerificationEmail(created.user.id).catch((error: unknown) => {
        this.logger.error(
          `Verification email failed for user ${created.user.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
      return this.createSession(created.user.id, created.membership.id, metadata);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'ACCOUNT_EXISTS',
          message: 'An account with this email already exists',
        });
      }
      throw error;
    }
  }

  public async login(input: LoginInput, metadata: ClientMetadata): Promise<SessionResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: { business: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user || !(await verify(user.passwordHash, input.password)) || user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }
    const membership = user.memberships.find((item) =>
      ['ACTIVE', 'TRIAL'].includes(item.business.status),
    );
    if (!membership)
      throw new UnauthorizedException({
        code: 'TENANT_UNAVAILABLE',
        message: 'No active business is available',
      });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.createSession(user.id, membership.id, metadata);
  }

  public async logout(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  public async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;
    const { token, tokenHash } = this.generateToken('password-reset');
    const expiresAt = new Date(
      Date.now() + this.config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true }) * 60_000,
    );
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } }),
    ]);
    await this.mailer.send(this.passwordResetEmail(user, token)).catch((error: unknown) => {
      this.logger.error(
        `Password reset email failed for user ${user.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    });
  }

  public async resetPassword(token: string, password: string): Promise<void> {
    const tokenHash = this.hashToken('password-reset', token);
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException({
        code: 'INVALID_RESET_TOKEN',
        message: 'This password reset link is invalid or has expired',
      });
    }
    const passwordHash = await hash(password, { type: 2 });
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, passwordChangedAt: now },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      }),
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }

  public async sendVerificationEmail(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.emailVerifiedAt) return;
    const { token, tokenHash } = this.generateToken('email-verify');
    const expiresAt = new Date(
      Date.now() +
        this.config.get('EMAIL_VERIFICATION_TTL_HOURS', { infer: true }) * 60 * 60 * 1000,
    );
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      }),
    ]);
    await this.mailer.send(this.verificationEmail(user, token));
  }

  public async verifyEmail(token: string): Promise<void> {
    const tokenHash = this.hashToken('email-verify', token);
    const record = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException({
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'This verification link is invalid or has expired',
      });
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: now },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: now },
      }),
    ]);
  }

  private passwordResetEmail(
    user: { email: string; displayName: string },
    token: string,
  ): MailMessage {
    const minutes = this.config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true });
    const link = `${this.config.get('DASHBOARD_URL', { infer: true })}/reset-password?token=${encodeURIComponent(token)}`;
    return {
      to: user.email,
      subject: 'Reset your BizChat password',
      text: `Hello ${user.displayName},\n\nUse this link to reset your BizChat password. It expires in ${minutes} minutes:\n${link}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Hello ${escapeHtml(user.displayName)},</p><p>Use the link below to reset your BizChat password. It expires in ${minutes} minutes.</p><p><a href="${escapeHtml(link)}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    };
  }

  private verificationEmail(
    user: { email: string; displayName: string },
    token: string,
  ): MailMessage {
    const link = `${this.config.get('DASHBOARD_URL', { infer: true })}/verify-email?token=${encodeURIComponent(token)}`;
    return {
      to: user.email,
      subject: 'Verify your BizChat email',
      text: `Hello ${user.displayName},\n\nConfirm your email address to secure your BizChat account:\n${link}`,
      html: `<p>Hello ${escapeHtml(user.displayName)},</p><p>Confirm your email address to secure your BizChat account.</p><p><a href="${escapeHtml(link)}">Verify email</a></p>`,
    };
  }

  private generateToken(purpose: TokenPurpose): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hashToken(purpose, token) };
  }

  private hashToken(purpose: TokenPurpose, token: string): string {
    return createHmac('sha256', this.config.get('SESSION_SECRET', { infer: true }))
      .update(`${purpose}:${token}`)
      .digest('hex');
  }

  private async createSession(
    userId: string,
    membershipId: string,
    metadata: ClientMetadata,
  ): Promise<SessionResult> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHmac('sha256', this.config.get('SESSION_SECRET', { infer: true }))
      .update(token)
      .digest('hex');
    const expiresAt = new Date(
      Date.now() + this.config.get('SESSION_TTL_HOURS', { infer: true }) * 60 * 60 * 1000,
    );
    await this.prisma.session.create({
      data: {
        tokenHash,
        userId,
        membershipId,
        expiresAt,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent?.slice(0, 512),
      },
    });
    return { token, expiresAt };
  }
}
