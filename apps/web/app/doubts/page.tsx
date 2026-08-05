import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthToken, getMe } from '@/lib/auth';
import { ApiError, getDoubts, getProblems, type Doubt, type Problem } from '@/lib/api';
import AnswerCard from '@/components/AnswerCard';
import DoubtForm from '@/components/DoubtForm';
import PageShell from '@/components/PageShell';
import { Button } from '@/components/ui/button';

// Auth-gated + live data: can never be statically rendered.
export const dynamic = 'force-dynamic';

async function loadProblemOptions(): Promise<Problem[]> {
  try {
    return await getProblems();
  } catch {
    return [];
  }
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
    <PageShell
      width="lg"
      eyebrow="Chambers"
      title="Doubts"
      description="Ask a question — an AI drafts an answer that a teacher must approve before anyone else sees it."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/*
          Asking is the student's role: a teacher posting a doubt would route
          their own question into their own review queue (the API returns 403
          for a teacher POST — see DoubtsController). Point them at the bench
          instead of showing a form that can only fail.
        */}
        <section className="h-fit rounded-xl border border-border bg-card p-5 lg:sticky lg:top-20">
          {user.role === 'TEACHER' ? (
            <>
              <h2 className="mb-2 text-sm font-semibold">You&rsquo;re on the bench</h2>
              <p className="text-sm text-muted-foreground">
                Students ask the questions here. AI-drafted answers wait for your ruling in the review queue —
                nothing reaches a student until you approve it.
              </p>
              <Button size="sm" className="mt-4" nativeButton={false} render={<Link href="/review" />}>
                Open review queue
              </Button>
            </>
          ) : (
            <>
              <h2 className="mb-4 text-sm font-semibold">Ask a question</h2>
              <DoubtForm problems={problems} />
            </>
          )}
        </section>

        <section>
          {unreachable ? (
            <EmptyCard>Could not load doubts — API unreachable.</EmptyCard>
          ) : doubts.length === 0 ? (
            <EmptyCard>No doubts yet — be the first to ask one.</EmptyCard>
          ) : (
            <ul className="flex flex-col gap-3">
              {doubts.map((doubt) => (
                <li key={doubt.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link href={`/doubts/${doubt.id}`} className="font-medium hover:text-primary hover:underline">
                      {doubt.title}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">
                      {doubt.author?.name ?? doubt.author?.email ?? 'Unknown'}
                    </span>
                  </div>
                  <p className="plain-text mt-2 text-sm text-muted-foreground">{doubt.body}</p>
                  {doubt.problemId && (
                    <Link
                      href={`/problems/${doubt.problemId}`}
                      className="mt-2 inline-block font-mono text-[0.7rem] text-brass hover:underline"
                    >
                      ↳ related problem
                    </Link>
                  )}

                  {doubt.answers.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-2 border-t border-dashed border-border pt-3">
                      {doubt.answers.map((answer) => (
                        <AnswerCard key={answer.id} answer={answer} />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
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
