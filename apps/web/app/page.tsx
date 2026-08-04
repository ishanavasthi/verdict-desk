import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/auth';
import { getProblems, type Problem, type QuestionKind } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import PageShell from '@/components/PageShell';

function kindLabel(kind: QuestionKind): string {
  return kind === 'INTEGER' ? 'INT' : kind;
}

// Auth-gated: reads the request cookie via `getMe()`, so this can never be
// statically rendered at build time (and the API may not even be running
// during `next build`).
export const dynamic = 'force-dynamic';

async function loadProblems(): Promise<{ problems: Problem[]; unreachable: boolean }> {
  try {
    return { problems: await getProblems(), unreachable: false };
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
    <PageShell eyebrow="Docket" title="Problems" description="Pick a case, submit your solution, and let the bench rule on it.">
      {unreachable ? (
        <EmptyCard>
          API not running — start it with <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">make dev</code>
        </EmptyCard>
      ) : problems.length === 0 ? (
        <EmptyCard>No problems yet. Seed the database to get started.</EmptyCard>
      ) : (
        <ul className="flex flex-col gap-2">
          {problems.map((problem, index) => (
            <li key={problem.id}>
              <Link
                href={`/problems/${problem.id}`}
                className="group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 font-medium">{problem.title}</span>
                <Badge variant="outline" className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  {kindLabel(problem.kind)}
                </Badge>
                {problem.difficulty && (
                  <Badge variant="outline" className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                    {problem.difficulty}
                  </Badge>
                )}
                <span className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
