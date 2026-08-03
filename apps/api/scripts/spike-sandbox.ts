/**
 * Scary integration spike #1: prove the hardened Docker sandbox actually works
 * AND actually contains untrusted code. Runs REAL containers via SandboxRunnerService.
 *
 * Run: pnpm --filter @verdict/api spike:sandbox   (tsx scripts/spike-sandbox.ts)
 *
 * Checks:
 *   1. hello-world: stdout parses as JSON, exitCode 0.
 *   2. containment (read-only mount): writing to /work FAILS.
 *   3. containment (network): fetch() under --network none FAILS.
 */
import { SandboxRunnerService } from '../src/sandbox/runner.service';

type Check = { name: string; pass: boolean; detail: string };

async function main(): Promise<void> {
  const runner = new SandboxRunnerService();
  const checks: Check[] = [];

  // 1) hello-world
  {
    const code = `console.log(JSON.stringify({hello:'world', pid: process.pid}))`;
    const res = await runner.runOnce({ code, timeoutMs: 15000 });
    let parsedOk = false;
    let parsed: any = null;
    try {
      parsed = JSON.parse(res.stdout.trim());
      parsedOk = parsed && parsed.hello === 'world' && typeof parsed.pid === 'number';
    } catch {
      parsedOk = false;
    }
    const pass = parsedOk && res.exitCode === 0 && !res.timedOut;
    checks.push({
      name: 'hello-world runs, stdout is JSON, exitCode 0',
      pass,
      detail: `exitCode=${res.exitCode} timedOut=${res.timedOut} stdout=${JSON.stringify(
        res.stdout.trim(),
      )} stderr=${JSON.stringify(res.stderr.trim().slice(0, 200))}`,
    });
  }

  // 2) containment: read-only mount must reject a write to /work
  {
    const code = `require('fs').writeFileSync('/work/pwned','x'); console.log('WROTE');`;
    const res = await runner.runOnce({ code, timeoutMs: 15000 });
    // Success = the write FAILED: non-zero exit and no 'WROTE' on stdout.
    const wroteMarker = res.stdout.includes('WROTE');
    const pass = res.exitCode !== 0 && !wroteMarker && !res.timedOut;
    checks.push({
      name: 'read-only /work mount blocks writes (containment)',
      pass,
      detail: `exitCode=${res.exitCode} wroteMarker=${wroteMarker} stderr=${JSON.stringify(
        res.stderr.trim().slice(0, 200),
      )}`,
    });
  }

  // 3) containment: no network -> fetch must fail
  {
    const code = `
      (async () => {
        try {
          const r = await fetch('http://example.com', { signal: AbortSignal.timeout(3000) });
          console.log('NET_OK ' + r.status);
        } catch (e) {
          console.log('NET_FAIL ' + (e && e.name ? e.name : 'err'));
          process.exit(3);
        }
      })();
    `;
    const res = await runner.runOnce({ code, timeoutMs: 15000 });
    const netBlocked = res.stdout.includes('NET_FAIL') || res.exitCode !== 0;
    const netSucceeded = res.stdout.includes('NET_OK');
    const pass = netBlocked && !netSucceeded;
    checks.push({
      name: 'network disabled (--network none) blocks fetch (containment)',
      pass,
      detail: `exitCode=${res.exitCode} stdout=${JSON.stringify(
        res.stdout.trim(),
      )}`,
    });
  }

  // ---- summary ----
  console.log('\n=== sandbox spike results ===');
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
    console.log(`      ${c.detail}`);
  }
  const allPass = checks.every((c) => c.pass);
  console.log(`\n${allPass ? 'PASS' : 'FAIL'}: sandbox spike ${allPass ? 'succeeded' : 'FAILED'} (${
    checks.filter((c) => c.pass).length
  }/${checks.length} checks passed)`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FAIL: sandbox spike threw:', err);
  process.exit(1);
});
