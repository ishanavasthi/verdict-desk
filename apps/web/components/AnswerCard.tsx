import type { Answer } from '@/lib/api';
import { answerAuthorTypeLabel, answerStateLabel, answerStateOutcome, formatTimestamp } from '@/lib/status';
import StatusBadge from './StatusBadge';

/**
 * What to show in place of an answer whose text this viewer can't read. The API
 * withholds the text of every non-APPROVED answer from non-teachers
 * (`content: null`), so the state alone decides the note — the component never
 * has to be told what to hide.
 *
 * REJECTED deliberately has no "why" here beyond the teacher's own reviewNote,
 * which renders separately below.
 */
const WITHHELD_NOTE: Record<string, string> = {
  PENDING_REVIEW: 'Awaiting teacher review — a teacher will review this AI-generated answer before it is shown.',
  DRAFT: 'An AI draft was generated but did not pass validation, so it was never sent for review.',
  REJECTED: 'A teacher reviewed this AI draft and rejected it, so it was never published.',
};

/**
 * A single answer to a doubt: author-type tag, review-state chip, and content
 * as PLAIN TEXT (never HTML/markdown — student/AI-authored, untrusted).
 *
 * When `content` is null the viewer isn't entitled to the text (see `Answer`);
 * we show the state's note instead. Teachers always get real content, so this
 * placeholder path only ever affects students.
 */
export default function AnswerCard({ answer }: { answer: Answer }) {
  const displayContent = answer.editedContent ?? answer.content;
  const withheldNote = displayContent === null ? (WITHHELD_NOTE[answer.state] ?? null) : null;

  return (
    <li className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-xs font-medium text-muted-foreground">
          {answerAuthorTypeLabel(answer.authorType)}
        </span>
        <StatusBadge outcome={answerStateOutcome(answer.state)}>{answerStateLabel(answer.state)}</StatusBadge>
        <span className="ml-auto font-mono text-[0.7rem] text-muted-foreground">
          {formatTimestamp(answer.createdAt)}
        </span>
      </div>

      {displayContent !== null ? (
        <p className="plain-text mt-2 text-sm">{displayContent}</p>
      ) : (
        <p className="mt-2 flex items-start gap-2 text-sm italic text-muted-foreground">
          <span aria-hidden="true">{answer.state === 'PENDING_REVIEW' ? '⏳' : '—'}</span>
          {withheldNote ?? 'This answer is not available.'}
        </p>
      )}

      {answer.state === 'REJECTED' && answer.reviewNote != null && (
        <p className="plain-text mt-2 text-sm italic text-[var(--fail)]">Teacher&rsquo;s note — {answer.reviewNote}</p>
      )}
    </li>
  );
}
