import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { RequestWithId } from './http.types';

export function requestIdMiddleware(
  request: RequestWithId,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.header('x-request-id');
  request.requestId = incoming && incoming.length <= 100 ? incoming : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
