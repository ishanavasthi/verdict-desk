import type { Answer } from '../lib/api';
import { answerAuthorTypeLabel, answerStateBadgeClass, answerStateLabel } from '../lib/status';

/**
 * Renders a single answer to a doubt: author-type tag, review-state badge,
 * and its content as PLAIN TEXT (never HTML/markdown — content is student-
 * or AI-authored and untrusted).
 *
 * `hidePendingContent`: when true (the viewer is the doubt's own author and
 * this is their doubt's own still-PENDING_REVIEW AI answer), the raw
 * unreviewed draft is withheld and replaced with a "awaiting review" note —
 * the student is told an answer is coming, but doesn't get an early,
 * unvetted look at it.
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
    <li className="answer-item">
      <div className="answer-header">
        <span className="author-type-tag">{answerAuthorTypeLabel(answer.authorType)}</span>
        <span className={`badge badge-sm ${answerStateBadgeClass(answer.state)}`}>
          {answerStateLabel(answer.state)}
        </span>
        <span className="answer-date">{new Date(answer.createdAt).toLocaleString()}</span>
      </div>

      {hidePendingContent ? (
        <p className="answer-pending-note">
          &#8987; awaiting teacher review &mdash; a teacher will review this AI-generated answer before it&rsquo;s
          shown to you.
        </p>
      ) : (
        <p className="answer-content plain-text">{displayContent}</p>
      )}
    </li>
  );
}
