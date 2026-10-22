import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RedisService } from '../realtime/redis.service';
import { IntegrationKeyService } from './integration-key.service';
import type { IntegrationPrincipal, IntegrationScope } from './integration.contracts';

export interface IntegrationRequest extends Request {
  integration: IntegrationPrincipal;
}
export const IntegrationScopeRequired = (scope: IntegrationScope): ReturnType<typeof SetMetadata> =>
  SetMetadata('integrationScope', scope);
const LIMIT_SCRIPT = `
local a = redis.call('INCR', KEYS[1])
if a == 1 then redis.call('PEXPIRE', KEYS[1], 60000) end
local b = redis.call('INCR', KEYS[2])
if b == 1 then redis.call('PEXPIRE', KEYS[2], 60000) end
return {a, b, math.max(redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2]))}
`;

@Injectable()
export class IntegrationGuard implements CanActivate {
  public constructor(
    private readonly keys: IntegrationKeyService,
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IntegrationRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    const principal = await this.keys.authenticate(
      request.header('authorization')?.match(/^Bearer (\S+)$/i)?.[1],
    );
    const scope = this.reflector.getAllAndOverride<IntegrationScope>('integrationScope', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scope || !principal.scopes.includes(scope))
      throw new ForbiddenException({
        code: 'INTEGRATION_SCOPE_REQUIRED',
        message: `Required scope: ${scope ?? 'none'}`,
      });
    let result: number[];
    try {
      result = (await this.redis.eval(
        LIMIT_SCRIPT,
        2,
        `integration:{${principal.businessId}}:key:${principal.keyId}`,
        `integration:{${principal.businessId}}:tenant`,
      )) as number[];
    } catch {
      throw new ServiceUnavailableException({
        code: 'INTEGRATION_RATE_LIMIT_UNAVAILABLE',
        message: 'Please retry later',
      });
    }
    response.setHeader('X-RateLimit-Limit', '120');
    response.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, Math.min(120 - result[0]!, 600 - result[1]!))),
    );
    if (result[0]! > 120 || result[1]! > 600) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil(result[2]! / 1000))));
      throw new HttpException(
        { code: 'INTEGRATION_RATE_LIMITED', message: 'Integration request quota exceeded' },
        429,
      );
    }
    request.integration = principal;
    return true;
  }
}
