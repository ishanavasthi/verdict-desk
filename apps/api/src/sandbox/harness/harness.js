'use strict';

/**
 * TRUSTED in-container grading harness. Plain, dependency-free CommonJS
 * (Node core `child_process`/`fs` ONLY — no npm deps, nothing to `require`
 * that isn't built into Node) because it is copied byte-for-byte into every
 * submission's temp dir and run as the container entrypoint:
 *
 *   docker run ... node:20-alpine node /work/harness.js
 *
 * It runs as the SAME non-root user as the untrusted program, under `--init`
 * (tini as PID 1), inside the same hardened container (--network none,
 * --read-only, --cap-drop ALL, --pids-limit 64, etc — see docker-args.ts).
 * The harness itself is trusted (it ships with the API, untrusted code never
 * touches it), but it must still defend itself against a hostile main.js:
 * fork bombs, infinite loops, output floods, etc.
 *
 * Manifest contract (host-written, read-only, at /work/manifest.json):
 *   { submissionId, perCaseTimeoutMs, maxCaseStdoutBytes, maxCaseStderrBytes,
 *     cases: [{ id, input }] }
 * Deliberately NO expectedOutput/weight/hidden — least privilege: the
 * container must never be able to read its own answer key. Pass/fail
 * verdicts are computed host-side (see grading-logic.ts).
 *
 * Output contract: exactly ONE write to real stdout, after all cases finish:
 *   { submissionId, results: [...] }
 * main.js's own stdout/stderr are always piped (never inherited), so the
 * container's real stdout can never contain anything from untrusted code —
 * control channel and untrusted-data channel are structurally separate.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// WORK_DIR is ALWAYS '/work' in production (the container's fixed layout —
// see docker-args.ts). The HARNESS_WORK_DIR override exists ONLY so
// test/harness-runtime.spec.ts can run this exact file, unmodified, as a
// plain child process on the host (no Docker) to regression-test the
// pipe-flush-before-exit behavior below. Untrusted code (main.js) runs in a
// SEPARATE child process and can never see or influence the harness's own
// process.env, so this test-only hook cannot be reached by a submission.
const WORK_DIR = process.env.HARNESS_WORK_DIR || '/work';
const MANIFEST_PATH = path.join(WORK_DIR, 'manifest.json');
const MAIN_PATH = path.join(WORK_DIR, 'main.js');

// Fixed grace period after a child's `close` event, so tini has a moment to
// reap any grandchildren (e.g. fork-bomb spawn) before the NEXT case starts —
// cases run strictly sequentially, at most one process group alive at a time.
const CLOSE_GRACE_MS = 75;

// Fast-path kill: even before the (cap-based) truncation logic below fires,
// if a single stream has produced this many bytes total, kill immediately.
// This bounds how much work we do per chunk before the cap fires.
const FAST_PATH_BYTES = 8 * 1024 * 1024; // 8 MiB

function main() {
  let manifest;
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    manifest = JSON.parse(raw);
  } catch (err) {
    writeFatalAndExit('failed to read/parse manifest: ' + describeError(err));
    return;
  }

  const submissionId = manifest && manifest.submissionId;
  const perCaseTimeoutMs = Number(manifest && manifest.perCaseTimeoutMs);
  const maxCaseStdoutBytes = Number(manifest && manifest.maxCaseStdoutBytes);
  const maxCaseStderrBytes = Number(manifest && manifest.maxCaseStderrBytes);
  const cases = Array.isArray(manifest && manifest.cases) ? manifest.cases : [];

  if (!Number.isFinite(perCaseTimeoutMs) || perCaseTimeoutMs <= 0) {
    writeFatalAndExit('manifest.perCaseTimeoutMs is missing or invalid');
    return;
  }

  runCasesSequentially(cases, perCaseTimeoutMs, maxCaseStdoutBytes, maxCaseStderrBytes)
    .then((results) => {
      // The ONE and ONLY write to real stdout.
      writeStdoutAndExit(JSON.stringify({ submissionId: submissionId, results: results }), 0);
    })
    .catch((err) => {
      // Should be unreachable — runOneCase never rejects — but never leave
      // the container silent on a harness bug.
      writeFatalAndExit('harness crashed: ' + describeError(err));
    });
}

function writeFatalAndExit(message) {
  writeStdoutAndExit(JSON.stringify({ fatal: true, message: message }), 1);
}

/**
 * Writes `payload` to real stdout and THEN exits with `exitCode` — critically,
 * only after the write has actually flushed.
 *
 * On POSIX, writes to a pipe are ASYNCHRONOUS: `process.stdout.write()`
 * returns immediately while the OS write happens in the background, possibly
 * over several syscalls if `payload` is bigger than one pipe buffer (commonly
 * 64 KiB on Linux). Calling `process.exit()` right after `.write()` does NOT
 * wait for pending I/O to flush, so a payload over ~64 KiB (e.g. several
 * near-cap per-case stdout strings concatenated into one results blob) gets
 * silently truncated mid-write. Using `.write()`'s completion callback avoids
 * that — this is what actually fixes it (confirmed via `scripts/abuse-demo.sh`
 * case 6, which produces an oversized payload and reproduced the truncation
 * before this fix).
 */
function writeStdoutAndExit(payload, exitCode) {
  process.exitCode = exitCode;
  try {
    process.stdout.write(payload, () => {
      process.exit(exitCode);
    });
  } catch (_err) {
    // Synchronous write failure (rare) — nothing more we can do, exit anyway.
    process.exit(exitCode);
  }
}

function describeError(err) {
  return err && err.message ? err.message : String(err);
}

async function runCasesSequentially(cases, perCaseTimeoutMs, maxCaseStdoutBytes, maxCaseStderrBytes) {
  const results = [];
  for (const c of cases) {
    const id = c && c.id;
    const input = c && typeof c.input === 'string' ? c.input : '';
    try {
      // eslint-disable-next-line no-await-in-loop -- cases MUST run sequentially.
      const result = await runOneCase(id, input, perCaseTimeoutMs, maxCaseStdoutBytes, maxCaseStderrBytes);
      results.push(result);
    } catch (err) {
      // Harness bug for this one case — record and continue with the rest.
      results.push({ id: id, error: describeError(err) });
    }
  }
  return results;
}

/**
 * Minimal self-contained capped collector, mirroring
 * `src/sandbox/capped-collector.ts` (kept as a small inline copy since this
 * file cannot `require` TypeScript / anything outside Node core).
 */
function makeCappedCollector(capBytes, onExceeded) {
  const cap = Number.isFinite(capBytes) && capBytes >= 0 ? capBytes : 0;
  const chunks = [];
  let storedBytes = 0;
  let totalSeenBytes = 0;
  let truncated = false;
  let exceededFired = false;

  return {
    push(chunk) {
      totalSeenBytes += chunk.length;

      const room = cap - storedBytes;
      if (room > 0) {
        const slice = chunk.length <= room ? chunk : chunk.subarray(0, room);
        chunks.push(slice);
        storedBytes += slice.length;
      }

      if (totalSeenBytes > cap) {
        truncated = true;
        if (!exceededFired) {
          exceededFired = true;
          if (onExceeded) onExceeded();
        }
      }
    },
    text() {
      return Buffer.concat(chunks).toString('utf8');
    },
    get truncated() {
      return truncated;
    },
    get totalSeenBytes() {
      return totalSeenBytes;
    },
  };
}

/** Kill the child's whole process group (it was spawned `detached: true`). */
function killGroup(child, sig) {
  try {
    process.kill(-child.pid, sig);
  } catch (_err) {
    try {
      child.kill('SIGKILL');
    } catch (_err2) {
      /* ignore — child may already be gone */
    }
  }
}

function runOneCase(id, input, timeoutMs, maxCaseStdoutBytes, maxCaseStderrBytes) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('node', [MAIN_PATH], {
        cwd: WORK_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        // Own process group so a fork bomb's children die together with it.
        detached: true,
      });
    } catch (err) {
      resolve({
        id: id,
        spawnError: true,
        message: describeError(err),
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        timeMs: Date.now() - startedAt,
      });
      return;
    }

    let settled = false;
    let timedOut = false;

    const killAll = (sig) => killGroup(child, sig);

    const onCapExceeded = () => {
      // Untrusted code may trap SIGTERM — go straight to SIGKILL.
      killAll('SIGKILL');
    };

    const stdoutCollector = makeCappedCollector(maxCaseStdoutBytes, onCapExceeded);
    const stderrCollector = makeCappedCollector(maxCaseStderrBytes, onCapExceeded);

    child.stdout.on('data', (chunk) => {
      stdoutCollector.push(chunk);
      if (stdoutCollector.totalSeenBytes > FAST_PATH_BYTES) killAll('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      stderrCollector.push(chunk);
      if (stderrCollector.totalSeenBytes > FAST_PATH_BYTES) killAll('SIGKILL');
    });
    // Streams are always piped, never inherited — untrusted output can NEVER
    // reach the container's real stdout/stderr.
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});

    const timer = setTimeout(() => {
      timedOut = true;
      killAll('SIGKILL');
    }, timeoutMs);

    const settleResolve = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    child.on('error', (err) => {
      // e.g. spawn failed after the fact (pid table full, EAGAIN, ...).
      settleResolve({
        id: id,
        spawnError: true,
        message: describeError(err),
        stdout: stdoutCollector.text(),
        stderr: stderrCollector.text(),
        stdoutTruncated: stdoutCollector.truncated,
        stderrTruncated: stderrCollector.truncated,
        exitCode: null,
        signal: null,
        timedOut: timedOut,
        timeMs: Date.now() - startedAt,
      });
    });

    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Fixed grace period: let tini reap any grandchildren before we return
      // control to the sequential loop and it spawns the NEXT case.
      setTimeout(() => {
        resolve({
          id: id,
          spawnError: false,
          stdout: stdoutCollector.text(),
          stderr: stderrCollector.text(),
          stdoutTruncated: stdoutCollector.truncated,
          stderrTruncated: stderrCollector.truncated,
          exitCode: exitCode === undefined ? null : exitCode,
          signal: signal === undefined ? null : signal,
          timedOut: timedOut,
          timeMs: Date.now() - startedAt,
        });
      }, CLOSE_GRACE_MS);
    });

    try {
      child.stdin.write(input);
    } catch (_err) {
      /* ignore — e.g. EPIPE if the child already died */
    }
    try {
      child.stdin.end();
    } catch (_err) {
      /* ignore */
    }
  });
}

main();
