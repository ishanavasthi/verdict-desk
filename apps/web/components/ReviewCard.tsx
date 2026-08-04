'use client';

import { useState } from 'react';
import type { ReviewQueueItem } from '../lib/api';
import HighlightedText from './HighlightedText';

type ActionState = 'idle' | 'approving' | 'saving' | 'rejecting';

/**
 * One PENDING_REVIEW answer, shown side-by-side with its parent doubt.
 * The AI draft is editable via a `<textarea>` (plain text — never rendered
 * as HTML/markdown); a read-only preview above it highlights any URLs in
 * both the doubt and the draft, without ever making them clickable.
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
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const isBusy = action !== 'idle';
  const isChanged = text !== savedText;

  async function postAction(path: string, body: unknown): Promise<Response> {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function handleApprove() {
    setError(null);
    setAction('approving');
    try {
      const res = await postAction(`/api/answers/${item.id}/approve`, isChanged ? { editedContent: text } : {});
      if (res.status === 409) {
        onConflict();
        return;
      }
      if (!res.ok) {
        setError(`Approve failed (status ${res.status}).`);
        return;
      }
      onHandled();
    } catch {
      setError('Could not reach the server. Is the API running?');
    } finally {
      setAction('idle');
    }
  }

  async function handleReject() {
    setError(null);
    setAction('rejecting');
    try {
      const reason = rejectReason.trim();
      const res = await postAction(`/api/answers/${item.id}/reject`, reason ? { reason } : {});
      if (res.status === 409) {
        onConflict();
        return;
      }
      if (!res.ok) {
        setError(`Reject failed (status ${res.status}).`);
        return;
      }
      onHandled();
    } catch {
      setError('Could not reach the server. Is the API running?');
    } finally {
      setAction('idle');
    }
  }

  async function handleSaveEdit() {
    setError(null);
    setSavedNotice(false);
    setAction('saving');
    try {
      const res = await postAction(`/api/answers/${item.id}/edit`, { editedContent: text });
      if (res.status === 409) {
        onConflict();
        return;
      }
      if (!res.ok) {
        setError(`Save failed (status ${res.status}).`);
        return;
      }
      setSavedText(text);
      setSavedNotice(true);
    } catch {
      setError('Could not reach the server. Is the API running?');
    } finally {
      setAction('idle');
    }
  }

  return (
    <article className="review-card">
      <div className="review-columns">
        <div className="review-column">
          <h3 className="review-column-title">Student doubt</h3>
          <p className="review-doubt-title">{item.doubt.title}</p>
          <HighlightedText text={item.doubt.body} />
          <p className="doubt-author">{item.doubt.author?.email ?? 'Unknown student'}</p>
        </div>

        <div className="review-column">
          <h3 className="review-column-title">&#129302; AI draft (URLs highlighted)</h3>
          <div className="review-draft-preview">
            <HighlightedText text={text} />
          </div>
          <textarea
            className="review-edit-textarea"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setSavedNotice(false);
            }}
            rows={8}
            aria-label="Edit AI draft answer"
          />
        </div>
      </div>

      <div className="review-actions">
        <button type="button" className="btn btn-primary" onClick={handleApprove} disabled={isBusy}>
          {action === 'approving' ? 'Approving…' : 'Approve'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleSaveEdit} disabled={isBusy || !isChanged}>
          {action === 'saving' ? 'Saving…' : 'Save edit'}
        </button>
        <input
          className="reject-reason-input"
          value={rejectReason}
          onChange={(event) => setRejectReason(event.target.value)}
          placeholder="Rejection reason (optional)"
          disabled={isBusy}
          aria-label="Rejection reason"
        />
        <button type="button" className="btn btn-danger" onClick={handleReject} disabled={isBusy}>
          {action === 'rejecting' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>

      {savedNotice && <p className="review-saved-notice">Edit saved — still pending review.</p>}
      {error && <p className="form-error">{error}</p>}
    </article>
  );
}
