import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAuthToken } from '@/lib/auth';
import { ApiError, getSubmission, type SubmissionDetail } from '@/lib/api';
import LiveSubmissionView from '@/components/LiveSubmissionView';
import { Button } from '@/components/ui/button';
import PageShell from '@/components/PageShell';

export const dynamic = 'force-dynamic';

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const token = await getAuthToken();
  if (!token) {
    redirect('/login');
  }

  let submission: SubmissionDetail;
  let unreachable = false;
  try {
    submission = await getSubmission(id, token);
  } catch (err) {
    // The API returns 404 for both "no such submission" and "not owned by
    // you" — either way there's nothing to render.
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    if (err instanceof ApiError && err.status === 401) {
      redirect('/login');
    }
    unreachable = true;
    submission = {
      id,
      problemId: '',
      problemKind: 'CODE',
      submittedAnswer: null,
      status: 'QUEUED',
      score: null,
      results: [],
      feedbackStatus: 'PENDING',
      feedback: null,
    };
  }

  return (
    <PageShell
      eyebrow="Ruling"
      title="Submission"
      actions={
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/history" />}>
          ← History
        </Button>
      }
    >
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {unreachable ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">Could not load this submission — API unreachable.</p>
        ) : (
          <LiveSubmissionView initial={submission} />
        )}
      </div>
    </PageShell>
  );
}
