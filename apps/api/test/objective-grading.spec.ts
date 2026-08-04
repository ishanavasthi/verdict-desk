import { gradeObjective, validateObjectiveAnswer } from '../src/submissions/objective-grading';

describe('validateObjectiveAnswer', () => {
  const options = [
    { id: 'a', text: '--network none' },
    { id: 'b', text: '--isolate' },
    { id: 'c', text: '--no-net' },
    { id: 'd', text: '--offline' },
  ];

  it('rejects answers longer than 256 chars', () => {
    const result = validateObjectiveAnswer('INTEGER', '1'.repeat(257), null);
    expect(result).toEqual({ ok: false, reason: expect.any(String) });
  });

  it('MCQ: accepts a valid option id', () => {
    expect(validateObjectiveAnswer('MCQ', 'a', options)).toEqual({ ok: true, normalized: 'a' });
  });

  it('MCQ: rejects an unknown option id', () => {
    const result = validateObjectiveAnswer('MCQ', 'z', options);
    expect(result.ok).toBe(false);
  });

  it('INTEGER: trims surrounding whitespace', () => {
    expect(validateObjectiveAnswer('INTEGER', '  42  ', null)).toEqual({ ok: true, normalized: '42' });
  });

  it('INTEGER: accepts a leading-zero value', () => {
    expect(validateObjectiveAnswer('INTEGER', '007', null)).toEqual({ ok: true, normalized: '007' });
  });

  it('INTEGER: accepts negative zero', () => {
    expect(validateObjectiveAnswer('INTEGER', '-0', null)).toEqual({ ok: true, normalized: '-0' });
  });

  it('INTEGER: rejects a value with more than 30 digits', () => {
    const result = validateObjectiveAnswer('INTEGER', '1'.repeat(31), null);
    expect(result.ok).toBe(false);
  });

  it('INTEGER: rejects non-numeric input', () => {
    const result = validateObjectiveAnswer('INTEGER', 'abc', null);
    expect(result.ok).toBe(false);
  });
});

describe('gradeObjective', () => {
  it('MCQ: exact id equality', () => {
    expect(gradeObjective('MCQ', 'a', 'a')).toEqual({ status: 'PASSED', score: 100 });
    expect(gradeObjective('MCQ', 'b', 'a')).toEqual({ status: 'FAILED', score: 0 });
  });

  it('INTEGER: canonicalises leading zeros on both sides', () => {
    expect(gradeObjective('INTEGER', '007', '7')).toEqual({ status: 'PASSED', score: 100 });
    expect(gradeObjective('INTEGER', '31', '031')).toEqual({ status: 'PASSED', score: 100 });
  });

  it('INTEGER: canonicalises "-0" to "0"', () => {
    expect(gradeObjective('INTEGER', '-0', '0')).toEqual({ status: 'PASSED', score: 100 });
    expect(gradeObjective('INTEGER', '0', '-0')).toEqual({ status: 'PASSED', score: 100 });
  });

  it('INTEGER: trims whitespace on both sides before comparing', () => {
    expect(gradeObjective('INTEGER', '  42  ', '42')).toEqual({ status: 'PASSED', score: 100 });
  });

  it('INTEGER: mismatched values fail', () => {
    expect(gradeObjective('INTEGER', '30', '31')).toEqual({ status: 'FAILED', score: 0 });
  });
});
