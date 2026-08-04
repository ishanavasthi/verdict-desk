/**
 * Pure, DB/HTTP-free hidden-test-case redaction: given the raw TestResult
 * rows for a submission and a `testCaseId -> hidden` map (join of TestResult
 * to TestCase.hidden), strip stdout/stderr/timeMs from hidden rows entirely.
 *
 * Factored out of `SubmissionsController` specifically so it's unit
 * testable without Prisma or HTTP (mirrors sandbox/grading-logic.ts).
 */

export interface RawTestResultRow {
  testCaseId: string;
  status: string;
  stdout: string;
  stderr: string;
  timeMs: number;
}

export interface HiddenTestResultView {
  testCaseId: string;
  status: string;
  hidden: true;
}

export interface VisibleTestResultView {
  testCaseId: string;
  status: string;
  hidden: false;
  stdout: string;
  stderr: string;
  timeMs: number;
}

export type RedactedTestResultView = HiddenTestResultView | VisibleTestResultView;

/**
 * Hidden rows -> `{testCaseId, status, hidden:true}` ONLY (no stdout/stderr/
 * timeMs — never leak a hidden case's expected/actual output). Visible rows
 * -> the full row plus `hidden:false`. A testCaseId absent from the map is
 * treated as visible (defensive default; in practice every row's testCaseId
 * comes from the same join that built the map).
 */
export function redactResults(
  results: RawTestResultRow[],
  hiddenByTestCaseId: Map<string, boolean>,
): RedactedTestResultView[] {
  return results.map((r) => {
    const hidden = hiddenByTestCaseId.get(r.testCaseId) ?? false;
    if (hidden) {
      return { testCaseId: r.testCaseId, status: r.status, hidden: true };
    }
    return {
      testCaseId: r.testCaseId,
      status: r.status,
      hidden: false,
      stdout: r.stdout,
      stderr: r.stderr,
      timeMs: r.timeMs,
    };
  });
}
