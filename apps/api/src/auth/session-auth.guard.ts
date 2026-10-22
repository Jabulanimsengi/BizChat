import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/http.types';
import { SessionAuthenticationService } from './session-authentication.service';

export const SESSION_COOKIE = 'bizchat_session';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  public constructor(private readonly sessions: SessionAuthenticationService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (request.cookies as Record<string, string | undefined> | undefined)?.[
      SESSION_COOKIE
    ];
    request.auth = await this.sessions.authenticate(token);
    return true;
  }
}
