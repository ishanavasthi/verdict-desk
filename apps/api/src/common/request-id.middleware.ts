import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Attaches a uuid to every request (honoring an inbound X-Request-Id if present)
 * and echoes it back on the response. The id is stashed on `req.requestId` so the
 * exception filter and logger can pick it up.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() || randomUUID();
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}

export function getRequestId(req: Request | undefined): string {
  return (req as (Request & { requestId?: string }) | undefined)?.requestId ?? 'unknown';
}
