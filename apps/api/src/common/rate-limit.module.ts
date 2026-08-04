import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { RateLimitGuard } from './rate-limit.guard';
import { DEFAULT_SUBMISSIONS_PER_MIN, RATE_LIMIT_WINDOW_MS } from './rate-limit.config';

/**
 * `@Global()` (mirrors PrismaModule) so `RateLimitGuard` is injectable from
 * any feature module's controllers via `@UseGuards(RateLimitGuard)` without
 * each module having to import this one directly.
 *
 * The single 'default' named throttler registered here is only a module-load
 * time placeholder required by `ThrottlerModule.forRoot()` — every route
 * that actually uses `RateLimitGuard` overrides its limit/ttl per-request via
 * `@Throttle({ default: { limit: envLimit(...), ttl: RATE_LIMIT_WINDOW_MS } })`
 * (see rate-limit.config.ts). `@nestjs/throttler` scopes each throttler's
 * bucket by controller class + handler name, so distinct routes sharing the
 * 'default' name never share a counter.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'default', ttl: RATE_LIMIT_WINDOW_MS, limit: DEFAULT_SUBMISSIONS_PER_MIN },
    ]),
  ],
  providers: [RateLimitGuard],
  exports: [RateLimitGuard],
})
export class RateLimitModule {}
