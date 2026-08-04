/**
 * Builds the EXACT hardened `docker run` argv used to execute untrusted code.
 * Kept as a pure function (no side effects) so the hardening flags can be unit
 * tested without Docker. NEVER assemble this as a shell string — always argv.
 */
export interface DockerRunOptions {
  containerName: string;
  hostTmpDir: string;
  image?: string;
  entryFile?: string;
}

export const SANDBOX_IMAGE = 'node:20-alpine';

export function buildDockerRunArgs(opts: DockerRunOptions): string[] {
  const image = opts.image ?? SANDBOX_IMAGE;
  const entryFile = opts.entryFile ?? 'main.js';
  return [
    'run',
    '--rm',
    '--init',
    '--name',
    opts.containerName,
    '--network',
    'none',
    '--memory',
    '256m',
    '--memory-swap',
    '256m',
    '--cpus',
    '0.5',
    '--pids-limit',
    '64',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=16m',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'SETUID',
    '--cap-add',
    'SETGID',
    // CAP_KILL is required *because* of the uid separation above: a process may
    // only signal another whose uid matches its own unless it holds CAP_KILL.
    // The harness (uid 0) must SIGKILL timed-out submission children (uid 65534)
    // — without this, every per-case timeout fails with `kill EPERM` and the
    // case reports ERROR instead of TIMEOUT. Grants no ability to affect
    // anything outside this container's PID namespace.
    '--cap-add',
    'KILL',
    '--security-opt',
    'no-new-privileges',
    // Fail-closed contract with harness.js. The uid separation that closes the
    // /proc/1/fd/1 gap depends on the harness starting as root so it CAN drop
    // the submission to 65534 — a property this argv establishes (by omitting
    // `--user`) but which the harness cannot itself guarantee. Without this
    // flag the harness can only *infer* intent from its own uid, so a container
    // that started non-root for ANY reason (a base image adding `USER`, a
    // daemon default, uid remapping) would silently run submissions at the
    // harness's own uid — reopening the gap with every test still green.
    // Setting this says "uid separation is REQUIRED here": the harness refuses
    // to grade at all if it cannot drop privileges, turning a silent security
    // downgrade into a loud, visible failure. Host-only harness tests don't set
    // it, so they keep the lenient path.
    '-e',
    'VERDICT_REQUIRE_UID_DROP=1',
    '-v',
    `${opts.hostTmpDir}:/work:ro`,
    '-w',
    '/work',
    image,
    'node',
    `/work/${entryFile}`,
  ];
}
