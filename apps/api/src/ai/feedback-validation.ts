/**
 * Pure, network-free validation for AI code-quality feedback.
 *
 * The LIVE model (see llm.service.ts) wraps its JSON response in a markdown
 * code fence (```json ... ```); this module strips that fence, parses the
 * result, and validates it against a STRICT Zod schema so that no matter what
 * the model returns — including anything an attacker smuggled in via the
 * student's code or program stdout/stderr (see feedback-prompt.ts) — only a
 * shape-correct, size-bounded object can ever be persisted as structured
 * feedback. Unknown keys are rejected outright (`.strict()`), so a prompt
 * injection cannot smuggle extra fields into what gets stored/served.
 *
 * Factored out of AiFeedbackService specifically so it's unit testable
 * without Prisma, Nest, or the network (mirrors grading-logic.ts /
 * redact-results.ts).
 */
import { z } from 'zod';

export const MAX_SUMMARY_CHARS = 1000;
export const MAX_SUGGESTION_TITLE_CHARS = 200;
export const MAX_SUGGESTION_DETAIL_CHARS = 1000;
export const MAX_SUGGESTIONS = 8;

export const feedbackSeveritySchema = z.enum(['info', 'low', 'medium', 'high']);

export const feedbackSuggestionSchema = z
  .object({
    title: z.string().min(1).max(MAX_SUGGESTION_TITLE_CHARS),
    detail: z.string().min(1).max(MAX_SUGGESTION_DETAIL_CHARS),
  })
  .strict();

export const feedbackSchema = z
  .object({
    summary: z.string().min(1).max(MAX_SUMMARY_CHARS),
    severity: feedbackSeveritySchema,
    suggestions: z.array(feedbackSuggestionSchema).min(0).max(MAX_SUGGESTIONS),
  })
  .strict();

export type ValidatedFeedback = z.infer<typeof feedbackSchema>;

export type ValidationResult =
  | { ok: true; value: ValidatedFeedback }
  | { ok: false; error: string };

/**
 * Strip a single leading/trailing markdown code fence (```json ... ``` or
 * plain ``` ... ```) if present. Idempotent on input that is already
 * unfenced raw JSON. Tries an anchored (whole-string) match first, then
 * falls back to the first fenced block found anywhere in the string (some
 * models add a stray leading/trailing newline or brief prose outside the
 * fence), then finally falls back to the trimmed input unchanged.
 */
export function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();

  const anchored = trimmed.match(/^```[^\n`]*\n?([\s\S]*?)\n?```$/);
  if (anchored) {
    return anchored[1].trim();
  }

  const anywhere = trimmed.match(/```[^\n`]*\n?([\s\S]*?)\n?```/);
  if (anywhere) {
    return anywhere[1].trim();
  }

  return trimmed;
}

/**
 * Fence-strip -> JSON.parse -> strict Zod validation. Never throws — always
 * returns a discriminated result so callers (AiFeedbackService's retry/flag
 * control flow) don't need try/catch scattered around.
 */
export function validateFeedback(raw: string): ValidationResult {
  const stripped = stripCodeFences(raw);

  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch (err) {
    return { ok: false, error: `response is not valid JSON: ${(err as Error).message}` };
  }

  const result = feedbackSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, value: result.data };
}
