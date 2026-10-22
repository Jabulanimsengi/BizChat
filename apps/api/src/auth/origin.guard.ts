import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Environment } from '../config/environment';

@Injectable()
export class OriginGuard implements CanActivate {
  private readonly origins: Set<string>;

  public constructor(config: ConfigService<Environment, true>) {
    this.origins = new Set([
      config.get('DASHBOARD_URL', { infer: true }),
      ...config
        .get('ALLOWED_DEV_ORIGINS', { infer: true })
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ]);
  }

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.header('origin');
    if (origin && !this.origins.has(origin)) {
      throw new ForbiddenException({
        code: 'UNTRUSTED_ORIGIN',
        message: 'Request origin is not allowed',
      });
    }
    return true;
  }
}
