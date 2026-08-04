/**
 * Typed API client for verdict-desk.
 *
 * The web app talks to the NestJS API two different ways:
 *  - Browser (Client Component) requests use the `/api/*` rewrite in
 *    `next.config.mjs` — same-origin, so the httpOnly `verdict_token` cookie
 *    is sent automatically by the browser.
 *  - Server Components fetch the API directly (Next.js rewrites only apply
 *    to requests that pass through the Next.js HTTP server, not to
 *    server-side `fetch()` calls), and must forward the auth cookie
 *    manually for protected endpoints — see `lib/auth.ts`.
 *
 * Both paths land on the same `API_PROXY_TARGET`.
 */

export const API_BASE_URL = process.env.API_PROXY_TARGET || 'http://localhost:4000';

export const AUTH_COOKIE_NAME = 'verdict_token';

export interface HealthResponse {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  requestId: string;
}

export type Role = 'STUDENT' | 'TEACHER';

export interface User {
  id: string;
  email: string;
  role: Role;
  name: string | null;
}

export interface Problem {
  id: string;
  title: string;
  difficulty: string | null;
}

export interface SampleTestCase {
  input: string;
  expectedOutput: string;
}

export interface ProblemDetail {
  id: string;
  title: string;
  description: string;
  difficulty: string | null;
  sampleTestCases: SampleTestCase[];
}

export type SubmissionStatus = 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'ERROR';
export type TestResultStatus = 'PASS' | 'FAIL' | 'TIMEOUT' | 'ERROR';

const TERMINAL_SUBMISSION_STATUSES: readonly SubmissionStatus[] = ['PASSED', 'FAILED', 'ERROR'];

export function isTerminalStatus(status: SubmissionStatus): boolean {
  return (TERMINAL_SUBMISSION_STATUSES as readonly string[]).includes(status);
}

export interface TestResultView {
  testCaseId: string;
  status: TestResultStatus;
  hidden: boolean;
  // Redacted server-side for hidden test cases.
  stdout?: string;
  stderr?: string;
  timeMs?: number;
}

export interface SubmissionDetail {
  id: string;
  problemId: string;
  status: SubmissionStatus;
  score: number | null;
  results: TestResultView[];
}

export interface SubmissionSummary {
  id: string;
  problemId: string;
  status: SubmissionStatus;
  score: number | null;
  createdAt: string;
}

export interface CreateSubmissionResponse {
  id: string;
  status: SubmissionStatus;
}

/** Thrown by `apiFetch` for any non-2xx response; carries the HTTP status so callers can branch on it. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ApiFetchOptions extends RequestInit {
  /** Raw `verdict_token` cookie value to forward — only needed for server-side calls to protected endpoints. */
  cookie?: string;
}

async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { cookie, headers, ...rest } = options;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    cache: 'no-store',
    headers: {
      ...(headers ?? {}),
      ...(cookie ? { Cookie: `${AUTH_COOKIE_NAME}=${cookie}` } : {}),
    },
  });

  if (!res.ok) {
    throw new ApiError(`API request to ${path} failed with status ${res.status}`, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

// ---- Public endpoints (no auth) ----

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health');
}

export function getProblems(): Promise<Problem[]> {
  return apiFetch<Problem[]>('/problems');
}

export function getProblemDetail(id: string): Promise<ProblemDetail> {
  return apiFetch<ProblemDetail>(`/problems/${id}`);
}

// ---- Protected endpoints (server-side callers must pass the forwarded cookie) ----

export function getMe(cookie: string): Promise<User> {
  return apiFetch<User>('/auth/me', { cookie });
}

export function getSubmission(id: string, cookie: string): Promise<SubmissionDetail> {
  return apiFetch<SubmissionDetail>(`/submissions/${id}`, { cookie });
}

export function getSubmissionHistory(cookie: string, problemId?: string): Promise<SubmissionSummary[]> {
  const qs = problemId ? `?problemId=${encodeURIComponent(problemId)}` : '';
  return apiFetch<SubmissionSummary[]>(`/submissions${qs}`, { cookie });
}
