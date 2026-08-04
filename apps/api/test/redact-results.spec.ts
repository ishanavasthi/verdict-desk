import { RawTestResultRow, redactResults } from '../src/submissions/redact-results';

const visible: RawTestResultRow = {
  testCaseId: 'tc-visible',
  status: 'PASS',
  stdout: '5\n',
  stderr: '',
  timeMs: 12,
};

const hidden: RawTestResultRow = {
  testCaseId: 'tc-hidden',
  status: 'FAIL',
  stdout: 'this must never reach the client',
  stderr: 'nor this',
  timeMs: 34,
};

describe('redactResults', () => {
  it('reduces a hidden test case to ONLY {testCaseId, status, hidden:true} — no stdout/stderr/timeMs', () => {
    const hiddenByTestCaseId = new Map([[hidden.testCaseId, true]]);
    const [result] = redactResults([hidden], hiddenByTestCaseId);

    expect(result).toEqual({ testCaseId: 'tc-hidden', status: 'FAIL', hidden: true });
    expect(result).not.toHaveProperty('stdout');
    expect(result).not.toHaveProperty('stderr');
    expect(result).not.toHaveProperty('timeMs');
  });

  it('passes through the full row for a visible test case, adding hidden:false', () => {
    const hiddenByTestCaseId = new Map([[visible.testCaseId, false]]);
    const [result] = redactResults([visible], hiddenByTestCaseId);

    expect(result).toEqual({
      testCaseId: 'tc-visible',
      status: 'PASS',
      hidden: false,
      stdout: '5\n',
      stderr: '',
      timeMs: 12,
    });
  });

  it('handles a mix of hidden and visible rows independently, preserving input order', () => {
    const hiddenByTestCaseId = new Map([
      [visible.testCaseId, false],
      [hidden.testCaseId, true],
    ]);
    const results = redactResults([visible, hidden], hiddenByTestCaseId);

    expect(results).toEqual([
      {
        testCaseId: 'tc-visible',
        status: 'PASS',
        hidden: false,
        stdout: '5\n',
        stderr: '',
        timeMs: 12,
      },
      { testCaseId: 'tc-hidden', status: 'FAIL', hidden: true },
    ]);
  });

  it('defaults to visible (hidden:false) when a testCaseId is absent from the map', () => {
    const [result] = redactResults([visible], new Map());
    expect(result).toMatchObject({ hidden: false, stdout: '5\n', stderr: '', timeMs: 12 });
  });

  it('returns an empty array for an empty input', () => {
    expect(redactResults([], new Map())).toEqual([]);
  });
});
