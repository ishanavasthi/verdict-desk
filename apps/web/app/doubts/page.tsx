import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthToken, getMe } from '../../lib/auth';
import { ApiError, getDoubts, getProblems, type Doubt, type Problem, type User } from '../../lib/api';
import AnswerCard from '../../components/AnswerCard';
import DoubtForm from '../../components/DoubtForm';
import NavLinks from '../../components/NavLinks';
import LogoutButton from '../../components/LogoutButton';

// Auth-gated + live data: can never be statically rendered, and the API may
// not even be running during `next build`.
export const dynamic = 'force-dynamic';

async function loadProblemOptions(): Promise<Problem[]> {
  try {
    return await getProblems();
  } catch {
    return [];
  }
}

function isOwnDoubt(user: User, doubt: Doubt): boolean {
  return doubt.author?.email === user.email;
}

export default async function DoubtsPage() {
  const token = await getAuthToken();
  if (!token) {
    redirect('/login');
  }
  const user = await getMe();
  if (!user) {
    redirect('/login');
  }

  let doubts: Doubt[] = [];
  let unreachable = false;
  try {
    doubts = await getDoubts(token);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      redirect('/login');
    }
    unreachable = true;
  }

  const problems = await loadProblemOptions();

  return (
    <main className="container container-wide">
      <header className="page-header">
        <div>
          <h1>Doubts</h1>
          <p className="user-meta">
            {user.email} <span className="role-pill">{user.role.toLowerCase()}</span>
          </p>
        </div>
        <div className="header-actions">
          <NavLinks role={user.role} />
          <LogoutButton />
        </div>
      </header>

      <section className="card">
        <h2>Ask a question</h2>
        <DoubtForm problems={problems} />
      </section>

      <section className="card doubt-board-card">
        <h2>Doubt board</h2>

        {unreachable ? (
          <p className="empty-state">Could not load doubts — API unreachable.</p>
        ) : doubts.length === 0 ? (
          <p className="empty-state">No doubts yet — be the first to ask one above.</p>
        ) : (
          <ul className="doubt-list">
            {doubts.map((doubt) => (
              <li key={doubt.id} className="doubt-item">
                <div className="doubt-item-header">
                  <Link href={`/doubts/${doubt.id}`} className="doubt-title-link">
                    <h3>{doubt.title}</h3>
                  </Link>
                  <span className="doubt-author">{doubt.author?.name ?? doubt.author?.email ?? 'Unknown'}</span>
                </div>
                <p className="doubt-body plain-text">{doubt.body}</p>
                {doubt.problemId && (
                  <Link href={`/problems/${doubt.problemId}`} className="difficulty-pill">
                    Related problem
                  </Link>
                )}

                {doubt.answers.length === 0 ? (
                  <p className="empty-state">No answers yet.</p>
                ) : (
                  <ul className="answer-list">
                    {doubt.answers.map((answer) => (
                      <AnswerCard
                        key={answer.id}
                        answer={answer}
                        hidePendingContent={
                          isOwnDoubt(user, doubt) && answer.authorType === 'AI' && answer.state === 'PENDING_REVIEW'
                        }
                      />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
