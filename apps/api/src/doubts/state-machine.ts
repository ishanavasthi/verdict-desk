import { AnswerState, AuthorType } from '@prisma/client';

/**
 * PURE mirror of the DB-enforced state machine added by the
 * `answer_state_machine` migration (prisma/migrations/*_answer_state_machine
 * /migration.sql: answers_insert_guard_trg / answers_transition_guard_trg).
 *
 * These two functions exist so the rules can be unit-tested without a
 * database, and so the app layer can pre-check before even attempting a
 * write. They must stay in EXACT lockstep with the SQL — the DB triggers
 * remain the ultimate source of truth/enforcement (an app-layer bug here
 * can never let an illegal state exist, only reject something the DB would
 * have allowed).
 */

const ALLOWED_TRANSITIONS: Record<AnswerState, AnswerState[]> = {
  DRAFT: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

/**
 * Mirrors `answers_transition_guard_trg`: a same-state "transition" (content
 * edit) is always allowed; otherwise only DRAFT->PENDING_REVIEW,
 * PENDING_REVIEW->APPROVED, and PENDING_REVIEW->REJECTED are legal.
 * APPROVED and REJECTED are terminal.
 */
export function isAllowedTransition(from: AnswerState, to: AnswerState): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Mirrors `answers_insert_guard_trg`: an AI-authored answer must be born
 * DRAFT; an answer born APPROVED must be TEACHER-authored. Every other
 * (authorType, state) combination at insert time is legal.
 */
export function canInsertAnswer(authorType: AuthorType, state: AnswerState): boolean {
  if (authorType === 'AI' && state !== 'DRAFT') return false;
  if (state === 'APPROVED' && authorType !== 'TEACHER') return false;
  return true;
}
