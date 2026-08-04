'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Problem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NONE = '__none__';

/** Posts a new doubt via `POST /api/doubts` (browser rewrite → API), then refreshes the board. */
export default function DoubtForm({ problems }: { problems: Problem[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [problemId, setProblemId] = useState<string>(NONE);
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
        body: JSON.stringify({ title, body, ...(problemId !== NONE ? { problemId } : {}) }),
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
      setProblemId(NONE);
      router.refresh();
    } catch {
      setError('Could not reach the server. Is the API running?');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="doubt-title">Title</Label>
        <Input
          id="doubt-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          placeholder="What are you stuck on?"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="doubt-body">Details</Label>
        <Textarea
          id="doubt-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={4}
          placeholder="Describe your doubt in detail…"
        />
      </div>
      {problems.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doubt-problem">Related problem (optional)</Label>
          <Select
            items={{ [NONE]: '— None —', ...Object.fromEntries(problems.map((p) => [p.id, p.title])) }}
            value={problemId}
            onValueChange={(v) => setProblemId(v ?? NONE)}
          >
            <SelectTrigger id="doubt-problem">
              <SelectValue placeholder="— None —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— None —</SelectItem>
              {problems.map((problem) => (
                <SelectItem key={problem.id} value={problem.id}>
                  {problem.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting} className="gap-1.5">
          {submitting && <span className="spinner-on-primary" aria-hidden="true" />}
          {submitting ? 'Posting…' : 'Post doubt'}
        </Button>
        {error && <span className="text-sm text-[var(--fail)]">{error}</span>}
      </div>
    </form>
  );
}
