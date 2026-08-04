'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import SubmissionResults from './SubmissionResults';
import LiveSubmissionView from './LiveSubmissionView';
import CodeEditor from './CodeEditor';
import { isTerminalStatus, type CreateSubmissionResponse, type SubmissionDetail } from '@/lib/api';

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 30; // ~30s cap before we tell the user to check back later.

type Phase = 'idle' | 'submitting' | 'polling' | 'busy' | 'timeout' | 'error';

function starterCode(problemTitle: string): string {
  return `// ${problemTitle}\n// Read stdin, write your answer to stdout.\n`;
}

export default function SubmitEditor({ problemId, problemTitle }: { problemId: string; problemTitle: string }) {
  const router = useRouter();
  const [code, setCode] = useState(() => starterCode(problemTitle));
  const [phase, setPhase] = useState<Phase>('idle');
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  function stopPolling() {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function pollSubmission(id: string) {
    // Poll only until grading reaches a terminal status. AI feedback (which
    // lands a moment later, and can take ~1–2 min with the live model) is then
    // handed off to <LiveSubmissionView>, which owns the feedback poll + a
    // manual refresh — so we don't duplicate that logic here.
    attemptsRef.current += 1;

    try {
      const res = await fetch(`/api/submissions/${id}`, { cache: 'no-store' });
      if (res.status === 401) {
        stopPolling();
        router.push('/login');
        return;
      }
      if (!res.ok) throw new Error(`status ${res.status}`);

      const data: SubmissionDetail = await res.json();
      if (!mountedRef.current) return;
      setSubmission(data);

      if (isTerminalStatus(data.status)) {
        setPhase('idle');
        stopPolling();
        return;
      }
    } catch {
      // Transient errors while polling are swallowed — keep trying to the cap.
    }

    if (!mountedRef.current) return;

    if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
      setPhase('timeout');
      stopPolling();
      return;
    }
    pollTimer.current = setTimeout(() => pollSubmission(id), POLL_INTERVAL_MS);
  }

  async function handleSubmit() {
    stopPolling();
    setErrorMessage(null);
    setSubmission(null);
    attemptsRef.current = 0;
    setPhase('submitting');

    try {
      const res = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problemId, code }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (res.status === 503) {
        setPhase('busy');
        return;
      }
      if (!res.ok) {
        setErrorMessage(`Submit failed (status ${res.status}).`);
        setPhase('error');
        return;
      }

      const created: CreateSubmissionResponse = await res.json();
      setPhase('polling');
      pollSubmission(created.id);
    } catch {
      setErrorMessage('Could not reach the server. Is the API running?');
      setPhase('error');
    }
  }

  const isBusy = phase === 'submitting' || phase === 'polling';

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="eyebrow">Chamber · Code</span>
        <Badge variant="outline" className="font-mono text-[0.65rem] text-muted-foreground">
          JavaScript · Node 20
        </Badge>
        <div className="ml-auto flex items-center gap-2.5">
          {phase === 'polling' && <span className="text-xs text-muted-foreground">Grading…</span>}
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isBusy}
            className="gap-1.5"
            title="Submit for grading (⌘/Ctrl + Enter)"
          >
            {isBusy && <span className="spinner-on-primary" aria-hidden="true" />}
            {phase === 'submitting' ? 'Submitting…' : phase === 'polling' ? 'Grading…' : 'Submit'}
          </Button>
        </div>
      </div>

      {/* Editor */}
      <div
        className="min-h-[240px] flex-1"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isBusy) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      >
        <CodeEditor value={code} onChange={setCode} />
      </div>

      {/* Console / verdict */}
      <div className="max-h-[46%] shrink-0 overflow-y-auto border-t border-border bg-muted/20">
        {phase === 'busy' ? (
          <ConsoleNote tone="warn">Grading queue is busy right now — please retry in a few seconds.</ConsoleNote>
        ) : phase === 'error' && errorMessage ? (
          <ConsoleNote tone="fail">{errorMessage}</ConsoleNote>
        ) : phase === 'timeout' ? (
          <ConsoleNote tone="warn">
            Grading is taking longer than expected. Check your{' '}
            <a href="/history" className="font-medium text-brass underline underline-offset-2">
              History
            </a>{' '}
            shortly.
          </ConsoleNote>
        ) : submission ? (
          isTerminalStatus(submission.status) ? (
            <LiveSubmissionView initial={submission} key={submission.id} />
          ) : (
            <SubmissionResults submission={submission} />
          )
        ) : (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
            <span className="font-mono text-brass">▸</span>
            Submit your solution to see the verdict and per-case results.
          </div>
        )}
      </div>
    </div>
  );
}

function ConsoleNote({ children, tone }: { children: React.ReactNode; tone: 'warn' | 'fail' }) {
  return (
    <p
      className="m-4 rounded-md border px-3 py-2 text-sm"
      style={{
        borderColor: `color-mix(in srgb, var(--${tone === 'warn' ? 'warn' : 'fail'}) 35%, transparent)`,
        background: `color-mix(in srgb, var(--${tone === 'warn' ? 'warn' : 'fail'}) 10%, transparent)`,
        color: `var(--${tone === 'warn' ? 'warn' : 'fail'})`,
      }}
    >
      {children}
    </p>
  );
}
