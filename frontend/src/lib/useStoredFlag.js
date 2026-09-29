import { useCallback, useState } from 'react';

/** A boolean remembered in localStorage — a per-viewer convenience (a folded
 *  panel, a hidden filter). It works without storage; it just forgets. */
export function useStoredFlag(key, fallback = false) {
  const [on, setOn] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v === '1';
    } catch {
      return fallback;
    }
  });
  const set = useCallback((next) => {
    setOn((prev) => {
      const v = typeof next === 'function' ? next(prev) : !!next;
      try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* private mode */ }
      return v;
    });
  }, [key]);
  return [on, set];
}
