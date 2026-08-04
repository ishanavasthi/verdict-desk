/**
 * Server-side auth helpers.
 *
 * Server Components can't rely on the browser to send the httpOnly
 * `verdict_token` cookie — we read it via `next/headers` and forward it
 * manually to the API for protected endpoints (see `lib/api.ts`).
 */

import { cache } from 'react';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME, getMe as fetchMe, type User } from './api';

/** Raw `verdict_token` cookie value from the incoming request, or null if absent. */
export async function getAuthToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(AUTH_COOKIE_NAME)?.value ?? null;
}

/**
 * Resolves the current user by forwarding the auth cookie to `GET /auth/me`.
 * Returns null when there's no cookie, the session is invalid/expired, or
 * the API is unreachable — callers treat all of those as "not logged in".
 */
export const getMe = cache(async (): Promise<User | null> => {
  const token = await getAuthToken();
  if (!token) {
    return null;
  }
  try {
    return await fetchMe(token);
  } catch {
    return null;
  }
});
