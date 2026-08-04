import type { FeedbackGenerationStatus, SubmissionFeedback } from '../lib/api';
import { feedbackSeverityLabel } from '../lib/status';

/**
 * The "🤖 AI-GENERATED FEEDBACK · UNREVIEWED" card. Purely presentational —
 * it renders whatever `feedbackStatus`/`feedback` it's handed, and (when the
 * caller can re-fetch) exposes a manual "Refresh" affordance via `onRefresh`.
 *
 * State → UI:
 *  - SKIPPED → renders nothing (an ERRORed submission has no code to critique).
 *  - PENDING → "generating…" with a spinner; optional Refresh button.
 *  - READY   → severity badge + summary + suggestions.
 *  - FAILED (or READY with no content) → graceful fallback note.
 *
 * `content` fields are untrusted LLM output rendered as PLAIN TEXT only —
 * never as HTML/markdown — so the model can't inject markup (see api.ts).
 */
export default function FeedbackCard({
  feedbackStatus,
  feedback,
  onRefresh,
  refreshing = false,
}: {
  feedbackStatus: FeedbackGenerationStatus;
  feedback: SubmissionFeedback | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  if (feedbackStatus === 'SKIPPED') {
    return null;
  }

  return (
    <div className="feedback-card">
      <div className="feedback-header">
        <span className="feedback-label">&#129302; AI-generated feedback &middot; UNREVIEWED</span>
        {feedbackStatus === 'PENDING' && onRefresh && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
      <p className="feedback-subline">Automated code-quality notes — not verified by a human.</p>

      {feedbackStatus === 'PENDING' ? (
        <p className="feedback-placeholder">
          <span className="spinner" aria-hidden="true" />
          Generating AI feedback… <span className="feedback-hint">the model can take a minute or two.</span>
        </p>
      ) : feedbackStatus === 'READY' && feedback?.content ? (
        <div className="feedback-body">
          <span className={`badge badge-sm badge-severity-${feedback.content.severity}`}>
            {feedbackSeverityLabel(feedback.content.severity)}
          </span>
          <p className="feedback-summary">{feedback.content.summary}</p>
          {feedback.content.suggestions.length > 0 && (
            <ul className="feedback-suggestions">
              {feedback.content.suggestions.map((suggestion, index) => (
                <li key={index} className="feedback-suggestion">
                  <strong>{suggestion.title}</strong>
                  <p>{suggestion.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="feedback-note">AI feedback couldn&rsquo;t be generated for this submission.</p>
      )}
    </div>
  );
}
