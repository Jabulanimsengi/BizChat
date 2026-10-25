import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthContext, AuthenticatedRequest } from '../common/http.types';
import type { Environment } from '../config/environment';

/** Whether a signed-in account administers the platform: a verified email on the allowlist. */
export function isPlatformAdmin(auth: AuthContext, allowlist: string[]): boolean {
  return auth.user.emailVerified && allowlist.includes(auth.user.email.toLowerCase());
}

/** Runs after SessionAuthGuard. Platform administration spans tenants, so it is never role-based. */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  private readonly allowlist: string[];

  public constructor(config: ConfigService<Environment, true>) {
    this.allowlist = config.get('PLATFORM_ADMIN_EMAILS', { infer: true });
  }

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!isPlatformAdmin(request.auth, this.allowlist))
      throw new ForbiddenException({
        code: 'PLATFORM_ADMIN_REQUIRED',
        message: 'Platform administration is not available to this account',
      });
    return true;
  }
}
