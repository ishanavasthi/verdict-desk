import { buildDockerRunArgs, SANDBOX_IMAGE } from '../src/sandbox/docker-args';

describe('buildDockerRunArgs (sandbox hardening flags)', () => {
  const args = buildDockerRunArgs({
    containerName: 'verdict-test',
    hostTmpDir: '/tmp/verdict-xyz',
  });
  const joined = args.join(' ');

  it('starts with `run --rm --init`', () => {
    expect(args[0]).toBe('run');
    expect(args).toContain('--rm');
    expect(args).toContain('--init');
  });

  it('names the container', () => {
    const i = args.indexOf('--name');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('verdict-test');
  });

  it('includes EXACTLY the required hardening flag pairs', () => {
    const pairs: [string, string][] = [
      ['--network', 'none'],
      ['--memory', '256m'],
      ['--memory-swap', '256m'],
      ['--cpus', '0.5'],
      ['--pids-limit', '64'],
      ['--tmpfs', '/tmp:rw,noexec,nosuid,size=16m'],
      ['--cap-drop', 'ALL'],
      ['--security-opt', 'no-new-privileges'],
      ['-w', '/work'],
    ];
    for (const [flag, value] of pairs) {
      const i = args.indexOf(flag);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(args[i + 1]).toBe(value);
    }
  });

  it('adds back ONLY SETUID/SETGID/KILL after --cap-drop ALL, and drops --user entirely', () => {
    // PID 1 (tini + harness) now runs as in-container root so the harness can
    // setuid()/setgid() the submission child to a distinct uid (65534) itself
    // — see harness.js. --user is removed; SETUID/SETGID enable that drop, and
    // KILL lets the harness SIGKILL a timed-out child that no longer shares its
    // uid (without it, every per-case timeout fails `kill EPERM`). No other cap.
    expect(args).not.toContain('--user');
    const dropIdx = args.indexOf('--cap-drop');
    expect(dropIdx).toBeGreaterThanOrEqual(0);
    expect(args[dropIdx + 1]).toBe('ALL');
    expect(args[dropIdx + 2]).toBe('--cap-add');
    expect(args[dropIdx + 3]).toBe('SETUID');
    expect(args[dropIdx + 4]).toBe('--cap-add');
    expect(args[dropIdx + 5]).toBe('SETGID');
    expect(args[dropIdx + 6]).toBe('--cap-add');
    expect(args[dropIdx + 7]).toBe('KILL');
    expect(args.filter((a) => a === '--cap-add')).toHaveLength(3);
  });

  it('includes the standalone --read-only flag', () => {
    expect(args).toContain('--read-only');
  });

  it('mounts the host tmp dir read-only at /work', () => {
    const i = args.indexOf('-v');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('/tmp/verdict-xyz:/work:ro');
  });

  it('runs `node /work/main.js` on the pinned image, as the LAST tokens', () => {
    expect(joined.endsWith(`${SANDBOX_IMAGE} node /work/main.js`)).toBe(true);
    expect(SANDBOX_IMAGE).toBe('node:20-alpine');
  });

  it('is an argv array (no shell metacharacters merged into one token)', () => {
    expect(Array.isArray(args)).toBe(true);
    // No single token should contain a space (that would imply a shell string).
    for (const tok of args) {
      expect(tok.includes(' ')).toBe(false);
    }
  });
});
