import { submissionStatusLabel } from '@/lib/status';
import type { Outcome } from '@/lib/status';
import type { SubmissionStatus } from '@/lib/api';

/**
 * The signature element. When a submission reaches a terminal status its
 * outcome is rendered as a stamped bench verdict — a letter-spaced mono block
 * inside a double rule, tinted pass/fail/warn. The one bold thing on the page.
 */
export default function VerdictStamp({
  status,
  score,
  outcome,
}: {
  status: SubmissionStatus;
  score: number | null;
  outcome: Outcome;
}) {
  return (
    <div className="verdict-stamp" data-outcome={outcome === 'info' ? 'pass' : outcome}>
      <span className="text-[0.6rem] font-medium uppercase tracking-[0.3em] opacity-70">Verdict</span>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold uppercase tracking-[0.12em]">{submissionStatusLabel(status)}</span>
        {score !== null && <span className="text-sm tabular-nums opacity-80">· {score}</span>}
      </div>
    </div>
  );
}
