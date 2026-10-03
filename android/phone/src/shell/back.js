// The Android Back button, phone-style: it closes the top-most thing first — a
// sheet, the expanded player, a search — and only then goes back a page.
//
// Anything closable registers itself with useBack(open, close) while it's open;
// the Android shell calls window.tubcalBack() on Back and only falls back to
// WebView history (or leaving the app) when that returns 'unhandled'.

import { useEffect, useRef } from 'react';

const stack = [];

if (typeof window !== 'undefined') {
  window.tubcalBack = () => {
    const top = stack[stack.length - 1];
    if (!top) return 'unhandled';
    top.current?.();
    return 'handled';
  };
}

/** While `open`, Back calls `onBack` (the latest one — no stale closures). */
export function useBack(open, onBack) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!open) return undefined;
    stack.push(ref);
    return () => {
      const i = stack.lastIndexOf(ref);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}
