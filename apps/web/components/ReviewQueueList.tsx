'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReviewQueueItem } from '../lib/api';
import ReviewCard from './ReviewCard';

/**
 * Client-side list of PENDING_REVIEW answers. Approve/reject/edit are
 * handled per-card (see ReviewCard); on success we optimistically drop the
 * item locally. On a 409 (another teacher already handled it) we surface a
 * notice and do a full `router.refresh()` to resync with the server.
 */
export default function ReviewQueueList({ initialQueue }: { initialQueue: ReviewQueueItem[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [notice, setNotice] = useState<string | null>(null);

  // Resync local state whenever the server component re-fetches (e.g. after
  // the router.refresh() triggered by a 409 below).
  useEffect(() => {
    setQueue(initialQueue);
  }, [initialQueue]);

  function handleHandled(id: string) {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }

  function handleConflict() {
    setNotice('This answer was already handled — refreshing.');
    router.refresh();
  }

  return (
    <div className="review-queue">
      {notice && <p className="form-error">{notice}</p>}
      {queue.length === 0 ? (
        <p className="empty-state">Nothing waiting for review right now.</p>
      ) : (
        queue.map((item) => (
          <ReviewCard
            key={item.id}
            item={item}
            onHandled={() => handleHandled(item.id)}
            onConflict={handleConflict}
          />
        ))
      )}
    </div>
  );
}
