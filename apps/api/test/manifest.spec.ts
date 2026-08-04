import {
  buildManifest,
  DEFAULT_MAX_CASE_STDERR_BYTES,
  DEFAULT_MAX_CASE_STDOUT_BYTES,
} from '../src/sandbox/manifest';

describe('buildManifest', () => {
  it('produces {submissionId, perCaseTimeoutMs, maxCaseStdoutBytes, maxCaseStderrBytes, cases}', () => {
    const manifest = buildManifest({
      submissionId: 'sub-1',
      perCaseTimeoutMs: 3000,
      cases: [
        { id: 'tc-1', input: '2\n3\n' },
        { id: 'tc-2', input: '10\n-4\n' },
      ],
    });

    expect(manifest).toEqual({
      submissionId: 'sub-1',
      perCaseTimeoutMs: 3000,
      maxCaseStdoutBytes: DEFAULT_MAX_CASE_STDOUT_BYTES,
      maxCaseStderrBytes: DEFAULT_MAX_CASE_STDERR_BYTES,
      cases: [
        { id: 'tc-1', input: '2\n3\n' },
        { id: 'tc-2', input: '10\n-4\n' },
      ],
    });
  });

  it('honors explicit byte caps when provided', () => {
    const manifest = buildManifest({
      submissionId: 'sub-2',
      perCaseTimeoutMs: 1000,
      cases: [],
      maxCaseStdoutBytes: 111,
      maxCaseStderrBytes: 222,
    });
    expect(manifest.maxCaseStdoutBytes).toBe(111);
    expect(manifest.maxCaseStderrBytes).toBe(222);
  });

  it('NEVER includes expectedOutput/weight/hidden even if present on the input cases', () => {
    const richCases = [
      {
        id: 'tc-1',
        input: 'in',
        expectedOutput: 'THE ANSWER KEY',
        weight: 99,
        hidden: true,
      },
    ];
    const manifest = buildManifest({
      submissionId: 'sub-3',
      perCaseTimeoutMs: 1000,
      cases: richCases,
    });

    expect(manifest.cases).toEqual([{ id: 'tc-1', input: 'in' }]);
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain('expectedOutput');
    expect(serialized).not.toContain('THE ANSWER KEY');
    expect(serialized).not.toContain('weight');
    expect(serialized).not.toContain('hidden');
  });

  it('is JSON-serializable and round-trips', () => {
    const manifest = buildManifest({
      submissionId: 'sub-4',
      perCaseTimeoutMs: 5000,
      cases: [{ id: 'a', input: 'x' }],
    });
    const roundTripped = JSON.parse(JSON.stringify(manifest));
    expect(roundTripped).toEqual(manifest);
  });
});
