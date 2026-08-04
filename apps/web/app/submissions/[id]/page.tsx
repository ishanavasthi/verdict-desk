import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAuthToken } from '../../../lib/auth';
import { ApiError, getSubmission, type SubmissionDetail } from '../../../lib/api';
import SubmissionResults from '../../../components/SubmissionResults';

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
    submission = { id, problemId: '', status: 'QUEUED', score: null, results: [], feedback: null };
  }

  return (
    <main className="container">
      <header className="page-header">
        <h1>Submission</h1>
        <Link href="/history" className="btn btn-secondary">
          ← History
        </Link>
      </header>

      <section className="card">
        {unreachable ? (
          <p className="empty-state">Could not load this submission — API unreachable.</p>
        ) : (
          <SubmissionResults submission={submission} />
        )}
      </section>
    </main>
  );
}
