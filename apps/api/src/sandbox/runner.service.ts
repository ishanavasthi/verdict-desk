import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildDockerRunArgs } from './docker-args';
import { CappedCollector } from './capped-collector';
import { buildManifest, ManifestCase } from './manifest';

/**
 * Path to the trusted harness.js, resolved relative to THIS file at runtime.
 * In dev (ts-jest/tsx reading src/) this resolves under src/sandbox/harness/.
 * In the built server, __dirname is dist/sandbox, and nest-cli's asset copy
 * step (see nest-cli.json `compilerOptions.assets`) places harness.js at
 * dist/sandbox/harness/harness.js — same relative layout either way.
 */
const HARNESS_SRC_PATH = path.join(__dirname, 'harness', 'harness.js');

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface RunOnceInput {
  /** JavaScript source to run as /work/main.js inside the container. */
  code: string;
  /** Optional stdin piped to the process. */
  stdin?: string;
  /** Wall-clock timeout in milliseconds. */
  timeoutMs: number;
}

export interface RunOnceResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface RunSubmissionCase {
  id: string;
  input: string;
}

export interface RunSubmissionInput {
  submissionId: string;
  /** JavaScript source to run as /work/main.js inside the container, once per case. */
  code: string;
  cases: RunSubmissionCase[];
  perCaseTimeoutMs: number;
}

export interface RunSubmissionResult {
  /** The container's own stdout — a single capped JSON blob written by harness.js. */
  rawStdout: string;
  stdoutTruncated: boolean;
  stderr: string;
  stderrTruncated: boolean;
  exitCode: number | null;
  /** True if the OUTER wall-clock timeout (covering all cases) fired. */
  timedOut: boolean;
}

/**
 * Runs a single piece of untrusted JS inside ONE hardened Docker container.
 *
 * This is the single clean "run seam": the future per-test-case grading loop
 * simply calls `runOnce` once per test case. All hardening lives in
 * `buildDockerRunArgs` so it is unit-testable without Docker.
 */
@Injectable()
export class SandboxRunnerService {
  private readonly logger = new Logger(SandboxRunnerService.name);

  async runOnce(input: RunOnceInput): Promise<RunOnceResult> {
    const { code, stdin, timeoutMs } = input;
    const containerName = `verdict-${randomUUID()}`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-'));
    const startedAt = Date.now();

    try {
      // Write the untrusted program (and optional stdin file) to the host temp dir.
      fs.writeFileSync(path.join(tmpDir, 'main.js'), code, 'utf8');
      if (stdin !== undefined) {
        fs.writeFileSync(path.join(tmpDir, 'input.txt'), stdin, 'utf8');
      }

      const args = buildDockerRunArgs({ containerName, hostTmpDir: tmpDir });
      this.logger.debug(`docker ${args.join(' ')}`);

      return await this.spawnDocker(containerName, args, stdin, timeoutMs, startedAt);
    } finally {
      // Always clean up the host temp dir.
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) {
        this.logger.warn(`temp cleanup failed for ${tmpDir}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Runs ALL test cases for one submission inside ONE hardened container, via
   * the trusted `harness.js` entrypoint (`entryFile: 'harness.js'`). The
   * container never sees expectedOutput/weight/hidden (see `buildManifest`);
   * pass/fail verdicts are computed host-side by `GradingService`.
   *
   * Host-side stdout/stderr capture uses `CappedCollector` (NOT the uncapped
   * `stdout += chunk` pattern `runOnce` uses) — this is the fix for the
   * streaming-memory DoS hole on the grading path, since a hostile submission
   * could otherwise make the container itself flood its own real stdout.
   */
  async runSubmission(input: RunSubmissionInput): Promise<RunSubmissionResult> {
    const { submissionId, code, cases, perCaseTimeoutMs } = input;
    const containerName = `verdict-sub-${randomUUID()}`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-sub-'));

    const numCases = Math.max(cases.length, 1);
    const stdoutCapBytes = clamp(numCases * 100 * 1024, 1 * 1024 * 1024, 16 * 1024 * 1024);
    const stderrCapBytes = 256 * 1024;
    // Must always exceed the sum of per-case budgets so it never PRE-EMPTS a
    // legitimately-slow (but correct) many-case run — each case can take up to
    // perCaseTimeoutMs + the harness's hard-settle/grace (~600ms) + spawn
    // overhead. Generous absolute ceiling still bounds a wedged container.
    const wallClockTimeoutMs = clamp(numCases * (perCaseTimeoutMs + 1000) + 10000, 15000, 600000);

    try {
      // Write the untrusted program, copy the TRUSTED harness verbatim, and
      // write the least-privilege manifest (no expectedOutput/weight/hidden).
      fs.writeFileSync(path.join(tmpDir, 'main.js'), code, 'utf8');
      fs.copyFileSync(HARNESS_SRC_PATH, path.join(tmpDir, 'harness.js'));

      const manifest = buildManifest({
        submissionId,
        perCaseTimeoutMs,
        cases: cases.map((c): ManifestCase => ({ id: c.id, input: c.input })),
      });
      fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');

      const args = buildDockerRunArgs({ containerName, hostTmpDir: tmpDir, entryFile: 'harness.js' });
      this.logger.debug(`docker ${args.join(' ')}`);

      return await this.spawnDockerCapped(
        containerName,
        args,
        stdoutCapBytes,
        stderrCapBytes,
        wallClockTimeoutMs,
      );
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (err) {
        this.logger.warn(`temp cleanup failed for ${tmpDir}: ${(err as Error).message}`);
      }
    }
  }

  private spawnDockerCapped(
    containerName: string,
    args: string[],
    stdoutCapBytes: number,
    stderrCapBytes: number,
    wallClockTimeoutMs: number,
  ): Promise<RunSubmissionResult> {
    return new Promise<RunSubmissionResult>((resolve) => {
      // argv array — NEVER a shell string. No stdin: harness reads all case
      // input from manifest.json, not from the docker CLI's stdin.
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let timedOut = false;
      let settled = false;
      let killed = false;

      const killContainer = () => {
        if (killed) return;
        killed = true;
        this.logger.warn(`killing ${containerName}`);
        const killer = spawn('docker', ['kill', containerName], { stdio: 'ignore' });
        killer.on('error', () => {});
      };

      const stdoutCollector = new CappedCollector({
        capBytes: stdoutCapBytes,
        onExceeded: () => {
          this.logger.warn(`grading stdout cap exceeded for ${containerName}`);
          killContainer();
        },
      });
      const stderrCollector = new CappedCollector({
        capBytes: stderrCapBytes,
        onExceeded: () => {
          this.logger.warn(`grading stderr cap exceeded for ${containerName}`);
          killContainer();
        },
      });
      stdoutCollector.attach(child.stdout);
      stderrCollector.attach(child.stderr);

      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          rawStdout: stdoutCollector.text(),
          stdoutTruncated: stdoutCollector.truncated,
          stderr: stderrCollector.text(),
          stderrTruncated: stderrCollector.truncated,
          exitCode,
          timedOut,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        this.logger.warn(`wall-clock timeout after ${wallClockTimeoutMs}ms; killing ${containerName}`);
        killContainer();
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, wallClockTimeoutMs);

      child.on('error', (err) => {
        this.logger.error(`docker spawn error: ${err.message}`);
        finish(null);
      });

      child.on('close', (codeExit) => {
        finish(codeExit);
      });
    });
  }

  private spawnDocker(
    containerName: string,
    args: string[],
    stdin: string | undefined,
    timeoutMs: number,
    startedAt: number,
  ): Promise<RunOnceResult> {
    return new Promise<RunOnceResult>((resolve) => {
      // argv array — NEVER a shell string.
      const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });

      let timedOut = false;
      let settled = false;
      let killed = false;

      const killContainer = () => {
        if (killed) return;
        killed = true;
        const killer = spawn('docker', ['kill', containerName], { stdio: 'ignore' });
        killer.on('error', () => {});
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      };

      // Cap host-side capture even on this (trusted, spike-only) path — same
      // streaming primitive as the grading path, NEVER the uncapped
      // `str += chunk` pattern, so a flood can't grow the API's RSS.
      const stdoutCollector = new CappedCollector({
        capBytes: 2 * 1024 * 1024,
        onExceeded: () => {
          this.logger.warn(`runOnce stdout cap exceeded for ${containerName}`);
          killContainer();
        },
      });
      const stderrCollector = new CappedCollector({
        capBytes: 256 * 1024,
        onExceeded: () => killContainer(),
      });
      stdoutCollector.attach(child.stdout);
      stderrCollector.attach(child.stderr);

      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: stdoutCollector.text(),
          stderr: stderrCollector.text(),
          exitCode,
          timedOut,
          durationMs: Date.now() - startedAt,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        this.logger.warn(`timeout after ${timeoutMs}ms; killing ${containerName}`);
        killContainer();
      }, timeoutMs);

      child.on('error', (err) => {
        this.logger.error(`docker spawn error: ${err.message}`);
        finish(null);
      });

      child.on('close', (codeExit) => {
        finish(codeExit);
      });

      // Feed stdin, if any, then close.
      try {
        if (stdin !== undefined) child.stdin.write(stdin);
        child.stdin.end();
      } catch {
        /* ignore EPIPE if the container already exited */
      }
    });
  }
}
