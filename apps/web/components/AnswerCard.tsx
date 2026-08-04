import type { Answer } from '@/lib/api';
import { answerAuthorTypeLabel, answerStateLabel, answerStateOutcome } from '@/lib/status';
import StatusBadge from './StatusBadge';

/**
 * A single answer to a doubt: author-type tag, review-state chip, and content
 * as PLAIN TEXT (never HTML/markdown — student/AI-authored, untrusted).
 *
 * `hidePendingContent`: when the viewer is the doubt's own author and this is
 * their own still-PENDING_REVIEW AI answer, the raw draft is withheld and
 * replaced with an "awaiting review" note.
 */
export default function AnswerCard({
  answer,
  hidePendingContent,
}: {
  answer: Answer;
  hidePendingContent: boolean;
}) {
  const displayContent = answer.editedContent ?? answer.content;

  return (
    <li className="rounded-lg border border-border bg-muted/30 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-xs font-medium text-muted-foreground">
          {answerAuthorTypeLabel(answer.authorType)}
        </span>
        <StatusBadge outcome={answerStateOutcome(answer.state)}>{answerStateLabel(answer.state)}</StatusBadge>
        <span className="ml-auto font-mono text-[0.7rem] text-muted-foreground">
          {new Date(answer.createdAt).toLocaleString()}
        </span>
      </div>

      {hidePendingContent ? (
        <p className="mt-2 flex items-start gap-2 text-sm italic text-[var(--warn)]">
          <span aria-hidden="true">⏳</span>
          Awaiting teacher review — a teacher will review this AI-generated answer before it&rsquo;s shown to you.
        </p>
      ) : (
        <p className="plain-text mt-2 text-sm">{displayContent}</p>
      )}

      {answer.state === 'REJECTED' && answer.reviewNote != null && (
        <p className="plain-text mt-2 text-sm italic text-[var(--fail)]">Rejected — {answer.reviewNote}</p>
      )}
    </li>
  );
}
