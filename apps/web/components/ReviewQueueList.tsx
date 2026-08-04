'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ReviewQueueItem } from '@/lib/api';
import ReviewCard from './ReviewCard';

/**
 * Client-side list of PENDING_REVIEW answers. Approve/reject/edit are handled
 * per-card (see ReviewCard); on success we optimistically drop the item. On a
 * 409 (another teacher already handled it) we toast and re-fetch to resync.
 */
export default function ReviewQueueList({ initialQueue }: { initialQueue: ReviewQueueItem[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);

  // Resync whenever the server component re-fetches (e.g. after a 409 refresh).
  useEffect(() => {
    setQueue(initialQueue);
  }, [initialQueue]);

  function handleHandled(id: string) {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }

  function handleConflict() {
    toast.info('This answer was already handled — refreshing.');
    router.refresh();
  }

  if (queue.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
        <p className="text-sm text-muted-foreground">The bench is clear — nothing waiting for review.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {queue.map((item) => (
        <ReviewCard
          key={item.id}
          item={item}
          onHandled={() => handleHandled(item.id)}
          onConflict={handleConflict}
        />
      ))}
    </div>
  );
}
