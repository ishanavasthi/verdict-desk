'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import SubmissionResults from './SubmissionResults';
import type { CreateSubmissionResponse, McqOption, QuestionKind, SubmissionDetail } from '@/lib/api';

type Phase = 'idle' | 'submitting' | 'error';

/**
 * The MCQ/INTEGER counterpart to <SubmitEditor>. No code editor, no
 * grading-queue polling — these kinds grade synchronously server-side, so a
 * single POST followed by one GET is enough to land on a terminal verdict.
 */
export default function AnswerEditor({
  problemId,
  kind,
  options,
}: {
  problemId: string;
  kind: QuestionKind;
  options: McqOption[] | null;
}) {
  const router = useRouter();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [integerAnswer, setIntegerAnswer] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);

  const answer = kind === 'MCQ' ? selectedOptionId : integerAnswer.trim();
  const canSubmit = phase !== 'submitting' && !!answer;

  async function handleSubmit() {
    if (!answer) return;
    setErrorMessage(null);
    setSubmission(null);
    setPhase('submitting');

    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemId, code: answer }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (res.status === 400) {
        setErrorMessage('That answer was rejected — check the format and try again.');
        setPhase('error');
        return;
      }
      if (!res.ok) {
        setErrorMessage(`Submit failed (status ${res.status}).`);
        setPhase('error');
        return;
      }

      const created: CreateSubmissionResponse = await res.json();

      const detailRes = await fetch(`/api/submissions/${created.id}`, { cache: 'no-store' });
      if (detailRes.status === 401) {
        router.push('/login');
        return;
      }
      if (!detailRes.ok) {
        setErrorMessage(`Could not load the verdict (status ${detailRes.status}).`);
        setPhase('error');
        return;
      }

      const detail: SubmissionDetail = await detailRes.json();
      setSubmission(detail);
      setPhase('idle');
    } catch {
      setErrorMessage('Could not reach the server. Is the API running?');
      setPhase('error');
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="eyebrow">Chamber · {kind === 'MCQ' ? 'Multiple choice' : 'Integer'}</span>
        <Badge variant="outline" className="font-mono text-[0.65rem] text-muted-foreground">
          {kind}
        </Badge>
        <div className="ml-auto flex items-center gap-2.5">
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit} className="gap-1.5">
            {phase === 'submitting' && <span className="spinner-on-primary" aria-hidden="true" />}
            {phase === 'submitting' ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </div>

      {/* Answer input */}
      <div className="min-h-[160px] flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        {kind === 'MCQ' ? (
          <fieldset className="flex flex-col gap-2.5">
            <legend className="eyebrow mb-1">Choose one</legend>
            {(options ?? []).map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card/60 px-3.5 py-2.5 text-sm transition-colors has-[:checked]:border-primary/50 has-[:checked]:bg-accent/40"
              >
                <input
                  type="radio"
                  name="mcq-option"
                  value={option.id}
                  checked={selectedOptionId === option.id}
                  onChange={() => setSelectedOptionId(option.id)}
                  className="mt-0.5"
                />
                <span className="plain-text text-foreground/90">{option.text}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="flex max-w-xs flex-col gap-2">
            <label htmlFor="integer-answer" className="eyebrow">
              Your answer
            </label>
            <Input
              id="integer-answer"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 42"
              value={integerAnswer}
              onChange={(e) => setIntegerAnswer(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Verdict */}
      <div className="max-h-[46%] shrink-0 overflow-y-auto border-t border-border bg-muted/20">
        {phase === 'error' && errorMessage ? (
          <p
            className="m-4 rounded-md border px-3 py-2 text-sm"
            style={{
              borderColor: 'color-mix(in srgb, var(--fail) 35%, transparent)',
              background: 'color-mix(in srgb, var(--fail) 10%, transparent)',
              color: 'var(--fail)',
            }}
          >
            {errorMessage}
          </p>
        ) : submission ? (
          <SubmissionResults submission={submission} />
        ) : (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
            <span className="font-mono text-brass">▸</span>
            Submit your answer to see the verdict.
          </div>
        )}
      </div>
    </div>
  );
}
