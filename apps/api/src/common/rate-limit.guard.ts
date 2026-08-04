import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

/**
 * Keys the throttle bucket by the AUTHENTICATED user id (`req.user.id`, set
 * by `JwtAuthGuard`) when present, else falls back to the client IP.
 *
 * Always list this guard AFTER `JwtAuthGuard` in `@UseGuards(...)` (Nest
 * runs controller-level guards before method-level ones, and evaluates
 * method-level guards left-to-right) so `req.user` is populated first — an
 * authenticated user's limit then follows them across IPs/devices. Routes
 * with no auth guard (e.g. POST /auth/login) simply never see `req.user`,
 * so those fall back to per-IP tracking, which is exactly what's wanted for
 * bounding login brute force.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    return request.user?.id ?? request.ip ?? 'unknown';
  }
}
