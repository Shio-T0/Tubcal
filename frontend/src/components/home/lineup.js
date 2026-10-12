// What the home screen knows: tonight's line-up, pieced together from reads the
// rooms already make (and cache), so the front of the set costs next to nothing.
//
//   useAnimeEntries   your AniList list, every title once (null when not connected)
//   usePickUp         the "pick up where you left off" queue: half-watched videos and
//                     the next episode of whatever you're watching, most recent
//                     first, topped up with fresh uploads when that runs short
//   useComingUp       what's on next: streams live now, premieres, and the next
//                     airing episode of the shows on your list
//   useMinute         a clock that re-renders once a minute, on the minute
//   tallyShelves / airingBacklog / slotLabel   small pure helpers for the copy

import { useEffect, useMemo, useState } from 'react';

import { useShared } from '../../lib/useShared.js';
import { COMPLETE_RATIO, applyOverlay, useAnimeSync, useProgress } from '../../state.jsx';
import { ACTIVE, watchState } from '../anime/watching.js';
import { useChannelFeed, useSeen, useWatched } from '../screening/feed.js';

export const PICKUP_MAX = 6;
const AHEAD = 8 * 86400; // the guide looks a week and a bit ahead
const DAY = 86400;

/** Re-render once a minute, on the minute. Returns the current Date. */
export function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t;
    const arm = () => {
      const d = new Date();
      t = setTimeout(() => { setNow(new Date()); arm(); }, (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 30);
    };
    arm();
    // a laptop waking up shouldn't show last night's time until the next minute
    const wake = () => { if (!document.hidden) setNow(new Date()); };
    document.addEventListener('visibilitychange', wake);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', wake); };
  }, []);
  return now;
}

/** Your AniList list, flattened: every title once, with the list's local edits
 *  painted over it. `null` while loading or when AniList isn't connected. */
export function useAnimeEntries() {
  const lists = useShared('/anime/lists', { maxAge: 60_000 });
  const { overlay } = useAnimeSync();
  const entries = useMemo(() => {
    if (!lists.data?.lists) return null;
    const seen = new Set();
    const out = [];
    for (const g of lists.data.lists) {
      if (g.custom) continue; // custom lists repeat titles that sit on a status shelf
      for (const e of g.entries) {
        if (seen.has(e.media.id)) continue;
        seen.add(e.media.id);
        const eff = applyOverlay(e.media.id, e, overlay);
        if (eff) out.push({ ...e, eff });
      }
    }
    return out;
  }, [lists.data, overlay]);
  return { entries, connected: !lists.error, loading: lists.loading };
}

/** Half-watched videos and the next episode of what you're watching, newest
 *  first; then — if that leaves room — the freshest uploads you haven't seen. */
export function usePickUp(entries) {
  const { progress } = useProgress();
  const cont = useShared('/youtube/continue', { maxAge: 30_000 });
  const { feed } = useChannelFeed();
  const { isNew } = useSeen();
  const watched = useWatched();

  return useMemo(() => {
    const out = [];
    for (const item of cont.data?.items || []) {
      const p = progress[item.id];
      if (p?.duration && p.position / p.duration >= COMPLETE_RATIO) continue; // finished since
      out.push({ kind: 'video', key: item.id, item, p, at: item.extra?.watched_at || 0 });
    }
    for (const e of entries || []) {
      if (!ACTIVE.has(e.eff.status)) continue;
      const w = watchState(e.media, e.eff, progress);
      if (!w.canPlay) continue;
      out.push({ kind: 'anime', key: `anime:${e.media.id}`, m: e.media, w, at: e.updated_at || 0 });
    }
    out.sort((a, b) => b.at - a.at);
    const picked = out.slice(0, PICKUP_MAX);

    // Top up with what's just in — new first, then anything not yet watched.
    if (picked.length < PICKUP_MAX) {
      const have = new Set(picked.map((x) => x.key));
      const items = (feed.data?.items || []).filter((i) => !i.extra?.live_status && !have.has(i.id));
      const fresh = [...items.filter(isNew), ...items.filter((i) => !isNew(i) && !watched(i).p)];
      for (const item of fresh) {
        if (picked.length >= PICKUP_MAX) break;
        if (have.has(item.id)) continue;
        have.add(item.id);
        picked.push({ kind: 'fresh', key: item.id, item, isNew: isNew(item), at: item.published_at || 0 });
      }
    }
    return {
      items: picked,
      loading: (cont.loading && !cont.data) || (feed.loading && !feed.data),
    };
  }, [cont.data, cont.loading, entries, progress, feed.data, feed.loading, isNew, watched]);
}

/** Streams live now, premieres, and the next episode of the shows on your list —
 *  soonest first, a week and a bit ahead. */
export function useComingUp(entries, live, now) {
  return useMemo(() => {
    const t = now.getTime() / 1000;
    const rows = [];
    for (const item of live?.data?.items || []) {
      const st = item.extra?.live_status;
      if (st === 'is_live') rows.push({ kind: 'live', key: item.id, at: t - 1, item });
      else if (st === 'is_upcoming' && item.extra?.scheduled_at > t && item.extra.scheduled_at < t + AHEAD) {
        rows.push({ kind: 'stream', key: item.id, at: item.extra.scheduled_at, item });
      }
    }
    for (const e of entries || []) {
      const m = e.media;
      if (!m.next_airing_at || m.next_airing_at <= t || m.next_airing_at > t + AHEAD) continue;
      const status = e.eff.status;
      // what you're watching, and anything you've planned that's about to premiere
      if (ACTIVE.has(status) || (status === 'PLANNING' && m.next_episode === 1)) {
        rows.push({ kind: m.next_episode === 1 ? 'premiere' : 'episode', key: `anime:${m.id}`, at: m.next_airing_at, m });
      }
    }
    rows.sort((a, b) => a.at - b.at);
    return rows;
  }, [entries, live?.data, now]);
}

/** How many titles sit on each shelf (watching counts rewatches, and airing is
 *  the part of it still on air). */
export function tallyShelves(entries) {
  const tally = { watching: 0, airing: 0, planning: 0, completed: 0 };
  for (const e of entries || []) {
    const st = e.eff.status;
    if (ACTIVE.has(st)) {
      tally.watching += 1;
      if (e.media.status === 'RELEASING') tally.airing += 1;
    } else if (st === 'PLANNING') tally.planning += 1;
    else if (st === 'COMPLETED') tally.completed += 1;
  }
  return tally;
}

/** The anime side of the greeting: unwatched episodes of shows still airing. */
export function airingBacklog(entries, progress) {
  let eps = 0;
  let shows = 0;
  for (const e of entries || []) {
    if (!ACTIVE.has(e.eff.status) || e.media.status !== 'RELEASING') continue;
    const w = watchState(e.media, e.eff, progress);
    if (w.left > 0) { eps += w.left; shows += 1; }
  }
  return { eps, shows };
}

/** "21:40", or "Thu 21:40" past today, or "17 Oct" past a week — the guide's time
 *  column, in the reader's own clock. */
export function slotLabel(epochSeconds, now) {
  const d = new Date(epochSeconds * 1000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  // Count calendar days between local midnights: a day across a DST change is 23
  // or 25 hours long, so dividing raw milliseconds misnames the day after it.
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const days = Math.round((that - start) / (DAY * 1000));
  if (days <= 0) return { day: 'Today', time };
  if (days === 1) return { day: 'Tmrw', time };
  if (days < 7) return { day: d.toLocaleDateString(undefined, { weekday: 'short' }), time };
  return { day: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), time };
}
