import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bookmark, Calendar, Check, CheckCheck,
  ChevronDown, ChevronLeft, ChevronRight, CircleSlash, Clapperboard, CloudOff,
  Eye, ExternalLink, Flag, Frown, Heart, History, Meh, Minus, Pause, Play, PlayCircle,
  Plus, RefreshCw, Repeat, Search, SlidersHorizontal, Smile, Star, Tag, ThumbsUp,
  Trash2, Tv, User, X,
} from 'lucide-react';

import { api, useApi } from '../api/client.js';
import {
  ErrorBox,
  Receiving,
  SearchBar,
  SectionHead,
  useDebounced,
} from '../components/layout/Section.jsx';
import { Button, EmptyState, SegmentedControl } from '../components/ui/index.jsx';
import { Avatar } from '../components/ui/Avatar.jsx';
import { ActivityFeed, ForumList } from '../components/anime/Discussions.jsx';
import { ProfileModal, ProfileStudio } from '../components/anime/Profile.jsx';
import { useHorizontalWheel } from '../lib/useHorizontalWheel.js';
import { compact } from '../lib/format.js';
import { clock, formatWhen, timeAgo } from '../lib/time.js';
import { applyOverlay, COMPLETE_RATIO, useAnimeSync, usePlayer, useProgress, useToast } from '../state.jsx';
import { useAnimeCalc } from '../components/anime/WatchCalculator.jsx';
import s from './anime.module.css';

/** A whisper-quiet keycap in a card's corner: the discoverable hint that hovering
 *  this title and tapping C tallies its next episode into the Reckoner. Revealed on
 *  hover by the card's own CSS; inert (aria-hidden) to assistive tech. */
function CalcCue() {
  return (
    <span className={s.calcCue} aria-hidden="true" title="Tap C to tally the next episode">
      C
    </span>
  );
}

// AniList score scales by the viewer's chosen format.
const SCORE_MAX = { POINT_100: 100, POINT_10_DECIMAL: 10, POINT_10: 10, POINT_5: 5, POINT_3: 3 };
const SCORE_STEP = { POINT_10_DECIMAL: 0.5 };

/** Component state that lives in the query string instead of in the component.
 *
 * Opening a title unmounts this page, so anything held in useState is gone by the
 * time you press back — you'd land in Browse with your filters cleared. Parking it
 * in the URL means the history entry itself carries the view, so back (the button,
 * the browser, or a gesture) restores the shelf and filters you left, and a reload
 * or a copied link opens the same place.
 *
 * Updates replace rather than push: a filter toggle isn't a destination, and
 * pushing would make back walk through every toggle before leaving the room.
 * Values equal to `fallback` drop out of the URL so the default view stays clean.
 */
function useParamState(key, fallback, { parse = (v) => v, format = String } = {}) {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = raw == null ? fallback : parse(raw);

  const set = useCallback(
    (next) => {
      setParams(
        (prev) => {
          const cur = prev.get(key) == null ? fallback : parse(prev.get(key));
          const v = typeof next === 'function' ? next(cur) : next;
          const p = new URLSearchParams(prev);
          const s = v == null ? '' : format(v);
          if (!s || s === format(fallback)) p.delete(key);
          else p.set(key, s);
          return p;
        },
        { replace: true },
      );
    },
    // parse/format are inline literals at every call site; re-creating `set` when
    // they change would defeat memoization for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, fallback, setParams],
  );

  return [value, set];
}

// A Set of filter keys <-> a comma-separated param, order-stable so the URL
// doesn't churn as buckets are toggled on and off.
const SET_PARAM = {
  parse: (v) => new Set(v.split(',').filter(Boolean)),
  format: (v) => [...v].sort().join(','),
};
// Stable identity: an inline `new Set()` fallback would be a fresh object on every
// render, so useParamState's `set` could never memoize.
const EMPTY_SET = new Set();

const ACCENT = { '--accent-local': 'var(--c-anime)' };

// A link into the Browse finder pre-set to one genre (`g`) or tag (`t`). Lets a
// genre/tag chip anywhere become "show me more like this" without a second thought.
const discoverHref = (key, value) => `/anime?tab=browse&${key}=${encodeURIComponent(value)}`;

// AniList averageScore is 0–100; show it as a tidy percent.
function scoreLabel(n) {
  return n ? `${n}%` : null;
}

// Your own score arrives in your chosen AniList format; render it the way you set it.
function personalScore(media, format) {
  const v = media.list_entry?.score;
  if (!v) return null;
  if (format === 'POINT_10_DECIMAL') return v.toFixed(1);
  return String(v); // POINT_100 / POINT_10 / POINT_5 / POINT_3 are already whole
}

/** The score cluster pinned to a cover: the global average always, plus *your*
 *  rating (persimmon, with a person glyph) when the title is on your list.
 *  `className` positions the cluster (top-right on browse, bottom-left elsewhere). */
function CoverRatings({ media, scoreFormat, className }) {
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

function metaLine(m) {
  const bits = [];
  if (m.format) bits.push(m.format);
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
function fmtCountdown(ms) {
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

/** A precise local date/time for an airing timestamp ("Sat, Jun 28 · 11:30 PM"). */
function airingDateLabel(at) {
  return new Date(at * 1000).toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** Keep a countdown live: re-render the caller every second within the final hour,
 *  every half-minute otherwise, and stop once the moment has passed. */
function useCountdownTick(atMs) {
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
function NextEpBadge({ media }) {
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
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Each browse dial has its own voice + whether its order is a true ranking.
const BROWSE_KINDS = [
  { value: 'trending', label: 'Trending', caption: 'what the house is tuned into this week', ranked: true },
  { value: 'popular', label: 'Popular', caption: 'the all-time crowd favorites', ranked: true },
  { value: 'seasonal', label: 'This season', caption: 'the current lineup, most-watched first', ranked: false },
  { value: 'top', label: 'Top rated', caption: 'the highest scored ever aired', ranked: true },
];

const MEDIA_STATUS = {
  RELEASING: 'Airing now',
  FINISHED: 'Complete',
  NOT_YET_RELEASED: 'Upcoming',
  CANCELLED: 'Cancelled',
  HIATUS: 'On hiatus',
};

const titleCase = (s) => (s ? s[0] + s.slice(1).toLowerCase() : s);

function SpecRow({ label, value }) {
  if (!value) return null;
  return (
    <div className={s.specRow}>
      <dt className={s.specLabel}>{label}</dt>
      <dd className={s.specValue} title={value}>{value}</dd>
    </div>
  );
}

// Human-readable spec values shared by the spotlight dossier and the detail header.
function mediaSpecs(media) {
  const aired = media.next_episode ? media.next_episode - 1 : null;
  const episodes = media.episodes
    ? `${media.episodes} ep${media.duration ? ` · ${media.duration}m` : ''}`
    : aired != null
      ? `${aired} aired so far`
      : null;
  const status =
    media.status === 'RELEASING' && media.next_episode
      ? `Airing · ep ${media.next_episode} next`
      : MEDIA_STATUS[media.status] || null;
  const season = media.season
    ? `${titleCase(media.season)}${media.year ? ` ${media.year}` : ''}`
    : media.year || null;
  const fans = media.popularity ? `${media.popularity.toLocaleString()} fans` : null;
  return { episodes, status, season, fans };
}

/** A segmented 0–100 score meter (the global AniList average). */
function ScoreMeter({ score }) {
  const filled = Math.round(score / 10);
  return (
    <div className={s.scoreMeter}>
      <span className={s.scoreMeterLabel}>
        <Star size={12} fill="currentColor" /> {score}<i>/100</i>
      </span>
      <span className={s.meterTrack} aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={i < filled ? s.meterOn : s.meterOff} />
        ))}
      </span>
    </div>
  );
}

/** The lead title as a detailed dossier: poster, spec sheet, and a score meter,
 *  with the banner demoted to ambient texture behind it. */
function FeatureSpotlight({ media, lead, scoreFormat }) {
  const synopsis = stripHtml(media.description);
  const art = media.banner || media.cover_xl || media.cover;
  const mine = personalScore(media, scoreFormat);
  const myStatus = media.list_entry && (STATUS_LABEL[media.list_entry.status] || 'On your list');
  const { episodes, status, season, fans } = mediaSpecs(media);

  return (
    <div className={s.spotlight} style={{ '--cover-c': media.color || 'var(--c-anime)' }}>
      {art && <div className={s.spotlightArt} style={{ backgroundImage: `url(${art})` }} />}
      <div className={s.spotlightScrim} />
      <span className={s.spotlightScan} aria-hidden="true" />

      <div className={s.spotlightInner}>
        <div className={s.spotlightPosterCol}>
          {media.cover_xl ? (
            <img className={s.spotlightPoster} src={media.cover_xl} alt="" loading="lazy" />
          ) : (
            <div className={s.spotlightPosterFallback}><Tv size={30} /></div>
          )}
          <Link to={`/anime/${media.id}`} className={s.spotlightCta}>
            Open detail <ArrowRight size={14} />
          </Link>
        </div>

        <div className={s.spotlightMain}>
          <span className={s.spotlightEyebrow}>{lead}</span>
          <Link to={`/anime/${media.id}`} className={s.spotlightTitleLink}>
            <h2 className={s.spotlightTitle}>{media.title}</h2>
          </Link>
          {media.title_native && <span className={s.spotlightNative}>{media.title_native}</span>}

          {media.genres?.length > 0 && (
            <div className={s.spotlightGenres}>
              {media.genres.slice(0, 4).map((g) => <span key={g}>{g}</span>)}
            </div>
          )}

          {synopsis && <p className={s.spotlightSynopsis}>{synopsis}</p>}

          <dl className={s.specSheet}>
            <SpecRow label="Studio" value={media.studios?.[0]} />
            <SpecRow label="Format" value={media.format} />
            <SpecRow label="Episodes" value={episodes} />
            <SpecRow label="Status" value={status} />
            <SpecRow label="Season" value={season} />
            <SpecRow label="Fanbase" value={fans} />
          </dl>

          <div className={s.spotlightScores}>
            {media.score > 0 && <ScoreMeter score={media.score} />}
            {(mine || myStatus) && (
              <span className={s.yourMark} title="Your rating on this title">
                <User size={12} />
                {mine && <strong>{mine}</strong>}
                {myStatus && <em>{myStatus}</em>}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Top-5 spotlight reel: auto-advances every few seconds, pauses on hover/focus,
 *  with dots + arrows and a per-slide progress tick. */
function SpotlightCarousel({ items, kind, ranked, label, scoreFormat }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = items.length;

  // Reset to the first slide whenever the section (kind) changes.
  useEffect(() => setI(0), [kind]);
  useEffect(() => {
    if (paused || n <= 1) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % n), 6500);
    return () => clearInterval(t);
  }, [paused, n, kind]);

  if (!n) return null;
  const safe = Math.min(i, n - 1);
  const m = items[safe];
  const lead = ranked ? `#${safe + 1} in ${label}` : 'This season’s spotlight';
  const go = (k) => setI(((k % n) + n) % n);

  return (
    <div
      className={s.carousel}
      data-paused={paused ? '' : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <FeatureSpotlight key={m.id} media={m} lead={lead} scoreFormat={scoreFormat} />

      {n > 1 && (
        <>
          <button className={`${s.carArrow} ${s.carPrev}`} onClick={() => go(safe - 1)} aria-label="Previous title">
            <ChevronLeft size={18} />
          </button>
          <button className={`${s.carArrow} ${s.carNext}`} onClick={() => go(safe + 1)} aria-label="Next title">
            <ChevronRight size={18} />
          </button>
          <div className={s.carDots} role="tablist" aria-label="Spotlight titles">
            {items.map((it, k) => (
              <button
                key={it.id}
                className={k === safe ? s.carDotOn : s.carDot}
                onClick={() => go(k)}
                aria-label={`Title ${k + 1}`}
                aria-selected={k === safe}
                role="tab"
              >
                {k === safe && <span key={safe} className={s.carTick} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Richer poster tile for Browse & Search: hover lifts, the cover breathes,
 *  and a veil rises to show the genre dyes. `rank` is set only for true orderings. */
function BrowseCard({ media, rank, index = 0, scoreFormat }) {
  const { hoverProps } = useAnimeCalc();
  return (
    <Link
      to={`/anime/${media.id}`}
      className={s.pcard}
      style={{ '--cover-c': media.color || 'var(--c-anime)', '--i': index }}
      {...hoverProps(media)}
    >
      <div className={s.pcardCover}>
        {media.cover ? (
          <img src={media.cover} alt="" loading="lazy" />
        ) : (
          <div className={s.pcardFallback}><Tv size={26} /></div>
        )}
        <span className={s.pcardVeil} />
        {rank != null && <span className={s.pcardRank}>{rank}</span>}
        <CoverRatings media={media} scoreFormat={scoreFormat} className={s.ratingsTR} />
        <NextEpBadge media={media} />
        <CalcCue />
        {media.genres?.length > 0 && (
          <div className={s.pcardReveal}>
            {media.genres.slice(0, 3).map((g) => <span key={g}>{g}</span>)}
          </div>
        )}
      </div>
      <div className={s.pcardTitle}>{media.title}</div>
      <div className={s.pcardMeta}>{metaLine(media)}</div>
    </Link>
  );
}

// The order dials the finder offers once a genre or tag is in play. Each carries a
// quiet caption so the shelf explains what it's showing, the way the browse dials do.
const DISCOVER_SORTS = [
  { value: 'popular', label: 'Most popular', caption: 'the best-loved matches first' },
  { value: 'trending', label: 'Trending now', caption: 'what the house is watching right now' },
  { value: 'score', label: 'Highest rated', caption: 'the highest scored of the lot' },
  { value: 'newest', label: 'Newest first', caption: 'freshest premieres up top' },
  { value: 'oldest', label: 'Oldest first', caption: 'from the very beginning' },
  { value: 'title', label: 'Title A–Z', caption: 'alphabetical, front to back' },
];

// AniList files tags under "Category-Subcategory" ("Cast-Main Cast", "Theme-Action").
// The middot reads far better than the hyphen once it's a heading.
const prettyCat = (c) => (c || 'Other').replace(/-/g, ' · ');

const toggleInSet = (setter) => (key) =>
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

/** One tag as a toggle chip, carrying AniList's own description as a hover note —
 *  the sort of gloss that answers "what *is* Iyashikei" without leaving the page. */
function TagChip({ tag, on, onToggle }) {
  return (
    <button
      type="button"
      className={`${s.tagPick} ${on ? s.tagPickOn : ''}`}
      title={tag.description || undefined}
      onClick={() => onToggle(tag.name)}
      aria-pressed={on}
    >
      <span className={s.tagPickCheck}>{on && <Check size={10} />}</span>
      {tag.name}
    </button>
  );
}

/** The finder: the full genre roster as chips, then AniList's tag vocabulary grouped
 *  by category into collapsible sections with an in-panel search. Selected tags are
 *  pinned to the top so a choice buried in a collapsed category is always reachable. */
function AnimeFinder({ coll, genres, tags, toggleGenre, toggleTag, clearGenres, clearTags }) {
  const [tagQuery, setTagQuery] = useState('');
  const [openCats, setOpenCats] = useState(() => new Set());
  const tq = tagQuery.trim().toLowerCase();

  if (coll.loading && !coll.data) {
    return <div className={s.finderPanel}><Receiving label="pulling the genre index" /></div>;
  }
  if (coll.error) {
    return <div className={s.finderPanel}><ErrorBox message={coll.error} /></div>;
  }
  const data = coll.data;
  if (!data) return null;

  const allGenres = data.genres || [];
  const groups = data.tag_groups || [];
  const toggleCat = toggleInSet(setOpenCats);

  // A flat, ranked match list while the tag search has text; otherwise the grouped
  // accordion. Description matches count too, so "healing" finds Iyashikei.
  const matches = tq
    ? (data.tags || []).filter(
        (t) => t.name.toLowerCase().includes(tq) || (t.description || '').toLowerCase().includes(tq),
      )
    : null;
  const selectedTags = [...tags].sort();

  return (
    <div className={s.finderPanel}>
      {/* Genres — the whole roster fits, so it's laid out flat, no folding needed. */}
      <section className={s.finderSection}>
        <div className={s.finderSectionHead}>
          <span className={s.finderLabel}><Clapperboard size={12} /> Genre</span>
          {genres.size > 0 && (
            <button className={s.finderMini} onClick={clearGenres}>clear {genres.size}</button>
          )}
        </div>
        <div className={s.genreGrid}>
          {allGenres.map((g) => {
            const on = genres.has(g);
            return (
              <button
                key={g}
                type="button"
                className={`${s.genreChip} ${on ? s.genreChipOn : ''}`}
                onClick={() => toggleGenre(g)}
                aria-pressed={on}
              >
                <span className={s.genreCheck}>{on && <Check size={11} />}</span>
                {g}
              </button>
            );
          })}
        </div>
      </section>

      {/* Tags — hundreds of them, so grouped + searchable, with selections surfaced. */}
      <section className={s.finderSection}>
        <div className={s.finderSectionHead}>
          <span className={s.finderLabel}><Tag size={12} /> Tags</span>
          <div className={s.tagSearchWrap}>
            <Search size={13} className={s.tagSearchIcon} />
            <input
              className={s.tagSearch}
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
              placeholder="filter tags…"
              spellCheck={false}
            />
            {tagQuery && (
              <button className={s.tagSearchClear} onClick={() => setTagQuery('')} aria-label="Clear tag filter">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {selectedTags.length > 0 && (
          <div className={s.tagSelected}>
            <span className={s.tagSelectedLead}>chosen</span>
            {selectedTags.map((t) => (
              <button key={t} type="button" className={s.tagPickOn} onClick={() => toggleTag(t)}>
                <span className={s.tagPickCheck}><Check size={10} /></span>
                {t}
                <X size={10} className={s.tagPickX} />
              </button>
            ))}
            <button className={s.finderMini} onClick={clearTags}>clear</button>
          </div>
        )}

        {matches ? (
          <div className={s.tagMatchWrap}>
            <span className={s.tagMatchCount}>
              {matches.length} tag{matches.length === 1 ? '' : 's'} match “{tagQuery.trim()}”
            </span>
            {matches.length > 0 ? (
              <div className={s.tagChips}>
                {matches.map((t) => (
                  <TagChip key={t.name} tag={t} on={tags.has(t.name)} onToggle={toggleTag} />
                ))}
              </div>
            ) : (
              <p className={s.finderEmpty}>Nothing in the vocabulary matches that.</p>
            )}
          </div>
        ) : (
          <div className={s.tagGroups}>
            {groups.map((grp) => {
              const sel = grp.tags.reduce((n, t) => n + (tags.has(t.name) ? 1 : 0), 0);
              const open = openCats.has(grp.category);
              return (
                <div key={grp.category} className={s.tagCat} data-open={open ? '' : undefined}>
                  <button
                    type="button"
                    className={s.tagCatHead}
                    onClick={() => toggleCat(grp.category)}
                    aria-expanded={open}
                  >
                    <ChevronRight size={13} className={`${s.tagCatCaret} ${open ? s.tagCatCaretOpen : ''}`} />
                    <span className={s.tagCatName}>{prettyCat(grp.category)}</span>
                    {sel > 0 && <span className={s.tagCatSel}>{sel}</span>}
                    <span className={s.tagCatTotal}>{grp.tags.length}</span>
                  </button>
                  {open && (
                    <div className={s.tagChips}>
                      {grp.tags.map((t) => (
                        <TagChip key={t.name} tag={t} on={tags.has(t.name)} onToggle={toggleTag} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/** The always-visible ledger of what's applied, so the filter is legible even with
 *  the finder folded away. Every pill removes its own filter; "clear" resets both. */
function ActiveFilters({ genres, tags, toggleGenre, toggleTag, clearAll }) {
  return (
    <div className={s.activeBar}>
      <span className={s.activeLead}>Filtering by</span>
      {[...genres].sort().map((g) => (
        <button key={g} type="button" className={s.activePillG} onClick={() => toggleGenre(g)}>
          {g}<X size={11} />
        </button>
      ))}
      {[...tags].sort().map((t) => (
        <button key={t} type="button" className={s.activePillT} onClick={() => toggleTag(t)}>
          <Tag size={9} />{t}<X size={11} />
        </button>
      ))}
      <button className={s.activeClear} onClick={clearAll}>clear all</button>
    </div>
  );
}

/** Accumulating paginated fetch for the Browse wall. `signature` fingerprints the
 *  live query (mode + filters + sort + text); the moment it changes the list resets
 *  to page one. `buildUrl(page)` names the endpoint for a page — always read through
 *  a ref so a rebuilt closure never forces a refetch on its own. Every backend page
 *  carries `has_next`, so the scroll knows exactly where the archive ends. */
function useInfiniteMedia(signature, buildUrl) {
  const [items, setItems] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const pageRef = useRef(1);
  const busyRef = useRef(false);
  const epochRef = useRef(0); // bumped per fetch; a stale resolve (old query) is ignored
  const buildRef = useRef(buildUrl);
  buildRef.current = buildUrl;

  const fetchPage = useCallback(async (p, append) => {
    // A fresh load (append=false) always supersedes any in-flight page — bumping the
    // epoch makes the older request's result a no-op — so a query change mid-fetch
    // can never strand the shelf. Appends are the only thing the busy flag gates.
    const myEpoch = (epochRef.current += 1);
    busyRef.current = true;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const d = await api(buildRef.current(p));
      if (myEpoch !== epochRef.current) return; // a newer query took over
      const got = d.items || [];
      // Append de-dupes on id: a title can drift across a page boundary between
      // fetches (popularity shifts), and a doubled key would crash the render.
      setItems((prev) => {
        if (!append || !prev) return got;
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...got.filter((m) => !seen.has(m.id))];
      });
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
    setItems(null);
    setHasMore(false);
    pageRef.current = 1;
    fetchPage(1, false);
  }, [signature, fetchPage]);

  const loadMore = useCallback(() => {
    if (busyRef.current || !hasMore) return;
    fetchPage(pageRef.current + 1, true);
  }, [hasMore, fetchPage]);

  return { items, hasMore, loading, loadingMore, error, loadMore };
}

/** An off-screen tripwire below the wall: when it nears the viewport it asks for the
 *  next page. `count` re-arms it after every append (a still-visible sentinel won't
 *  re-fire on its own), so a tall screen keeps filling until the page is covered. */
function InfiniteSentinel({ onReach, active, count }) {
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

function BrowseTab() {
  const [urlQuery, setUrlQuery] = useParamState('q', '');
  const [rawKind, setKind] = useParamState('kind', 'trending');
  const kind = BROWSE_KINDS.some((k) => k.value === rawKind) ? rawKind : 'trending';
  const [genres, setGenres] = useParamState('g', EMPTY_SET, SET_PARAM);
  const [tags, setTags] = useParamState('t', EMPTY_SET, SET_PARAM);
  const [rawSort, setSort] = useParamState('sort', 'popular');
  const dsort = DISCOVER_SORTS.some((o) => o.value === rawSort) ? rawSort : 'popular';
  const [panelOpen, setPanelOpen] = useState(false);
  const filtering = genres.size > 0 || tags.size > 0;
  const toggleGenre = toggleInSet(setGenres);
  const toggleTag = toggleInSet(setTags);
  const clearAll = () => { setGenres(new Set()); setTags(new Set()); };

  // The input keeps its own state so a keystroke is never a history write (browsers
  // throttle those); only the settled query is published to the URL. Nothing is lost
  // by waiting — results don't render until the debounce lands, so there's no result
  // to click on an unpublished query.
  const [query, setQuery] = useState(urlQuery);
  const q = query.trim();
  const dq = useDebounced(q);
  const searching = dq.length > 0;

  // Deliberately keyed on the settled query alone: `setUrlQuery` is rebuilt whenever
  // the query string changes, so including it would re-run this on every URL change.
  // Skipping the no-op write also keeps mount from replacing the entry we came back to.
  useEffect(() => {
    if (dq !== urlQuery) setUrlQuery(dq);
  }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a genre or tag is in play the discover query owns the shelf (folding in the
  // text search too); otherwise it's plain text search, else the browse wall. Each
  // mode is one infinite list, paged in as you scroll.
  const mode = filtering ? 'discover' : searching ? 'search' : 'browse';
  const gcsv = encodeURIComponent([...genres].sort().join(','));
  const tcsv = encodeURIComponent([...tags].sort().join(','));
  // A fingerprint of everything that changes the result set — changing it resets the
  // scroll to page one; scrolling alone (which only bumps the page arg) does not.
  const sig = mode === 'discover'
    ? `d|${gcsv}|${tcsv}|${dsort}|${dq}`
    : mode === 'search'
      ? `s|${dq}`
      : `b|${kind}`;
  const buildUrl = useCallback(
    (p) => {
      if (mode === 'discover') {
        return `/anime/discover?genres=${gcsv}&tags=${tcsv}&sort=${dsort}&q=${encodeURIComponent(dq)}&page=${p}`;
      }
      if (mode === 'search') return `/anime/search?q=${encodeURIComponent(dq)}&page=${p}`;
      return `/anime/browse?kind=${kind}&page=${p}`;
    },
    [mode, gcsv, tcsv, dsort, dq, kind],
  );
  const feed = useInfiniteMedia(sig, buildUrl);
  const me = useApi('/anime/me'); // viewer score format (for "your rating"); 401 when not connected
  const scoreFormat = me.data?.score_format;
  // The finder vocabulary is only needed once the panel is open; hold it back till then.
  const coll = useApi('/anime/genres', panelOpen);

  const items = feed.items || [];
  const activeKind = BROWSE_KINDS.find((k) => k.value === kind) || BROWSE_KINDS[0];
  const activeSort = DISCOVER_SORTS.find((o) => o.value === dsort) || DISCOVER_SORTS[0];

  // The spotlight reel is a feature of the plain browse wall — a filtered or searched
  // result has no canonical "top 5" to romanticize, so it drops to a clean grid.
  const showSpotlight = mode === 'browse';
  const featured = showSpotlight ? items.slice(0, 5) : [];
  const wall = featured.length ? items.slice(featured.length) : items;

  // The editorial caption under the controls, phrased for whichever mode is live.
  let caption;
  if (filtering) {
    const bits = [];
    if (genres.size) bits.push([...genres].sort().join(' + '));
    if (tags.size) bits.push(`${tags.size} tag${tags.size === 1 ? '' : 's'}`);
    caption = `${bits.join(' + ')} · ${activeSort.caption}`;
  } else if (searching) {
    caption = `matches for “${dq}”`;
  } else {
    caption = activeKind.caption;
  }

  return (
    <>
      <SearchBar value={query} onChange={setQuery} placeholder="search AniList…" />

      <div className={s.finderBar}>
        <button
          type="button"
          className={`${s.filterToggle} ${panelOpen ? s.filterToggleOn : ''}`}
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
        >
          <SlidersHorizontal size={14} />
          Genres &amp; tags
          {filtering && <span className={s.filterBadge}>{genres.size + tags.size}</span>}
          <ChevronDown size={13} className={panelOpen ? s.flip : undefined} />
        </button>

        {filtering ? (
          <label className={s.sortWrap}>
            <span className={s.sortLabel}>Order</span>
            <div className={s.sortSelectWrap}>
              <select className={s.sortSelect} value={dsort} onChange={(e) => setSort(e.target.value)}>
                {DISCOVER_SORTS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <ChevronDown size={13} className={s.sortCaret} aria-hidden="true" />
            </div>
          </label>
        ) : !searching ? (
          <SegmentedControl
            options={BROWSE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
            value={kind}
            onChange={setKind}
          />
        ) : null}

        <span className={s.browseCaption}>
          {caption}
          {items.length ? <em className={s.browseCount}>{items.length} titles</em> : null}
        </span>
      </div>

      {panelOpen && (
        <AnimeFinder
          coll={coll}
          genres={genres}
          tags={tags}
          toggleGenre={toggleGenre}
          toggleTag={toggleTag}
          clearGenres={() => setGenres(new Set())}
          clearTags={() => setTags(new Set())}
        />
      )}

      {filtering && (
        <ActiveFilters
          genres={genres}
          tags={tags}
          toggleGenre={toggleGenre}
          toggleTag={toggleTag}
          clearAll={clearAll}
        />
      )}

      {feed.error && <ErrorBox message={feed.error} />}
      {feed.loading && items.length === 0 && (
        <Receiving
          label={filtering ? 'sifting the archive' : searching ? `searching for “${dq}”` : 'pulling the listings'}
        />
      )}
      {!feed.loading && !feed.error && items.length === 0 && (
        <p className={s.muted}>
          {filtering
            ? 'No anime match this combination — try loosening a tag.'
            : searching
              ? `No anime match “${dq}”.`
              : 'Nothing on air here yet.'}
        </p>
      )}

      {featured.length > 0 && (
        <SpotlightCarousel
          items={featured}
          kind={kind}
          ranked={activeKind.ranked}
          label={activeKind.label}
          scoreFormat={scoreFormat}
        />
      )}

      <div className={s.posterGrid}>
        {wall.map((m, i) => (
          <BrowseCard
            key={m.id}
            media={m}
            index={i}
            scoreFormat={scoreFormat}
            rank={showSpotlight && activeKind.ranked ? i + featured.length + 1 : null}
          />
        ))}
      </div>

      {/* Infinite scroll: the sentinel deals the next page; a quiet footer marks the
          end so the wall never just stops with no word. */}
      {items.length > 0 && (
        <>
          <InfiniteSentinel onReach={feed.loadMore} active={feed.hasMore && !feed.error} count={items.length} />
          {feed.loadingMore && (
            <div className={s.moreRow}>
              <span className={s.moreDot} /><span className={s.moreDot} /><span className={s.moreDot} />
              <span className={s.moreLabel}>dealing more titles</span>
            </div>
          )}
          {!feed.hasMore && !feed.loadingMore && (
            <p className={s.endNote}>· that’s every title in this shelf ·</p>
          )}
        </>
      )}
    </>
  );
}

const STATUS_LABEL = {
  CURRENT: 'Watching',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
  REPEATING: 'Rewatching',
};

// Status pills, in the order AniList presents them, each with its own glyph.
const STATUS_META = [
  ['CURRENT', 'Watching', Eye],
  ['PLANNING', 'Planning', Bookmark],
  ['COMPLETED', 'Completed', CheckCheck],
  ['PAUSED', 'Paused', Pause],
  ['DROPPED', 'Dropped', CircleSlash],
  ['REPEATING', 'Rewatching', Repeat],
];

// Sync-state glyph: edits land locally at once, so this is how you tell whether a
// change is still only on this machine (pending), being pushed (syncing), or
// failed. Absent when everything is in sync with AniList.
const SYNC_META = {
  pending: [CloudOff, 'Not yet synced'],
  syncing: [RefreshCw, 'Syncing to AniList…'],
  error: [AlertTriangle, 'Sync failed — kept locally'],
};

function SyncBadge({ status, label = true, className }) {
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

/** Worst-of sync status across every media with a pending/in-flight edit, for the
 *  room header — at a glance you know the whole room is settled or still flushing. */
function AnimeSyncStatus() {
  const { syncState } = useAnimeSync();
  const vals = Object.values(syncState || {});
  if (!vals.length) return null;
  const status = vals.includes('syncing')
    ? 'syncing'
    : vals.includes('pending')
      ? 'pending'
      : vals.includes('error')
        ? 'error'
        : null;
  if (!status) return null;
  const n = vals.filter((v) => v === status).length;
  return (
    <span className={s.syncSummary}>
      <SyncBadge status={status} />
      {n > 1 && <em className={s.syncCount}>{n}</em>}
    </span>
  );
}

/** An adaptive score control: stars for POINT_5, smileys for POINT_3, and a
 *  slider + numeric badge for the point scales. Commits via onSet(value). */
function ScoreField({ scoreFormat, value, disabled, onSet }) {
  const max = SCORE_MAX[scoreFormat] || 10;

  if (scoreFormat === 'POINT_5') {
    return (
      <div className={s.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={s.star}
            data-on={value >= n ? '' : undefined}
            disabled={disabled}
            onClick={() => onSet(value === n ? 0 : n)}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
          >
            <Star size={20} fill={value >= n ? 'currentColor' : 'none'} />
          </button>
        ))}
        {value > 0 && <button type="button" className={s.scoreClear} disabled={disabled} onClick={() => onSet(0)}>clear</button>}
      </div>
    );
  }

  if (scoreFormat === 'POINT_3') {
    const faces = [[1, Frown, 'Bad'], [2, Meh, 'Meh'], [3, Smile, 'Good']];
    return (
      <div className={s.stars}>
        {faces.map(([n, Icon, label]) => (
          <button
            key={n}
            type="button"
            className={s.face}
            data-on={value === n ? '' : undefined}
            disabled={disabled}
            onClick={() => onSet(value === n ? 0 : n)}
            aria-label={label}
          >
            <Icon size={22} />
          </button>
        ))}
        {value > 0 && <button type="button" className={s.scoreClear} disabled={disabled} onClick={() => onSet(0)}>clear</button>}
      </div>
    );
  }

  const step = SCORE_STEP[scoreFormat] || 1;
  return (
    <div className={s.scoreSlider}>
      <input
        type="range"
        min="0"
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        className={s.range}
        style={{ '--pct': `${(value / max) * 100}%` }}
        onChange={(e) => onSet(Number(e.target.value))}
      />
      <span className={s.scoreBadge} data-empty={value ? undefined : ''}>
        {value ? value : '—'}<small>/ {max}</small>
      </span>
    </div>
  );
}

/** Status / progress / score editor for a media's AniList list entry — the
 *  "Your list" panel: status pills, a progress meter, an adaptive score control,
 *  and a foldout for rewatches, dates and notes. */
function ListControls({ media, scoreFormat }) {
  const { overlay, syncState, queueListEdit, removeListEntry } = useAnimeSync();
  const [more, setMore] = useState(false);
  const entry = applyOverlay(media.id, media.list_entry, overlay);
  const status = syncState[media.id];
  const prog = entry?.progress || 0;
  const total = media.episodes;
  const pct = total ? Math.min(100, Math.round((prog / total) * 100)) : 0;
  const repeat = entry?.repeat || 0;

  // Edits apply locally at once and flush to AniList on a debounce (see state.jsx),
  // so the controls stay responsive and never block on the network.
  const save = (patch) => queueListEdit(media, patch);
  const remove = () => removeListEntry(media, entry?.id);
  // Mark the whole run watched and complete it in one tap.
  const finish = () => save({ status: 'COMPLETED', ...(total ? { progress: total } : {}) });

  return (
    <div className={s.listPanel} data-active={entry ? '' : undefined}>
      {/* status as pills — tapping one adds the title or moves it between lists */}
      <div className={s.statusPills}>
        {STATUS_META.map(([v, label, Icon]) => (
          <button
            key={v}
            type="button"
            className={s.statusPill}
            data-on={entry?.status === v ? '' : undefined}
            onClick={() => save({ status: v })}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
        <SyncBadge status={status} className={s.listSync} />
      </div>

      {!entry && (
        <p className={s.listHint}>Pick a shelf above to add this to your AniList.</p>
      )}

      {entry && (
        <>
          <div className={s.listFields}>
            {/* progress: a meter you can scrub with the stepper, plus a finish shortcut */}
            <div className={s.listField}>
              <div className={s.listFieldHead}>
                <span className={s.listLabel}>Progress</span>
                <span className={s.progCount}>
                  {prog}{total ? ` / ${total}` : ''} {total ? 'episodes' : 'ep'}
                </span>
              </div>
              <div className={s.progRow}>
                <button className={s.stepBtn} disabled={prog <= 0} onClick={() => save({ progress: prog - 1 })} aria-label="One fewer">
                  <Minus size={14} />
                </button>
                <div className={s.progTrack} title={total ? `${pct}% watched` : undefined}>
                  <span className={s.progFill} style={{ width: `${total ? pct : prog > 0 ? 100 : 0}%` }} />
                </div>
                <button className={s.stepBtn} disabled={total && prog >= total} onClick={() => save({ progress: prog + 1 })} aria-label="One more">
                  <Plus size={14} />
                </button>
              </div>
              {total > 0 && prog < total && entry.status !== 'COMPLETED' && (
                <button className={s.finishBtn} onClick={finish}>
                  <Flag size={12} /> Finish — mark all {total} watched
                </button>
              )}
            </div>

            {/* score: adaptive to the viewer's chosen format */}
            <div className={s.listField}>
              <div className={s.listFieldHead}>
                <span className={s.listLabel}>Your score</span>
              </div>
              <ScoreField
                scoreFormat={scoreFormat}
                value={entry.score || 0}
                onSet={(v) => { if (v !== (entry.score || 0)) save({ score: v }); }}
              />
            </div>
          </div>

          <button className={s.moreToggle} onClick={() => setMore((v) => !v)} data-open={more ? '' : undefined}>
            <ChevronDown size={14} /> {more ? 'Fewer details' : 'More details'}
          </button>

          {more && (
            <div className={s.listExtra}>
              <div className={s.listField}>
                <div className={s.listFieldHead}>
                  <span className={s.listLabel}>Rewatches</span>
                </div>
                <div className={s.stepper}>
                  <button className={s.stepBtn} disabled={repeat <= 0} onClick={() => save({ repeat: repeat - 1 })} aria-label="One fewer rewatch">
                    <Minus size={14} />
                  </button>
                  <span className={s.stepperVal}><Repeat size={12} /> {repeat}×</span>
                  <button className={s.stepBtn} onClick={() => save({ repeat: repeat + 1 })} aria-label="One more rewatch">
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              <label className={s.dateField}>
                <span className={s.listLabel}><Calendar size={12} /> Started</span>
                <input
                  type="date"
                  className={s.dateInput}
                  defaultValue={entry.started_at || ''}
                  onChange={(e) => save({ started_at: e.target.value })}
                />
              </label>
              <label className={s.dateField}>
                <span className={s.listLabel}><Calendar size={12} /> Finished</span>
                <input
                  type="date"
                  className={s.dateInput}
                  defaultValue={entry.completed_at || ''}
                  onChange={(e) => save({ completed_at: e.target.value })}
                />
              </label>

              <label className={s.notesField}>
                <span className={s.listLabel}>Notes</span>
                <textarea
                  className={s.notesInput}
                  rows={2}
                  placeholder="A private note for this title…"
                  defaultValue={entry.notes || ''}
                  onBlur={(e) => { if (e.target.value !== (entry.notes || '')) save({ notes: e.target.value }); }}
                />
              </label>
            </div>
          )}

          <button className={s.removeLink} onClick={remove}>
            <Trash2 size={12} /> Remove from list
          </button>
        </>
      )}
    </div>
  );
}

function ListEntryCard({ entry, scoreFormat, showSeen = false }) {
  const { overlay, syncState, queueListEdit } = useAnimeSync();
  const m = entry.media;
  const eff = applyOverlay(m.id, entry, overlay);
  if (!eff) return null; // removed locally from elsewhere
  const status = syncState[m.id];
  const total = m.episodes;
  const prog = eff.progress || 0;
  // Episodes available so far: for an airing show, the episode before the next to
  // air; otherwise the full run. "Behind" = aired-so-far minus what you've watched.
  const aired = m.next_episode ? m.next_episode - 1 : (total || 0);
  const behind = Math.max(0, aired - prog);
  const behindTag = behind > 0 ? `${behind} ep${behind > 1 ? 's' : ''} behind` : null;
  const bump = (e) => {
    e.preventDefault();
    e.stopPropagation();
    queueListEdit(m, { progress: prog + 1 });
  };
  return (
    <div className={s.listEntry}>
      {/* feed the optimistic entry through so the card's "your rating" stays live */}
      <AnimeCard media={{ ...m, list_entry: eff }} corner={behindTag} scoreFormat={scoreFormat} />
      <div className={s.quickRow}>
        <span className={s.quickProg}>{prog}{total ? ` / ${total}` : ''}</span>
        {/* The stamp the activity filter reads, so a match explains itself on the card. */}
        {showSeen && entry.updated_at && (
          <span className={s.quickSeen} title={`Last activity ${formatWhen(entry.updated_at)}`}>
            {timeAgo(entry.updated_at)}
          </span>
        )}
        {status && <SyncBadge status={status} label={false} className={s.quickSync} />}
        {(!total || prog < total) && (
          <button className={s.quickBtn} onClick={bump} title="Mark next episode watched">
            <Plus size={12} /> ep
          </button>
        )}
      </div>
    </div>
  );
}

// AniList's natural shelf order; custom lists (no standard status) sort last.
const STATUS_ORDER = ['CURRENT', 'REPEATING', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED'];
const groupKey = (g) => g.status || g.name;

// ── Last-activity filter ──────────────────────────────────────────────────────
// The watched shelves get a "when did I last touch this" filter. The stamp is
// AniList's own entry `updatedAt`: progress bumps (including Tubcal's auto-mark at
// 90%), score edits and status changes all write it. It is the closest thing
// AniList exposes to "when did I last watch this" — not an exact viewing time —
// so the UI calls it activity rather than claiming more than it knows.
const DAY = 86400;
// Cumulative windows ("touched within the last …"), plus a tail bucket for the
// opposite question: what have I not touched in over a year?
// Rolling windows, so the labels say "past N" — "this week" would imply a calendar
// week and quietly lie at both ends of it.
const ACTIVITY_WINDOWS = [
  ['1d', 'Past 24h', DAY],
  ['7d', 'Past week', 7 * DAY],
  ['30d', 'Past month', 30 * DAY],
  ['3m', 'Past 3 months', 90 * DAY],
  ['1y', 'Past year', 365 * DAY],
  ['older', 'Over a year', null], // the tail: nothing since
];
const ACTIVITY_SHELVES = new Set(['CURRENT', 'REPEATING', 'COMPLETED', 'PAUSED', 'DROPPED']);
const isCustomRange = (v) => typeof v === 'string' && v.includes('..');

/** A predicate over an entry's `updated_at` for the selected window, or null when
 *  nothing should be filtered out. `now` is injectable so the buckets are testable. */
function activityMatcher(seen, now = Date.now() / 1000) {
  if (!seen || seen === 'any') return null;
  if (isCustomRange(seen)) {
    const [a, b] = seen.split('..');
    // Inclusive of both endpoints' full local days; a half-open range is allowed.
    const from = a ? Date.parse(`${a}T00:00:00`) / 1000 : -Infinity;
    const to = b ? Date.parse(`${b}T23:59:59`) / 1000 : Infinity;
    if (Number.isNaN(from) || Number.isNaN(to)) return null; // half-typed date
    return (t) => t != null && t >= from && t <= to;
  }
  const w = ACTIVITY_WINDOWS.find(([k]) => k === seen);
  if (!w) return null;
  const cutoff = now - (w[2] ?? 365 * DAY);
  return w[0] === 'older' ? (t) => t != null && t < cutoff : (t) => t != null && t >= cutoff;
}

/** The activity panel: one window at a time (they nest, so multi-select would only
 *  confuse), each chip carrying its own count so the shelf's shape is visible
 *  before you commit to a filter. Empty windows disable themselves. */
function ActivityFilter({ entries, seen, setSeen }) {
  const [custom, setCustom] = useState(() => isCustomRange(seen));
  const [from, to] = isCustomRange(seen) ? seen.split('..') : ['', ''];
  const counts = {};
  for (const [key] of ACTIVITY_WINDOWS) {
    const m = activityMatcher(key);
    counts[key] = entries.filter((e) => m(e.updated_at)).length;
  }
  // Entries AniList gave no stamp for can't answer the question either way; they
  // drop out of every window, so say so rather than letting them vanish silently.
  const untracked = entries.filter((e) => e.updated_at == null).length;
  const filtering = seen !== 'any';
  const pick = (key) => { setCustom(false); setSeen(key); };
  const setRange = (a, b) => setSeen(a || b ? `${a}..${b}` : 'any');
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className={s.seenRow}>
      <div className={s.seenChips}>
        <span
          className={s.seenLabel}
          title="AniList's last-updated stamp — progress bumps, score edits and status changes all touch it."
        >
          <History size={11} /> Last activity
        </span>
        <button
          className={`${s.seenChip} ${seen === 'any' && !custom ? s.seenChipOn : ''}`}
          onClick={() => pick('any')}
          aria-pressed={seen === 'any' && !custom}
        >
          Any time
          <span className={s.seenCount}>{entries.length}</span>
        </button>
        {ACTIVITY_WINDOWS.map(([key, label]) => {
          const n = counts[key];
          const on = seen === key;
          return (
            <button
              key={key}
              className={`${s.seenChip} ${on ? s.seenChipOn : ''}`}
              disabled={!n && !on}
              onClick={() => pick(key)}
              aria-pressed={on}
            >
              {label}
              <span className={s.seenCount}>{n}</span>
            </button>
          );
        })}
        <button
          className={`${s.seenChip} ${custom ? s.seenChipOn : ''}`}
          onClick={() => setCustom((c) => !c)}
          aria-pressed={custom}
        >
          <Calendar size={11} /> Custom
        </button>
      </div>

      {custom && (
        <div className={s.seenCustom}>
          <label className={s.seenDate}>
            <span>from</span>
            <input type="date" max={to || today} value={from} onChange={(e) => setRange(e.target.value, to)} />
          </label>
          <label className={s.seenDate}>
            <span>to</span>
            <input type="date" min={from || undefined} max={today} value={to} onChange={(e) => setRange(from, e.target.value)} />
          </label>
          {isCustomRange(seen) && (
            <button className={s.releaseClear} onClick={() => setSeen('any')}>clear</button>
          )}
          {!isCustomRange(seen) && <span className={s.seenHint}>pick a date to filter</span>}
        </div>
      )}

      {filtering && untracked > 0 && (
        <span className={s.seenHint}>
          {untracked} {untracked === 1 ? 'title has' : 'titles have'} no activity stamp and stay hidden while filtering.
        </span>
      )}
    </div>
  );
}

// Release-status buckets for the Planning shelf's extra filters. "Announced" is an
// unaired title with a known date; "TBA" is unaired with no date scheduled yet.
const RELEASE_FILTERS = [
  ['released', 'Fully released'],
  ['airing', 'Airing'],
  ['announced', 'Announced'],
  ['tba', 'TBA'],
];
function releaseClass(m) {
  switch (m.status) {
    case 'FINISHED': return 'released';
    case 'RELEASING': return 'airing';
    case 'NOT_YET_RELEASED': return (m.next_airing_at || m.start_year) ? 'announced' : 'tba';
    default: return null; // CANCELLED / HIATUS — unbucketed
  }
}

function MyListTab() {
  const lists = useApi('/anime/lists');
  const [filter, setFilter] = useParamState('shelf', 'all');
  const [release, setRelease] = useParamState('release', EMPTY_SET, SET_PARAM); // empty = no release filter
  const [seen, setSeen] = useParamState('seen', 'any');
  const scoreFormat = lists.data?.viewer?.score_format;
  const toggleRelease = (key) =>
    setRelease((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  if (lists.loading && !lists.data) return <Receiving label="opening your shelves" />;
  if (lists.error) {
    return (
      <EmptyState
        icon={<Clapperboard size={32} />}
        color="var(--c-anime)"
        title="Connect AniList to see your lists"
        subtitle="Add your AniList app credentials in Settings → Connections, then connect. Your watching, planning and completed shelves show up here."
        action={
          <Button onClick={() => (window.location.href = '/settings')}>Open Settings</Button>
        }
      />
    );
  }
  const groups = (lists.data?.lists || [])
    .filter((g) => g.entries.length > 0)
    .sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a.status), bi = STATUS_ORDER.indexOf(b.status);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  if (groups.length === 0) return <p className={s.muted}>Your AniList anime list is empty.</p>;

  const shown = filter === 'all' ? groups : groups.filter((g) => groupKey(g) === filter);

  // The Planning shelf gets an extra release-status filter; tally each bucket so the
  // checkboxes can show counts and disable empties.
  const planning = groups.find((g) => groupKey(g) === 'PLANNING');
  const planningCounts = {};
  for (const e of planning?.entries || []) {
    const c = releaseClass(e.media);
    if (c) planningCounts[c] = (planningCounts[c] || 0) + 1;
  }
  // The watched shelves get the last-activity filter; it only applies while one of
  // them is the selected shelf, so "All" stays an unfiltered overview.
  const activityShelf = ACTIVITY_SHELVES.has(filter) ? groups.find((g) => groupKey(g) === filter) : null;
  const matchSeen = activityShelf ? activityMatcher(seen) : null;

  // Filter a group's entries by whichever extra filter its shelf offers.
  const entriesOf = (g) => {
    if (groupKey(g) === 'PLANNING' && release.size > 0) {
      return g.entries.filter((e) => release.has(releaseClass(e.media)));
    }
    if (matchSeen && ACTIVITY_SHELVES.has(groupKey(g))) {
      return g.entries.filter((e) => matchSeen(e.updated_at));
    }
    return g.entries;
  };

  return (
    <>
      <div className={s.filterRow}>
        <button
          className={`${s.filterPill} ${filter === 'all' ? s.filterPillOn : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        {groups.map((g) => {
          const key = groupKey(g);
          return (
            <button
              key={key}
              className={`${s.filterPill} ${filter === key ? s.filterPillOn : ''}`}
              onClick={() => setFilter(key)}
            >
              {STATUS_LABEL[g.status] || g.name}
              <span className={s.filterCount}>{g.entries.length}</span>
            </button>
          );
        })}
      </div>

      {filter === 'PLANNING' && planning && (
        <div className={s.releaseRow}>
          <span className={s.releaseLabel}>Release status</span>
          {RELEASE_FILTERS.map(([key, label]) => {
            const n = planningCounts[key] || 0;
            const on = release.has(key);
            return (
              <button
                key={key}
                className={`${s.releaseChip} ${on ? s.releaseChipOn : ''}`}
                disabled={!n && !on}
                onClick={() => toggleRelease(key)}
                aria-pressed={on}
              >
                <span className={s.releaseBox}>{on && <Check size={11} />}</span>
                {label}
                <span className={s.releaseCount}>{n}</span>
              </button>
            );
          })}
          {release.size > 0 && (
            <button className={s.releaseClear} onClick={() => setRelease(new Set())}>clear</button>
          )}
        </div>
      )}

      {activityShelf && (
        <ActivityFilter entries={activityShelf.entries} seen={seen} setSeen={setSeen} />
      )}

      <div className={s.lists}>
        {shown.map((g) => {
          const entries = entriesOf(g);
          const withSeen = ACTIVITY_SHELVES.has(groupKey(g));
          const held = entries.length < g.entries.length; // some filter is narrowing this shelf
          return (
            <section key={groupKey(g)} className={s.listGroup}>
              <h3 className={s.listHead}>
                {STATUS_LABEL[g.status] || g.name}
                <span className={s.listCount}>
                  {entries.length}
                  {held && <span className={s.listOf}> of {g.entries.length}</span>}
                </span>
              </h3>
              {entries.length === 0 ? (
                <p className={s.muted}>
                  {withSeen && matchSeen
                    ? 'Nothing on this shelf was touched in that window.'
                    : 'No titles match those release filters.'}
                </p>
              ) : (
                <div className={s.grid}>
                  {entries.map((e) => (
                    <ListEntryCard key={e.entry_id} entry={e} scoreFormat={scoreFormat} showSeen={withSeen} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function TrailerChannel() {
  const ch = useApi('/anime/channel');
  const { open, enqueue } = usePlayer();
  const { queueListEdit } = useAnimeSync();
  const toast = useToast();

  if (ch.loading && !ch.data) return <Receiving label="tuning the anime channel" />;
  if (ch.error) {
    return (
      <EmptyState
        icon={<Clapperboard size={32} />}
        color="var(--c-anime)"
        title="Connect AniList to tune the channel"
        subtitle="The Anime Channel reels through trailers for shows related to what you've watched. Connect AniList in Settings to build it from your list."
        action={<Button onClick={() => (window.location.href = '/settings')}>Open Settings</Button>}
      />
    );
  }
  const reel = (ch.data?.items || []).map((m) => ({ m, item: trailerItem(m) })).filter((x) => x.item);
  if (!reel.length) {
    return <p className={s.muted}>No related trailers yet — watch and rate a few anime, then check back.</p>;
  }

  // Lean-back: play one trailer and queue the rest; the player auto-advances on end.
  const playFrom = (i) => {
    open(reel[i].item);
    reel.slice(i + 1).forEach((t) => enqueue(t.item));
  };
  const plan = (e, m) => {
    e.preventDefault();
    e.stopPropagation();
    queueListEdit(m, { status: 'PLANNING' });
    toast(`Added “${m.title}” to Planning`, 'success');
  };

  return (
    <>
      <div className={s.channelHead}>
        <Button onClick={() => playFrom(0)}>
          <Play size={15} fill="currentColor" /> Play the channel
        </Button>
        <span className={s.muted} style={{ padding: 0 }}>
          {reel.length} trailers · related to what you've watched
        </span>
      </div>
      <div className={s.guide}>
        {reel.map((t, i) => (
          <div key={t.m.id} className={s.guideRow}>
            <button className={s.guideThumb} onClick={() => playFrom(i)} title="Play from here">
              <img src={t.m.trailer.thumbnail || t.m.cover} alt="" loading="lazy" />
              <span className={s.guidePlay}><Play size={18} fill="currentColor" /></span>
            </button>
            <div className={s.guideMeta}>
              <Link to={`/anime/${t.m.id}`} className={s.guideTitle}>{t.m.title}</Link>
              <span className={s.guideSub}>{metaLine(t.m)}</span>
              <button className={s.planBtn} onClick={(e) => plan(e, t.m)}>
                <Plus size={11} /> Planning
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function DiscussionsTab() {
  const [mode, setMode] = useState('forum');
  return (
    <>
      <div className={s.browseBar}>
        <SegmentedControl
          options={[{ value: 'forum', label: 'Forum' }, { value: 'activity', label: 'Activity' }]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {mode === 'forum' ? <ForumList /> : <ActivityFeed />}
    </>
  );
}

const TABS = [
  { id: 'browse', label: 'Browse & Search' },
  { id: 'list', label: 'My List' },
  { id: 'channel', label: 'The Anime Channel' },
  { id: 'discuss', label: 'Discussions' },
];

// A compact chip in the section header showing the connected AniList account; opens
// the profile studio to edit your own settings.
function ActiveProfileButton() {
  const me = useApi('/anime/me');
  const [studio, setStudio] = useState(false);
  const [viewing, setViewing] = useState(null);
  const u = me.data;
  if (!u) return null;
  return (
    <>
      <button type="button" className={s.activeProfile} onClick={() => setStudio(true)}>
        <Avatar src={u.avatar?.large || u.avatar} name={u.name} imgClass={s.apAvatar} letterClass={s.apAvatarFallback} />
        <span className={s.apMeta}>
          <span className={s.apKicker}>Active profile</span>
          <span className={s.apName}>{u.name}</span>
        </span>
      </button>
      {studio && (
        <ProfileStudio
          onClose={() => setStudio(false)}
          onView={(name) => { setStudio(false); setViewing(name); }}
        />
      )}
      {viewing && <ProfileModal name={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

export default function Anime() {
  const [rawTab, setTab] = useParamState('tab', 'browse');
  // A hand-edited or stale ?tab= shouldn't render a blank room.
  const tab = TABS.some((t) => t.id === rawTab) ? rawTab : 'browse';
  return (
    <>
      <SectionHead
        kicker="No 06 — The Anime"
        title="The picture scroll"
        note="Browse and search AniList, keep your list in sync, and watch — all on this machine."
        color="var(--c-anime)"
      >
        <AnimeSyncStatus />
        <ActiveProfileButton />
      </SectionHead>
      <div className={s.tabs} style={ACCENT}>
        <SegmentedControl
          options={TABS.map((t) => ({ value: t.id, label: t.label }))}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'browse' && <BrowseTab />}
      {tab === 'list' && <MyListTab />}
      {tab === 'channel' && <TrailerChannel />}
      {tab === 'discuss' && <DiscussionsTab />}
    </>
  );
}

// ── Detail page ────────────────────────────────────────────────────────────────

function RelStrip({ title, items, scoreFormat }) {
  const ref = useHorizontalWheel();
  if (!items.length) return null;
  return (
    <div className={s.relBlock}>
      <h3 className={s.blockLabel}>{title}</h3>
      <div className={s.relRow} ref={ref}>
        {items.map((m, i) => (
          <div key={m.id} className={s.relItem} style={{ '--i': Math.min(i, 10) }}>
            <AnimeCard media={m} scoreFormat={scoreFormat} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RecStrip({ title, sourceId, recs, canPost, scoreFormat }) {
  const ref = useHorizontalWheel();
  const toast = useToast();
  const items = recs.filter((r) => r.media);
  if (!items.length) return null;
  const endorse = async (recId) => {
    try {
      await api('/anime/recommend', {
        method: 'POST',
        body: JSON.stringify({ media_id: sourceId, recommend_id: recId }),
      });
      toast('Recommendation sent to AniList', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <div className={s.relBlock}>
      <h3 className={s.blockLabel}>{title}</h3>
      <div className={s.relRow} ref={ref}>
        {items.map((r, i) => (
          <div key={r.media.id} className={s.relItem} style={{ '--i': Math.min(i, 10) }}>
            <AnimeCard media={r.media} scoreFormat={scoreFormat} />
            {canPost && (
              <button className={s.endorseBtn} onClick={() => endorse(r.media.id)} title="Agree with this recommendation">
                <ThumbsUp size={12} /> agree
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** AniList's streaming URLs are often insecure (http) or missing a scheme, which
 *  makes window.open treat them as relative. Force https and add a scheme when
 *  missing — but keep the full path/slug (the id alone can 404; the original
 *  full URL is the form that resolves). */
function normalizeOfficialUrl(url) {
  if (!url) return url;
  let u = url.trim();
  if (u.startsWith('//')) u = `https:${u}`;
  else if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
  return u.replace(/^http:\/\//i, 'https://');
}

/** Open an official source in a centered popup window — closest thing to an
 *  embed for a site that forbids framing + uses DRM. Falls back to a tab when
 *  the popup is blocked. */
function launchOfficial(url) {
  const target = normalizeOfficialUrl(url);
  if (!target) return;
  const w = 1100;
  const h = 720;
  const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - w) / 2));
  const top = Math.round(window.screenY + Math.max(0, (window.outerHeight - h) / 2));
  const win = window.open(target, 'tubcal-watch', `width=${w},height=${h},left=${left},top=${top}`);
  if (!win) window.open(target, '_blank', 'noopener,noreferrer');
}

/** Strip AniList's "Episode N - " / "Episode N: " prefix to the real subtitle. */
function epSubtitle(title, number) {
  if (!title) return null;
  const cleaned = title.replace(/^\s*episode\s+\d+\s*[-:–—]?\s*/i, '').trim();
  return cleaned && cleaned !== String(number) ? cleaned : null;
}

function EpisodeList({ media }) {
  // The aggregator is optional now — it only enables local playback when up.
  const eps = useApi(`/anime/episodes/${media.id}`);
  const { open } = usePlayer();
  const { progress } = useProgress();
  const { overlay, queueListEdit } = useAnimeSync();
  const entry = applyOverlay(media.id, media.list_entry, overlay);

  // Playback state per episode, keyed exactly like the player reports it, so the
  // per-episode progress bars match the Screening Room tiles' resume indicator.
  const progKey = (n) => `anime:${media.id}:${n}`;
  const progOf = (n) => progress[progKey(n)];
  const ratioOf = (n) => {
    const p = progOf(n);
    return p && p.duration ? Math.min(1, p.position / p.duration) : 0;
  };

  // Build the episode list from AniList, then fold in aggregator keys (by number)
  // so a local stream can play when the source is reachable.
  const merged = {};
  for (const se of media.streaming || []) {
    if (se.number == null) continue;
    const e = (merged[se.number] ||= { number: se.number });
    if (!e.image) e.image = se.thumbnail;
    if (!e.url) { e.url = se.url; e.site = se.site; }
    if (!e.title) e.title = epSubtitle(se.title, se.number);
  }
  for (const ep of eps.data?.episodes || []) {
    if (ep.number == null) continue;
    const e = (merged[ep.number] ||= { number: ep.number });
    if (!e.key) e.key = ep.key;
    if (!e.image) e.image = ep.image;
    if (!e.title) e.title = epSubtitle(ep.title, ep.number);
  }

  // How many episodes have actually aired: for a finished show that's the total;
  // for an airing one it's the episode before the next to air. Fill any gaps so
  // released episodes still appear when streamingEpisodes lags / the source is down.
  let aired = Object.keys(merged).length ? Math.max(...Object.keys(merged).map(Number)) : 0;
  if (media.next_episode) aired = Math.max(aired, media.next_episode - 1);
  else if (media.episodes && media.status !== 'NOT_YET_RELEASED') aired = Math.max(aired, media.episodes);
  for (let n = 1; n <= aired; n++) merged[n] ||= { number: n };

  const list = Object.values(merged).sort((a, b) => a.number - b.number);
  const links = media.external_links || [];
  const seriesLink = links[0]?.url || null;

  const playLocal = (e) =>
    open({
      id: `anime:${media.id}:${e.number}`,
      platform: 'anime',
      title: `${media.title} — Episode ${e.number}`,
      thumbnail: e.image || media.cover,
      url: `https://anilist.co/anime/${media.id}`,
      source: media.title,
      published_at: 0,
      extra: { stream_key: e.key, anilist_id: media.id, episode: e.number },
    });

  // Continue watching: resume the last episode you left unfinished, or — if it's
  // done — start the next one. Sequential-watch assumption (highest touched ep).
  // Playable only for local episodes; the player auto-resumes from saved progress.
  let cont = null; // { ep, mode: 'resume' | 'next', pos }
  const touched = list.filter((e) => e.key && ratioOf(e.number) > 0);
  if (touched.length) {
    const lastN = Math.max(...touched.map((e) => e.number));
    if (ratioOf(lastN) < COMPLETE_RATIO) {
      cont = { ep: list.find((e) => e.number === lastN), mode: 'resume', pos: progOf(lastN).position };
    } else {
      const next = list.find((e) => e.number > lastN && e.key);
      if (next) cont = { ep: next, mode: 'next' };
    }
  }

  // Launch official source; optionally advance AniList progress on launch.
  const launch = (url, epNumber) => {
    launchOfficial(url);
    if (epNumber != null && entry && epNumber > (entry.progress || 0)) {
      queueListEdit(media, { progress: epNumber });
    }
  };

  return (
    <div className={s.relBlock}>
      <h3 className={s.blockLabel}>Episodes</h3>

      {cont && (
        <button className={s.continueBtn} onClick={() => playLocal(cont.ep)}>
          <PlayCircle size={16} />
          <span className={s.continueLabel}>
            {cont.mode === 'resume' ? 'Continue watching' : 'Up next'}
          </span>
          <span className={s.continueEp}>
            Episode {cont.ep.number}
            {cont.mode === 'resume' && cont.pos ? ` · ${clock(cont.pos)}` : ''}
          </span>
        </button>
      )}

      {links.length > 0 && (
        <div className={s.deepLinks}>
          <span className={s.deepLinkLabel}>Watch official:</span>
          {links.map((l, i) => (
            <button
              key={l.url}
              style={{ '--i': Math.min(i, 9) }}
              className={s.deepLink}
              style={l.color ? { '--ext-c': l.color } : undefined}
              onClick={() => launch(l.url, null)}
            >
              {l.icon && <img src={l.icon} alt="" />}
              {l.site}
              <ExternalLink size={12} />
            </button>
          ))}
        </div>
      )}

      {!list.length && eps.loading && <Receiving label="finding episodes" />}
      {!list.length && !eps.loading && (
        <p className={s.muted}>No episode listing available for this title yet.</p>
      )}

      {list.length > 0 && (
        <div className={s.episodes}>
          {list.map((e, i) => {
            const local = !!e.key;
            const officialUrl = e.url || seriesLink; // per-episode link, else the series page
            const primary = local
              ? () => playLocal(e)
              : () => officialUrl && launch(officialUrl, e.number);
            return (
              // Only the opening screenful is dealt in. Capping --i alone isn't
              // enough: the animation would still be *created* for all ~1,170 of
              // One Piece's episodes, and every one past the cap would fire on the
              // same frame — a thousand elements animating at once, to be watched
              // by nobody, since they're far below the fold. Past EP_ANIM_MAX the
              // cards simply start visible.
              <div
                key={e.number}
                className={`${s.episode} ${i < EP_ANIM_MAX ? s.episodeIn : ''}`}
                style={i < EP_ANIM_MAX ? { '--i': i } : undefined}
              >
                <button className={s.epMain} onClick={primary} disabled={!local && !officialUrl}>
                  <div className={s.epThumb}>
                    {e.image || media.cover ? (
                      <img src={e.image || media.cover} alt="" loading="lazy" />
                    ) : (
                      <Tv size={18} />
                    )}
                    <span className={s.epPlay}>
                      {local ? <Play size={15} fill="currentColor" /> : <ExternalLink size={15} />}
                    </span>
                    {(() => {
                      const r = ratioOf(e.number);
                      if (r <= 0) return null;
                      const p = progOf(e.number);
                      const done = r >= COMPLETE_RATIO;
                      return (
                        <>
                          {p?.duration ? (
                            <span className={s.epTime}>
                              {done ? clock(p.duration) : `${clock(p.position)} / ${clock(p.duration)}`}
                            </span>
                          ) : null}
                          <div
                            className={s.epProgress}
                            title={done ? 'Watched' : `${Math.round(r * 100)}% watched`}
                          >
                            <div
                              className={`${s.epProgressFill} ${done ? s.epProgressDone : ''}`}
                              style={{ width: `${done ? 100 : Math.max(4, r * 100)}%` }}
                            />
                          </div>
                        </>
                      );
                    })()}
                  </div>
                  <div className={s.epMeta}>
                    <span className={s.epNum}>Episode {e.number}</span>
                    {e.title && <span className={s.epTitle}>{e.title}</span>}
                  </div>
                </button>
                {/* When local play is primary, the official launch is the secondary action. */}
                {local && officialUrl && (
                  <button
                    className={s.epExt}
                    title={`Watch episode ${e.number} on ${e.site || 'official source'}`}
                    onClick={() => launch(officialUrl, e.number)}
                  >
                    <ExternalLink size={13} />
                    {e.site || 'Official'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Heart toggle that adds/removes the title from your AniList favourites. */
function FavouriteButton({ mediaId, initial }) {
  const toast = useToast();
  const [fav, setFav] = useState(!!initial);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    const prev = fav;
    setFav(!prev); // optimistic
    try {
      const res = await api('/anime/favourite', {
        method: 'POST',
        body: JSON.stringify({ media_id: mediaId }),
      });
      setFav(res.is_favourite);
      toast(res.is_favourite ? 'Added to favorites' : 'Removed from favorites', 'success');
    } catch (e) {
      setFav(prev); // revert
      toast(e.message, 'error');
    }
    setBusy(false);
  };

  return (
    <button
      className={s.favBtn}
      data-on={fav ? '' : undefined}
      disabled={busy}
      onClick={toggle}
      aria-pressed={fav}
    >
      <Heart size={15} fill={fav ? 'currentColor' : 'none'} />
      {fav ? 'Favorited' : 'Add to favorites'}
    </button>
  );
}

/** The detail dossier's live "next episode" banner: a labeled countdown plus the
 *  exact local air date. Renders nothing when there's no scheduled episode ahead. */
function NextEpisodeBanner({ next }) {
  const atMs = next?.airing_at ? next.airing_at * 1000 : 0;
  useCountdownTick(atMs);
  if (!atMs) return null;
  const ms = atMs - Date.now();
  if (ms <= 0) return null;
  return (
    <div className={s.airStrip}>
      <span className={s.airStripPulse} aria-hidden="true" />
      <span className={s.airStripLabel}>Episode {next.episode} airs in</span>
      <span className={s.airStripTime}>{fmtCountdown(ms)}</span>
      <span className={s.airStripDate}>{airingDateLabel(next.airing_at)}</span>
    </div>
  );
}

// ── Dramatis Personae ─────────────────────────────────────────────────────────
// The cast as a theatre programme: character on the left, voice on the right, a
// leader of dots carrying your eye across. Everything else on this page is poster
// art, so this block earns its keep by being type instead of pictures.

// How many episode cards get dealt in. Roughly the first screenful; the rest of a
// long-runner's list is below the fold and starts drawn.
const EP_ANIM_MAX = 18;

const ROLE_LABEL = { MAIN: 'Main', SUPPORTING: 'Supporting', BACKGROUND: 'Background' };
const CAST_PREVIEW = 8; // a programme's worth before "show all"
// Japanese tops out at ~3 credits for one character, but the English and French
// dubs of a long-runner reach six — stacked raw, that one row swamps the sheet.
const CAST_ALSO_MAX = 2;

/** Languages present in this cast, original first, then by how much of the cast
 *  each one actually covers — a dub with two credits shouldn't outrank Japanese. */
function castLanguages(characters) {
  const n = {};
  for (const c of characters) for (const v of c.voices) if (v.language) n[v.language] = (n[v.language] || 0) + 1;
  return Object.keys(n).sort((a, b) => (a === 'Japanese' ? -1 : b === 'Japanese' ? 1 : n[b] - n[a]));
}

function CastSheet({ characters }) {
  const langs = castLanguages(characters);
  const [lang, setLang] = useState(() => (langs.includes('Japanese') ? 'Japanese' : langs[0]));
  const [all, setAll] = useState(false);
  const [openRows, setOpenRows] = useState(() => new Set());
  if (!characters.length) return null;

  const toggleRow = (id) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Every character stays on the sheet in every language: switching to a dub that
  // only covers half the cast shouldn't make rows disappear under the cursor.
  const shown = all ? characters : characters.slice(0, CAST_PREVIEW);

  return (
    <section className={s.castBlock}>
      <div className={s.castHead}>
        <h3 className={s.blockLabel}>Cast</h3>
        {langs.length > 1 && (
          <div className={s.castLangs} role="group" aria-label="Voice language">
            {langs.map((l) => (
              <button
                key={l}
                className={`${s.castLang} ${l === lang ? s.castLangOn : ''}`}
                onClick={() => setLang(l)}
                aria-pressed={l === lang}
              >
                {l === 'Japanese' ? <span lang="ja">日本語</span> : l}
              </button>
            ))}
          </div>
        )}
      </div>

      <ol className={s.castSheet}>
        {shown.map((c, i) => {
          const voices = c.voices.filter((v) => v.language === lang);
          const [lead, ...also] = voices;
          const rowOpen = openRows.has(c.id);
          const alsoShown = rowOpen ? also : also.slice(0, CAST_ALSO_MAX);
          return (
            // The stagger is capped: past the tenth line the wait stops growing,
            // so "show all 24" doesn't leave the tail of the cast drifting in.
            <li key={c.id} className={s.castRow} style={{ '--row': Math.min(i, 10) }}>
              <Avatar src={c.image} name={c.name} imgClass={s.castFace} letterClass={s.castFaceFallback} />

              <div className={s.castMid}>
                {/* One line, so the dot leader lands on the names' own baseline. */}
                <p className={s.castTop}>
                  <span className={s.castName}>{c.name}</span>
                  {lead ? (
                    <Link to={`/anime/voice/${lead.id}`} className={s.castVoiceName}>
                      {lead.name}
                    </Link>
                  ) : (
                    <span className={`${s.castVoiceName} ${s.castUncredited}`}>not credited</span>
                  )}
                </p>
                <p className={s.castUnder}>
                  <span className={s.castSub}>
                    {c.native && <span className={s.castNative} lang="ja">{c.native}</span>}
                    <span className={s.castRole}>{ROLE_LABEL[c.role] || c.role}</span>
                  </span>
                  <span className={s.castSub}>
                    {lead?.dub_group && <span className={s.castDub}>{lead.dub_group}</span>}
                    {lead?.native && <span className={s.castNative} lang="ja">{lead.native}</span>}
                    {c.favourites > 0 && (
                      <span className={s.castFav} title={`${c.favourites.toLocaleString()} AniList favourites`}>
                        <Heart size={9} /> {compact(c.favourites)}
                      </span>
                    )}
                  </span>
                </p>

                {/* Second and later credits hang under the row, carrying the note
                    that explains why they exist at all ("Young", "eps 299-319"). */}
                {alsoShown.map((v) => (
                  <p key={`${v.id}-${v.notes || ''}`} className={s.castAlso}>
                    <span className={s.castAlsoNote}>{v.notes || v.dub_group || 'also'}</span>
                    <Link to={`/anime/voice/${v.id}`} className={s.castAlsoName}>{v.name}</Link>
                  </p>
                ))}
                {also.length > CAST_ALSO_MAX && (
                  <button className={s.castAlsoMore} onClick={() => toggleRow(c.id)}>
                    {rowOpen ? 'fewer' : `+${also.length - CAST_ALSO_MAX} more`}
                  </button>
                )}
              </div>

              <Avatar
                src={lead?.image}
                name={lead?.name || '?'}
                imgClass={s.castFace}
                letterClass={s.castFaceFallback}
              />
            </li>
          );
        })}
      </ol>

      {characters.length > CAST_PREVIEW && (
        <button className={s.castMore} onClick={() => setAll((v) => !v)}>
          {all ? 'show fewer' : `show all ${characters.length}`}
        </button>
      )}
    </section>
  );
}

/** The detail-page header as a full dossier: banner backdrop, poster + trailer,
 *  title block, labeled spec sheet, and both the global average and your rating. */
function DetailDossier({ m, trailer, onTrailer, scoreFormat, connected }) {
  const { episodes, status, season, fans } = mediaSpecs(m);
  const { hoverProps, add } = useAnimeCalc();
  const mine = personalScore(m, scoreFormat);
  const myStatus = m.list_entry && (STATUS_LABEL[m.list_entry.status] || 'On your list');
  const myProgress = m.list_entry?.progress
    ? `${m.list_entry.progress}${m.episodes ? ` / ${m.episodes}` : ''} watched`
    : null;

  return (
    <header className={s.dossier} {...hoverProps(m)}>
      {m.banner && <div className={s.dossierArt} style={{ backgroundImage: `url(${m.banner})` }} />}
      <div className={s.dossierScrim} />
      <span className={s.spotlightScan} aria-hidden="true" />

      <div className={s.dossierInner}>
        <div className={s.dossierPosterCol}>
          {m.cover_xl ? (
            <img className={s.dossierPoster} src={m.cover_xl} alt="" />
          ) : (
            <div className={s.dossierPosterFallback}><Tv size={34} /></div>
          )}
          {trailer && (
            <button className={s.dossierTrailer} onClick={onTrailer}>
              <Play size={15} fill="currentColor" /> Play trailer
            </button>
          )}
          {connected && <FavouriteButton mediaId={m.id} initial={m.is_favourite} />}
          {/* Explicit, keyboard-reachable twin of the hover+C gesture. */}
          <button className={s.dossierTally} onClick={() => add(m)} title="Add the next unwatched episode to the Reckoner">
            <Plus size={14} /> Tally next episode <kbd className={s.tallyKey}>C</kbd>
          </button>
        </div>

        <div className={s.dossierMain}>
          <span className={s.spotlightEyebrow}>
            {[m.format, MEDIA_STATUS[m.status] || m.status, season].filter(Boolean).join(' · ')}
          </span>
          <h1 className={s.dossierTitle}>{m.title}</h1>
          {m.title_native && <span className={s.spotlightNative}>{m.title_native}</span>}

          {m.genres?.length > 0 && (
            <div className={s.spotlightGenres}>
              {m.genres.slice(0, 6).map((g) => (
                <Link key={g} to={discoverHref('g', g)} title={`Browse ${g} anime`}>{g}</Link>
              ))}
            </div>
          )}

          <NextEpisodeBanner next={m.next_airing} />

          <dl className={s.specSheet}>
            <SpecRow label="Studio" value={m.studios?.[0]} />
            <SpecRow label="Format" value={m.format} />
            <SpecRow label="Episodes" value={episodes} />
            <SpecRow label="Status" value={status} />
            <SpecRow label="Season" value={season} />
            <SpecRow label="Fanbase" value={fans} />
          </dl>

          <div className={s.spotlightScores}>
            {m.score > 0 && <ScoreMeter score={m.score} />}
            {(mine || myStatus) && (
              <span className={s.yourMark} title="Your rating and status">
                <User size={13} />
                {mine && <strong>{mine}</strong>}
                {myStatus && <em>{myStatus}</em>}
                {myProgress && <em className={s.yourProgress}>{myProgress}</em>}
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

/** The synopsis as a comfy editorial block: a labeled card with a drop-cap, a
 *  graceful "read more" fold for long write-ups, and the title's defining tags. */
function Synopsis({ html, tags }) {
  const [open, setOpen] = useState(false);
  // AniList descriptions vary wildly in length; only fold the long ones.
  const longish = (html || '').replace(/<[^>]+>/g, '').length > 480;
  const topTags = (tags || []).filter((t) => (t.rank || 0) >= 60).slice(0, 14);

  return (
    <section className={s.synopsisBlock}>
      <h3 className={s.blockLabel}>Synopsis</h3>
      <div className={s.synopsisCard}>
        <div
          className={[
            s.synopsis,
            longish && open ? s.synopsisCols : '',
            longish && !open ? s.synopsisClipped : '',
          ].filter(Boolean).join(' ')}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {longish && (
          <button className={s.readMore} onClick={() => setOpen((v) => !v)}>
            {open ? 'Show less' : 'Read more'} <ChevronDown size={13} className={open ? s.flip : undefined} />
          </button>
        )}
        {topTags.length > 0 && (
          <div className={s.tagSection}>
            <span className={s.asideLabel}>Themes &amp; tags</span>
            <div className={s.tagRow}>
              {topTags.map((t, i) => (
                <Link
                  key={t.name}
                  to={discoverHref('t', t.name)}
                  className={s.tag}
                  style={{ '--i': Math.min(i, 13) }}
                  title={`Browse ${t.name} anime`}
                >
                  {t.name}
                  {t.rank != null && <small>{t.rank}%</small>}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function AnimeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { open } = usePlayer();
  const detail = useApi(`/anime/media/${id}`);
  const me = useApi('/anime/me');
  const m = detail.data;

  const trailer = m && trailerItem(m);

  return (
    <>
      <button onClick={() => navigate(-1)} className={s.back}>
        <ArrowLeft size={13} /> back
      </button>

      {detail.error && <ErrorBox message={detail.error} />}
      {detail.loading && !m && <Receiving label="unrolling the scroll" />}

      {m && (
        <article className={s.detail} style={{ '--cover-c': m.color || 'var(--c-anime)' }}>
          <DetailDossier m={m} trailer={trailer} onTrailer={() => open(trailer)} scoreFormat={me.data?.score_format} connected={!!me.data} />

          {me.data && (
            <div className={s.yourList}>
              <h3 className={s.blockLabel}>Your list</h3>
              <ListControls media={m} scoreFormat={me.data.score_format} />
            </div>
          )}

          {m.description && <Synopsis html={m.description} tags={m.tags} />}

          {/* Above the episodes on purpose: the episode list runs to a row per
              episode (One Piece alone is ~1,170), so anything below it is buried. */}
          <CastSheet characters={m.characters || []} />

          <EpisodeList media={m} />

          <RecStrip
            title="Recommended if you like this"
            sourceId={m.id}
            recs={m.recommendations || []}
            canPost={!!me.data}
            scoreFormat={me.data?.score_format}
          />
          <RelStrip
            title="Related"
            items={(m.relations || []).map((r) => r.media).filter(Boolean)}
            scoreFormat={me.data?.score_format}
          />

          <div className={s.relBlock}>
            <h3 className={s.blockLabel}>Discussion</h3>
            <ForumList mediaId={m.id} />
          </div>
        </article>
      )}
    </>
  );
}
