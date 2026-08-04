'use client';

import { useCallback, useEffect, useRef } from 'react';

export interface UsePollingOptions {
  enabled: boolean;
  intervalMs?: number;
  maxAttempts?: number;
  onTick: () => Promise<'continue' | 'stop'>;
}

const DEFAULT_INTERVAL_MS = 2500;
const DEFAULT_MAX_ATTEMPTS = 60;

/**
 * Capped-attempt polling loop (extracted from LiveSubmissionView, generalized
 * for any `onTick`). While `enabled`, calls `onTick` every `intervalMs` and
 * reschedules only if it resolves `'continue'`, up to `maxAttempts`. Ticks
 * that would fire while the tab is hidden are skipped (rescheduled without
 * consuming the attempt budget). `restart()` resets the budget and, if
 * `enabled`, immediately reschedules — for a manual refresh or an action
 * that re-opens polling.
 */
export function usePolling({
  enabled,
  intervalMs = DEFAULT_INTERVAL_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  onTick,
}: UsePollingOptions): { restart: () => void } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const mountedRef = useRef(true);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const scheduleRef = useRef<() => void>(() => {});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const schedule = () => {
      if (!enabled) return;
      if (attemptsRef.current >= maxAttempts) return;

      timer.current = setTimeout(async () => {
        if (document.visibilityState === 'hidden') {
          schedule(); // don't consume budget while the tab is hidden
          return;
        }
        attemptsRef.current += 1;
        const result = await onTickRef.current();
        if (!mountedRef.current) return;
        if (result === 'continue') schedule();
      }, intervalMs);
    };
    scheduleRef.current = schedule;

    schedule();

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, intervalMs, maxAttempts]);

  const restart = useCallback(() => {
    attemptsRef.current = 0;
    if (timer.current) clearTimeout(timer.current);
    scheduleRef.current();
  }, []);

  return { restart };
}
