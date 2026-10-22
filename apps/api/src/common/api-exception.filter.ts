import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { RequestWithId } from './http.types';

interface ErrorPayload {
  code?: string;
  message?: string | string[];
  details?: unknown;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const payload = typeof raw === 'object' && raw !== null ? (raw as ErrorPayload) : {};
    const rawMessage = payload.message;
    const message = Array.isArray(rawMessage)
      ? rawMessage.join(', ')
      : (rawMessage ?? (status === 500 ? 'An unexpected error occurred' : 'Request failed'));

    if (!(exception instanceof HttpException)) {
      this.logger.error({ requestId: request.requestId, exception });
    }

    response.status(status).json({
      error: {
        code: payload.code ?? `HTTP_${status}`,
        message,
        requestId: request.requestId,
        ...(payload.details === undefined ? {} : { details: payload.details }),
      },
    });
  }
}
