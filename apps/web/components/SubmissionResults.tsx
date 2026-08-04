import type { SubmissionDetail } from '@/lib/api';
import { statusOutcome } from '@/lib/status';
import StatusBadge from './StatusBadge';
import VerdictStamp from './VerdictStamp';
import FeedbackCard from './FeedbackCard';

/**
 * The verdict panel: the stamped outcome, a per-test-case breakdown (hidden
 * cases redacted server-side), and the AI feedback card. Pure presentational
 * — works from Server or Client trees.
 *
 * `onRefreshFeedback`/`refreshingFeedback` (and the regenerate pair) come only
 * from client callers that can re-fetch (LiveSubmissionView); server renders omit them.
 */
export default function SubmissionResults({
  submission,
  onRefreshFeedback,
  refreshingFeedback,
  onRegenerateFeedback,
  regeneratingFeedback,
}: {
  submission: SubmissionDetail;
  onRefreshFeedback?: () => void;
  refreshingFeedback?: boolean;
  onRegenerateFeedback?: () => void;
  regeneratingFeedback?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <VerdictStamp status={submission.status} score={submission.score} outcome={statusOutcome(submission.status)} />
        <span className="font-mono text-xs text-muted-foreground">
          {submission.results.length} case{submission.results.length === 1 ? '' : 's'}
        </span>
      </div>

      {submission.results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No test results yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {submission.results.map((result, index) => {
            const outcome = statusOutcome(result.status);
            const hasOutput = !result.hidden && (result.stdout || result.stderr);
            return (
              <li key={result.testCaseId} className="rounded-lg border border-border bg-card/60 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <StatusBadge outcome={outcome} dot>
                    {result.status}
                  </StatusBadge>
                  {result.hidden ? (
                    <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                      <LockIcon className="size-3" /> hidden case
                    </span>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">Case {index + 1}</span>
                  )}
                  {typeof result.timeMs === 'number' && (
                    <span className="ml-auto font-mono text-[0.7rem] tabular-nums text-muted-foreground">
                      {result.timeMs} ms
                    </span>
                  )}
                </div>

                {hasOutput && (
                  <details className="mt-2 group">
                    <summary className="cursor-pointer select-none font-mono text-xs text-muted-foreground hover:text-foreground">
                      Output
                    </summary>
                    {result.stdout && <OutputBlock label="stdout" value={result.stdout} />}
                    {result.stderr && <OutputBlock label="stderr" value={result.stderr} tone="fail" />}
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <FeedbackCard
        feedbackStatus={submission.feedbackStatus}
        feedback={submission.feedback}
        onRefresh={onRefreshFeedback}
        refreshing={refreshingFeedback}
        onRegenerate={onRegenerateFeedback}
        regenerating={regeneratingFeedback}
      />
    </div>
  );
}

function OutputBlock({ label, value, tone }: { label: string; value: string; tone?: 'fail' }) {
  return (
    <pre
      className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs"
      style={tone === 'fail' ? { color: 'var(--fail)' } : undefined}
    >
      <span className="mb-1 block text-[0.65rem] uppercase tracking-wider opacity-60">{label}</span>
      {value}
    </pre>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
