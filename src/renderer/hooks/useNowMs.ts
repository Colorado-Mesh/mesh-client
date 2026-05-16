/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useLayoutEffect, useState } from 'react';

/**
 * Current time in ms for relative timestamps. Updated on mount (layout) and on an interval.
 * Prefer this over `Date.now()` during render (react-hooks/purity).
 */
export function useNowMs(enabled = true, intervalMs = 60_000): number {
  const [nowMs, setNowMs] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) {
      setNowMs(0);
      return;
    }
    setNowMs(Date.now());
  }, [enabled]);

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [enabled, intervalMs]);

  return nowMs;
}
