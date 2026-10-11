// What you've read, per paper — kept in this browser (localStorage
// `tubcal.edition.read`, { "YYYY-MM-DD": [item ids] }), a month of papers deep.

import { useCallback, useMemo, useState } from 'react';

const READ_KEY = 'tubcal.edition.read';

function readAll() {
  try { return JSON.parse(localStorage.getItem(READ_KEY)) || {}; } catch { return {}; }
}

/** `[marks, mark, markMany]` for one paper: a Set of read item ids, and ways to add. */
export function useReadMarks(date) {
  const [all, setAll] = useState(readAll);
  const marks = useMemo(() => new Set(all[date] || []), [all, date]);
  const markMany = useCallback((keys) => {
    const add = (keys || []).filter(Boolean);
    if (!date || !add.length) return;
    setAll((prev) => {
      const cur = new Set(prev[date] || []);
      const before = cur.size;
      add.forEach((k) => cur.add(k));
      if (cur.size === before) return prev;
      const next = { ...prev, [date]: [...cur] };
      // Keep a month of papers; older ticks don't matter.
      Object.keys(next).sort().slice(0, -31).forEach((d) => delete next[d]);
      try { localStorage.setItem(READ_KEY, JSON.stringify(next)); } catch { /* fine */ }
      return next;
    });
  }, [date]);
  const mark = useCallback((key) => markMany([key]), [markMany]);
  return [marks, mark, markMany];
}
