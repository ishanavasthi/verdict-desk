import { Badge } from '@/components/ui/badge';
import type { ProblemDetail } from '@/lib/api';

/**
 * The left compartment: the case file. Problem title, difficulty, the
 * statement, and sample test cases. Presentational; scrolls independently of
 * the editor on the right.
 */
export default function ProblemPanel({ problem }: { problem: ProblemDetail }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <p className="eyebrow mb-2">Docket · The case</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{problem.title}</h1>
          {problem.difficulty && (
            <Badge variant="outline" className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              {problem.difficulty}
            </Badge>
          )}
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <p className="plain-text text-[0.95rem] text-foreground/90">{problem.description}</p>

        {problem.sampleTestCases.length > 0 && (
          <section className="mt-7">
            <p className="eyebrow mb-3">Sample cases · Evidence</p>
            <ul className="flex flex-col gap-3">
              {problem.sampleTestCases.map((sample, index) => (
                <li key={index} className="overflow-hidden rounded-lg border border-border bg-muted/40">
                  <div className="flex items-center gap-2 border-b border-border/70 px-3 py-1.5">
                    <span className="font-mono text-[0.7rem] font-medium text-muted-foreground">#{index + 1}</span>
                  </div>
                  <div className="grid gap-px sm:grid-cols-2">
                    <SampleCell label="Input" value={sample.input} />
                    <SampleCell label="Expected" value={sample.expectedOutput} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function SampleCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card/60 px-3 py-2.5">
      <span className="mb-1 block font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">{label}</span>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground/90">{value}</pre>
    </div>
  );
}
