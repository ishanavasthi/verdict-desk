import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAuthToken } from '../../../lib/auth';
import { ApiError, getProblemDetail, type ProblemDetail } from '../../../lib/api';
import SubmitEditor from '../../../components/SubmitEditor';

export const dynamic = 'force-dynamic';

export default async function ProblemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const token = await getAuthToken();
  if (!token) {
    redirect('/login');
  }

  let problem: ProblemDetail;
  let unreachable = false;
  try {
    problem = await getProblemDetail(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    unreachable = true;
    problem = { id, title: '', description: '', difficulty: null, sampleTestCases: [] };
  }

  return (
    <main className="container">
      <header className="page-header">
        <Link href="/" className="btn btn-secondary">
          ← Problems
        </Link>
      </header>

      {unreachable ? (
        <section className="card">
          <p className="empty-state">Could not load this problem — API unreachable.</p>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="problem-detail-header">
              <h1>{problem.title}</h1>
              <span className="difficulty-pill">{problem.difficulty ?? 'n/a'}</span>
            </div>
            <p className="problem-description">{problem.description}</p>

            {problem.sampleTestCases.length > 0 && (
              <div className="sample-cases">
                <h3>Sample test cases</h3>
                <ul className="sample-case-list">
                  {problem.sampleTestCases.map((sample, index) => (
                    <li key={index} className="sample-case">
                      <div>
                        <span className="sample-label">Input</span>
                        <pre className="output-block">{sample.input}</pre>
                      </div>
                      <div>
                        <span className="sample-label">Expected output</span>
                        <pre className="output-block">{sample.expectedOutput}</pre>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <SubmitEditor problemId={problem.id} problemTitle={problem.title} />
        </>
      )}
    </main>
  );
}
