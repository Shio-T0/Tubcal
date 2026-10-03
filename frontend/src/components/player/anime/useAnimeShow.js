// The show around the episode that's playing: AniList's record of it, the episode
// list (the same one the title page builds), and where this episode sits in it —
// what the anime player's strip, episode rail and next-episode countdown all read.
// Both requests go through the shared store, so the strip and the rail cost one
// fetch between them, and the title page has usually warmed them already.

import { useMemo } from 'react';

import { useShared } from '../../../lib/useShared.js';
import { applyOverlay, useAnimeSync } from '../../../state.jsx';
import { buildEpisodeList, episodeItem } from '../../anime/episodeList.js';

// The audio you switched to, per show, for this session — so the next episode (from
// the strip, the rail or the countdown) keeps it. Only an explicit switch sets it:
// a source quietly serving Sub because an episode has no Dub shouldn't stick.
const chosenAudio = new Map();
export const rememberAudio = (aid, audio) => {
  if (aid && audio) chosenAudio.set(aid, audio);
};
/** The audio last switched to for this show, if any (for items made elsewhere). */
export const audioFor = (aid) => chosenAudio.get(aid);

export function useAnimeShow(item) {
  const aid = item?.platform === 'anime' ? item.extra?.anilist_id : null;
  const media = useShared(aid ? `/anime/media/${aid}` : null, { maxAge: 600_000 });
  const eps = useShared(aid ? `/anime/episodes/${aid}` : null, { maxAge: 600_000 });
  const { overlay } = useAnimeSync();
  const m = media.data;

  const list = useMemo(() => (m ? buildEpisodeList(m, eps.data?.episodes) : []), [m, eps.data]);
  const n = item?.extra?.episode;
  const i = list.findIndex((e) => e.number === n);
  const current = i >= 0 ? list[i] : null;
  // Neighbours you can actually play here (the local source has a key for them).
  const next = i >= 0 && list[i + 1]?.key ? list[i + 1] : null;
  const prev = i > 0 && list[i - 1]?.key ? list[i - 1] : null;
  const entry = m ? applyOverlay(m.id, m.list_entry, overlay) : null;

  return {
    aid,
    media: m,
    list,
    current,
    next,
    prev,
    entry,
    itemFor: (e) => (m && e?.key ? episodeItem(m, e, { audio: chosenAudio.get(m.id) }) : null),
  };
}

/** The show's own colour as the player's accent — lifted toward cream so the
 *  scrubber and buttons stay legible over a dark picture, and dropped for a
 *  near-black cover colour that would vanish there. */
export function showAccent(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const v = parseInt(m[1], 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum < 0.18) return null;
  return `color-mix(in srgb, #${m[1]} 78%, #f3e7cf)`;
}

/** The source's opening/ending timings as chapters (Cold open · Opening · Episode ·
 *  Ending · After the credits): notches and names on a seek bar, and steps for
 *  chapter keys. Null when there's nothing to cut. */
export function skipChapters(skip, dur) {
  if (!dur || !(skip?.intro || skip?.outro)) return null;
  const out = [];
  let at = 0;
  const cut = (end, title) => {
    const e = Math.min(end, dur);
    if (e - at > 1) out.push({ start: at, end: e, title });
    at = Math.max(at, e);
  };
  if (skip.intro) { cut(skip.intro.start, 'Cold open'); cut(skip.intro.end, 'Opening'); }
  if (skip.outro) { cut(skip.outro.start, 'Episode'); cut(skip.outro.end, 'Ending'); }
  cut(dur, skip.outro ? 'After the credits' : 'Episode');
  return out.length > 1 ? out : null;
}

/** The opening and ending as spans a seek bar can shade. */
export const skipSpans = (skip) => (skip
  ? [skip.intro && { ...skip.intro, kind: 'intro' }, skip.outro && { ...skip.outro, kind: 'outro' }].filter(Boolean)
  : null);
