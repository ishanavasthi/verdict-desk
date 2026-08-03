import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { getRequestId } from './request-id.middleware';

export interface ErrorEnvelope {
  error: {
    message: string;
    code: string;
    requestId: string;
  };
}

/**
 * Global exception filter that renders a uniform error envelope:
 *   { "error": { "message": string, "code": string, "requestId": string } }
 * The original HTTP status is preserved.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = getRequestId(request);

    const { status, message, code } = this.normalize(exception);

    this.logger.error(
      `[${requestId}] ${request?.method ?? '?'} ${request?.url ?? '?'} -> ${status} ${code}: ${message}`,
    );

    const body: ErrorEnvelope = {
      error: { message, code, requestId },
    };

    response.status(status).json(body);
  }

  private normalize(exception: unknown): {
    status: number;
    message: string;
    code: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      let message = exception.message;
      if (typeof res === 'object' && res !== null) {
        const r = res as Record<string, unknown>;
        if (typeof r.message === 'string') {
          message = r.message;
        } else if (Array.isArray(r.message)) {
          message = r.message.join(', ');
        }
      } else if (typeof res === 'string') {
        message = res;
      }
      return { status, message, code: this.codeFor(status) };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message:
        exception instanceof Error ? exception.message : 'Internal server error',
      code: 'INTERNAL_SERVER_ERROR',
    };
  }

  private codeFor(status: number): string {
    return (
      HttpStatus[status] !== undefined
        ? String(HttpStatus[status])
        : `HTTP_${status}`
    );
  }
}
