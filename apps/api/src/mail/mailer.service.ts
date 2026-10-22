import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Environment } from '../config/environment';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter?: Transporter;
  private readonly from: string;

  public constructor(private readonly config: ConfigService<Environment, true>) {
    this.from = config.get('SMTP_FROM', { infer: true });
    const host = config.get('SMTP_HOST', { infer: true });
    if (host) {
      const user = config.get('SMTP_USER', { infer: true });
      const password = config.get('SMTP_PASSWORD', { infer: true });
      this.transporter = nodemailer.createTransport({
        host,
        port: config.get('SMTP_PORT', { infer: true }),
        secure: config.get('SMTP_SECURE', { infer: true }),
        ...(user ? { auth: { user, pass: password } } : {}),
      });
    } else {
      this.logger.warn('SMTP is not configured; outbound email will be logged instead of sent');
    }
  }

  public get enabled(): boolean {
    return Boolean(this.transporter);
  }

  public async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `[mail:console] to=${message.to} subject="${message.subject}"\n${message.text}`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, ...message });
    } catch (error) {
      this.logger.error(
        `Failed to deliver email to ${message.to}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw new ServiceUnavailableException({
        code: 'EMAIL_UNAVAILABLE',
        message: 'Email delivery is temporarily unavailable. Please try again shortly.',
      });
    }
  }
}
