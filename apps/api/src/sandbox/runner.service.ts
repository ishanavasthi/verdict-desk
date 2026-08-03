import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildDockerRunArgs } from './docker-args';

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

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;

      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exitCode,
          timedOut,
          durationMs: Date.now() - startedAt,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        this.logger.warn(`timeout after ${timeoutMs}ms; killing ${containerName}`);
        // Best-effort hard kill of the container.
        const killer = spawn('docker', ['kill', containerName], {
          stdio: 'ignore',
        });
        killer.on('error', () => {});
        // Also try to kill the docker CLI child so we don't leak the process.
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, timeoutMs);

      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString('utf8');
      });
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8');
      });

      child.on('error', (err) => {
        stderr += `\n[spawn error] ${err.message}`;
        finish(null);
      });

      child.on('close', (codeExit) => {
        finish(codeExit);
      });

      // Feed stdin, if any, then close.
      if (stdin !== undefined) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    });
  }
}
