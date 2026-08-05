import type { FeedbackGenerationStatus, SubmissionFeedback } from '@/lib/api';
import { feedbackSeverityLabel, severityOutcome } from '@/lib/status';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import StatusBadge from './StatusBadge';

/**
 * The "AI-generated feedback · unreviewed" card. Purely presentational; the
 * caller decides whether a refresh affordance exists via `onRefresh`.
 *
 * State → UI:
 *  - SKIPPED → renders nothing (an ERRORed submission has no code to critique).
 *  - PENDING → "generating…" with a spinner, plus Refresh and (since a
 *    fire-and-forget job can die with the process, stranding this state) Retry.
 *  - READY   → severity chip + summary + suggestions.
 *  - FAILED (or READY with no content) → graceful fallback note.
 *
 * `content` fields are untrusted LLM output rendered as PLAIN TEXT only.
 */
export default function FeedbackCard({
  feedbackStatus,
  feedback,
  onRefresh,
  refreshing = false,
  onRegenerate,
  regenerating = false,
}: {
  feedbackStatus: FeedbackGenerationStatus;
  feedback: SubmissionFeedback | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  if (feedbackStatus === 'SKIPPED') return null;

  return (
    <div className="rounded-xl border border-brass/25 bg-brass/[0.06] p-3.5">
      <div className="flex items-center gap-2">
        <RobotIcon className="size-4 text-brass" />
        <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-brass">
          AI feedback · unreviewed
        </span>
        {feedbackStatus === 'PENDING' && onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs text-muted-foreground"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
        {/*
          PENDING gets Regenerate as well as Refresh. Generation is
          fire-and-forget, so a restart can leave a submission pending with no
          job behind it — refreshing then never resolves. Regenerating re-fires
          it (the API accepts PENDING and FAILED for exactly this reason).
        */}
        {(feedbackStatus === 'FAILED' || feedbackStatus === 'PENDING') && onRegenerate && (
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 px-2 text-xs text-muted-foreground', feedbackStatus === 'FAILED' && 'ml-auto')}
            onClick={onRegenerate}
            disabled={regenerating}
          >
            {regenerating ? 'Regenerating…' : feedbackStatus === 'PENDING' ? 'Retry' : 'Regenerate'}
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Automated code-quality notes — not verified by a human.</p>

      {feedbackStatus === 'PENDING' ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="spinner" aria-hidden="true" />
          Generating AI feedback…
          <span className="opacity-80">the model can take a minute or two.</span>
        </p>
      ) : feedbackStatus === 'READY' && feedback?.content ? (
        <div className="mt-3 flex flex-col gap-3">
          <StatusBadge outcome={severityOutcome(feedback.content.severity)}>
            {feedbackSeverityLabel(feedback.content.severity)}
          </StatusBadge>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{feedback.content.summary}</p>
          {feedback.content.suggestions.length > 0 && (
            <ul className="flex flex-col gap-2">
              {feedback.content.suggestions.map((suggestion, index) => (
                <li key={index} className="rounded-lg border border-border bg-card/70 px-3 py-2">
                  <strong className="block text-sm font-medium">{suggestion.title}</strong>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {suggestion.detail}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">AI feedback couldn&rsquo;t be generated for this submission.</p>
      )}
    </div>
  );
}

function RobotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2M20 14h2M15 13v2M9 13v2M12 2v4M9 6h6" />
    </svg>
  );
}
