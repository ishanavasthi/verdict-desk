import { CookieOptions } from 'express';

/** Name of the httpOnly cookie carrying the signed JWT — part of the SHARED CONTRACT with the web slice. */
export const AUTH_COOKIE_NAME = 'verdict_token';

/** ~7 days, matching the JWT's own expiry (see AuthModule's JwtModule.registerAsync). */
export const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `secure:false` is intentional for local dev (see SHARED CONTRACT) — the web
 * slice is built against this exact cookie shape, do not change it here.
 */
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: false,
};
