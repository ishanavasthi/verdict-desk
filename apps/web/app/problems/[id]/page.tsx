import { notFound, redirect } from 'next/navigation';
import { getAuthToken } from '@/lib/auth';
import { getProblemDetail, isNotFoundish, type ProblemDetail } from '@/lib/api';
import ProblemWorkspace from '@/components/ProblemWorkspace';

export const dynamic = 'force-dynamic';

export default async function ProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const token = await getAuthToken();
  if (!token) {
    redirect('/login');
  }

  let problem: ProblemDetail;
  try {
    problem = await getProblemDetail(id);
  } catch (err) {
    if (isNotFoundish(err)) {
      notFound();
    }
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Could not load this problem — API unreachable.
        </div>
      </main>
    );
  }

  return <ProblemWorkspace problem={problem} />;
}
