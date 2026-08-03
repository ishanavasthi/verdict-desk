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
      ['--user', '65534:65534'],
      ['-w', '/work'],
    ];
    for (const [flag, value] of pairs) {
      const i = args.indexOf(flag);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(args[i + 1]).toBe(value);
    }
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
