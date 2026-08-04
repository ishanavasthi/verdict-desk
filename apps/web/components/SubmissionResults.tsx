import type { SubmissionDetail } from '../lib/api';
import { statusBadgeClass, submissionStatusLabel } from '../lib/status';
import FeedbackCard from './FeedbackCard';

/**
 * Renders the outcome of a single submission: overall status/score plus a
 * per-test-case breakdown and the AI feedback card. Pure presentational, no
 * client-only APIs, so it works from either a Server or Client Component tree.
 *
 * `onRefreshFeedback`/`refreshingFeedback` are only supplied by client callers
 * that can re-fetch (e.g. `LiveSubmissionView`); server renders omit them.
 */
export default function SubmissionResults({
  submission,
  onRefreshFeedback,
  refreshingFeedback,
}: {
  submission: SubmissionDetail;
  onRefreshFeedback?: () => void;
  refreshingFeedback?: boolean;
}) {
  return (
    <div className="results">
      <div className="results-summary">
        <span className={`badge ${statusBadgeClass(submission.status)}`}>
          {submissionStatusLabel(submission.status)}
        </span>
        <span className="score-pill">Score: {submission.score !== null ? `${submission.score}%` : '—'}</span>
      </div>

      {submission.results.length === 0 ? (
        <p className="empty-state">No test results yet.</p>
      ) : (
        <ul className="result-list">
          {submission.results.map((result, index) => (
            <li key={result.testCaseId} className="result-item">
              <div className="result-item-header">
                <span className={`badge badge-sm ${statusBadgeClass(result.status)}`}>{result.status}</span>
                {result.hidden ? (
                  <span className="hidden-label">&#128274; hidden</span>
                ) : (
                  <span className="test-id">Test {index + 1}</span>
                )}
                {typeof result.timeMs === 'number' && <span className="time-ms">{result.timeMs} ms</span>}
              </div>
              {!result.hidden && (result.stdout || result.stderr) && (
                <details className="result-output">
                  <summary>Output</summary>
                  {result.stdout && (
                    <pre className="output-block">
                      <strong>stdout</strong>
                      {'\n'}
                      {result.stdout}
                    </pre>
                  )}
                  {result.stderr && (
                    <pre className="output-block output-stderr">
                      <strong>stderr</strong>
                      {'\n'}
                      {result.stderr}
                    </pre>
                  )}
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <FeedbackCard
        feedbackStatus={submission.feedbackStatus}
        feedback={submission.feedback}
        onRefresh={onRefreshFeedback}
        refreshing={refreshingFeedback}
      />
    </div>
  );
}
