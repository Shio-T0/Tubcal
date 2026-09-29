// What the live bits of a description or comment do, for the video on screen:
// a timestamp seeks it, another video opens in the player (its details fetched
// first, so history and the notes have a title), and a hashtag or a channel
// takes you into the Screening Room — tucking the player into the corner so you
// can see where you went.

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { fetchShared } from '../../lib/useShared.js';
import { usePlayer, useToast } from '../../state.jsx';

export const metaPath = (videoId) => `/youtube/video/${videoId}`;

/** A playable item for a bare video id, from its (cached) details. */
export async function itemForVideo(id) {
  let d = {};
  try { d = await fetchShared(metaPath(id), 600_000); } catch { /* play it anyway */ }
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
