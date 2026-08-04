/**
 * Pure, DB/Docker/LLM-free grading logic for non-CODE question kinds (MCQ,
 * INTEGER). These are graded instantly and synchronously — they never touch
 * the sandbox queue. Mirrors the style of sandbox/grading-logic.ts.
 */

export type ObjectiveQuestionKind = 'MCQ' | 'INTEGER';

export interface McqOption {
  id: string;
  text: string;
}

const MAX_ANSWER_LENGTH = 256;
const INTEGER_PATTERN = /^-?\d{1,30}$/;

export type ValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: string };

/**
 * Validates and normalizes a raw submitted answer for a non-CODE question.
 * MCQ: normalized must equal one of the option ids. INTEGER: trimmed value
 * must match /^-?\d{1,30}$/.
 */
export function validateObjectiveAnswer(
  kind: ObjectiveQuestionKind,
  rawAnswer: string,
  options: McqOption[] | null,
): ValidationResult {
  if (rawAnswer.length > MAX_ANSWER_LENGTH) {
    return { ok: false, reason: 'answer is too long' };
  }

  if (kind === 'MCQ') {
    const normalized = rawAnswer.trim();
    const validIds = new Set((options ?? []).map((o) => o.id));
    if (!validIds.has(normalized)) {
      return { ok: false, reason: 'invalid answer' };
    }
    return { ok: true, normalized };
  }

  // INTEGER
  const normalized = rawAnswer.trim();
  if (!INTEGER_PATTERN.test(normalized)) {
    return { ok: false, reason: 'invalid answer' };
  }
  return { ok: true, normalized };
}

/** Strips a sign, leading zeros, and collapses "-0" to "0" for comparison. */
function canonicalizeInteger(value: string): string {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const digits = negative ? trimmed.slice(1) : trimmed;
  const stripped = digits.replace(/^0+(?=\d)/, '');
  if (stripped === '0') return '0';
  return negative ? `-${stripped}` : stripped;
}

export interface ObjectiveGradeResult {
  status: 'PASSED' | 'FAILED';
  score: 100 | 0;
}

/**
 * Grades an already-validated, normalized answer against the problem's
 * answerKey. INTEGER compares canonicalised values on both sides; MCQ is
 * exact id equality.
 */
export function gradeObjective(
  kind: ObjectiveQuestionKind,
  normalized: string,
  answerKey: string,
): ObjectiveGradeResult {
  const correct =
    kind === 'MCQ'
      ? normalized === answerKey
      : canonicalizeInteger(normalized) === canonicalizeInteger(answerKey);

  return correct ? { status: 'PASSED', score: 100 } : { status: 'FAILED', score: 0 };
}
