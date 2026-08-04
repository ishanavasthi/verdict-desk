import {
  CaseVerdict,
  computeScore,
  computeSubmissionStatus,
  computeVerdict,
  GradableTestCase,
  HarnessCaseResult,
} from '../src/sandbox/grading-logic';

const tc = (over: Partial<GradableTestCase> = {}): GradableTestCase => ({
  id: 'tc-1',
  expectedOutput: '5\n',
  weight: 1,
  ...over,
});

describe('computeVerdict', () => {
  it('PASS when exitCode 0, no signal, not timed out, and stdout matches after trim', () => {
    const result: HarnessCaseResult = {
      id: 'tc-1',
      stdout: '5\n', // exact match
      stderr: '',
      exitCode: 0,
      signal: null,
      timedOut: false,
      timeMs: 12,
    };
    expect(computeVerdict(tc(), result).status).toBe('PASS');
  });

  it('PASS tolerates surrounding whitespace on both sides via trim()', () => {
    const result: HarnessCaseResult = {
      id: 'tc-1',
      stdout: '  5\n\n',
      stderr: '',
      exitCode: 0,
      signal: null,
      timedOut: false,
      timeMs: 1,
    };
    expect(computeVerdict(tc({ expectedOutput: '5' }), result).status).toBe('PASS');
  });

  it('FAIL when exitCode 0 but stdout does not match', () => {
    const result: HarnessCaseResult = {
      id: 'tc-1',
      stdout: '6\n',
      stderr: '',
      exitCode: 0,
      signal: null,
      timedOut: false,
      timeMs: 1,
    };
    expect(computeVerdict(tc(), result).status).toBe('FAIL');
  });

  it('FAIL (never PASS) when stdout was truncated, even if the captured prefix matches', () => {
    const result: HarnessCaseResult = {
      id: 'tc-1',
      stdout: '5\n', // would match, but…
      stderr: '',
      stdoutTruncated: true, // …output was capped mid-stream, so it's incomplete
      exitCode: 0,
      signal: null,
      timedOut: false,
      timeMs: 1,
    };
    expect(computeVerdict(tc(), result).status).toBe('FAIL');
  });

  it('FAIL when stdout matches but exitCode is non-zero', () => {
    const result: HarnessCaseResult = {
      id: 'tc-1',
      stdout: '5\n',
      stderr: '',
      exitCode: 1,
      signal: null,
      timedOut: false,
      timeMs: 1,
    };
    expect(computeVerdict(tc(), result).status).toBe('FAIL');
  });

  it('TIMEOUT when timedOut is true, regardless of partial stdout', () => {
    const result: HarnessCaseResult = {
      id: 'tc-1',
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: 'SIGKILL',
      timedOut: true,
      timeMs: 5000,
    };
    expect(computeVerdict(tc(), result).status).toBe('TIMEOUT');
  });

  it('ERROR when spawnError is true', () => {
    const result: HarnessCaseResult = {
      id: 'tc-1',
      spawnError: true,
      message: 'EAGAIN',
      timedOut: false,
      timeMs: 0,
    };
    const v = computeVerdict(tc(), result);
    expect(v.status).toBe('ERROR');
    expect(v.stderr).toContain('EAGAIN');
  });

  it('ERROR when killed by an unexpected signal (not a timeout)', () => {
    const result: HarnessCaseResult = {
      id: 'tc-1',
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: 'SIGSEGV',
      timedOut: false,
      timeMs: 3,
    };
    expect(computeVerdict(tc(), result).status).toBe('ERROR');
  });

  it('ERROR when the harness recorded a per-case error', () => {
    const result: HarnessCaseResult = { id: 'tc-1', error: 'unexpected harness bug' };
    const v = computeVerdict(tc(), result);
    expect(v.status).toBe('ERROR');
    expect(v.stderr).toBe('unexpected harness bug');
  });

  it('ERROR when the case is absent from the harness results entirely', () => {
    const v = computeVerdict(tc(), undefined);
    expect(v.status).toBe('ERROR');
  });
});

describe('computeScore', () => {
  it('is 100 when all weighted cases pass', () => {
    const testCases: GradableTestCase[] = [
      { id: 'a', expectedOutput: '1', weight: 1 },
      { id: 'b', expectedOutput: '2', weight: 3 },
    ];
    const verdicts: CaseVerdict[] = [
      { testCaseId: 'a', status: 'PASS', stdout: '', stderr: '', timeMs: 0 },
      { testCaseId: 'b', status: 'PASS', stdout: '', stderr: '', timeMs: 0 },
    ];
    expect(computeScore(verdicts, testCases)).toBe(100);
  });

  it('is weighted proportionally when only some cases pass', () => {
    const testCases: GradableTestCase[] = [
      { id: 'a', expectedOutput: '1', weight: 1 },
      { id: 'b', expectedOutput: '2', weight: 3 },
    ];
    const verdicts: CaseVerdict[] = [
      { testCaseId: 'a', status: 'PASS', stdout: '', stderr: '', timeMs: 0 },
      { testCaseId: 'b', status: 'FAIL', stdout: '', stderr: '', timeMs: 0 },
    ];
    // 1 / (1+3) * 100 = 25
    expect(computeScore(verdicts, testCases)).toBe(25);
  });

  it('is 0 when nothing passes', () => {
    const testCases: GradableTestCase[] = [{ id: 'a', expectedOutput: '1', weight: 1 }];
    const verdicts: CaseVerdict[] = [
      { testCaseId: 'a', status: 'FAIL', stdout: '', stderr: '', timeMs: 0 },
    ];
    expect(computeScore(verdicts, testCases)).toBe(0);
  });

  it('guards divide-by-zero when total weight is 0 (no test cases)', () => {
    expect(computeScore([], [])).toBe(0);
  });
});

describe('computeSubmissionStatus', () => {
  it('PASSED iff ALL cases PASS', () => {
    const verdicts: CaseVerdict[] = [
      { testCaseId: 'a', status: 'PASS', stdout: '', stderr: '', timeMs: 0 },
      { testCaseId: 'b', status: 'PASS', stdout: '', stderr: '', timeMs: 0 },
    ];
    expect(computeSubmissionStatus(verdicts, false)).toBe('PASSED');
  });

  it('FAILED when at least one case is not PASS (and no infra error)', () => {
    const verdicts: CaseVerdict[] = [
      { testCaseId: 'a', status: 'PASS', stdout: '', stderr: '', timeMs: 0 },
      { testCaseId: 'b', status: 'TIMEOUT', stdout: '', stderr: '', timeMs: 0 },
    ];
    expect(computeSubmissionStatus(verdicts, false)).toBe('FAILED');
  });

  it('FAILED (not ERROR) when a single case is ERROR but it is not an infra-level failure', () => {
    const verdicts: CaseVerdict[] = [
      { testCaseId: 'a', status: 'PASS', stdout: '', stderr: '', timeMs: 0 },
      { testCaseId: 'b', status: 'ERROR', stdout: '', stderr: '', timeMs: 0 },
    ];
    expect(computeSubmissionStatus(verdicts, false)).toBe('FAILED');
  });

  it('ERROR when infraError is true, even if every computed verdict happens to be PASS', () => {
    const verdicts: CaseVerdict[] = [
      { testCaseId: 'a', status: 'PASS', stdout: '', stderr: '', timeMs: 0 },
    ];
    expect(computeSubmissionStatus(verdicts, true)).toBe('ERROR');
  });

  it('FAILED (never PASSED) when there are zero test cases', () => {
    expect(computeSubmissionStatus([], false)).toBe('FAILED');
  });
});
