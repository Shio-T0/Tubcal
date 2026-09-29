// Pieces every corner of the Anime room shares: the URL-state hook, the poster
// card and its badges, labels for AniList's enums, and a few small hooks. They
// used to live inside pages/Anime.jsx; the room grew tabs and pages of its own,
// and each of those reaches for the same card and the same vocabulary.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Bookmark, CheckCheck, CircleSlash, CloudOff, Eye, Heart, Pause, RefreshCw, Repeat, Star,
  Tv, User,
} from 'lucide-react';

import { api } from '../../api/client.js';
import { useToast } from '../../state.jsx';
import { useAnimeCalc } from './WatchCalculator.jsx';
import s from '../../pages/anime.module.css';

/** A whisper-quiet keycap in a card's corner: the discoverable hint that hovering
 *  this title and tapping C tallies its next episode into the Reckoner. Revealed on
 *  hover by the card's own CSS; inert (aria-hidden) to assistive tech. */
export function CalcCue() {
  return (
    <span className={s.calcCue} aria-hidden="true" title="Tap C to tally the next episode">
      C
    </span>
  );
}

// AniList score scales by the viewer's chosen format.
export const SCORE_MAX = { POINT_100: 100, POINT_10_DECIMAL: 10, POINT_10: 10, POINT_5: 5, POINT_3: 3 };
export const SCORE_STEP = { POINT_10_DECIMAL: 0.5 };

// The URL-state pair (useParamState + latestParams) lives in lib/urlState.js now —
// the Hub's rooms keep their view in the query string too.
export { latestParams, useParamState } from '../../lib/urlState.js';

// A Set of filter keys <-> a comma-separated param, order-stable so the URL
// doesn't churn as buckets are toggled on and off.
export const SET_PARAM = {
  parse: (v) => new Set(v.split(',').filter(Boolean)),
  format: (v) => [...v].sort().join(','),
};
// Stable identity: an inline `new Set()` fallback would be a fresh object on every
// render, so useParamState's `set` could never memoize.
export const EMPTY_SET = new Set();

export const toggleInSet = (setter) => (key) =>
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

// A link into the Browse finder pre-set to one genre (`g`) or tag (`t`). Lets a
// genre/tag chip anywhere become "show me more like this" without a second thought.
export const discoverHref = (key, value) => `/anime?tab=browse&${key}=${encodeURIComponent(value)}`;

// AniList averageScore is 0–100; show it as a tidy percent.
export function scoreLabel(n) {
  return n ? `${n}%` : null;
}

// Your own score arrives in your chosen AniList format; render it the way you set it.
export function personalScore(media, format) {
  const v = media.list_entry?.score;
  if (!v) return null;
  if (format === 'POINT_10_DECIMAL') return v.toFixed(1);
  return String(v); // POINT_100 / POINT_10 / POINT_5 / POINT_3 are already whole
}

/** The score cluster pinned to a cover: the global average always, plus *your*
 *  rating (persimmon, with a person glyph) when the title is on your list.
 *  `className` positions the cluster (top-right on browse, bottom-left elsewhere). */
export function CoverRatings({ media, scoreFormat, className }) {
  const mine = personalScore(media, scoreFormat);
  if (!scoreLabel(media.score) && !mine) return null;
  return (
    <div className={`${s.ratings} ${className || ''}`}>
      {scoreLabel(media.score) && (
        <span className={s.rateGlobal} title="AniList average">
          <Star size={10} fill="currentColor" /> {scoreLabel(media.score)}
        </span>
      )}
      {mine && (
        <span className={s.rateMine} title="Your rating">
          <User size={10} /> {mine}
        </span>
      )}
    </div>
  );
}

export const FORMAT_LABEL = {
  TV: 'TV', TV_SHORT: 'TV short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA',
  ONA: 'ONA', MUSIC: 'Music', MANGA: 'Manga', NOVEL: 'Novel', ONE_SHOT: 'One-shot',
};
export const formatLabel = (f) => FORMAT_LABEL[f] || f || null;

export const SOURCE_LABEL = {
  ORIGINAL: 'Original', MANGA: 'Manga', LIGHT_NOVEL: 'Light novel', VISUAL_NOVEL: 'Visual novel',
  VIDEO_GAME: 'Video game', OTHER: 'Other', NOVEL: 'Novel', DOUJINSHI: 'Doujinshi', ANIME: 'Anime',
  WEB_NOVEL: 'Web novel', LIVE_ACTION: 'Live action', GAME: 'Game', COMIC: 'Comic',
  MULTIMEDIA_PROJECT: 'Multimedia project', PICTURE_BOOK: 'Picture book',
};
export const COUNTRY_LABEL = { JP: 'Japan', CN: 'China', KR: 'South Korea', TW: 'Taiwan' };

export function metaLine(m) {
  const bits = [];
  if (m.format) bits.push(formatLabel(m.format));
  if (m.episodes) bits.push(`${m.episodes} ep`);
  if (m.year) bits.push(m.year);
  return bits.join(' · ');
}

/** A trailer plays through Tubcal's existing YouTube player (AniList stores a YT id). */
export function trailerItem(media) {
  const tr = media.trailer;
  if (!tr || tr.site !== 'youtube') return null;
  return {
    id: `yt:${tr.id}`,
    platform: 'youtube',
    title: `${media.title} — Trailer`,
    url: `https://www.youtube.com/watch?v=${tr.id}`,
    thumbnail: tr.thumbnail,
    source: media.title,
    published_at: 0,
    extra: { video_id: tr.id },
  };
}

/** Format a remaining-millisecond span as a compact "2d 4h" / "3h 12m" / "5m 02s". */
export function fmtCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** Minutes of watching as "3d 4h", "11h 20m", "45m" — the unit a backlog is felt in. */
export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

/** A precise local date/time for an airing timestamp ("Sat, Jun 28 · 11:30 PM"). */
export function airingDateLabel(at) {
  return new Date(at * 1000).toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** Keep a countdown live: re-render the caller every second within the final hour,
 *  every half-minute otherwise, and stop once the moment has passed. */
export function useCountdownTick(atMs) {
  const [, force] = useState(0);
  const remaining = atMs ? atMs - Date.now() : 0;
  const fast = remaining > 0 && remaining < 3_600_000;
  const done = remaining <= 0;
  useEffect(() => {
    if (!atMs || done) return undefined;
    const t = setInterval(() => force((n) => n + 1), fast ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [atMs, fast, done]);
}

/** A live "next episode" countdown chip pinned to a media cover. Renders nothing
 *  unless the title has a scheduled upcoming episode still in the future. */
export function NextEpBadge({ media }) {
  const atMs = media.next_airing_at ? media.next_airing_at * 1000 : 0;
  useCountdownTick(atMs);
  if (!atMs) return null;
  const ms = atMs - Date.now();
  if (ms <= 0) return null;
  return (
    <span className={s.airBadge} title={`Episode ${media.next_episode ?? ''} airs ${airingDateLabel(media.next_airing_at)}`}>
      <span className={s.airPulse} aria-hidden="true" />
      {media.next_episode ? `EP ${media.next_episode}` : 'Next'} · {fmtCountdown(ms)}
    </span>
  );
}

export function AnimeCard({ media, corner, scoreFormat }) {
  const { hoverProps } = useAnimeCalc();
  return (
    <Link to={`/anime/${media.id}`} className={s.card} style={{ '--cover-c': media.color || 'var(--c-anime)' }} {...hoverProps(media)}>
      <div className={s.cardCoverWrap}>
        {media.cover ? (
          <img className={s.cardCover} src={media.cover} alt="" loading="lazy" />
        ) : (
          <div className={s.cardCoverFallback}><Tv size={26} /></div>
        )}
        {corner && <span className={s.cardCorner}>{corner}</span>}
        <CoverRatings media={media} scoreFormat={scoreFormat} className={s.ratingsBL} />
        <NextEpBadge media={media} />
        <CalcCue />
      </div>
      <div className={s.cardTitle}>{media.title}</div>
      <div className={s.cardMeta}>{metaLine(media)}</div>
    </Link>
  );
}

/** AniList synopses arrive as HTML; flatten to one clean line for previews. */
export function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export const MEDIA_STATUS = {
  RELEASING: 'Airing now',
  FINISHED: 'Complete',
  NOT_YET_RELEASED: 'Upcoming',
  CANCELLED: 'Cancelled',
  HIATUS: 'On hiatus',
};

// Sync-state glyph: edits land locally at once, so this is how you tell whether a
// change is still only on this machine (pending), being pushed (syncing), or
// failed. Absent when everything is in sync with AniList.
const SYNC_META = {
  pending: [CloudOff, 'Not yet synced'],
  syncing: [RefreshCw, 'Syncing to AniList…'],
  error: [AlertTriangle, 'Sync failed — kept locally'],
};

export function SyncBadge({ status, label = true, className }) {
  const meta = SYNC_META[status];
  if (!meta) return null;
  const [Icon, text] = meta;
  return (
    <span
      className={`${s.syncBadge} ${s[`sync_${status}`] || ''} ${className || ''}`}
      title={text}
      data-status={status}
    >
      <Icon size={12} className={status === 'syncing' ? s.spin : undefined} aria-hidden="true" />
      {label && <span>{text}</span>}
    </span>
  );
}

export const titleCase = (str) => (str ? str[0] + str.slice(1).toLowerCase() : str);

export const seasonLabel = (season, year) =>
  season ? `${titleCase(season)}${year ? ` ${year}` : ''}` : (year ? String(year) : null);

export const STATUS_LABEL = {
  CURRENT: 'Watching',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
  REPEATING: 'Rewatching',
};

// Status pills, in the order AniList presents them, each with its own glyph.
export const STATUS_META = [
  ['CURRENT', 'Watching', Eye],
  ['PLANNING', 'Planning', Bookmark],
  ['COMPLETED', 'Completed', CheckCheck],
  ['PAUSED', 'Paused', Pause],
  ['DROPPED', 'Dropped', CircleSlash],
  ['REPEATING', 'Rewatching', Repeat],
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_SHORT = MONTHS;

/** AniList birthdays are frequently day+month with no year. Render exactly what's
 *  known rather than inventing a year or dropping the date. */
export function fuzzyDateLabel(d) {
  if (!d) return null;
  const { year, month, day } = d;
  const md = month ? `${MONTHS[month - 1]}${day ? ` ${day}` : ''}` : null;
  if (md && year) return `${md}, ${year}`;
  return md || (year ? String(year) : null);
}

/** Fire once when an element first comes near the viewport. The heavier sections
 *  of a detail page (the franchise walk especially) wait for this, so a quick
 *  glance at a title doesn't spend AniList's per-minute budget on what's below. */
export function useInView(margin = '400px') {
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return undefined;
    }
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setSeen(true); },
      { rootMargin: `${margin} 0px` },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [seen, margin]);
  return [ref, seen];
}

/** Accumulating paginated fetch. `signature` fingerprints the live query; the
 *  moment it changes the list resets to page one. `buildUrl(page)` names the
 *  endpoint for a page — always read through a ref so a rebuilt closure never
 *  forces a refetch on its own. Every backend page carries `has_next`. Items are
 *  de-duplicated on `keyOf` (a title can drift across a page boundary between
 *  fetches, and a doubled React key would crash the render). */
export function useInfinite(signature, buildUrl, { keyOf = (x) => x.id, enabled = true } = {}) {
  const [items, setItems] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [extra, setExtra] = useState(null); // the first page's non-list fields
  const pageRef = useRef(1);
  const busyRef = useRef(false);
  const epochRef = useRef(0); // bumped per fetch; a stale resolve (old query) is ignored
  const buildRef = useRef(buildUrl);
  buildRef.current = buildUrl;
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;

  const fetchPage = useCallback(async (p, append) => {
    const myEpoch = (epochRef.current += 1);
    busyRef.current = true;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const d = await api(buildRef.current(p));
      if (myEpoch !== epochRef.current) return;
      const got = d.items || [];
      setItems((prev) => {
        if (!append || !prev) return got;
        const seen = new Set(prev.map((x) => keyRef.current(x)));
        return [...prev, ...got.filter((x) => !seen.has(keyRef.current(x)))];
      });
      if (!append) setExtra(d);
      setHasMore(!!d.has_next);
      pageRef.current = p;
    } catch (e) {
      if (myEpoch !== epochRef.current) return;
      setError(e.message);
      if (!append) setItems([]);
    } finally {
      if (myEpoch === epochRef.current) {
        busyRef.current = false;
        setLoadingMore(false);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setItems(null);
    setHasMore(false);
    pageRef.current = 1;
    fetchPage(1, false);
  }, [signature, fetchPage, enabled]);

  const loadMore = useCallback(() => {
    if (busyRef.current || !hasMore) return;
    fetchPage(pageRef.current + 1, true);
  }, [hasMore, fetchPage]);

  const patch = useCallback((fn) => setItems((prev) => (prev ? fn(prev) : prev)), []);

  return { items, hasMore, loading, loadingMore, error, loadMore, extra, patch };
}

/** An off-screen tripwire below a wall: when it nears the viewport it asks for the
 *  next page. `count` re-arms it after every append (a still-visible sentinel won't
 *  re-fire on its own), so a tall screen keeps filling until the page is covered. */
export function InfiniteSentinel({ onReach, active, count }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active || typeof IntersectionObserver === 'undefined') return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) onReach(); },
      { rootMargin: '800px 0px' }, // start dealing the next page well before it shows
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onReach, active, count]);
  return <div ref={ref} aria-hidden="true" className={s.sentinel} />;
}

/** The heart that adds or removes anything AniList lets you favourite — an anime,
 *  a character, a voice actor or staff member, a studio. Optimistic, then settled
 *  to what AniList reports back. `compact` drops the words for tight corners. */
export function FavToggle({ kind, id, initial, count, compact = false, className }) {
  const toast = useToast();
  const [fav, setFav] = useState(!!initial);
  const [n, setN] = useState(count ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFav(!!initial); }, [initial]);

  const toggle = async (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (busy) return;
    setBusy(true);
    const prev = fav;
    setFav(!prev);
    try {
      const res = await api('/anime/favourite', { method: 'POST', body: JSON.stringify({ kind, id }) });
      setFav(res.is_favourite);
      if (res.favourites != null) setN(res.favourites);
      toast(res.is_favourite ? 'Added to your AniList favourites' : 'Removed from favourites', 'success');
    } catch (err) {
      setFav(prev);
      toast(err.message, 'error');
    }
    setBusy(false);
  };

  return (
    <button
      type="button"
      className={`${s.favBtn} ${compact ? s.favBtnCompact : ''} ${className || ''}`}
      data-on={fav ? '' : undefined}
      disabled={busy}
      onClick={toggle}
      aria-pressed={fav}
      title={fav ? 'Remove from favourites' : 'Add to favourites'}
    >
      <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
      {!compact && (fav ? 'Favourited' : 'Favourite')}
      {n != null && n > 0 && <span className={s.favCount}>{n.toLocaleString()}</span>}
    </button>
  );
}

/** AniList's own markdown dialect for bios and descriptions: __bold__, _italic_,
 *  [text](url) links, raw newlines between paragraphs, and ~!spoilers!~ — which
 *  stay veiled until clicked, one at a time. Everything renders as React nodes;
 *  no HTML from AniList is injected here. */
const MD_TOKEN = /~!([\s\S]+?)!~|__(.+?)__|(?<![\w])_([^_\n]+?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)|<br\s*\/?>/gi;

function Spoiler({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className={`${s.mdSpoiler} ${open ? s.mdSpoilerOpen : ''}`}
      onClick={() => setOpen(true)}
      aria-label={open ? undefined : 'Reveal spoiler'}
    >
      {open ? children : 'spoiler — tap to reveal'}
    </button>
  );
}

function renderInline(text, keyBase) {
  const out = [];
  let last = 0;
  let m;
  // A fresh regex per call: spoilers recurse, and a shared /g regex would have
  // its lastIndex moved under the outer loop by the inner one.
  const re = new RegExp(MD_TOKEN.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${m.index}`;
    if (m[1] !== undefined) out.push(<Spoiler key={k}>{renderInline(m[1], k)}</Spoiler>);
    else if (m[2] !== undefined) out.push(<b key={k}>{m[2]}</b>);
    else if (m[3] !== undefined) out.push(<i key={k}>{m[3]}</i>);
    else if (m[4] !== undefined) {
      out.push(/^https?:\/\//i.test(m[5])
        ? <a key={k} href={m[5]} target="_blank" rel="noreferrer">{m[4]}</a>
        : m[4]);
    } else out.push(<br key={k} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function AniText({ text, className, paragraphs = Infinity }) {
  if (!text) return null;
  const paras = text
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className={className}>
      {/* A single newline is a line break — AniList bios list vitals one per line
          ("__Height:__ 172 cm", "__Affiliation:__ …"), and joining them runs on. */}
      {paras.slice(0, paragraphs).map((p, i) => (
        <p key={i}>{renderInline(p.replace(/\r?\n/g, '<br>'), i)}</p>
      ))}
    </div>
  );
}
