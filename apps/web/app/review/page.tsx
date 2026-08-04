import { redirect } from 'next/navigation';
import { getAuthToken, getMe } from '@/lib/auth';
import { getReviewQueue, type ReviewQueueItem } from '@/lib/api';
import ReviewQueueList from '@/components/ReviewQueueList';
import PageShell from '@/components/PageShell';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const token = await getAuthToken();
  if (!token) {
    redirect('/login');
  }
  const user = await getMe();
  if (!user) {
    redirect('/login');
  }
  if (user.role !== 'TEACHER') {
    redirect('/');
  }

  let queue: ReviewQueueItem[] = [];
  let unreachable = false;
  try {
    queue = await getReviewQueue(token);
  } catch {
    unreachable = true;
  }

  return (
    <PageShell
      width="lg"
      eyebrow="The bench"
      title="Review queue"
      description="AI-drafted answers awaiting your ruling. Nothing reaches a student until you approve it."
    >
      {unreachable ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground">
          Could not load the review queue — API unreachable.
        </div>
      ) : (
        <ReviewQueueList initialQueue={queue} />
      )}
    </PageShell>
  );
}
