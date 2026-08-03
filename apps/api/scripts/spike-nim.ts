/**
 * Scary integration spike #2: prove the LLM client works with NO API key via the
 * MOCK path (MOCK_LLM=1). If a real key is present AND MOCK_LLM is not set, it will
 * attempt a live call, but the success criterion here is the MOCK path passing.
 *
 * Run: pnpm --filter @verdict/api spike:nim   (tsx scripts/spike-nim.ts)
 */
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../src/ai/llm.service';

function isTruthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

async function main(): Promise<void> {
  const hasKey = !!(process.env.LLM_API_KEY && process.env.LLM_API_KEY.trim());
  const mockSet = isTruthy(process.env.MOCK_LLM);

  // If there's no key and MOCK isn't explicitly set, force the mock path so the
  // spike can pass in a keyless environment (this environment has no key).
  if (!hasKey && !mockSet) {
    process.env.MOCK_LLM = '1';
    console.log('No LLM_API_KEY detected -> forcing MOCK_LLM=1 for this spike.');
  }

  // ConfigService backed by process.env (ConfigModule loads .env into process.env
  // when running the app; here we read process.env directly).
  const config = new ConfigService(process.env);
  const llm = new LlmService(config);

  console.log(`Mode: ${llm.isMock ? 'MOCK' : 'LIVE'} (hasKey=${hasKey})`);

  const prompt =
    'Return a short JSON object with a one-line summary and severity for: variable used before declaration.';
  const raw = await llm.chat(prompt);
  console.log('Raw response:', raw);

  // The MOCK path must return valid JSON. A live path may return prose; only
  // require valid JSON when we are in mock mode.
  let jsonOk = true;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    jsonOk = false;
  }

  if (llm.isMock) {
    if (!jsonOk) {
      console.log('FAIL: MOCK path did not return valid JSON.');
      process.exit(1);
    }
    console.log('Parsed JSON keys:', Object.keys(parsed as object));
    console.log('\nPASS: LLM MOCK path returned valid JSON with no network call.');
    process.exit(0);
  }

  // Live mode: any non-empty response is acceptable for this smoke spike.
  if (!raw || !raw.trim()) {
    console.log('FAIL: LIVE path returned an empty response.');
    process.exit(1);
  }
  console.log('\nPASS: LLM LIVE path returned a non-empty response.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL: nim spike threw:', err);
  process.exit(1);
});
