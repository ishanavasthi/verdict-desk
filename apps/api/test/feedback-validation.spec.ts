import {
  MAX_SUGGESTIONS,
  MAX_SUGGESTION_DETAIL_CHARS,
  MAX_SUGGESTION_TITLE_CHARS,
  MAX_SUMMARY_CHARS,
  stripCodeFences,
  validateFeedback,
} from '../src/ai/feedback-validation';

const VALID = {
  summary: 'Solid solution overall, a couple of readability nits.',
  severity: 'low',
  suggestions: [
    { title: 'Use const over let', detail: 'The loop variable is never reassigned.' },
  ],
};

describe('stripCodeFences', () => {
  it('leaves unfenced raw JSON unchanged', () => {
    const raw = '{"a":1}';
    expect(stripCodeFences(raw)).toBe('{"a":1}');
  });

  it('strips a ```json ... ``` fence', () => {
    const raw = '```json\n{"a":1}\n```';
    expect(stripCodeFences(raw)).toBe('{"a":1}');
  });

  it('strips a plain ``` ... ``` fence (no language tag)', () => {
    const raw = '```\n{"a":1}\n```';
    expect(stripCodeFences(raw)).toBe('{"a":1}');
  });

  it('trims stray surrounding whitespace/newlines', () => {
    const raw = '\n\n```json\n  {"a":1}  \n```\n\n';
    expect(stripCodeFences(raw)).toBe('{"a":1}');
  });
});

describe('validateFeedback', () => {
  it('accepts a well-formed object', () => {
    const result = validateFeedback(JSON.stringify(VALID));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.summary).toBe(VALID.summary);
      expect(result.value.severity).toBe('low');
      expect(result.value.suggestions).toHaveLength(1);
    }
  });

  it('accepts markdown-fenced JSON after stripping', () => {
    const fenced = '```json\n' + JSON.stringify(VALID) + '\n```';
    const result = validateFeedback(fenced);
    expect(result.ok).toBe(true);
  });

  it('accepts zero suggestions (empty array is allowed)', () => {
    const result = validateFeedback(JSON.stringify({ ...VALID, suggestions: [] }));
    expect(result.ok).toBe(true);
  });

  it('rejects invalid JSON outright', () => {
    const result = validateFeedback('not json at all {{{');
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown top-level key (.strict())', () => {
    const result = validateFeedback(JSON.stringify({ ...VALID, evil: true }));
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown key inside a suggestion (.strict())', () => {
    const bad = {
      ...VALID,
      suggestions: [{ title: 't', detail: 'd', extra: 'nope' }],
    };
    const result = validateFeedback(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid severity value', () => {
    const result = validateFeedback(JSON.stringify({ ...VALID, severity: 'pwned' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a missing severity (not defaulted)', () => {
    const { severity, ...rest } = VALID;
    void severity;
    const result = validateFeedback(JSON.stringify(rest));
    expect(result.ok).toBe(false);
  });

  it('rejects a summary over the max length', () => {
    const result = validateFeedback(
      JSON.stringify({ ...VALID, summary: 'x'.repeat(MAX_SUMMARY_CHARS + 1) }),
    );
    expect(result.ok).toBe(false);
  });

  it('accepts a summary at exactly the max length', () => {
    const result = validateFeedback(
      JSON.stringify({ ...VALID, summary: 'x'.repeat(MAX_SUMMARY_CHARS) }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a suggestion title over the max length', () => {
    const bad = {
      ...VALID,
      suggestions: [{ title: 'x'.repeat(MAX_SUGGESTION_TITLE_CHARS + 1), detail: 'd' }],
    };
    expect(validateFeedback(JSON.stringify(bad)).ok).toBe(false);
  });

  it('rejects a suggestion detail over the max length', () => {
    const bad = {
      ...VALID,
      suggestions: [{ title: 't', detail: 'x'.repeat(MAX_SUGGESTION_DETAIL_CHARS + 1) }],
    };
    expect(validateFeedback(JSON.stringify(bad)).ok).toBe(false);
  });

  it('rejects more than the max number of suggestions', () => {
    const bad = {
      ...VALID,
      suggestions: Array.from({ length: MAX_SUGGESTIONS + 1 }, (_, i) => ({
        title: `t${i}`,
        detail: 'd',
      })),
    };
    expect(validateFeedback(JSON.stringify(bad)).ok).toBe(false);
  });

  it('accepts exactly the max number of suggestions', () => {
    const ok = {
      ...VALID,
      suggestions: Array.from({ length: MAX_SUGGESTIONS }, (_, i) => ({
        title: `t${i}`,
        detail: 'd',
      })),
    };
    expect(validateFeedback(JSON.stringify(ok)).ok).toBe(true);
  });

  it('rejects an empty summary', () => {
    expect(validateFeedback(JSON.stringify({ ...VALID, summary: '' })).ok).toBe(false);
  });

  it('rejects a non-array suggestions field', () => {
    expect(validateFeedback(JSON.stringify({ ...VALID, suggestions: 'nope' })).ok).toBe(false);
  });

  it('rejects a prompt-injection payload that tries to smuggle extra fields', () => {
    // Simulates an attacker-controlled LLM output shaped like an injection
    // attempt: valid-looking core fields plus a smuggled unknown key.
    const injected = {
      ...VALID,
      severity: 'pwned',
      evil: true,
    };
    const result = validateFeedback(JSON.stringify(injected));
    expect(result.ok).toBe(false);
  });
});
