// One episode list for a show, built the same way wherever it's needed — the title
// page's episode section and the player's episode rail both read it, so the two
// can never disagree about which episodes exist, what they're called, or what
// pressing one plays.

/** Strip AniList's "Episode N - " / "Episode N: " prefix to the real subtitle. */
export function epSubtitle(title, number) {
  if (!title) return null;
  const cleaned = title.replace(/^\s*episode\s+\d+\s*[-:–—]?\s*/i, '').trim();
  return cleaned && cleaned !== String(number) ? cleaned : null;
}

/** AniList's streaming episodes, with the local source's keys folded in by number,
 *  gaps filled up to what has actually aired. Each entry: {number, key?, url?,
 *  site?, title?, image?, still?} — `still` only when the image is this episode's
 *  own (one the source hands back for several episodes is the series art). */
export function buildEpisodeList(media, sourceEpisodes) {
  const merged = {};
  for (const se of media?.streaming || []) {
    if (se.number == null) continue;
    const e = (merged[se.number] ||= { number: se.number });
    if (!e.image) e.image = se.thumbnail;
    if (!e.url) { e.url = se.url; e.site = se.site; }
    if (!e.title) e.title = epSubtitle(se.title, se.number);
  }
  for (const ep of sourceEpisodes || []) {
    if (ep.number == null) continue;
    const e = (merged[ep.number] ||= { number: ep.number });
    if (!e.key) e.key = ep.key;
    if (!e.image) e.image = ep.image;
    if (!e.title) e.title = epSubtitle(ep.title, ep.number);
  }
  let aired = Object.keys(merged).length ? Math.max(...Object.keys(merged).map(Number)) : 0;
  if (media?.next_episode) aired = Math.max(aired, media.next_episode - 1);
  else if (media?.episodes && media.status !== 'NOT_YET_RELEASED') aired = Math.max(aired, media.episodes);
  for (let n = 1; n <= aired; n++) merged[n] ||= { number: n };
  const out = Object.values(merged).sort((a, b) => a.number - b.number);
  const uses = {};
  for (const e of out) if (e.image) uses[e.image] = (uses[e.image] || 0) + 1;
  for (const e of out) e.still = e.image && uses[e.image] === 1 ? e.image : null;
  return out;
}

/** The player item for one locally playable episode. Its id is the progress key
 *  the server watches to sync AniList (`anime:<anilist id>:<episode>`). */
export function episodeItem(media, e, { audio } = {}) {
  return {
    id: `anime:${media.id}:${e.number}`,
    platform: 'anime',
    title: `${media.title} — Episode ${e.number}`,
    thumbnail: e.still || media.cover_xl || media.cover,
    url: `https://anilist.co/anime/${media.id}`,
    source: media.title,
    published_at: 0,
    extra: {
      stream_key: keyWithAudio(e.key, audio),
      anilist_id: media.id,
      episode: e.number,
      episode_title: e.title || null,
      show: media.title,
      cover: media.cover_xl || media.cover || null,
      banner: media.banner || null,
      color: media.color || null,
    },
  };
}

/** The same episode key asking for the other audio. Keys are base64url JSON made
 *  by server/sources/anime_source._encode_key; `l` is the language. So a Sub/Dub
 *  choice in the player carries on to the next episode. Leaves the key alone if it
 *  can't read it. */
export function keyWithAudio(key, audio) {
  if (!key || !audio) return key;
  try {
    const json = JSON.parse(atob(key.replace(/-/g, '+').replace(/_/g, '/')));
    if (json.l === audio) return key;
    json.l = audio;
    return btoa(JSON.stringify(json)).replace(/\+/g, '-').replace(/\//g, '_');
  } catch {
    return key;
  }
}
