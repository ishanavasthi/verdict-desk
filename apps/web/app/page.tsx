import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe } from '../lib/auth';
import { getProblems, type Problem } from '../lib/api';
import LogoutButton from '../components/LogoutButton';
import NavLinks from '../components/NavLinks';

// Auth-gated: reads the request cookie via `getMe()`, so this can never be
// statically rendered at build time (and the API may not even be running
// during `next build`).
export const dynamic = 'force-dynamic';

async function loadProblems(): Promise<{ problems: Problem[]; unreachable: boolean }> {
  try {
    const problems = await getProblems();
    return { problems, unreachable: false };
  } catch {
    return { problems: [], unreachable: true };
  }
}

export default async function HomePage() {
  const user = await getMe();
  if (!user) {
    redirect('/login');
  }

  const { problems, unreachable } = await loadProblems();

  return (
    <main className="container">
      <header className="page-header">
        <div>
          <h1>verdict-desk</h1>
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
        <h2>Problems</h2>

        {unreachable ? (
          <p className="empty-state">
            API not running — start it with <code>make dev</code>
          </p>
        ) : problems.length === 0 ? (
          <p className="empty-state">No problems yet. Seed the database to get started.</p>
        ) : (
          <ul className="problem-list">
            {problems.map((problem) => (
              <li key={problem.id} className="problem-item">
                <Link href={`/problems/${problem.id}`} className="problem-link">
                  <span className="problem-title">{problem.title}</span>
                  <span className="difficulty-pill">{problem.difficulty ?? 'n/a'}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
