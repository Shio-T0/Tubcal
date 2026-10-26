// What the live bits of a description or comment do, for the video on screen:
// a timestamp seeks it, another video opens in the player (its details fetched
// first, so history and the notes have a title), and a hashtag or a channel
// takes you into the Screening Room — tucking the player into the corner so you
// can see where you went. And a YouTube link anywhere else (a Wire story, a
// Reddit link post) plays here too, rather than on youtube.com.

import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { hasModule } from '../../lib/modules.js';
import { fetchShared } from '../../lib/useShared.js';
import { usePlayer, useToast } from '../../state.jsx';
import { youtubeTarget } from './richText.jsx';

export const metaPath = (videoId) => `/youtube/video/${videoId}`;

/** A playable item for a video id and its details (what `metaPath` answers). */
export function videoItem(id, d = {}) {
  return {
    id: `yt:${id}`,
    platform: 'youtube',
    title: d.title || 'YouTube video',
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    source: d.author || '',
    author: d.author || '',
    published_at: d.published_at || 0,
    extra: { video_id: id, channel_id: d.channel_id || null, length_seconds: d.duration || null },
  };
}

/** A playable item for a bare video id, from its (cached) details. */
export async function itemForVideo(id) {
  let d = {};
  try { d = await fetchShared(metaPath(id), 600_000); } catch { /* play it anyway */ }
  return videoItem(id, d);
}

/** The video (and start) a link points at, when it can play here: a YouTube
 *  watch/short/live link, on an install with the Screening Room (whose server
 *  side the player's YouTube streams come from). */
export function playableHere(url) {
  if (!url || !/^https?:\/\//.test(url) || !hasModule('youtube')) return null;
  return youtubeTarget(url);
}

// Videos a link press is still opening, so pressing again doesn't open one twice.
const opening = new Set();

/** `playLink(url, e)`, for a link's onClick: a plain click on a YouTube link
 *  opens it in the player once its details are in (so history gets its title
 *  and channel), and returns true. When they can't be had (a removed video) it
 *  offers YouTube instead of a player that would fail the same way. Anything
 *  else (another site, Ctrl/⌘/Shift/middle-click) is left to the browser, and
 *  returns false. */
export function usePlayLink() {
  const { open } = usePlayer();
  const toast = useToast();
  return useCallback((url, e) => {
    const target = playableHere(url);
    if (!target || e?.defaultPrevented || e?.button || e?.metaKey || e?.ctrlKey || e?.shiftKey || e?.altKey) return false;
    e?.preventDefault();
    if (opening.has(target.id)) {
      toast('Still opening this video…', 'info');
      return true;
    }
    opening.add(target.id);
    toast('Opening the video…', 'info');
    fetchShared(metaPath(target.id), 600_000)
      .then((d) => open(videoItem(target.id, d), target.start != null ? { start: target.start } : {}))
      .catch(() => toast("Couldn't load this video.", 'error', {
        action: { label: 'Open on YouTube', run: () => window.open(url, '_blank', 'noopener,noreferrer') },
      }))
      .finally(() => opening.delete(target.id));
    return true;
  }, [open, toast]);
}

export function useWatchLinks(item, duration) {
  const navigate = useNavigate();
  const { seek, open, minimize } = usePlayer();
  const toast = useToast();
  const videoId = item?.extra?.video_id;
  const itemId = item?.id;
  return useMemo(() => ({
    videoId,
    duration,
    onSeek: (t) => seek(itemId, t),
    onVideo: async (id, start) => {
      toast('Rolling the next reel…', 'info');
      open(await itemForVideo(id), start != null ? { start } : {});
    },
    onSearch: (q) => { minimize(); navigate(`/youtube?q=${encodeURIComponent(q)}`); },
    onChannel: (cid) => { minimize(); navigate(`/youtube/c/${cid}`); },
  }), [videoId, itemId, duration, seek, open, minimize, navigate, toast]);
}
