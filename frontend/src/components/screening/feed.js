// The Screening Room's shared reads, and what "new" means in it.
//
// Two things on screen want the same data at once — the room itself and its index
// in the hub console (channel list, new counts, what's live) — so they read it
// through `useShared` (lib/useShared.js): one request between them.
//
// "New" is per channel, like an inbox: an upload is new until you've watched any
// of it or opened its channel since it came out. A first visit counts the last
// three days as new so the badges mean something from the start.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useShared } from '../../lib/useShared.js';
import { COMPLETE_RATIO, useProgress, useSubscriptions } from '../../state.jsx';

export { useShared };

// The room's standing reads, by name, so the console and the page agree on paths.
export const FEED_PATH = (source = 'curated') => `/feed/youtube?source=${source}`;
export const LIVE_PATH = '/youtube/live';

/** The subscription feed (newest first) and what's live across your channels. */
export function useChannelFeed(source = 'curated') {
  const { subs } = useSubscriptions();
  const hasSubs = subs.youtube.length > 0;
  const feed = useShared(FEED_PATH(source), { enabled: source === 'account' || hasSubs });
  const live = useShared(LIVE_PATH, { enabled: hasSubs, maxAge: 120_000 });
  return { feed, live, hasSubs };
}

// ── what's new ────────────────────────────────────────────────────────────────

const SEEN_KEY = 'tubcal.screening.seen';
const SEEN_EVENT = 'tubcal:screening-seen';
const FIRST_WINDOW = 3 * 86400;
const now = () => Math.floor(Date.now() / 1000);

function readSeen() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY));
    if (v && typeof v.base === 'number') return { base: v.base, ch: v.ch || {} };
  } catch { /* private window, blocked storage */ }
  const fresh = { base: now() - FIRST_WINDOW, ch: {} };
  writeSeen(fresh, false);
  return fresh;
}

function writeSeen(v, announce = true) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch { /* fine */ }
  if (announce) window.dispatchEvent(new Event(SEEN_EVENT));
}

/** When a channel was last looked at (or the room-wide line, if later) — read
 *  before `markSeen` so the page you just opened can still say what was new. */
export function seenSince(channelId) {
  const v = readSeen();
  return Math.max(v.base, (channelId && v.ch[channelId]) || 0);
}

/** Mark one channel (or, with no id, everything) as looked at, as of now. */
export function markSeen(channelId) {
  const v = readSeen();
  if (channelId) v.ch[channelId] = now();
  else { v.base = now(); v.ch = {}; }
  writeSeen(v);
}

/** `isNew(item)` and `newCount(items, channelId?)`, live across the app. */
export function useSeen() {
  const [seen, setSeen] = useState(readSeen);
  const { progress } = useProgress();
  useEffect(() => {
    const sync = () => setSeen(readSeen());
    window.addEventListener(SEEN_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SEEN_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const isNew = useCallback((item) => {
    if (!item?.published_at || item.extra?.live_status) return false;
    const since = Math.max(seen.base, seen.ch[item.extra?.channel_id] || 0);
    if (item.published_at <= since) return false;
    return !progress[item.id]; // any play at all means you've met it
  }, [seen, progress]);

  const newCount = useCallback(
    (items, channelId) => (items || []).filter((i) => (!channelId || i.extra?.channel_id === channelId) && isNew(i)).length,
    [isNew],
  );
  return { isNew, newCount };
}

/** Watched share of a video (0–1), and whether it counts as finished. */
export function useWatched() {
  const { progress } = useProgress();
  return useCallback((item) => {
    const p = progress[item?.id];
    const ratio = p && p.duration ? Math.min(1, p.position / p.duration) : 0;
    return { ratio, done: ratio >= COMPLETE_RATIO, p };
  }, [progress]);
}

/** Your channels, freshest first, with their newest upload and new count. */
export function useChannelRoster(items) {
  const { subs } = useSubscriptions();
  const { newCount } = useSeen();
  return useMemo(() => {
    const latest = new Map();
    for (const it of items || []) {
      const cid = it.extra?.channel_id;
      if (cid && !latest.has(cid)) latest.set(cid, it); // items arrive newest first
    }
    return subs.youtube
      .map((sub) => ({
        sub,
        latest: latest.get(sub.source_id) || null,
        fresh: newCount(items, sub.source_id),
      }))
      .sort((a, b) => (b.latest?.published_at || 0) - (a.latest?.published_at || 0));
  }, [items, subs.youtube, newCount]);
}
