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

/**
 * What kind of answer a problem expects. CODE runs in the Docker sandbox;
 * MCQ/INTEGER are graded instantly server-side against a secret `answerKey`
 * that — like hidden test-case expected outputs — is NEVER sent to clients.
 */
export type QuestionKind = 'CODE' | 'MCQ' | 'INTEGER';

export interface McqOption {
  id: string;
  text: string;
}

export interface Problem {
  id: string;
  title: string;
  difficulty: string | null;
  kind: QuestionKind;
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
  kind: QuestionKind;
  /** MCQ only (null otherwise): the choices, without any correctness marker. */
  options: McqOption[] | null;
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

export type FeedbackStatus = 'VALID' | 'FLAGGED';
export type FeedbackSeverity = 'info' | 'low' | 'medium' | 'high';

export interface FeedbackSuggestion {
  title: string;
  detail: string;
}

export interface FeedbackContent {
  summary: string;
  severity: FeedbackSeverity;
  suggestions: FeedbackSuggestion[];
}

/**
 * AI-generated code-quality feedback for a submission. This is produced by
 * an LLM with NO human review — always render `unreviewed` prominently in
 * the UI and treat `content` fields as untrusted plain text (never as
 * HTML/markdown to render).
 *
 * `null` until generation completes (shortly after grading finishes).
 * `status: 'FLAGGED'` or `content: null` means the model output couldn't be
 * validated into the expected shape — show a graceful fallback, never raw
 * text from the model.
 */
export interface SubmissionFeedback {
  status: FeedbackStatus;
  model: string;
  unreviewed: true;
  content: FeedbackContent | null;
}

/**
 * Coarse generation state of the AI feedback, so the UI can poll/show a
 * pending spinner instead of inferring from `feedback === null`:
 *  - `PENDING` — feedback expected but not yet available (the live model can
 *    take ~1–2 min); keep polling and show a "generating…" state.
 *  - `READY`   — validated feedback available (`feedback.content` present).
 *  - `FAILED`  — generation ran but couldn't be validated; show a fallback.
 *  - `SKIPPED` — no feedback will be produced (submission ERRORed); hide the card.
 */
export type FeedbackGenerationStatus = 'PENDING' | 'READY' | 'FAILED' | 'SKIPPED';

export interface SubmissionDetail {
  id: string;
  problemId: string;
  /** Kind of the problem this submission answers — MCQ/INTEGER render an answer view, not cases. */
  problemKind: QuestionKind;
  /** The raw submitted answer for MCQ/INTEGER submissions; null for CODE. */
  submittedAnswer: string | null;
  status: SubmissionStatus;
  score: number | null;
  results: TestResultView[];
  feedbackStatus: FeedbackGenerationStatus;
  feedback: SubmissionFeedback | null;
}

export interface SubmissionSummary {
  id: string;
  problemId: string;
  problemKind: QuestionKind;
  status: SubmissionStatus;
  score: number | null;
  createdAt: string;
}

export interface CreateSubmissionResponse {
  id: string;
  status: SubmissionStatus;
}

// ---- Doubts / teacher review ----

export type AnswerAuthorType = 'AI' | 'TEACHER';
export type AnswerState = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface DoubtAuthor {
  email: string;
  name: string | null;
}

/**
 * A single answer to a doubt. `content` is the original (AI) draft;
 * `editedContent` is set once a teacher has edited or approved-with-edits —
 * always prefer `editedContent ?? content` when displaying an answer.
 *
 * `content`/`editedContent` are untrusted (AI- or teacher-authored student
 * doubt content) — render as plain text only, never as HTML/markdown.
 */
export interface Answer {
  id: string;
  authorType: AnswerAuthorType;
  state: AnswerState;
  content: string;
  editedContent: string | null;
  /** Teacher's reject reason — only ever non-null on REJECTED answers, which the API only returns to the doubt author and teachers. Untrusted free text: render plain. */
  reviewNote: string | null;
  createdAt: string;
}

/**
 * A student-authored doubt (question). `title`/`body` are untrusted —
 * render as plain text only.
 *
 * The API filters `answers` by viewer: students see APPROVED answers plus
 * their own doubt's PENDING_REVIEW answers; teachers see everything.
 */
export interface Doubt {
  id: string;
  problemId: string | null;
  title: string;
  body: string;
  createdAt: string;
  author: DoubtAuthor | null;
  answers: Answer[];
}

export interface CreateDoubtResponse {
  id: string;
}

export interface ReviewQueueDoubtSummary {
  id: string;
  title: string;
  body: string;
  author: { email: string } | null;
}

/** A PENDING_REVIEW answer plus its parent doubt, as returned by the teacher review queue. */
export interface ReviewQueueItem {
  id: string;
  content: string;
  editedContent: string | null;
  state: AnswerState;
  createdAt: string;
  doubt: ReviewQueueDoubtSummary;
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

/**
 * True when the API said "there is nothing here for you" — which covers BOTH
 * a 404 and a 400. The API validates `:id` params as UUIDs, so a mistyped or
 * truncated id in the address bar comes back 400 rather than 404; from a
 * page's point of view both mean "render not-found", never "the API is down".
 */
export function isNotFoundish(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 400);
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

export function getDoubts(cookie: string): Promise<Doubt[]> {
  return apiFetch<Doubt[]>('/doubts', { cookie });
}

export function getDoubt(id: string, cookie: string): Promise<Doubt> {
  return apiFetch<Doubt>(`/doubts/${id}`, { cookie });
}

/** TEACHER-only: PENDING_REVIEW answers awaiting approve/edit/reject. */
export function getReviewQueue(cookie: string): Promise<ReviewQueueItem[]> {
  return apiFetch<ReviewQueueItem[]>('/review/queue', { cookie });
}
