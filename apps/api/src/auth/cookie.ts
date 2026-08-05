import { CookieOptions } from 'express';

/** Name of the httpOnly cookie carrying the signed JWT — part of the SHARED CONTRACT with the web slice. */
export const AUTH_COOKIE_NAME = 'verdict_token';

/** ~7 days, matching the JWT's own expiry (see AuthModule's JwtModule.registerAsync). */
export const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `secure` defaults to FALSE so local dev over plain HTTP works (the web slice
 * is built against this exact cookie shape). Set `COOKIE_SECURE=1` in any
 * environment served over HTTPS — see DEPLOY.md — and the cookie is then only
 * ever sent over TLS.
 *
 * Read at call time rather than at module load: `ConfigModule` populates
 * process.env from .env during bootstrap, which happens after this module is
 * first required.
 */
export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.COOKIE_SECURE === '1',
  };
}
