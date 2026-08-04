/**
 * Control characters below are built via String.fromCharCode (never
 * embedded as literal raw bytes in this source) — same spirit as
 * prisma/seed.ts's UGLY_PAYLOAD, avoiding any ambiguity about what byte
 * each test asserts on.
 */
import { MAX_EDITED_CONTENT_CHARS, sanitizeContent } from '../src/doubts/sanitize';

const NUL = String.fromCharCode(0x00);
const SOH = String.fromCharCode(0x01);
const BEL = String.fromCharCode(0x07);
const ESC = String.fromCharCode(0x1b);
const DEL = String.fromCharCode(0x7f);
const C1_CONTROL = String.fromCharCode(0x85);

describe('sanitizeContent', () => {
  it('leaves ordinary text unchanged', () => {
    expect(sanitizeContent('This looks correct, nice work.')).toBe('This looks correct, nice work.');
  });

  it('preserves ordinary whitespace (tab, newline, carriage return)', () => {
    const input = 'line one\nline two\ttabbed\r\nline three';
    expect(sanitizeContent(input)).toBe(input);
  });

  it('strips NUL, SOH, and BEL control characters', () => {
    const input = 'before' + NUL + SOH + 'after' + BEL;
    expect(sanitizeContent(input)).toBe('beforeafter');
  });

  it('strips ESC-based ANSI escape sequences', () => {
    const input = 'plain ' + ESC + '[31mred' + ESC + '[0m text';
    expect(sanitizeContent(input)).toBe('plain [31mred[0m text');
  });

  it('strips DEL and a C1 control character', () => {
    const input = 'a' + DEL + 'b' + C1_CONTROL + 'c';
    expect(sanitizeContent(input)).toBe('abc');
  });

  it('caps length to the default max', () => {
    const input = 'x'.repeat(MAX_EDITED_CONTENT_CHARS + 500);
    const result = sanitizeContent(input);
    expect(result).toHaveLength(MAX_EDITED_CONTENT_CHARS);
  });

  it('caps length to a custom max', () => {
    expect(sanitizeContent('abcdefgh', 3)).toBe('abc');
  });

  it('handles an empty string', () => {
    expect(sanitizeContent('')).toBe('');
  });
});
