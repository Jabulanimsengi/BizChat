import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type { Environment } from '../config/environment';
import { MailerService } from './mailer.service';

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

const createTransport = nodemailer.createTransport as unknown as jest.Mock;

function buildService(env: Record<string, unknown>): MailerService {
  const config = {
    get: jest.fn((key: string) => env[key]),
  };
  return new MailerService(config as unknown as ConfigService<Environment, true>);
}

const message = { to: 'user@example.com', subject: 'Hi', text: 'body', html: '<p>body</p>' };

describe('MailerService', () => {
  beforeEach(() => createTransport.mockReset());

  it('logs instead of sending when SMTP is not configured', async () => {
    const service = buildService({ SMTP_FROM: 'BizChat <no-reply@example.com>' });

    expect(service.enabled).toBe(false);
    await expect(service.send(message)).resolves.toBeUndefined();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends through the configured SMTP transport', async () => {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    createTransport.mockReturnValue({ sendMail });
    const service = buildService({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_FROM: 'BizChat <no-reply@example.com>',
    });

    await service.send(message);

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'BizChat <no-reply@example.com>',
      ...message,
    });
  });

  it('surfaces a service error when delivery fails', async () => {
    createTransport.mockReturnValue({
      sendMail: jest.fn().mockRejectedValue(new Error('smtp down')),
    });
    const service = buildService({ SMTP_HOST: 'smtp.example.com' });

    await expect(service.send(message)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
