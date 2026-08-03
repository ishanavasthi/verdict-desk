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
    '--security-opt',
    'no-new-privileges',
    '--user',
    '65534:65534',
    '-v',
    `${opts.hostTmpDir}:/work:ro`,
    '-w',
    '/work',
    image,
    'node',
    `/work/${entryFile}`,
  ];
}
