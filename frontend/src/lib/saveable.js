// What can be saved, and what each saved thing is.
//
// Every saved entry is a feed-item-shaped object (`id`, `platform`, `title`, `url`,
// `thumbnail`, `source`, `extra`) kept whole in the `saved` table, so the Saved page
// can draw it without asking anyone again. The platform rooms (YouTube, Reddit, HN,
// GitHub) already hand out items in that shape; everything else is built here:
// anime titles, characters, people, studios and threads, a moment in an archived
// video, Workbench podcasts, posts and manuals, editor files, YouTube playlists and
// channels, subreddits — and any page at all (`pageItem`).
//
// `kindOf` names what an entry is, KINDS says how it's labelled and which channel
// it belongs to, and `channelOfItem` sorts it into Social, Coding or Video.

import { channelOfPath, roomOfPath } from './rooms.js';

/** Every kind of saved thing, in the order the Saved page lists them. */
export const KINDS = {
  video:     { label: 'Videos', one: 'video', channel: 'video' },
  moment:    { label: 'Moments', one: 'moment', channel: 'video' },
  playlist:  { label: 'Playlists', one: 'playlist', channel: 'video' },
  ytchannel: { label: 'Channels', one: 'channel', channel: 'video' },
  anime:     { label: 'Anime', one: 'title', channel: 'video' },
  character: { label: 'Characters', one: 'character', channel: 'video' },
  staff:     { label: 'Voices & staff', one: 'person', channel: 'video' },
  studio:    { label: 'Studios', one: 'studio', channel: 'video' },
  thread:    { label: 'Anime threads', one: 'thread', channel: 'video' },
  story:     { label: 'HN stories', one: 'story', channel: 'social' },
  post:      { label: 'Reddit posts', one: 'post', channel: 'social' },
  subreddit: { label: 'Subreddits', one: 'subreddit', channel: 'social' },
  repo:      { label: 'Repositories', one: 'repo', channel: 'coding' },
  release:   { label: 'Releases', one: 'release', channel: 'coding' },
  event:     { label: 'GitHub activity', one: 'event', channel: 'coding' },
  file:      { label: 'Files', one: 'file', channel: 'coding' },
  article:   { label: 'Posts & articles', one: 'article', channel: 'coding' },
  podcast:   { label: 'Podcast episodes', one: 'episode', channel: 'coding' },
  doc:       { label: 'Manuals', one: 'manual', channel: 'coding' },
  page:      { label: 'Pages', one: 'page', channel: null },
  link:      { label: 'Links', one: 'link', channel: null },
};
export const KIND_ORDER = Object.keys(KINDS);

/** What a saved entry is. Older entries carry no `extra.kind`; their platform says. */
export function kindOf(item) {
  const k = item?.extra?.kind;
  if (k && KINDS[k]) return k;
  switch (item?.platform) {
    case 'youtube': return 'video';
    case 'reddit': return 'post';
    case 'hackernews': return 'story';
    case 'github':
      if (item.extra?.type === 'release') return 'release';
      if (item.extra?.type === 'event') return 'event';
      return 'repo';
    default: return 'link';
  }
}

/** Social, Coding or Video — or null for a page outside every channel. */
export function channelOfItem(item) {
  const kind = kindOf(item);
  if (kind === 'page') return channelOfPath(String(item.url || '').split('?')[0])?.id || null;
  return KINDS[kind].channel;
}

/** The room colour an entry wears. */
export function toneOf(item) {
  switch (kindOf(item)) {
    case 'video': case 'moment': case 'playlist': case 'ytchannel': return 'var(--c-youtube)';
    case 'anime': case 'character': case 'staff': case 'studio': case 'thread': return 'var(--c-anime)';
    case 'story': return 'var(--c-hn)';
    case 'post': case 'subreddit': return 'var(--c-reddit)';
    case 'repo': case 'release': case 'event': return 'var(--c-github)';
    case 'file': return 'var(--c-editor)';
    case 'article': case 'podcast': case 'doc': return 'var(--c-dev)';
    case 'page': return roomOfPath(String(item.url || '').split('?')[0])?.color || 'var(--signal)';
    default: return 'var(--signal)';
  }
}

// ── builders ─────────────────────────────────────────────────────────────────

/** An AniList title (a `norm_media` object). */
export function animeItem(m) {
  return {
    id: `anime:${m.id}`,
    platform: 'anime',
    title: m.title,
    url: `/anime/${m.id}`,
    thumbnail: m.cover || m.cover_xl || null,
    source: [m.format, m.season && m.year ? `${m.season[0]}${m.season.slice(1).toLowerCase()} ${m.year}` : m.year || m.start_year]
      .filter(Boolean).join(' · ') || 'AniList',
    extra: { kind: 'anime', anilist_id: m.id, color: m.color || null, episodes: m.episodes || null, native: m.title_native || null },
  };
}

/** A character, voice actor/staff member or studio on AniList. */
export function anilistEntityItem(kind, { id, name, image, sub, native }) {
  const route = { character: 'character', staff: 'voice', studio: 'studio' }[kind];
  return {
    id: `anilist-${kind}:${id}`,
    platform: 'anime',
    title: name,
    url: `/anime/${route}/${id}`,
    thumbnail: image || null,
    source: sub || null,
    extra: { kind, anilist_id: id, native: native || null },
  };
}

/** An AniList forum thread. */
export function threadItem(t) {
  return {
    id: `anilist-thread:${t.id}`,
    platform: 'anime',
    title: t.title,
    url: `/anime/thread/${t.id}`,
    thumbnail: null,
    source: t.user?.name ? `by ${t.user.name}` : 'AniList forum',
    comments_count: t.reply_count ?? t.replies ?? null,
    published_at: t.created_at || null,
    extra: { kind: 'thread', anilist_id: t.id },
  };
}

/** A moment in an archived video: the video, a time and what was said there. */
export function momentItem(video, t, quote) {
  const sec = Math.max(0, Math.floor(t || 0));
  return {
    id: `moment:${video.id}@${sec}`,
    platform: 'youtube',
    title: video.title,
    url: video.url,
    thumbnail: video.thumbnail,
    source: video.source,
    extra: { kind: 'moment', t: sec, quote: quote || '', video },
  };
}

/** A YouTube playlist (`/youtube/playlist/:id`). */
export function playlistItem({ id, title, thumbnail, author, count }) {
  return {
    id: `ytpl:${id}`,
    platform: 'youtube',
    title,
    url: `/youtube/playlist/${id}`,
    thumbnail: thumbnail || null,
    source: [author, count != null ? `${count} videos` : null].filter(Boolean).join(' · ') || null,
    extra: { kind: 'playlist', playlist_id: id },
  };
}

/** A YouTube channel (`/youtube/c/:id`). */
export function ytChannelItem({ id, name, thumbnail, subscribers }) {
  return {
    id: `ytch:${id}`,
    platform: 'youtube',
    title: name,
    url: `/youtube/c/${id}`,
    thumbnail: thumbnail || null,
    source: subscribers || 'YouTube channel',
    extra: { kind: 'ytchannel', channel_id: id },
  };
}

/** A subreddit (`/reddit/r/:sub`). */
export function subredditItem(sub) {
  return {
    id: `subreddit:${sub.toLowerCase()}`,
    platform: 'reddit',
    title: `r/${sub}`,
    url: `/reddit/r/${sub}`,
    thumbnail: null,
    source: 'Subreddit',
    extra: { kind: 'subreddit', subreddit: sub },
  };
}

/** A file in the Composing Room's workspace. */
export function fileItem(path) {
  const name = path.split('/').pop();
  const dir = path.slice(0, -name.length).replace(/\/$/, '');
  return {
    id: `file:${path}`,
    platform: 'editor',
    title: name,
    url: `/editor?open=${encodeURIComponent(path)}`,
    thumbnail: null,
    source: dir || 'workspace root',
    extra: { kind: 'file', path },
  };
}

/** A Workbench podcast episode (plays from its own audio URL). */
export function podcastItem(ep, lang) {
  return {
    id: `podcast:${ep.id}`,
    platform: 'dev',
    title: ep.title,
    url: ep.url || ep.audio,
    thumbnail: null,
    source: ep.show,
    published_at: ep.published_at || null,
    extra: { kind: 'podcast', audio: ep.audio, duration: ep.duration || null, lang: lang || null },
  };
}

/** A Workbench change-log entry (a release or a core-team post). */
export function devPostItem(p, lang) {
  const release = p.type === 'release';
  return {
    id: `dev:${p.id || p.url}`,
    platform: 'dev',
    title: release ? `${p.tag}${p.title && p.title !== p.tag ? ` — ${p.title}` : ''}` : p.title,
    url: p.url,
    thumbnail: null,
    source: p.source || (lang ? `${lang} releases` : null),
    published_at: p.published_at || null,
    extra: { kind: 'article', lang: lang || null, release },
  };
}

/** A manual from a Workbench reference shelf. */
export function docItem(d, lang) {
  return {
    id: `doc:${d.url}`,
    platform: 'dev',
    title: d.title,
    url: d.url,
    thumbnail: null,
    source: [lang, d.kind].filter(Boolean).join(' · ') || null,
    description: d.note || '',
    extra: { kind: 'doc', lang: lang || null },
  };
}

/** Any page in Tubcal, by its address. */
export function pageItem(path, title) {
  const room = roomOfPath(path.split('?')[0]);
  return {
    id: `page:${path}`,
    platform: 'page',
    title: title || room?.label || path,
    url: path,
    thumbnail: null,
    source: room?.label || 'Tubcal',
    extra: { kind: 'page' },
  };
}

/** A readable name for the page at `pathname` + `search`, for "Save this page". */
export function pageTitle(pathname, search) {
  const room = roomOfPath(pathname);
  const q = new URLSearchParams(search);
  const bits = [];
  const query = q.get('q');
  if (query) bits.push(`“${query}”`);
  const sub = pathname.match(/^\/reddit\/r\/([^/]+)/);
  if (sub) bits.push(`r/${sub[1]}`);
  const lang = q.get('lang');
  if (lang) bits.push(lang);
  const tab = q.get('tab');
  if (tab) bits.push(tab);
  const view = q.get('v') || q.get('l');
  if (view) bits.push(view);
  const shelf = q.get('shelf');
  if (shelf) bits.push(shelf.toLowerCase());
  const head = room?.label || (pathname === '/' ? 'Home' : pathname);
  return bits.length ? `${head} — ${bits.join(' · ')}` : head;
}
