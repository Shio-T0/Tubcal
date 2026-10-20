// Where you are with a title on your list, and playing its next episode — the two
// pieces My List, the title page's list panel and the home screen all share. Kept
// apart from WatchList.jsx (which re-exports them) so the eager home screen can use
// them without pulling the Anime's stylesheets into the first paint.

import { fetchShared } from '../../../lib/useShared.js';
import { COMPLETE_RATIO, usePlayer, useToast } from '../../../state.jsx';
import { episodeItem } from './episodeList.js';
import { audioFor } from './useAnimeShow.js';

/** Shelves you're actively watching from. */
export const ACTIVE = new Set(['CURRENT', 'REPEATING']);
/** Shelves where "the next episode" still means something. */
export const RESUMABLE = new Set(['CURRENT', 'REPEATING', 'PAUSED', 'DROPPED']);

/** Where you are with a title: what's aired, what's left and how long that takes,
 *  which episode is next and whether you'd started it here (`resumeAt`). */
export function watchState(m, eff, progress) {
  const status = eff.status;
  const watched = eff.progress || 0;
  const total = m.episodes || null;
  let aired;
  if (m.next_episode) aired = m.next_episode - 1;
  else if (m.status === 'NOT_YET_RELEASED') aired = 0;
  else aired = total || watched;
  const left = Math.max(0, aired - watched);
  const nextN = status === 'PLANNING' ? 1 : watched + 1;
  const canPlay = status !== 'COMPLETED' && nextN <= aired;
  const p = progress[`anime:${m.id}:${nextN}`];
  const ratio = p?.duration ? p.position / p.duration : 0;
  const resumeAt = canPlay && ratio > 0.02 && ratio < COMPLETE_RATIO ? p.position : null;
  const per = m.duration || 24;
  return {
    status,
    watched,
    total,
    aired,
    left,
    nextN,
    canPlay,
    resumeAt,
    remainingOfNext: resumeAt != null && p.duration ? p.duration - p.position : null,
    catchUp: left * per,
    airingAt: m.next_airing_at && m.next_airing_at * 1000 > Date.now() ? m.next_airing_at : null,
    airingEp: m.next_episode || null,
    canBump: RESUMABLE.has(status) && (!total || watched < total),
  };
}

/** Play episode `n` of `m` in the anime player. Its stream key comes from the
 *  title's episode list (shared, so a second press is instant). */
export function usePlayEpisode() {
  const { open } = usePlayer();
  const toast = useToast();
  return async (m, n) => {
    try {
      const d = await fetchShared(`/anime/episodes/${m.id}`, 600_000);
      const ep = (d?.episodes || []).find((x) => x.number === n);
      if (!ep?.key) {
        toast(`Episode ${n} of ${m.title} isn't available to play yet`, 'error');
        return false;
      }
      open(episodeItem(m, { number: n, key: ep.key }, { audio: audioFor(m.id) }));
      return true;
    } catch (e) {
      toast(`Couldn't find ${m.title} on the episode source — ${e.message}`, 'error');
      return false;
    }
  };
}
