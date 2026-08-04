import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAuthToken, getMe } from '../../../lib/auth';
import { ApiError, getDoubt, type Doubt } from '../../../lib/api';
import AnswerCard from '../../../components/AnswerCard';
import NavLinks from '../../../components/NavLinks';
import LogoutButton from '../../../components/LogoutButton';

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
    <main className="container">
      <header className="page-header">
        <h1>Doubt</h1>
        <div className="header-actions">
          <NavLinks role={user.role} />
          <LogoutButton />
        </div>
      </header>

      <section className="card">
        {unreachable ? (
          <p className="empty-state">Could not load this doubt — API unreachable.</p>
        ) : (
          <>
            <div className="doubt-item-header">
              <h2>{doubt.title}</h2>
              <span className="doubt-author">{doubt.author?.name ?? doubt.author?.email ?? 'Unknown'}</span>
            </div>
            <p className="doubt-body plain-text">{doubt.body}</p>
            {doubt.problemId && (
              <Link href={`/problems/${doubt.problemId}`} className="difficulty-pill">
                Related problem
              </Link>
            )}

            <h3 className="answers-heading">Answers</h3>
            {doubt.answers.length === 0 ? (
              <p className="empty-state">No answers yet.</p>
            ) : (
              <ul className="answer-list">
                {doubt.answers.map((answer) => (
                  <AnswerCard
                    key={answer.id}
                    answer={answer}
                    hidePendingContent={isOwn && answer.authorType === 'AI' && answer.state === 'PENDING_REVIEW'}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}
