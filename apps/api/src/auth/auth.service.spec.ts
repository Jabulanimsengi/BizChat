import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Environment } from '../config/environment';
import type { PrismaService } from '../database/prisma.service';
import type { MailerService } from '../mail/mailer.service';
import { AuthService } from './auth.service';

const SESSION_SECRET = 's'.repeat(48);

interface PrismaMock {
  user: { findUnique: jest.Mock; update: jest.Mock };
  session: { create: jest.Mock; updateMany: jest.Mock };
  passwordResetToken: {
    updateMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
  };
  emailVerificationToken: {
    updateMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
  };
  $transaction: jest.Mock;
}

function firstCallArg<T>(mock: jest.Mock): T {
  const calls = mock.mock.calls as unknown[][];
  return calls[0]?.[0] as T;
}

function buildService(): {
  service: AuthService;
  prisma: PrismaMock;
  mailer: { send: jest.Mock };
} {
  const prisma: PrismaMock = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    session: { create: jest.fn(), updateMany: jest.fn() },
    passwordResetToken: {
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    emailVerificationToken: {
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const mailer = { send: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        SESSION_SECRET,
        PASSWORD_RESET_TTL_MINUTES: 60,
        EMAIL_VERIFICATION_TTL_HOURS: 24,
        DASHBOARD_URL: 'https://app.bizchat.example',
        SESSION_TTL_HOURS: 168,
      };
      return values[key];
    }),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService<Environment, true>,
    mailer as unknown as MailerService,
  );
  return { service, prisma, mailer };
}

function tokenHashFor(token: string): string {
  return createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
}

describe('AuthService password reset', () => {
  it('issues a reset token and sends mail for an active user', async () => {
    const { service, prisma, mailer } = buildService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      status: 'ACTIVE',
    });

    await service.requestPasswordReset('owner@example.com');

    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    const created = firstCallArg<{ data: { userId: string; tokenHash: string } }>(
      prisma.passwordResetToken.create,
    );
    expect(created.data.userId).toBe('user-1');
    expect(created.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(firstCallArg<{ to: string }>(mailer.send).to).toBe('owner@example.com');
  });

  it('does not reveal whether an unknown email exists', async () => {
    const { service, prisma, mailer } = buildService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.requestPasswordReset('nobody@example.com')).resolves.toBeUndefined();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('rejects an expired or unknown reset token', async () => {
    const { service, prisma } = buildService();
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);

    await expect(service.resetPassword('a'.repeat(43), 'new-password-123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rotates the password, burns the token, and revokes sessions', async () => {
    const { service, prisma } = buildService();
    const token = 'b'.repeat(43);
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-1',
      userId: 'user-1',
      tokenHash: tokenHashFor(token),
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await service.resetPassword(token, 'new-password-123');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    const tokenUpdate = firstCallArg<{ where: { id: string }; data: { usedAt: Date } }>(
      prisma.passwordResetToken.update,
    );
    expect(tokenUpdate.where.id).toBe('reset-1');
    expect(tokenUpdate.data.usedAt).toBeInstanceOf(Date);
    const sessionRevoke = firstCallArg<{ where: { userId: string }; data: { revokedAt: Date } }>(
      prisma.session.updateMany,
    );
    expect(sessionRevoke.where).toEqual({ userId: 'user-1', revokedAt: null });
    expect(sessionRevoke.data.revokedAt).toBeInstanceOf(Date);
  });
});

describe('AuthService email verification', () => {
  it('skips users that are already verified', async () => {
    const { service, prisma, mailer } = buildService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      emailVerifiedAt: new Date(),
    });

    await service.sendVerificationEmail('user-1');

    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('marks the email verified for a valid token', async () => {
    const { service, prisma } = buildService();
    const token = 'c'.repeat(43);
    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 'verify-1',
      userId: 'user-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await service.verifyEmail(token);

    const update = firstCallArg<{ where: { id: string }; data: { emailVerifiedAt: Date } }>(
      prisma.user.update,
    );
    expect(update.where.id).toBe('user-1');
    expect(update.data.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid verification token', async () => {
    const { service, prisma } = buildService();
    prisma.emailVerificationToken.findUnique.mockResolvedValue(null);

    await expect(service.verifyEmail('d'.repeat(43))).rejects.toBeInstanceOf(BadRequestException);
  });
});
