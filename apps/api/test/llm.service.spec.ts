import { ConfigService } from '@nestjs/config';
import { LlmService } from '../src/ai/llm.service';

describe('LlmService (MOCK mode)', () => {
  function build(env: Record<string, string | undefined>): LlmService {
    const config = new ConfigService(env);
    return new LlmService(config);
  }

  it('activates MOCK mode when MOCK_LLM is truthy', () => {
    const llm = build({ MOCK_LLM: '1', LLM_MODEL: 'test-model' });
    expect(llm.isMock).toBe(true);
  });

  it('returns valid, parseable JSON with expected keys and makes no network call', async () => {
    const llm = build({ MOCK_LLM: 'true', LLM_MODEL: 'test-model' });
    const raw = await llm.chat('please review this code');
    const parsed = JSON.parse(raw);
    expect(typeof parsed).toBe('object');
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('severity');
    expect(Array.isArray(parsed.suggestions)).toBe(true);
  });

  it('exposes the configured model via modelName (independent of the JSON content)', () => {
    const llm = build({ MOCK_LLM: '1', LLM_MODEL: 'test-model' });
    expect(llm.modelName).toBe('test-model');
  });

  it('does not treat an empty/unset MOCK_LLM as mock', () => {
    const llm = build({ MOCK_LLM: '', LLM_MODEL: 'm' });
    expect(llm.isMock).toBe(false);
  });
});
