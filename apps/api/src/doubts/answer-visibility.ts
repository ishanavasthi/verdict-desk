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
