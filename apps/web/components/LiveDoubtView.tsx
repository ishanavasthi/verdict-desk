'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Doubt } from '@/lib/api';
import { usePolling } from '@/lib/use-polling';
import AnswerCard from '@/components/AnswerCard';
import { Button } from '@/components/ui/button';

// Poll only while something can still CHANGE: an AI draft may still be
// generating (no answers yet, on the viewer's own doubt), or a teacher has yet
// to rule on a PENDING_REVIEW answer.
//
// DRAFT is deliberately NOT a polling trigger. It looks in-flight but is
// terminal in practice: the pipeline inserts DRAFT and immediately transitions
// it to PENDING_REVIEW, so an answer still sitting at DRAFT is one whose
// validation failed and which will never be queued (AiDraftPipeline
// .persistFailure). Polling it burned the whole 60-tick budget against a state
// that cannot move.
function needsPolling(doubt: Doubt, isOwn: boolean): boolean {
  if (doubt.answers.length === 0 && isOwn) return true;
  return doubt.answers.some((answer) => answer.state === 'PENDING_REVIEW');
}

/**
 * Answers section for a doubt detail page. Seeds from server-fetched data,
 * then polls `GET /api/doubts/:id` while an AI draft may still be generating
 * or a teacher review is pending, and exposes a manual "Refresh" affordance.
 */
export default function LiveDoubtView({ doubt: initial, isOwn }: { doubt: Doubt; isOwn: boolean }) {
  const router = useRouter();
  const [doubt, setDoubt] = useState<Doubt>(initial);
  const [refreshing, setRefreshing] = useState(false);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // One-shot fetch of the latest doubt. Returns the fresh doubt (or null on
  // failure) so the auto-poll loop can decide whether to continue.
  const fetchOnce = useCallback(async (): Promise<Doubt | null> => {
    try {
      const res = await fetch(`/api/doubts/${initial.id}`, { cache: 'no-store' });
      if (res.status === 401) {
        router.push('/login');
        return null;
      }
      if (!res.ok) return null;
      const data: Doubt = await res.json();
      if (!mountedRef.current) return null;
      setDoubt(data);
      return data;
    } catch {
      return null;
    }
  }, [initial.id, router]);

  const pollingActive = needsPolling(doubt, isOwn);

  const { restart } = usePolling({
    enabled: pollingActive,
    onTick: async () => {
      const fresh = await fetchOnce();
      return fresh && needsPolling(fresh, isOwn) ? 'continue' : 'stop';
    },
  });

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    restart(); // a manual refresh re-opens the auto-poll budget
    await fetchOnce();
    if (mountedRef.current) setRefreshing(false);
  }, [refreshing, fetchOnce, restart]);

  return (
    <>
      <div className="mb-3 mt-6 flex flex-wrap items-center gap-2">
        <p className="eyebrow">Answers</p>
        {pollingActive && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs text-muted-foreground"
            onClick={refresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      </div>
      {doubt.answers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No answers yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {doubt.answers.map((answer) => (
            <AnswerCard key={answer.id} answer={answer} />
          ))}
        </ul>
      )}
    </>
  );
}
