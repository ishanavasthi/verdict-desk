/**
 * Pure, DB/Docker-free grading logic: given a raw per-case harness result and
 * the problem's test case (expectedOutput/weight), compute the verdict; given
 * all verdicts, compute the weighted score and overall submission outcome.
 * Factored out of `GradingService` specifically so it's unit testable without
 * Prisma or Docker.
 */

export type TestVerdictStatus = 'PASS' | 'FAIL' | 'TIMEOUT' | 'ERROR';

/** Shape of one element of the parsed harness `results` array (host-side view). */
export interface HarnessCaseResult {
  id: string;
  spawnError?: boolean;
  message?: string;
  stdout?: string;
  stderr?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  timeMs?: number;
  /** Present when the harness's own try/catch around the case caught a bug. */
  error?: string;
}

export interface GradableTestCase {
  id: string;
  expectedOutput: string;
  weight: number;
}

export interface CaseVerdict {
  testCaseId: string;
  status: TestVerdictStatus;
  stdout: string;
  stderr: string;
  timeMs: number;
}

/**
 * PASS iff !timedOut && !spawnError && signal===null && exitCode===0 &&
 * stdout.trim() === expectedOutput.trim(). TIMEOUT if timedOut. ERROR if
 * spawnError / unexpected signal / a harness-level per-case error / the case
 * is simply absent from the harness's results. Otherwise FAIL.
 */
export function computeVerdict(
  testCase: GradableTestCase,
  result: HarnessCaseResult | undefined,
): CaseVerdict {
  if (!result) {
    return {
      testCaseId: testCase.id,
      status: 'ERROR',
      stdout: '',
      stderr: 'no result reported by harness for this test case',
      timeMs: 0,
    };
  }

  if (result.error !== undefined) {
    return {
      testCaseId: testCase.id,
      status: 'ERROR',
      stdout: result.stdout ?? '',
      stderr: result.error,
      timeMs: result.timeMs ?? 0,
    };
  }

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const timeMs = Math.max(0, Math.round(result.timeMs ?? 0));

  if (result.spawnError) {
    return {
      testCaseId: testCase.id,
      status: 'ERROR',
      stdout,
      stderr: result.message ?? stderr ?? 'spawn error',
      timeMs,
    };
  }

  if (result.timedOut) {
    return { testCaseId: testCase.id, status: 'TIMEOUT', stdout, stderr, timeMs };
  }

  const signal = result.signal ?? null;
  if (signal !== null) {
    return { testCaseId: testCase.id, status: 'ERROR', stdout, stderr, timeMs };
  }

  // Truncated stdout is incomplete by definition — it must NEVER be treated as a
  // PASS (otherwise the verdict would depend on where the cap happened to land).
  if (result.stdoutTruncated) {
    return { testCaseId: testCase.id, status: 'FAIL', stdout, stderr, timeMs };
  }

  if (result.exitCode === 0 && stdout.trim() === testCase.expectedOutput.trim()) {
    return { testCaseId: testCase.id, status: 'PASS', stdout, stderr, timeMs };
  }

  return { testCaseId: testCase.id, status: 'FAIL', stdout, stderr, timeMs };
}

/** score = 100 * (sum of weights of PASS cases) / (sum of all weights); guards divide-by-zero. */
export function computeScore(verdicts: CaseVerdict[], testCases: GradableTestCase[]): number {
  const weightById = new Map(testCases.map((tc) => [tc.id, tc.weight]));

  let totalWeight = 0;
  for (const tc of testCases) {
    totalWeight += tc.weight;
  }
  if (totalWeight <= 0) return 0;

  let passWeight = 0;
  for (const v of verdicts) {
    if (v.status === 'PASS') {
      passWeight += weightById.get(v.testCaseId) ?? 0;
    }
  }

  return (100 * passWeight) / totalWeight;
}

export type SubmissionOutcome = 'PASSED' | 'FAILED' | 'ERROR';

/** ALL cases PASS -> PASSED. `infraError` (harness truncation/parse/fatal) -> ERROR. Else FAILED. */
export function computeSubmissionStatus(
  verdicts: CaseVerdict[],
  infraError: boolean,
): SubmissionOutcome {
  if (infraError) return 'ERROR';
  if (verdicts.length > 0 && verdicts.every((v) => v.status === 'PASS')) return 'PASSED';
  return 'FAILED';
}
