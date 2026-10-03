// Seasons — the program guide.
//
// AniChart's job, in the room's own voice: one season at a time, every title as a
// landscape "program card" (poster, synopsis, where it streams, when it airs),
// grouped the way a broadcast guide is — the TV lineup, shorts, films, the odd
// OVA/ONA/special, and last season's leftovers still on air. Planning a show is a
// single tap on its card.
//
// A card reads the way a listing in a TV guide does: its time slot first (the
// weekday stamped in kanji, the local time, a live countdown), then the title, one
// line of facts, as much synopsis as the card has room for — "Read more" grows the
// card in place rather than scrolling a box — and the trailer and services last.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Play, Plus, Tv, Users } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { ErrorBox, Receiving } from '../layout/Section.jsx';
import { applyOverlay, useAnimeSync, usePlayer, useToast } from '../../state.jsx';
import {
  CoverRatings, MONTH_SHORT, SOURCE_LABEL, STATUS_META, fmtCountdown, formatLabel,
  titleCase, trailerItem, useCountdownTick, useParamState,
} from './shared.jsx';
import { useAnimeCalc } from './WatchCalculator.jsx';
import s from '../../pages/anime.module.css';
import g from './seasons.module.css';

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const SEASON_GLYPH = { WINTER: '冬', SPRING: '春', SUMMER: '夏', FALL: '秋' };
const SEASON_MONTHS = { WINTER: 'Jan – Mar', SPRING: 'Apr – Jun', SUMMER: 'Jul – Sep', FALL: 'Oct – Dec' };

const GROUPS = [
  ['tv', 'The lineup', (m) => m.format === 'TV'],
  ['short', 'Shorts', (m) => m.format === 'TV_SHORT'],
  ['movie', 'At the cinema', (m) => m.format === 'MOVIE'],
  ['other', 'OVA · ONA · specials', (m) => ['OVA', 'ONA', 'SPECIAL', 'MUSIC'].includes(m.format)],
];

const SORTS = [
  ['popular', 'Popularity'],
  ['score', 'Score'],
  ['airing', 'Airing soonest'],
  ['start', 'Premiere date'],
  ['title', 'Title'],
];

function sortItems(items, sort) {
  const arr = [...items];
  const byNum = (f) => (a, b) => (f(b) ?? -1) - (f(a) ?? -1);
  switch (sort) {
    case 'score': return arr.sort(byNum((m) => m.score));
    case 'airing': return arr.sort((a, b) => (a.next_airing_at || 9e12) - (b.next_airing_at || 9e12));
    case 'start': return arr.sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999'));
    case 'title': return arr.sort((a, b) => a.title.localeCompare(b.title));
    default: return arr; // the server already ordered by popularity
  }
}

function step(season, year, dir) {
  let i = SEASONS.indexOf(season) + dir;
  let y = year;
  if (i < 0) { i = 3; y -= 1; }
  if (i > 3) { i = 0; y += 1; }
  return [SEASONS[i], y];
}

const WEEKDAY_KANJI = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_MS = 86_400_000;
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

const sameDay = (a, b) => a.toDateString() === b.toDateString();

/** "2026-10-20" → a local Date (not UTC midnight, which is the day before out west). */
function localDate(iso) {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d);
}

/** The listing's time slot, as a TV guide prints it: a stamp (the weekday in kanji
 *  for a weekly show, a calendar leaf for a dated one-off), a headline time, and a
 *  line under it. `tone` colours it: soon = within a day, quiet = nothing to wait for. */
function slotOf(m, now) {
  const at = m.next_airing_at ? m.next_airing_at * 1000 : 0;
  const film = m.format === 'MOVIE';
  if (at > now) {
    const d = new Date(at);
    const day = sameDay(d, new Date(now)) ? 'Today'
      : sameDay(d, new Date(now + DAY_MS)) ? 'Tomorrow'
        : d.toLocaleDateString([], { weekday: 'short' });
    const what = film ? 'Opens' : m.next_episode === 1 ? 'Premiere'
      : `Ep ${m.next_episode}${m.episodes ? ` of ${m.episodes}` : ''}`;
    // A film opens on a date, not in a slot — its "time" is just AniList's midnight JST.
    return {
      stamp: film ? null : WEEKDAY_KANJI[d.getDay()],
      leaf: film ? d : null,
      head: film
        ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
        : `${day} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
      date: film ? null : d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      what,
      countdown: fmtCountdown(at - now),
      tone: at - now < DAY_MS ? 'soon' : '',
    };
  }
  if (m.status === 'FINISHED') {
    const out = film && m.start_date
      ? `Released ${localDate(m.start_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
      : m.episodes > 1 ? `All ${m.episodes} episodes out` : null;
    return { stamp: '完', head: 'Finished', what: out, tone: 'quiet' };
  }
  if (m.status === 'RELEASING') {
    return { stamp: '配', head: 'Streaming now', what: 'No weekly slot', tone: 'quiet' };
  }
  // a payload cached before these flags existed: trust the date, as the guide used to
  if (m.start_date && (m.start_exact ?? true)) {
    const d = localDate(m.start_date);
    return {
      leaf: d,
      head: `Starts ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
      what: 'Time not announced',
    };
  }
  if (m.start_date && (m.start_month ?? true)) {
    const d = localDate(m.start_date);
    return {
      stamp: '未',
      head: `Coming ${d.toLocaleDateString([], { month: 'long' })}`,
      what: 'Day not announced',
      tone: 'quiet',
    };
  }
  return { stamp: '未', head: 'Date not announced', tone: 'quiet' };
}

function Slot({ m }) {
  const atMs = m.next_airing_at ? m.next_airing_at * 1000 : 0;
  useCountdownTick(atMs);
  const t = slotOf(m, Date.now());
  return (
    <div className={g.slot} data-tone={t.tone || undefined}>
      <span className={g.stamp} aria-hidden="true">
        {t.leaf ? (
          <span className={g.leaf}><b>{t.leaf.getDate()}</b>{MONTH_SHORT[t.leaf.getMonth()]}</span>
        ) : (
          <span lang="ja">{t.stamp}</span>
        )}
      </span>
      <span className={g.slotText}>
        <span className={g.when}>
          {t.head}
          {t.date && <em>{t.date}</em>}
        </span>
        {(t.what || t.countdown) && (
          <span className={g.until}>
            {t.what}
            {t.countdown && <> in <strong>{t.countdown}</strong></>}
          </span>
        )}
      </span>
    </div>
  );
}

/** AniList descriptions → paragraphs, minus the "(Source: Crunchyroll)" credit
 *  lines that eat a short card's last line. */
function synopsisOf(html) {
  if (!html) return [];
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\((?:Source|Written by)[^)]*\)|\[Written by[^\]]*\]/gi, '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Clamp the synopsis to exactly the lines its box has room for — a card's free
 *  height depends on whether the title took one line or two. When it doesn't all
 *  fit, one line is given up to the "Read more" row. Imperative on purpose: the
 *  clamp is pure layout and shouldn't cost a render per card per resize. */
function useFitLines(open, content) {
  const boxRef = useRef(null);
  const textRef = useRef(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return undefined;
    if (open) {
      text.style.webkitLineClamp = 'none';
      return undefined;
    }
    const measure = () => {
      const lh = parseFloat(getComputedStyle(text).lineHeight) || 21;
      text.style.webkitLineClamp = 'none';
      const fits = text.scrollHeight <= box.clientHeight + 1;
      const room = fits ? box.clientHeight : box.clientHeight - lh;
      text.style.webkitLineClamp = String(Math.max(1, Math.floor(room / lh)));
      setClipped(!fits);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [open, content]);
  return { boxRef, textRef, clipped };
}

function ListMark({ m, entry }) {
  const [, label, Icon] = STATUS_META.find(([k]) => k === entry.status) || [null, 'On your list', Check];
  const counting = ['CURRENT', 'REPEATING', 'PAUSED'].includes(entry.status) && entry.progress > 0;
  return (
    <Link to={`/anime/${m.id}`} className={g.onList} title="On your list — open to edit">
      <Icon size={13} />
      <span className={g.actLabel}>{label}</span>
      {counting && <span className={g.progress}>{entry.progress}{m.episodes ? `/${m.episodes}` : ''}</span>}
    </Link>
  );
}

function ProgramCard({ m }) {
  const { overlay, queueListEdit } = useAnimeSync();
  const { hoverProps } = useAnimeCalc();
  const { open: play } = usePlayer();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const paras = useMemo(() => synopsisOf(m.description), [m.description]);
  const { boxRef, textRef, clipped } = useFitLines(open, m.description);
  const entry = applyOverlay(m.id, m.list_entry, overlay);
  const trailer = trailerItem(m);
  const studio = m.studio_refs?.[0];
  const streams = m.streams || [];
  const facts = [
    formatLabel(m.format),
    m.episodes > 1 && `${m.episodes} eps`,
    m.duration && `${m.duration} min`,
    SOURCE_LABEL[m.source] && (m.source === 'ORIGINAL' ? 'Original story' : `From ${SOURCE_LABEL[m.source].toLowerCase()}`),
  ].filter(Boolean);
  const plan = () => {
    queueListEdit(m, { status: 'PLANNING' });
    toast(`“${m.title}” → Planning`, 'success');
  };
  return (
    <article
      className={g.card}
      data-open={open || undefined}
      style={{ '--cover-c': m.color || 'var(--c-anime)' }}
      {...hoverProps(m)}
    >
      <Link to={`/anime/${m.id}`} className={g.cover} tabIndex={-1} aria-hidden="true">
        {m.cover_xl || m.cover ? <img src={m.cover_xl || m.cover} alt="" loading="lazy" /> : <Tv size={28} />}
        <CoverRatings media={m} className={s.ratingsTR} />
      </Link>
      <div className={g.body}>
        <div className={g.slotRow}>
          <Slot m={m} />
          {entry?.status ? (
            <ListMark m={m} entry={entry} />
          ) : (
            <button type="button" className={g.plan} onClick={plan} aria-label="Add to Planning">
              <Plus size={13} /><span className={g.actLabel}>Plan</span>
            </button>
          )}
        </div>

        <h4 className={g.title}>
          <Link to={`/anime/${m.id}`} title={m.title_romaji && m.title_romaji !== m.title ? m.title_romaji : undefined}>
            {m.title}
          </Link>
        </h4>
        {m.title_native && <p className={g.native} lang="ja">{m.title_native}</p>}
        <p className={g.facts}>
          {studio ? <Link to={`/anime/studio/${studio.id}`}>{studio.name}</Link> : m.studios?.[0] && <span>{m.studios[0]}</span>}
          {facts.map((x) => <span key={x}>{x}</span>)}
        </p>

        <div className={g.syn} ref={boxRef}>
          {open ? (
            <div className={g.synFull} ref={textRef}>
              {paras.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          ) : (
            <p
              className={paras.length ? g.synText : `${g.synText} ${g.synNone}`}
              ref={textRef}
              onClick={clipped ? () => setOpen(true) : undefined}
            >
              {paras.join(' ') || 'No synopsis yet.'}
            </p>
          )}
          {(clipped || open) && (
            <button type="button" className={g.more} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? <>Show less <ChevronUp size={13} /></> : <>Read more <ChevronDown size={13} /></>}
            </button>
          )}
        </div>

        <footer className={g.foot}>
          {m.genres?.length > 0 && (
            <span className={g.genres}>
              {m.genres.slice(0, 3).map((x) => (
                <Link key={x} to={`/anime?tab=browse&g=${encodeURIComponent(x)}`}>{x}</Link>
              ))}
            </span>
          )}
          <span className={g.tools}>
            {m.popularity > 0 && (
              <span className={g.pop} title={`${m.popularity.toLocaleString()} people have it on their AniList`}>
                <Users size={12} /> {compact.format(m.popularity)}
              </span>
            )}
            {trailer && (
              <button type="button" className={g.trailer} onClick={() => play(trailer)}>
                <Play size={11} fill="currentColor" /> Trailer
              </button>
            )}
            {streams.slice(0, 3).map((st) => (
              <a
                key={st.url}
                className={g.stream}
                href={st.url}
                target="_blank"
                rel="noreferrer"
                title={`Watch on ${st.site}${st.language ? ` (${st.language})` : ''}`}
                style={st.color ? { '--st-c': st.color } : undefined}
              >
                {st.icon ? <img src={st.icon} alt={st.site} /> : <ExternalLink size={12} />}
              </a>
            ))}
            {streams.length > 3 && (
              <Link
                to={`/anime/${m.id}`}
                className={g.streamMore}
                title={streams.slice(3).map((st) => st.site).join(', ')}
              >
                +{streams.length - 3}
              </Link>
            )}
          </span>
        </footer>
      </div>
    </article>
  );
}

/** Where a season sits relative to the one on air: 0 now, >0 ahead, <0 past. */
function seasonOffset(cur, now) {
  if (!cur || !now) return 0;
  return (cur[1] - now.year) * 4 + SEASONS.indexOf(cur[0]) - SEASONS.indexOf(now.season);
}

export default function Seasons() {
  const [season, setSeason] = useParamState('season', '');
  const [yearRaw, setYear] = useParamState('year', '');
  const [sort, setSort] = useParamState('ssort', 'popular');
  const [only, setOnly] = useParamState('sfmt', 'all');
  const [mine, setMine] = useParamState('smine', '0');

  const q = season && yearRaw ? `?season=${season}&year=${yearRaw}` : '';
  const chart = useApi(`/anime/season${q}`);
  const d = chart.data;
  const cur = d ? [d.season, d.year] : null;

  const go = (dir) => {
    if (!cur) return;
    const [s2, y2] = step(cur[0], cur[1], dir);
    setSeason(s2);
    setYear(String(y2));
  };
  const goNow = () => { setSeason(''); setYear(''); };

  const groups = useMemo(() => {
    if (!d) return [];
    let items = d.items;
    if (mine === '1') items = items.filter((m) => m.list_entry);
    const out = GROUPS
      .filter(([key]) => only === 'all' || only === key)
      .map(([key, label, test]) => [key, label, sortItems(items.filter(test), sort)])
      .filter(([, , list]) => list.length);
    if ((only === 'all' || only === 'left') && d.leftovers?.length) {
      const left = mine === '1' ? d.leftovers.filter((m) => m.list_entry) : d.leftovers;
      if (left.length) out.push(['left', 'Still on air from last season', sortItems(left, sort)]);
    }
    return out;
  }, [d, only, sort, mine]);

  const counts = useMemo(() => {
    const c = {};
    for (const [key, , test] of GROUPS) c[key] = (d?.items || []).filter(test).length;
    c.left = d?.leftovers?.length || 0;
    return c;
  }, [d]);
  const onListCount = (d?.items || []).filter((m) => m.list_entry).length;
  const offset = seasonOffset(cur, d?.now);
  const isNow = !!d && offset === 0;

  return (
    <div className={g.guide}>
      <header className={g.dial}>
        <button type="button" className={g.arrow} onClick={() => go(-1)} disabled={!cur} aria-label="Previous season">
          <ChevronLeft size={20} />
        </button>
        <div className={g.dialFace}>
          <span className={g.glyph} lang="ja" aria-hidden="true">{cur ? SEASON_GLYPH[cur[0]] : '季'}</span>
          <div className={g.dialText}>
            <span className={g.dialKicker}>{isNow ? 'On air now' : offset > 0 ? 'Coming up' : 'From the archive'}</span>
            <h2 className={g.dialTitle}>{cur ? `${titleCase(cur[0])} ${cur[1]}` : 'Tuning…'}</h2>
            <span className={g.dialSub}>
              {cur ? SEASON_MONTHS[cur[0]] : ''}{d ? ` · ${d.items.length} titles` : ''}
              {onListCount > 0 && ` · ${onListCount} on your list`}
            </span>
          </div>
          {!isNow && d && <button type="button" className={g.nowBtn} onClick={goNow}>back to now</button>}
        </div>
        <button type="button" className={g.arrow} onClick={() => go(1)} disabled={!cur} aria-label="Next season">
          <ChevronRight size={20} />
        </button>
      </header>

      <div className={g.controls}>
        <div className={g.chips} role="group" aria-label="Show">
          {[['all', 'Everything'], ...GROUPS.map(([k, label]) => [k, label]), ['left', 'Leftovers']].map(([k, label]) => (
            (k === 'all' || counts[k] > 0) && (
              <button key={k} type="button" className={only === k ? g.chipOn : g.chip} onClick={() => setOnly(k)} aria-pressed={only === k}>
                {label}{k !== 'all' && <span>{counts[k]}</span>}
              </button>
            )
          ))}
        </div>
        <div className={g.right}>
          <label className={g.mine}>
            <input type="checkbox" checked={mine === '1'} onChange={(e) => setMine(e.target.checked ? '1' : '0')} />
            only my list
          </label>
          <select className={g.select} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Order">
            {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
      </div>

      {chart.error && <ErrorBox message={chart.error} />}
      {chart.loading && !d && <Receiving label="printing the program guide" />}
      {d && groups.length === 0 && (
        <p className={g.muted}>{mine === '1' ? 'Nothing from this season is on your list yet.' : 'No titles announced for this season yet.'}</p>
      )}

      {groups.map(([key, label, list]) => (
        <section key={key} className={g.group}>
          <h3 className={g.groupHead}>
            <span>{label}</span>
            <span className={g.groupCount}>{list.length}</span>
          </h3>
          <div className={g.cards}>
            {list.map((m) => <ProgramCard key={m.id} m={m} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
