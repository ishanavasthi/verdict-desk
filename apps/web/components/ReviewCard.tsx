'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { ReviewQueueItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import HighlightedText from './HighlightedText';

type ActionState = 'idle' | 'approving' | 'saving' | 'rejecting';

/**
 * One PENDING_REVIEW answer, shown side-by-side with its parent doubt. The AI
 * draft is editable via a `<textarea>` (plain text — never rendered as HTML);
 * a read-only preview above it highlights any URLs in both the doubt and the
 * draft, without ever making them clickable.
 */
export default function ReviewCard({
  item,
  onHandled,
  onConflict,
}: {
  item: ReviewQueueItem;
  onHandled: () => void;
  onConflict: () => void;
}) {
  const initialText = item.editedContent ?? item.content;
  const [text, setText] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const [rejectReason, setRejectReason] = useState('');
  const [action, setAction] = useState<ActionState>('idle');

  const isBusy = action !== 'idle';
  const isChanged = text !== savedText;

  async function postAction(path: string, body: unknown): Promise<Response> {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  async function handleApprove() {
    setAction('approving');
    try {
      const res = await postAction(`/api/answers/${item.id}/approve`, isChanged ? { editedContent: text } : {});
      if (res.status === 409) return onConflict();
      if (!res.ok) return void toast.error(`Approve failed (status ${res.status}).`);
      toast.success('Answer approved — now visible to the student.');
      onHandled();
    } catch {
      toast.error('Could not reach the server. Is the API running?');
    } finally {
      setAction('idle');
    }
  }

  async function handleReject() {
    setAction('rejecting');
    try {
      const reason = rejectReason.trim();
      const res = await postAction(`/api/answers/${item.id}/reject`, reason ? { reason } : {});
      if (res.status === 409) return onConflict();
      if (!res.ok) return void toast.error(`Reject failed (status ${res.status}).`);
      toast.success('Answer rejected.');
      onHandled();
    } catch {
      toast.error('Could not reach the server. Is the API running?');
    } finally {
      setAction('idle');
    }
  }

  async function handleSaveEdit() {
    setAction('saving');
    try {
      const res = await postAction(`/api/answers/${item.id}/edit`, { editedContent: text });
      if (res.status === 409) return onConflict();
      if (!res.ok) return void toast.error(`Save failed (status ${res.status}).`);
      setSavedText(text);
      toast.success('Edit saved — still pending review.');
    } catch {
      toast.error('Could not reach the server. Is the API running?');
    } finally {
      setAction('idle');
    }
  }

  return (
    <article className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="eyebrow mb-2">Student doubt</p>
          <p className="mb-1 font-medium">{item.doubt.title}</p>
          <div className="text-sm text-foreground/90">
            <HighlightedText text={item.doubt.body} />
          </div>
          <p className="mt-2 font-mono text-xs text-muted-foreground">{item.doubt.author?.email ?? 'Unknown student'}</p>
        </div>

        <div>
          <p className="eyebrow mb-2">🤖 AI draft · URLs flagged</p>
          <div className="mb-2 max-h-56 overflow-y-auto rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            <HighlightedText text={text} />
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="font-mono text-sm"
            aria-label="Edit AI draft answer"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Button onClick={handleApprove} disabled={isBusy} className="gap-1.5">
          {action === 'approving' && <span className="spinner-on-primary" aria-hidden="true" />}
          {action === 'approving' ? 'Approving…' : 'Approve'}
        </Button>
        <Button variant="outline" onClick={handleSaveEdit} disabled={isBusy || !isChanged}>
          {action === 'saving' ? 'Saving…' : 'Save edit'}
        </Button>
        <Input
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Rejection reason (optional)"
          disabled={isBusy}
          aria-label="Rejection reason"
          className="h-9 max-w-xs flex-1"
        />
        <Button
          variant="ghost"
          onClick={handleReject}
          disabled={isBusy}
          className="text-[var(--fail)] hover:bg-[color-mix(in_srgb,var(--fail)_12%,transparent)] hover:text-[var(--fail)]"
        >
          {action === 'rejecting' ? 'Rejecting…' : 'Reject'}
        </Button>
      </div>
    </article>
  );
}
