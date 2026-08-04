'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe media query hook. Starts from `initial` (default true — desktop-
 * first, matching the common evaluator viewport) so the server and first
 * client render agree, then reconciles to the real match after mount.
 */
export function useMediaQuery(query: string, initial = true): boolean {
  const [matches, setMatches] = useState(initial);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);

  return matches;
}
