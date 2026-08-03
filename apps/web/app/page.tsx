import { getHealth, getProblems, type HealthResponse, type Problem } from '../lib/api';

// This page renders a DB row through the API at request time — the whole point
// of the M0 walking skeleton. `force-dynamic` ensures `next build` never tries
// to reach the API at build time (it may not be running).
export const dynamic = 'force-dynamic';

async function loadHealth(): Promise<{ health: HealthResponse | null; unreachable: boolean }> {
  try {
    const health = await getHealth();
    return { health, unreachable: false };
  } catch {
    return { health: null, unreachable: true };
  }
}

async function loadProblems(): Promise<{ problems: Problem[]; unreachable: boolean }> {
  try {
    const problems = await getProblems();
    return { problems, unreachable: false };
  } catch {
    return { problems: [], unreachable: true };
  }
}

function HealthBadge({
  health,
  unreachable,
}: {
  health: HealthResponse | null;
  unreachable: boolean;
}) {
  if (unreachable || !health) {
    return (
      <span className="badge badge-error">
        <span className="dot" aria-hidden="true" />
        API unreachable
      </span>
    );
  }

  if (health.db === 'up') {
    return (
      <span className="badge badge-ok">
        <span className="dot" aria-hidden="true" />
        API &#10003; &middot; DB &#10003;
      </span>
    );
  }

  return (
    <span className="badge badge-error">
      <span className="dot" aria-hidden="true" />
      API &#10003; &middot; DB down
    </span>
  );
}

export default async function HomePage() {
  const [{ health, unreachable: healthUnreachable }, { problems, unreachable: problemsUnreachable }] =
    await Promise.all([loadHealth(), loadProblems()]);

  return (
    <main className="container">
      <header className="page-header">
        <h1>verdict-desk</h1>
        <HealthBadge health={health} unreachable={healthUnreachable} />
      </header>

      <section className="card">
        <h2>Problems</h2>

        {problemsUnreachable ? (
          <p className="empty-state">
            API not running — start it with <code>make dev</code>
          </p>
        ) : problems.length === 0 ? (
          <p className="empty-state">No problems yet. Seed the database to get started.</p>
        ) : (
          <ul className="problem-list">
            {problems.map((problem) => (
              <li key={problem.id} className="problem-item">
                <span className="problem-title">{problem.title}</span>
                <span className="difficulty-pill">{problem.difficulty}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
