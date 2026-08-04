'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import SubmissionResults from './SubmissionResults';
import LiveSubmissionView from './LiveSubmissionView';
import { isTerminalStatus, type CreateSubmissionResponse, type SubmissionDetail } from '../lib/api';

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 30; // ~30s cap before we tell the user to check back later.

type Phase = 'idle' | 'submitting' | 'polling' | 'busy' | 'timeout' | 'error';

function starterCode(problemTitle: string): string {
  return `// ${problemTitle}\n// Write your solution below, then hit Submit.\n`;
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
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
      }
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

      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }

      const data: SubmissionDetail = await res.json();
      if (!mountedRef.current) return;
      setSubmission(data);

      if (isTerminalStatus(data.status)) {
        setPhase('idle');
        stopPolling();
        return;
      }
    } catch {
      // Transient errors while polling are swallowed — we just keep trying
      // until the cap is hit.
    }

    if (!mountedRef.current) return;

    if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
      setPhase('timeout');
      stopPolling();
      return;
    }

    pollTimer.current = setTimeout(() => pollSubmission(id), POLL_INTERVAL_MS);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    <section className="card editor-card">
      <h2>Your solution</h2>
      <form onSubmit={handleSubmit} className="editor-form">
        <textarea
          className="code-editor"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          spellCheck={false}
          rows={16}
          aria-label="Solution code"
        />
        <div className="editor-actions">
          <button type="submit" className="btn btn-primary" disabled={isBusy}>
            {phase === 'submitting' ? 'Submitting…' : phase === 'polling' ? 'Grading…' : 'Submit'}
          </button>
          {phase === 'polling' && <span className="hint">Waiting for results…</span>}
        </div>
      </form>

      {phase === 'busy' && (
        <p className="form-error">Grading queue is busy right now — please retry in a few seconds.</p>
      )}
      {phase === 'error' && errorMessage && <p className="form-error">{errorMessage}</p>}
      {phase === 'timeout' && (
        <p className="form-error">
          Grading is taking longer than expected. Check the <a href="/history">History</a> page shortly for the
          result.
        </p>
      )}

      {submission &&
        (isTerminalStatus(submission.status) ? (
          // Grading finished — hand off to the live view, which keeps the AI
          // feedback fresh (poll + manual refresh) without a page reload.
          <LiveSubmissionView initial={submission} key={submission.id} />
        ) : (
          // Still grading — show the in-progress snapshot (no feedback poll yet).
          <SubmissionResults submission={submission} />
        ))}
    </section>
  );
}
