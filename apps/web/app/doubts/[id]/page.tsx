import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAuthToken, getMe } from '@/lib/auth';
import { ApiError, getDoubt, type Doubt } from '@/lib/api';
import LiveDoubtView from '@/components/LiveDoubtView';
import PageShell from '@/components/PageShell';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function DoubtDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const token = await getAuthToken();
  if (!token) {
    redirect('/login');
  }
  const user = await getMe();
  if (!user) {
    redirect('/login');
  }

  let doubt: Doubt;
  let unreachable = false;
  try {
    doubt = await getDoubt(id, token);
  } catch (err) {
    // The API returns 404 for both "no such doubt" and "not visible to you".
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    if (err instanceof ApiError && err.status === 401) {
      redirect('/login');
    }
    unreachable = true;
    doubt = { id, problemId: null, title: '', body: '', createdAt: '', author: null, answers: [] };
  }

  const isOwn = doubt.author?.email === user.email;

  return (
    <PageShell
      eyebrow="Chambers"
      title="Doubt"
      actions={
        <Button variant="outline" size="sm" render={<Link href="/doubts" />}>
          ← Doubts
        </Button>
      }
    >
      <div className="rounded-xl border border-border bg-card p-5">
        {unreachable ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Could not load this doubt — API unreachable.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-lg font-semibold">{doubt.title}</h2>
              <span className="font-mono text-xs text-muted-foreground">
                {doubt.author?.name ?? doubt.author?.email ?? 'Unknown'}
              </span>
            </div>
            <p className="plain-text mt-2 text-sm text-foreground/90">{doubt.body}</p>
            {doubt.problemId && (
              <Link
                href={`/problems/${doubt.problemId}`}
                className="mt-2 inline-block font-mono text-[0.7rem] text-brass hover:underline"
              >
                ↳ related problem
              </Link>
            )}

            <LiveDoubtView doubt={doubt} isOwn={isOwn} />
          </>
        )}
      </div>
    </PageShell>
  );
}
