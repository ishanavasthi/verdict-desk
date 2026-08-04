'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Problem } from '../lib/api';

/** Posts a new doubt via `POST /api/doubts` (browser rewrite → API), then refreshes the board. */
export default function DoubtForm({ problems }: { problems: Problem[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [problemId, setProblemId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/doubts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body,
          ...(problemId ? { problemId } : {}),
        }),
      });

      if (res.status === 401) {
        router.push('/login');
        return;
      }

      if (!res.ok) {
        setError(`Could not post your doubt (status ${res.status}).`);
        return;
      }

      setTitle('');
      setBody('');
      setProblemId('');
      router.refresh();
    } catch {
      setError('Could not reach the server. Is the API running?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <label className="field">
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={200}
          placeholder="What are you stuck on?"
        />
      </label>
      <label className="field">
        Details
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
          rows={4}
          placeholder="Describe your doubt in detail…"
        />
      </label>
      {problems.length > 0 && (
        <label className="field">
          Related problem (optional)
          <select value={problemId} onChange={(event) => setProblemId(event.target.value)}>
            <option value="">— None —</option>
            {problems.map((problem) => (
              <option key={problem.id} value={problem.id}>
                {problem.title}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="editor-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Posting…' : 'Post doubt'}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
