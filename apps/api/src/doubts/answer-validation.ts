/**
 * PURE, network-free validation for an AI-drafted doubt answer. Mirrors
 * ai/feedback-validation.ts's fence-strip + strict-Zod pattern exactly (and
 * reuses its `stripCodeFences`, since the LIVE model wraps JSON responses in
 * a markdown code fence the same way for every AI feature — see
 * llm.service.ts).
 *
 * Only a shape-correct, size-bounded `{ answer: string }` can ever be
 * persisted as an AI-authored answer — unknown keys are rejected outright
 * (`.strict()`), so a prompt injection smuggled in via the student's doubt
 * title/body cannot add extra fields to what gets stored/reviewed.
 */
import { z } from 'zod';
import { stripCodeFences } from '../ai/feedback-validation';

export const MAX_ANSWER_CHARS = 4000;

export const answerSchema = z
  .object({
    answer: z.string().min(1).max(MAX_ANSWER_CHARS),
  })
  .strict();

export type ValidatedAnswer = z.infer<typeof answerSchema>;

export type AnswerValidationResult =
  | { ok: true; value: ValidatedAnswer }
  | { ok: false; error: string };

/**
 * Fence-strip -> JSON.parse -> strict Zod validation. Never throws — always
 * returns a discriminated result so the caller's retry/flag control flow
 * doesn't need try/catch scattered around.
 */
export function validateAnswer(raw: string): AnswerValidationResult {
  const stripped = stripCodeFences(raw);

  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch (err) {
    return { ok: false, error: `response is not valid JSON: ${(err as Error).message}` };
  }

  const result = answerSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, value: result.data };
}
