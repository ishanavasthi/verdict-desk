/**
 * Per-user rate limiting for the write endpoints that trigger expensive work
 * (the grading sandbox for POST /submissions, the LLM draft pipeline for
 * POST /doubts) or are a brute-force target (POST /auth/login).
 *
 * Defaults are deliberately GENEROUS: chosen so the M1 abuse-demo script
 * (~7 submissions from one student over 1-2 minutes) and normal interactive
 * use never trip the limit, while still bounding a scripted burst. All three
 * are overridable via env so an operator can tighten (or loosen) them
 * without a code change.
 */

/** Fixed-size sliding window used by every named throttler below. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

export const DEFAULT_SUBMISSIONS_PER_MIN = 30;
export const DEFAULT_DOUBTS_PER_MIN = 30;
export const DEFAULT_LOGIN_PER_MIN = 10;

export const RATE_LIMIT_SUBMISSIONS_ENV = 'RATE_LIMIT_SUBMISSIONS_PER_MIN';
export const RATE_LIMIT_DOUBTS_ENV = 'RATE_LIMIT_DOUBTS_PER_MIN';
export const RATE_LIMIT_LOGIN_ENV = 'RATE_LIMIT_LOGIN_PER_MIN';

/**
 * Returns a `Resolvable<number>` for `@nestjs/throttler`'s `@Throttle()`
 * decorator: a zero-arg function re-evaluated on EVERY request (not once at
 * class-load time). This matters because `.env` is loaded by `ConfigModule`
 * during Nest bootstrap, which happens AFTER controller files are first
 * `require`d — so reading `process.env` eagerly at decoration time would
 * miss `.env`-file-set values. By request time, bootstrap has long finished.
 */
export function envLimit(envVar: string, fallback: number): () => number {
  return () => {
    const raw = process.env[envVar];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
}
