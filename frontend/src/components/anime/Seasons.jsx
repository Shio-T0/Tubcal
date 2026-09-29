// Seasons — the program guide.
//
// AniChart's job, in the room's own voice: one season at a time, every title as a
// landscape "program card" (poster, synopsis, where it streams, when it airs),
// grouped the way a broadcast guide is — the TV lineup, shorts, films, the odd
// OVA/ONA/special, and last season's leftovers still on air. Planning a show is a
// single tap on its card.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Clock, ExternalLink, Plus, Tv } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { ErrorBox, Receiving } from '../layout/Section.jsx';
import { applyOverlay, useAnimeSync, useToast } from '../../state.jsx';
import {
  SOURCE_LABEL, STATUS_LABEL, airingDateLabel, fmtCountdown, formatLabel, stripHtml,
  titleCase, useCountdownTick, useParamState,
} from './shared.jsx';
import { useAnimeCalc } from './WatchCalculator.jsx';
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

function AiringLine({ m }) {
  const atMs = m.next_airing_at ? m.next_airing_at * 1000 : 0;
  useCountdownTick(atMs);
  if (atMs && atMs > Date.now()) {
    const premiere = m.next_episode === 1;
    return (
      <span className={g.airing}>
        <Clock size={12} />
        {premiere ? 'Premieres' : `Ep ${m.next_episode}`} in <strong>{fmtCountdown(atMs - Date.now())}</strong>
        <em>{airingDateLabel(m.next_airing_at)}</em>
      </span>
    );
  }
  if (m.status === 'FINISHED') {
    return <span className={g.airing}>{m.episodes ? `All ${m.episodes} episodes out` : 'Finished airing'}</span>;
  }
  if (m.start_date && m.status === 'NOT_YET_RELEASED') {
    return <span className={g.airing}><Clock size={12} /> Starts {m.start_date}</span>;
  }
  return <span className={g.airing}>{m.status === 'RELEASING' ? 'Airing' : 'Date to be announced'}</span>;
}

function ProgramCard({ m, index }) {
  const { overlay, queueListEdit } = useAnimeSync();
  const { hoverProps } = useAnimeCalc();
  const toast = useToast();
  const entry = applyOverlay(m.id, m.list_entry, overlay);
  const synopsis = stripHtml(m.description);
  const plan = () => {
    queueListEdit(m, { status: 'PLANNING' });
    toast(`“${m.title}” → Planning`, 'success');
  };
  return (
    <article
      className={g.card}
      style={{ '--cover-c': m.color || 'var(--c-anime)', '--i': Math.min(index, 12) }}
      {...hoverProps(m)}
    >
      <Link to={`/anime/${m.id}`} className={g.cover}>
        {m.cover_xl || m.cover ? <img src={m.cover_xl || m.cover} alt="" loading="lazy" /> : <Tv size={28} />}
        <span className={g.coverFoot}>
          <span className={g.coverTitle}>{m.title}</span>
          {m.studios?.[0] && <span className={g.coverStudio}>{m.studios[0]}</span>}
        </span>
      </Link>
      <div className={g.body}>
        <div className={g.bodyHead}>
          <AiringLine m={m} />
          <span className={g.facts}>
            {[formatLabel(m.format), m.episodes && `${m.episodes} eps`, m.duration && `${m.duration}m`,
              SOURCE_LABEL[m.source]].filter(Boolean).join(' · ')}
          </span>
        </div>
        {m.title_native && <span className={g.native} lang="ja">{m.title_native}</span>}
        <p className={g.synopsis}>{synopsis || 'No synopsis yet.'}</p>
        {m.genres?.length > 0 && (
          <div className={g.genres}>
            {m.genres.slice(0, 4).map((x) => (
              <Link key={x} to={`/anime?tab=browse&g=${encodeURIComponent(x)}`}>{x}</Link>
            ))}
          </div>
        )}
        <footer className={g.foot}>
          <span className={g.stats}>
            {m.score ? <b>{m.score}%</b> : <span className={g.unscored}>no score yet</span>}
            {m.popularity > 0 && <span>{m.popularity.toLocaleString()} watching</span>}
          </span>
          {m.streams?.length > 0 && (
            <span className={g.streams}>
              {m.streams.slice(0, 5).map((st) => (
                <a
                  key={st.url}
                  href={st.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`${st.site}${st.language ? ` (${st.language})` : ''}`}
                  style={st.color ? { '--st-c': st.color } : undefined}
                >
                  {st.icon ? <img src={st.icon} alt={st.site} /> : <ExternalLink size={12} />}
                </a>
              ))}
            </span>
          )}
          {entry?.status ? (
            <span className={g.onList}><Check size={12} /> {STATUS_LABEL[entry.status] || 'On your list'}</span>
          ) : (
            <button type="button" className={g.plan} onClick={plan}><Plus size={12} /> Plan</button>
          )}
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
            {list.map((m, i) => <ProgramCard key={m.id} m={m} index={i} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
