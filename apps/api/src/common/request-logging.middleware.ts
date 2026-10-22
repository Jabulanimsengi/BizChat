import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { RequestWithId } from './http.types';
import { MetricsService } from '../metrics/metrics.service';

const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const UNMATCHED_ROUTE = 'unmatched';

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  public constructor(private readonly metrics: MetricsService) {}

  public use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const route = routeLabel(request);
      this.metrics.recordRequest(
        methodLabel(request.method),
        route,
        response.statusCode,
        durationMs,
      );
      this.logger.log({
        requestId: (request as RequestWithId).requestId ?? request.header('x-request-id'),
        method: request.method,
        route,
        status: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  }
}

export function methodLabel(method: string): string {
  return KNOWN_METHODS.has(method) ? method : 'OTHER';
}

export function routeLabel(request: Request): string {
  const route = (request as unknown as { route?: { path?: unknown } }).route;
  if (route && typeof route.path === 'string') return `${request.baseUrl}${route.path}`;
  // Unmatched paths are attacker-controlled; collapse them to one bounded label so they cannot
  // grow the metrics series set without limit.
  return UNMATCHED_ROUTE;
}
