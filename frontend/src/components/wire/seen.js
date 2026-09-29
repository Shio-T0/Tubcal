// What you've already read on the Wire, remembered in this browser: when you last
// opened a story's discussion and how many comments it had then. The board dims
// stories you've read and says how many comments arrived since; the reader marks
// the comments that are new since your last visit.

import { useCallback, useEffect, useState } from 'react';

const KEY = 'tubcal.wire.seen';
const EVENT = 'tubcal:wire-seen';
const KEEP = 800;

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

/** When you last opened this story ({at, n}), or null — read it *before* visit(). */
export function lastVisit(hnId) {
  return readAll()[hnId] || null;
}

/** Record a visit now, with the comment count you saw. */
export function visit(hnId, comments) {
  const all = readAll();
  all[hnId] = { at: Math.floor(Date.now() / 1000), n: comments || 0 };
  const ids = Object.keys(all);
  if (ids.length > KEEP) {
    ids.sort((a, b) => all[a].at - all[b].at).slice(0, ids.length - KEEP).forEach((id) => delete all[id]);
  }
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT));
}

/** The whole map, live (the board re-renders when the reader records a visit). */
export function useWireSeen() {
  const [seen, setSeen] = useState(readAll);
  useEffect(() => {
    const sync = () => setSeen(readAll());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const newSince = useCallback((item) => {
    const v = seen[item.extra?.hn_id];
    return v ? Math.max(0, (item.comments_count || 0) - v.n) : 0;
  }, [seen]);
  return { seen, newSince };
}
