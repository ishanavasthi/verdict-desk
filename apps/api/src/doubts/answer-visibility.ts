import { Prisma, Role } from '@prisma/client';

/**
 * PURE builder for the answer-visibility rule, enforced IN the Prisma query
 * (a nested `where` on the `answers` relation) rather than filtered in
 * application code after the fact: an answer is visible if it is
 * `state='APPROVED'`, OR the viewer is the doubt's author, OR the viewer is
 * a TEACHER (who may see everything, including DRAFT/PENDING_REVIEW/
 * REJECTED answers, for review purposes).
 */
export function visibleAnswerWhere(viewer: { id: string; role: Role }): Prisma.AnswerWhereInput {
  if (viewer.role === 'TEACHER') {
    return {};
  }
  return {
    OR: [{ state: 'APPROVED' }, { doubt: { authorId: viewer.id } }],
  };
}

/**
 * PURE companion to `visibleAnswerWhere`, and the second half of the same rule.
 *
 * `visibleAnswerWhere` decides which answer ROWS a viewer receives; this decides
 * whether the row carries its TEXT. They differ on purpose: the query returns
 * the doubt's author every answer on their own doubt in every state, so the UI
 * can show that a draft exists and how review went — but the asker being told
 * "an answer is pending" must never become the asker reading unreviewed AI
 * output. So for a non-TEACHER, only an APPROVED answer carries content.
 *
 * Withholding matters for all three non-approved states:
 *   PENDING_REVIEW — a teacher hasn't ruled on it yet.
 *   REJECTED       — a teacher explicitly refused to publish it.
 *   DRAFT          — never queued for review; on a validation failure its
 *                    content is an internal diagnostic string, not an answer.
 *
 * Returns the text to serialize, or `null` to withhold it.
 */
export function readableAnswerContent(
  viewer: { role: Role },
  answer: { state: string; content: string; editedContent: string | null },
): string | null {
  if (viewer.role !== 'TEACHER' && answer.state !== 'APPROVED') {
    return null;
  }
  // A teacher's edit REPLACES the draft students see — the raw pre-edit text is
  // never shipped, otherwise the edit would be cosmetic.
  return answer.editedContent ?? answer.content;
}
