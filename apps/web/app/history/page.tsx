import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthToken } from '@/lib/auth';
import { getSubmissionHistory, type QuestionKind, type SubmissionSummary } from '@/lib/api';
import { formatTimestamp, statusOutcome, submissionStatusLabel } from '@/lib/status';
import StatusBadge from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import PageShell from '@/components/PageShell';

function kindLabel(kind: QuestionKind): string {
  return kind === 'INTEGER' ? 'INT' : kind;
}

export const dynamic = 'force-dynamic';

async function loadHistory(token: string): Promise<{ submissions: SubmissionSummary[]; unreachable: boolean }> {
  try {
    return { submissions: await getSubmissionHistory(token), unreachable: false };
  } catch {
    return { submissions: [], unreachable: true };
  }
}

export default async function HistoryPage() {
  const token = await getAuthToken();
  if (!token) {
    redirect('/login');
  }

  const { submissions, unreachable } = await loadHistory(token);

  return (
    <PageShell eyebrow="Record" title="History" description="Every ruling on your past submissions.">
      {unreachable ? (
        <EmptyCard>Could not load submission history — API unreachable.</EmptyCard>
      ) : submissions.length === 0 ? (
        <EmptyCard>No submissions yet — solve a problem to see it here.</EmptyCard>
      ) : (
        <ul className="flex flex-col gap-2">
          {submissions.map((submission) => (
            <li key={submission.id}>
              <Link
                href={`/submissions/${submission.id}`}
                className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <StatusBadge outcome={statusOutcome(submission.status)} dot>
                  {submissionStatusLabel(submission.status)}
                </StatusBadge>
                <Badge variant="outline" className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  {kindLabel(submission.problemKind)}
                </Badge>
                <span className="font-mono text-sm font-medium tabular-nums">
                  {submission.score !== null ? `${submission.score}%` : '—'}
                </span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {formatTimestamp(submission.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
