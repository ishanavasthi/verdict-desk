'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import SubmissionResults from './SubmissionResults';
import type { SubmissionDetail } from '../lib/api';

// The live model (z-ai/glm-5.2) can take ~1–2 min; poll on a relaxed cadence
// for up to ~2.5 min before giving up and leaving the manual Refresh button.
const FEEDBACK_POLL_INTERVAL_MS = 2500;
const MAX_FEEDBACK_POLL_ATTEMPTS = 60; // 60 × 2.5s = 150s

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

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const mountedRef = useRef(true);

  // Re-seed if the parent hands us a different submission (e.g. the editor
  // grades a second submission) — reset the poll budget with it.
  useEffect(() => {
    setSubmission(initial);
    attemptsRef.current = 0;
  }, [initial]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timer.current) clearTimeout(timer.current);
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
  useEffect(() => {
    if (submission.feedbackStatus !== 'PENDING') return;
    if (attemptsRef.current >= MAX_FEEDBACK_POLL_ATTEMPTS) return;

    timer.current = setTimeout(async () => {
      attemptsRef.current += 1;
      await fetchOnce();
    }, FEEDBACK_POLL_INTERVAL_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [submission, fetchOnce]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    attemptsRef.current = 0; // a manual refresh re-opens the auto-poll budget
    await fetchOnce();
    if (mountedRef.current) setRefreshing(false);
  }, [refreshing, fetchOnce]);

  return (
    <SubmissionResults submission={submission} onRefreshFeedback={refresh} refreshingFeedback={refreshing} />
  );
}
