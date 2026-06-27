import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Bookmark, Calendar, Check, CheckCheck, ChevronDown,
  ChevronLeft, ChevronRight, CircleSlash, Clapperboard, Eye, ExternalLink, Flag,
  Frown, Heart, Meh, Minus, Pause, Play, Plus, Repeat, Smile, Star, ThumbsUp,
  Trash2, Tv, User,
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
import { usePlayer, useToast } from '../state.jsx';
import s from './anime.module.css';

// AniList score scales by the viewer's chosen format.
const SCORE_MAX = { POINT_100: 100, POINT_10_DECIMAL: 10, POINT_10: 10, POINT_5: 5, POINT_3: 3 };
const SCORE_STEP = { POINT_10_DECIMAL: 0.5 };

const ACCENT = { '--accent-local': 'var(--c-anime)' };

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
  return (
    <Link to={`/anime/${media.id}`} className={s.card} style={{ '--cover-c': media.color || 'var(--c-anime)' }}>
      <div className={s.cardCoverWrap}>
        {media.cover ? (
          <img className={s.cardCover} src={media.cover} alt="" loading="lazy" />
        ) : (
          <div className={s.cardCoverFallback}><Tv size={26} /></div>
        )}
        {corner && <span className={s.cardCorner}>{corner}</span>}
        <CoverRatings media={media} scoreFormat={scoreFormat} className={s.ratingsBL} />
        <NextEpBadge media={media} />
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
  return (
    <Link
      to={`/anime/${media.id}`}
      className={s.pcard}
      style={{ '--cover-c': media.color || 'var(--c-anime)', '--i': index }}
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

function BrowseTab() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('trending');
  const q = query.trim();
  const dq = useDebounced(q);
  const searching = dq.length > 0;

  const search = useApi(`/anime/search?q=${encodeURIComponent(dq)}`, searching);
  const browse = useApi(`/anime/browse?kind=${kind}`, !searching);
  const me = useApi('/anime/me'); // viewer score format (for "your rating"); 401 when not connected
  const scoreFormat = me.data?.score_format;

  const active = searching ? search : browse;
  const items = active.data?.items || [];
  const activeKind = BROWSE_KINDS.find((k) => k.value === kind) || BROWSE_KINDS[0];

  // Browse opens on a rotating spotlight of the top 5; the wall continues from rank 6.
  const featured = !searching ? items.slice(0, 5) : [];
  const wall = featured.length ? items.slice(featured.length) : items;

  return (
    <>
      <SearchBar value={query} onChange={setQuery} placeholder="search AniList…" />

      {!searching && (
        <div className={s.browseTools}>
          <SegmentedControl
            options={BROWSE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
            value={kind}
            onChange={setKind}
          />
          <span className={s.browseCaption}>
            {activeKind.caption}
            {items.length ? <em className={s.browseCount}>{items.length} titles</em> : null}
          </span>
        </div>
      )}

      {active.error && <ErrorBox message={active.error} />}
      {active.loading && !active.data && (
        <Receiving label={searching ? `searching for “${dq}”` : 'pulling the listings'} />
      )}
      {!active.loading && items.length === 0 && (
        <p className={s.muted}>{searching ? `No anime match “${dq}”.` : 'Nothing on air here yet.'}</p>
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
            rank={!searching && activeKind.ranked ? i + featured.length + 1 : null}
          />
        ))}
      </div>
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

async function patchList(patch, toast, onSaved) {
  try {
    await api('/anime/list', { method: 'POST', body: JSON.stringify(patch) });
    toast('List updated', 'success');
    onSaved?.();
  } catch (e) {
    toast(e.message, 'error');
  }
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
function ListControls({ media, scoreFormat, onSaved }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const entry = media.list_entry;
  const prog = entry?.progress || 0;
  const total = media.episodes;
  const pct = total ? Math.min(100, Math.round((prog / total) * 100)) : 0;
  const repeat = entry?.repeat || 0;

  const save = async (patch) => {
    setBusy(true);
    await patchList({ media_id: media.id, ...patch }, toast, onSaved);
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api(`/anime/list/${entry.id}`, { method: 'DELETE' });
      toast('Removed from list', 'info');
      onSaved?.();
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  };
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
            disabled={busy}
            onClick={() => save({ status: v })}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
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
                <button className={s.stepBtn} disabled={busy || prog <= 0} onClick={() => save({ progress: prog - 1 })} aria-label="One fewer">
                  <Minus size={14} />
                </button>
                <div className={s.progTrack} title={total ? `${pct}% watched` : undefined}>
                  <span className={s.progFill} style={{ width: `${total ? pct : prog > 0 ? 100 : 0}%` }} />
                </div>
                <button className={s.stepBtn} disabled={busy || (total && prog >= total)} onClick={() => save({ progress: prog + 1 })} aria-label="One more">
                  <Plus size={14} />
                </button>
              </div>
              {total > 0 && prog < total && entry.status !== 'COMPLETED' && (
                <button className={s.finishBtn} disabled={busy} onClick={finish}>
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
                disabled={busy}
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
                  <button className={s.stepBtn} disabled={busy || repeat <= 0} onClick={() => save({ repeat: repeat - 1 })} aria-label="One fewer rewatch">
                    <Minus size={14} />
                  </button>
                  <span className={s.stepperVal}><Repeat size={12} /> {repeat}×</span>
                  <button className={s.stepBtn} disabled={busy} onClick={() => save({ repeat: repeat + 1 })} aria-label="One more rewatch">
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
                  disabled={busy}
                  onChange={(e) => save({ started_at: e.target.value })}
                />
              </label>
              <label className={s.dateField}>
                <span className={s.listLabel}><Calendar size={12} /> Finished</span>
                <input
                  type="date"
                  className={s.dateInput}
                  defaultValue={entry.completed_at || ''}
                  disabled={busy}
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
                  disabled={busy}
                  onBlur={(e) => { if (e.target.value !== (entry.notes || '')) save({ notes: e.target.value }); }}
                />
              </label>
            </div>
          )}

          <button className={s.removeLink} disabled={busy} onClick={remove}>
            <Trash2 size={12} /> Remove from list
          </button>
        </>
      )}
    </div>
  );
}

function ListEntryCard({ entry, onSaved, scoreFormat }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const m = entry.media;
  const total = m.episodes;
  const prog = entry.progress || 0;
  // Episodes available so far: for an airing show, the episode before the next to
  // air; otherwise the full run. "Behind" = aired-so-far minus what you've watched.
  const aired = m.next_episode ? m.next_episode - 1 : (total || 0);
  const behind = Math.max(0, aired - prog);
  const behindTag = behind > 0 ? `${behind} ep${behind > 1 ? 's' : ''} behind` : null;
  const bump = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    await patchList({ media_id: m.id, progress: prog + 1 }, toast, onSaved);
    setBusy(false);
  };
  return (
    <div className={s.listEntry}>
      <AnimeCard media={m} corner={behindTag} scoreFormat={scoreFormat} />
      <div className={s.quickRow}>
        <span className={s.quickProg}>{prog}{total ? ` / ${total}` : ''}</span>
        {(!total || prog < total) && (
          <button className={s.quickBtn} disabled={busy} onClick={bump} title="Mark next episode watched">
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
  const [filter, setFilter] = useState('all');
  const [release, setRelease] = useState(() => new Set()); // empty = no release filter
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
  // Filter a group's entries by the active release buckets (Planning only).
  const entriesOf = (g) =>
    groupKey(g) === 'PLANNING' && release.size > 0
      ? g.entries.filter((e) => release.has(releaseClass(e.media)))
      : g.entries;

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

      <div className={s.lists}>
        {shown.map((g) => {
          const entries = entriesOf(g);
          return (
            <section key={groupKey(g)} className={s.listGroup}>
              <h3 className={s.listHead}>
                {STATUS_LABEL[g.status] || g.name}
                <span className={s.listCount}>{entries.length}</span>
              </h3>
              {entries.length === 0 ? (
                <p className={s.muted}>No titles match those release filters.</p>
              ) : (
                <div className={s.grid}>
                  {entries.map((e) => (
                    <ListEntryCard key={e.entry_id} entry={e} onSaved={lists.reload} scoreFormat={scoreFormat} />
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
  const plan = async (e, m) => {
    e.preventDefault();
    e.stopPropagation();
    await patchList({ media_id: m.id, status: 'PLANNING' }, toast);
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
  const [tab, setTab] = useState('browse');
  return (
    <>
      <SectionHead
        kicker="No 06 — The Anime"
        title="The picture scroll"
        note="Browse and search AniList, keep your list in sync, and watch — all on this machine."
        color="var(--c-anime)"
      >
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
        {items.map((m) => (
          <div key={m.id} className={s.relItem}>
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
        {items.map((r) => (
          <div key={r.media.id} className={s.relItem}>
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

function EpisodeList({ media, onProgress }) {
  // The aggregator is optional now — it only enables local playback when up.
  const eps = useApi(`/anime/episodes/${media.id}`);
  const { open } = usePlayer();
  const toast = useToast();

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

  // Launch official source; optionally advance AniList progress on launch.
  const launch = (url, epNumber) => {
    launchOfficial(url);
    if (epNumber != null && media.list_entry && epNumber > (media.list_entry.progress || 0)) {
      patchList({ media_id: media.id, progress: epNumber }, toast, onProgress);
    }
  };

  return (
    <div className={s.relBlock}>
      <h3 className={s.blockLabel}>Episodes</h3>

      {links.length > 0 && (
        <div className={s.deepLinks}>
          <span className={s.deepLinkLabel}>Watch official:</span>
          {links.map((l) => (
            <button
              key={l.url}
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
          {list.map((e) => {
            const local = !!e.key;
            const officialUrl = e.url || seriesLink; // per-episode link, else the series page
            const primary = local
              ? () => playLocal(e)
              : () => officialUrl && launch(officialUrl, e.number);
            return (
              <div key={e.number} className={s.episode}>
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

/** The detail-page header as a full dossier: banner backdrop, poster + trailer,
 *  title block, labeled spec sheet, and both the global average and your rating. */
function DetailDossier({ m, trailer, onTrailer, scoreFormat, connected }) {
  const { episodes, status, season, fans } = mediaSpecs(m);
  const mine = personalScore(m, scoreFormat);
  const myStatus = m.list_entry && (STATUS_LABEL[m.list_entry.status] || 'On your list');
  const myProgress = m.list_entry?.progress
    ? `${m.list_entry.progress}${m.episodes ? ` / ${m.episodes}` : ''} watched`
    : null;

  return (
    <header className={s.dossier}>
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
        </div>

        <div className={s.dossierMain}>
          <span className={s.spotlightEyebrow}>
            {[m.format, MEDIA_STATUS[m.status] || m.status, season].filter(Boolean).join(' · ')}
          </span>
          <h1 className={s.dossierTitle}>{m.title}</h1>
          {m.title_native && <span className={s.spotlightNative}>{m.title_native}</span>}

          {m.genres?.length > 0 && (
            <div className={s.spotlightGenres}>
              {m.genres.slice(0, 6).map((g) => <span key={g}>{g}</span>)}
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
              {topTags.map((t) => (
                <span key={t.name} className={s.tag}>
                  {t.name}
                  {t.rank != null && <small>{t.rank}%</small>}
                </span>
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
              <ListControls media={m} scoreFormat={me.data.score_format} onSaved={detail.reload} />
            </div>
          )}

          {m.description && <Synopsis html={m.description} tags={m.tags} />}

          <EpisodeList media={m} onProgress={detail.reload} />

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
