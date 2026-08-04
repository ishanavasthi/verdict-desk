import type { SubmissionDetail } from '../lib/api';
import { feedbackSeverityLabel, statusBadgeClass, submissionStatusLabel } from '../lib/status';

/**
 * Renders the outcome of a single submission: overall status/score plus a
 * per-test-case breakdown. Used both by the live editor (after polling
 * reaches a terminal status) and by the static `/submissions/[id]` page —
 * pure presentational, no client-only APIs, so it works from either a
 * Server or a Client Component tree.
 */
export default function SubmissionResults({ submission }: { submission: SubmissionDetail }) {
  const { feedback } = submission;
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

      <div className="feedback-card">
        <div className="feedback-header">
          <span className="feedback-label">&#129302; AI-generated feedback &middot; UNREVIEWED</span>
        </div>
        <p className="feedback-subline">Automated code-quality notes — not verified by a human.</p>

        {feedback === null ? (
          <p className="feedback-placeholder">Generating AI feedback&hellip;</p>
        ) : feedback.status === 'VALID' && feedback.content ? (
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
    </div>
  );
}
