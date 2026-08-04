import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HARNESS_PATH = path.join(__dirname, '..', 'src', 'sandbox', 'harness', 'harness.js');

/**
 * Runs harness.js directly as a plain child process on the HOST (no Docker),
 * using the HARNESS_WORK_DIR test-only override (see harness.js) to point it
 * at a real temp directory instead of the container's fixed /work. This lets
 * us regression-test harness runtime BEHAVIOR (not just syntax) without
 * Docker, per the "CI runs `pnpm test` with NO Docker" constraint.
 */
function runHarness(
  workDir: string,
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [HARNESS_PATH], {
      cwd: workDir,
      env: { ...process.env, HARNESS_WORK_DIR: workDir, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (stderr.trim()) {
        // Surface unexpected harness stderr in test failure output for debuggability.
        console.error('[harness stderr]', stderr);
      }
      resolve({ stdout, exitCode });
    });
  });
}

function makeWorkDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-runtime-'));
}

describe('harness.js runtime behavior (no Docker — real child_process, real pipes)', () => {
  it('runs a trivial case and emits exactly one valid JSON blob on stdout', async () => {
    const dir = makeWorkDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'main.js'),
        `const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{process.stdout.write('hi');});`,
      );
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({
          submissionId: 'sub-trivial',
          perCaseTimeoutMs: 3000,
          maxCaseStdoutBytes: 1024,
          maxCaseStderrBytes: 1024,
          cases: [{ id: 'c1', input: '' }],
        }),
      );

      const { stdout, exitCode } = await runHarness(dir);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.submissionId).toBe('sub-trivial');
      expect(parsed.results).toHaveLength(1);
      expect(parsed.results[0].stdout).toBe('hi');
      expect(parsed.results[0].exitCode).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it(
    'REGRESSION: does not truncate the final JSON when the aggregated results exceed one pipe buffer (~64KiB) — ' +
      'reproduces the exact bug from scripts/abuse-demo.sh case 6 (process.exit() called before an async pipe write flushed)',
    async () => {
      const dir = makeWorkDir();
      try {
        // Each case writes ~60KB of stdout; 3 cases comfortably exceed a 64KiB
        // pipe buffer once wrapped in the final JSON envelope (which also adds
        // per-case stderr/exitCode/timing fields and JSON-escaping overhead).
        fs.writeFileSync(
          path.join(dir, 'main.js'),
          `process.stdout.write('A'.repeat(60000));`,
        );
        fs.writeFileSync(
          path.join(dir, 'manifest.json'),
          JSON.stringify({
            submissionId: 'sub-large',
            perCaseTimeoutMs: 5000,
            maxCaseStdoutBytes: 65536,
            maxCaseStderrBytes: 1024,
            cases: [
              { id: 'c1', input: '' },
              { id: 'c2', input: '' },
              { id: 'c3', input: '' },
            ],
          }),
        );

        const { stdout, exitCode } = await runHarness(dir);
        expect(exitCode).toBe(0);
        expect(stdout.length).toBeGreaterThan(65536); // bigger than one pipe buffer's worth

        // Must be valid, complete JSON — NOT "Unterminated string in JSON ...".
        const parsed = JSON.parse(stdout);
        expect(parsed.submissionId).toBe('sub-large');
        expect(parsed.results).toHaveLength(3);
        for (const r of parsed.results) {
          expect(r.stdout).toHaveLength(60000);
          expect(r.stdoutTruncated).toBe(false);
          expect(r.exitCode).toBe(0);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    20000,
  );

  it('emits a {fatal:true} blob and exits 1 on an unreadable/invalid manifest', async () => {
    const dir = makeWorkDir();
    try {
      // No manifest.json written at all.
      const { stdout, exitCode } = await runHarness(dir);
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout);
      expect(parsed.fatal).toBe(true);
      expect(typeof parsed.message).toBe('string');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  /**
   * The fail-closed guarantee for the /proc/1/fd/1 hardening. The uid
   * separation only holds if the harness starts as root and can drop the
   * submission to 65534; when it cannot, it must REFUSE to grade rather than
   * silently run the submission at its own uid (which would reopen the
   * self-injection gap while leaving every other test green). docker-args.ts
   * sets VERDICT_REQUIRE_UID_DROP=1 on the real sandbox path; this test
   * asserts the refusal by running the harness unprivileged on the host with
   * that flag set. Without the flag (every other test here) the lenient
   * host-test path is preserved.
   */
  it('FAIL-CLOSED: refuses to grade when VERDICT_REQUIRE_UID_DROP=1 but it cannot drop privileges', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      // Running as root (e.g. some container CI images): the harness CAN drop
      // privileges here, so the refusal path is legitimately unreachable.
      return;
    }
    const dir = makeWorkDir();
    try {
      fs.writeFileSync(path.join(dir, 'main.js'), `process.stdout.write('should never run');`);
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({
          submissionId: 'sub-uid-guard',
          perCaseTimeoutMs: 3000,
          maxCaseStdoutBytes: 1024,
          maxCaseStderrBytes: 1024,
          cases: [{ id: 'c1', input: '' }],
        }),
      );

      const { stdout, exitCode } = await runHarness(dir, { VERDICT_REQUIRE_UID_DROP: '1' });

      expect(exitCode).toBe(1);
      const parsed = JSON.parse(stdout);
      expect(parsed.fatal).toBe(true);
      expect(parsed.message).toMatch(/refusing to grade/i);
      // Critically: it refused BEFORE running any case — no verdicts were
      // produced from a sandbox weaker than the threat model claims.
      expect(parsed.results).toBeUndefined();
      expect(stdout).not.toContain('should never run');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
