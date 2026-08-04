'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SubmissionResults from './SubmissionResults';
import { usePolling } from '../lib/use-polling';
import type { SubmissionDetail } from '../lib/api';

/**
 * Wraps a graded submission and keeps its AI feedback fresh without a manual
 * page reload. Feedback is generated fire-and-forget AFTER grading finishes
 * (see grading.service.ts), so a submission is frequently `feedbackStatus:
 * 'PENDING'` when first rendered. This component seeds from server-fetched
 * (or editor-polled) data, then polls `GET /api/submissions/:id` while the
 * feedback is PENDING, and exposes a manual "Refresh" affordance so the user
 * is never stuck staring at a stale "generating…" state.
 *
 * Used by BOTH the static `/submissions/[id]` page and the live SubmitEditor,
 * so the feedback-polling logic lives in exactly one place.
 */
export default function LiveSubmissionView({ initial }: { initial: SubmissionDetail }) {
  const router = useRouter();
  const [submission, setSubmission] = useState<SubmissionDetail>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // One-shot fetch of the latest submission. Returns the fresh feedbackStatus
  // (or null on failure) so the auto-poll loop can decide whether to continue.
  const fetchOnce = useCallback(async (): Promise<SubmissionDetail['feedbackStatus'] | null> => {
    try {
      const res = await fetch(`/api/submissions/${submission.id}`, { cache: 'no-store' });
      if (res.status === 401) {
        router.push('/login');
        return null;
      }
      if (!res.ok) return null;
      const data: SubmissionDetail = await res.json();
      if (!mountedRef.current) return null;
      setSubmission(data);
      return data.feedbackStatus;
    } catch {
      return null;
    }
  }, [submission.id, router]);

  // Auto-poll while feedback is PENDING, capped. Cleared on unmount or once the
  // feedback reaches a terminal state (READY/FAILED/SKIPPED).
  const { restart } = usePolling({
    enabled: submission.feedbackStatus === 'PENDING',
    onTick: async () => {
      const status = await fetchOnce();
      return status === 'PENDING' ? 'continue' : 'stop';
    },
  });

  // Re-seed if the parent hands us a different submission (e.g. the editor
  // grades a second submission) — reset the poll budget with it.
  useEffect(() => {
    setSubmission(initial);
    restart();
  }, [initial, restart]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    restart(); // a manual refresh re-opens the auto-poll budget
    await fetchOnce();
    if (mountedRef.current) setRefreshing(false);
  }, [refreshing, fetchOnce, restart]);

  // FAILED feedback is terminal server-side until regenerated: POST the
  // regenerate endpoint (deletes the flagged row and re-fires generation),
  // then re-fetch — the submission comes back PENDING, which re-arms the poll.
  const regenerate = useCallback(async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/submissions/${submission.id}/feedback/regenerate`, { method: 'POST' });
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (res.ok) {
        restart(); // fresh poll budget for the new generation cycle
        await fetchOnce();
      }
    } catch {
      // network hiccup: the card stays FAILED and the button remains usable
    } finally {
      if (mountedRef.current) setRegenerating(false);
    }
  }, [regenerating, submission.id, router, restart, fetchOnce]);

  return (
    <SubmissionResults
      submission={submission}
      onRefreshFeedback={refresh}
      refreshingFeedback={refreshing}
      onRegenerateFeedback={regenerate}
      regeneratingFeedback={regenerating}
    />
  );
}
