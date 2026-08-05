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
 * The ONLY message ever sent to a client for an exception we didn't raise
 * deliberately. Anything else — a Prisma error, a TypeError, a driver failure —
 * carries internals a client must never see: absolute source paths, code
 * frames, SQL/constraint names, sometimes row values. Those go to the log
 * (with the requestId, so a report of "500 on req X" is still diagnosable)
 * and never into the response body.
 */
const OPAQUE_INTERNAL_MESSAGE = 'Internal server error';

/**
 * Prisma error codes that describe a bad REQUEST rather than a broken server,
 * mapped to the status the client should have gotten in the first place. These
 * reach the filter when an id from the URL/body is well-formed enough to pass
 * class-validator but wrong at the database level:
 *   P2023 — malformed value for the column type (e.g. a non-UUID `:id`).
 *   P2003 — foreign-key violation (e.g. a problemId that doesn't exist).
 *   P2025 — the record a write depended on is missing.
 * The client still gets a fixed, generic message per status: the code tells us
 * the *class* of mistake, never that it's safe to echo Prisma's own text.
 */
const PRISMA_REQUEST_ERRORS: Record<string, { status: number; message: string }> = {
  P2023: { status: HttpStatus.BAD_REQUEST, message: 'malformed identifier in request' },
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'referenced record does not exist' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'record not found' },
};

/**
 * Global exception filter that renders a uniform error envelope:
 *   { "error": { "message": string, "code": string, "requestId": string } }
 *
 * Deliberately raised `HttpException`s keep their status AND their message —
 * those strings are written by us for the client. Everything else is reported
 * as an opaque 500 (or a mapped 4xx for the known bad-request Prisma codes),
 * with the real detail logged server-side only. See OPAQUE_INTERNAL_MESSAGE.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = getRequestId(request);

    const { status, message, code, logDetail } = this.normalize(exception);

    // Log the FULL detail (never the client-facing message when they differ),
    // so redacting the response costs nothing diagnostically.
    this.logger.error(
      `[${requestId}] ${request?.method ?? '?'} ${request?.url ?? '?'} -> ${status} ${code}: ${logDetail ?? message}`,
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
    /** Full internal detail for the log when it differs from the client message. */
    logDetail?: string;
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

    const internalDetail =
      exception instanceof Error ? exception.message : String(exception);

    // Duck-typed rather than importing Prisma's error classes (same approach as
    // doubts/db-conflict.ts) so this stays trivially unit-testable.
    const prismaCode =
      exception && typeof exception === 'object'
        ? (exception as { code?: unknown }).code
        : undefined;
    if (typeof prismaCode === 'string') {
      const mapped = PRISMA_REQUEST_ERRORS[prismaCode];
      if (mapped) {
        return {
          status: mapped.status,
          message: mapped.message,
          code: this.codeFor(mapped.status),
          logDetail: `${prismaCode}: ${internalDetail}`,
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: OPAQUE_INTERNAL_MESSAGE,
      code: 'INTERNAL_SERVER_ERROR',
      logDetail: internalDetail,
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
