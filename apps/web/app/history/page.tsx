import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthToken } from '../../lib/auth';
import { getSubmissionHistory, type SubmissionSummary } from '../../lib/api';
import { statusBadgeClass, submissionStatusLabel } from '../../lib/status';

export const dynamic = 'force-dynamic';

async function loadHistory(token: string): Promise<{ submissions: SubmissionSummary[]; unreachable: boolean }> {
  try {
    const submissions = await getSubmissionHistory(token);
    return { submissions, unreachable: false };
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
    <main className="container">
      <header className="page-header">
        <h1>History</h1>
        <Link href="/" className="btn btn-secondary">
          ← Problems
        </Link>
      </header>

      <section className="card">
        {unreachable ? (
          <p className="empty-state">Could not load submission history — API unreachable.</p>
        ) : submissions.length === 0 ? (
          <p className="empty-state">No submissions yet — solve a problem to see it here.</p>
        ) : (
          <ul className="history-list">
            {submissions.map((submission) => (
              <li key={submission.id} className="history-item">
                <Link href={`/submissions/${submission.id}`} className="history-link">
                  <span className={`badge ${statusBadgeClass(submission.status)}`}>
                    {submissionStatusLabel(submission.status)}
                  </span>
                  <span className="history-score">
                    {submission.score !== null ? `${submission.score}%` : '—'}
                  </span>
                  <span className="history-date">{new Date(submission.createdAt).toLocaleString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
