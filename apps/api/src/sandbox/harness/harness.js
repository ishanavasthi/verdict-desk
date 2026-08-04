'use strict';

/**
 * TRUSTED in-container grading harness. Plain, dependency-free CommonJS
 * (Node core `child_process`/`fs` ONLY — no npm deps, nothing to `require`
 * that isn't built into Node) because it is copied byte-for-byte into every
 * submission's temp dir and run as the container entrypoint:
 *
 *   docker run ... node:20-alpine node /work/harness.js
 *
 * It runs as PID 1 (tini's child) INSIDE the container as **root**, while
 * every untrusted `main.js` child it spawns runs as uid/gid 65534 (see the
 * explicit `{ uid: 65534, gid: 65534 }` on the `spawn()` call below) — a
 * DISTINCT uid from the harness itself, inside the same hardened container
 * (--network none, --read-only, --cap-drop ALL + only `SETUID`/`SETGID`
 * added back, --pids-limit 64, --security-opt no-new-privileges, etc — see
 * docker-args.ts). `no-new-privileges` does not block this: it blocks
 * privilege GAIN on execve, not a root process voluntarily dropping
 * privilege via setuid()/setgid(), which is what Node's `spawn(..., {uid,
 * gid})` does before exec'ing the child. Because the harness and the
 * submission no longer share a uid, `main.js` can no longer open
 * `/proc/1/fd/1` (that's the harness/PID1's own fd, now owned by a
 * different, unreachable-to-it uid) to corrupt or fabricate its own result
 * blob — seen below. The harness itself is trusted (it ships with the API,
 * untrusted code never touches it), but it must still defend itself against
 * a hostile main.js: fork bombs, infinite loops, output floods, etc.
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
 * main.js's stdout/stderr are always PIPED (never inherited) into per-case
 * collectors, so in normal operation untrusted output does not reach the
 * container's real stdout. This USED TO be only a functional (not hard
 * security) boundary, since main.js ran as the SAME uid as this harness and
 * PID1: it could in principle write straight to /proc/1/fd/1 and inject
 * bytes into the container's real stdout, though it still could never forge
 * a PASS (expected outputs are withheld from the container and comparison
 * is host-side), so the worst case was corrupting/replacing its OWN result
 * blob. That gap is now closed: the harness runs as uid 0 and spawns every
 * submission child at uid/gid 65534 — a DISTINCT, unprivileged uid — so
 * /proc/1/fd/1 is owned by a uid main.js no longer has, and the write fails
 * with EACCES/EPERM. See the README threat model.
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
  // Refuse to grade at all if uid separation was declared mandatory but this
  // process cannot perform it — see REQUIRE_UID_DROP above. Reported through
  // the existing `fatal` channel, so grading.service.ts surfaces it as an
  // infra error (submission -> ERROR) instead of producing verdicts from a
  // sandbox that is quietly weaker than the threat model claims.
  if (REQUIRE_UID_DROP && !CAN_DROP_PRIVS) {
    const actualUid = typeof process.getuid === 'function' ? process.getuid() : 'unknown';
    writeFatalAndExit(
      'refusing to grade: VERDICT_REQUIRE_UID_DROP=1 demands the submission run at a uid distinct ' +
        'from the harness, but the harness is not root (uid=' +
        actualUid +
        ') and cannot drop privileges — see docker-args.ts and the README threat model',
    );
    return;
  }

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

// In production the harness ALWAYS runs as in-container root (see
// docker-args.ts / the file header), so it can always setuid()/setgid() the
// submission child down to 65534. The ONLY exception is
// test/harness-runtime.spec.ts, which runs this exact file as a plain
// process on the HOST (no Docker, no root) to regression-test I/O behavior
// without Docker — passing uid/gid there would throw EPERM before the child
// even starts, since an unprivileged host user cannot setuid() at all.
const CAN_DROP_PRIVS = typeof process.getuid === 'function' && process.getuid() === 0;

// FAIL-CLOSED SWITCH. Set only by docker-args.ts, i.e. only on the real
// sandbox path. Deciding whether to drop privileges from `getuid() === 0`
// alone is a SILENT contract: if the container ever started non-root by some
// route other than the (unit-tested) absence of `--user` — a base image
// adding `USER`, a daemon-level default, uid remapping — the harness would
// quietly skip the drop, run the submission at its own uid, and reopen the
// /proc/1/fd/1 self-injection gap while every existing test still passed.
// A security property must never degrade quietly, so when the caller declares
// the drop mandatory we refuse to grade rather than grade less safely.
const REQUIRE_UID_DROP = process.env.VERDICT_REQUIRE_UID_DROP === '1';

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
        // Drop the child to a DISTINCT, unprivileged uid/gid — the harness
        // (this process, PID 1) runs as root so it CAN setuid()/setgid()
        // here, but the submission itself must still NEVER run as root.
        // This is also what closes the /proc/1/fd/1 self-injection gap:
        // main.js no longer shares a uid with the harness/PID1, so it can't
        // open the harness's own stdout fd (see file header).
        ...(CAN_DROP_PRIVS ? { uid: 65534, gid: 65534 } : {}),
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

    // Soft caps only TRUNCATE (stop storing) — they do NOT kill. Killing on the
    // soft cap made verdicts timing-dependent (a program right at the cap could
    // land PASS or FAIL depending on scheduling) and wrongly failed correct
    // programs that merely write verbose stderr. Memory stays bounded anyway:
    // the collector discards bytes past the cap while still draining the pipe.
    // Genuine runaway floods are stopped by the fast-path byte kill (below) and
    // the per-case timeout.
    const stdoutCollector = makeCappedCollector(maxCaseStdoutBytes);
    const stderrCollector = makeCappedCollector(maxCaseStderrBytes);

    child.stdout.on('data', (chunk) => {
      stdoutCollector.push(chunk);
      if (stdoutCollector.totalSeenBytes > FAST_PATH_BYTES) killAll('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      stderrCollector.push(chunk);
      if (stderrCollector.totalSeenBytes > FAST_PATH_BYTES) killAll('SIGKILL');
    });
    // Streams are piped (never inherited) into the collectors above. See the
    // file header for why this is a functional, not a hard-security, boundary.
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});

    const collect = (extra) =>
      Object.assign(
        {
          id: id,
          spawnError: false,
          stdout: stdoutCollector.text(),
          stderr: stderrCollector.text(),
          stdoutTruncated: stdoutCollector.truncated,
          stderrTruncated: stderrCollector.truncated,
          exitCode: null,
          signal: null,
          timedOut: timedOut,
          timeMs: Date.now() - startedAt,
        },
        extra,
      );

    const finalize = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardTimer);
      resolve(payload);
    };

    // Wall-clock timeout: SIGKILL the child's process group. Killing the DIRECT
    // child makes its 'exit' fire, which settles the case — so the timeout is
    // self-sufficient and never depends on the child cooperating.
    const timer = setTimeout(() => {
      timedOut = true;
      killAll('SIGKILL');
    }, timeoutMs);

    // Belt-and-suspenders: guarantee the case settles even if 'exit' is somehow
    // delayed past the kill (never let one case wedge the whole submission).
    const hardTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killAll('SIGKILL');
      finalize(collect({ signal: 'SIGKILL' }));
    }, timeoutMs + 500);

    child.on('error', (err) => {
      // e.g. spawn failed after the fact (pid table full, EAGAIN, ...).
      finalize(collect({ spawnError: true, message: describeError(err) }));
    });

    // Resolve on the child process's OWN 'exit' (the direct child ending), NOT
    // on stdio 'close'. A grandchild that main.js spawns detached with
    // stdio:'inherit' holds main.js's stdout pipe open, so 'close' may NEVER
    // fire — but 'exit' still does. This closes the queue-stall where such a
    // grandchild wedged a case until the host wall-clock backstop.
    child.on('exit', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardTimer);
      // Grace: let final buffered stdout drain and tini reap grandchildren
      // before the sequential loop spawns the NEXT case.
      setTimeout(() => {
        resolve(
          collect({
            exitCode: exitCode === undefined ? null : exitCode,
            signal: signal === undefined ? null : signal,
          }),
        );
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
