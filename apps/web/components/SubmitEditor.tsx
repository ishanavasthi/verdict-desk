'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import SubmissionResults from './SubmissionResults';
import { isTerminalStatus, type CreateSubmissionResponse, type SubmissionDetail } from '../lib/api';

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 30; // ~30s cap before we tell the user to check back later.
const MAX_FEEDBACK_POLL_ATTEMPTS = 10; // ~10s cap for AI feedback after grading finishes.

type Phase = 'idle' | 'submitting' | 'polling' | 'polling-feedback' | 'busy' | 'timeout' | 'error';

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
  const feedbackAttemptsRef = useRef(0);
  const awaitingFeedbackRef = useRef(false);
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
    // Once grading reaches a terminal status we switch to a separate,
    // shorter-capped polling mode just to pick up `feedback` (generated a
    // moment after grading finishes) without a manual refresh.
    const isFeedbackPoll = awaitingFeedbackRef.current;
    if (isFeedbackPoll) {
      feedbackAttemptsRef.current += 1;
    } else {
      attemptsRef.current += 1;
    }

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
        if (data.feedback !== null || feedbackAttemptsRef.current >= MAX_FEEDBACK_POLL_ATTEMPTS) {
          setPhase('idle');
          stopPolling();
          return;
        }

        // Grading is done but feedback hasn't landed yet — keep polling a
        // few more times, capped, then give up and leave the "generating…"
        // placeholder showing (feedback may still arrive on a later visit).
        awaitingFeedbackRef.current = true;
        setPhase('polling-feedback');
        pollTimer.current = setTimeout(() => pollSubmission(id), POLL_INTERVAL_MS);
        return;
      }
    } catch {
      // Transient errors while polling are swallowed — we just keep trying
      // until the relevant cap is hit.
    }

    if (!mountedRef.current) return;

    if (isFeedbackPoll) {
      if (feedbackAttemptsRef.current >= MAX_FEEDBACK_POLL_ATTEMPTS) {
        setPhase('idle');
        stopPolling();
        return;
      }
    } else if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
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
    feedbackAttemptsRef.current = 0;
    awaitingFeedbackRef.current = false;
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
          {phase === 'polling-feedback' && <span className="hint">Waiting for AI feedback…</span>}
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

      {submission && <SubmissionResults submission={submission} />}
    </section>
  );
}
