/**
 * Small server-side API helper for the walking skeleton.
 *
 * The web app talks to the NestJS API two different ways:
 *  - Browser requests use the `/api/*` rewrite in `next.config.mjs`.
 *  - Server Components (like `app/page.tsx`) fetch the API directly, since
 *    Next.js rewrites only apply to requests that pass through the Next.js
 *    HTTP server, not to `fetch()` calls made from server-side code.
 *
 * Both paths land on the same `API_PROXY_TARGET`.
 */

export const API_BASE_URL = process.env.API_PROXY_TARGET || 'http://localhost:4000';

export interface HealthResponse {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  requestId: string;
}

export interface Problem {
  id: string;
  title: string;
  difficulty: string;
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`API request to ${path} failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health');
}

export function getProblems(): Promise<Problem[]> {
  return apiFetch<Problem[]>('/problems');
}
