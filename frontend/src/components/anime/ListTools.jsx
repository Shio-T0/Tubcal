// My List's toolkit: the things people keep asking list trackers for.
//
//  · Tonight's pick — "what should I watch?" answered by a (score-weighted) draw
//    from your backlog, with length / genre / released-only limits.
//  · Sequel radar — sequels and side stories of things you finished that aren't
//    on your list at all (AniList itself never tells you).
//  · Gathering dust — shows you're "watching" but haven't touched in weeks.
//  · Bulk edit, export (JSON / CSV / MyAnimeList XML), sort, search and a
//    compact ledger-row view.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check, CircleSlash, Clock, Dices, Download, EyeOff, Lock, Pause, Play, Plus, Radar, Trash2, Unlock, X,
} from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { ErrorBox, Receiving } from '../layout/Section.jsx';
import { applyOverlay, useAnimeSync, useToast } from '../../state.jsx';
import { timeAgo } from '../../lib/time.js';
import {
  STATUS_LABEL, STATUS_META, fmtCountdown, fmtDuration, metaLine, stripHtml,
} from './shared.jsx';
import lt from './listtools.module.css';

// ── sorting + search ──────────────────────────────────────────────────────────

export const LIST_SORTS = [
  ['default', 'Shelf order'],
  ['title', 'Title A–Z'],
  ['score', 'Your score'],
  ['progress', 'Progress'],
  ['updated', 'Last touched'],
  ['added', 'Date added'],
  ['airing', 'Next episode'],
  ['avg', 'AniList score'],
  ['released', 'Release date'],
];

export function sortEntries(entries, sort) {
  if (sort === 'default') return entries;
  const arr = [...entries];
  const desc = (f) => (a, b) => (f(b) ?? -Infinity) - (f(a) ?? -Infinity);
  switch (sort) {
    case 'title': return arr.sort((a, b) => a.media.title.localeCompare(b.media.title));
    case 'score': return arr.sort(desc((e) => e.score || null));
    case 'progress': return arr.sort(desc((e) => (e.media.episodes ? (e.progress || 0) / e.media.episodes : e.progress)));
    case 'updated': return arr.sort(desc((e) => e.updated_at));
    case 'added': return arr.sort(desc((e) => e.created_at));
    case 'airing': return arr.sort((a, b) => (a.media.next_airing_at || 9e12) - (b.media.next_airing_at || 9e12));
    case 'avg': return arr.sort(desc((e) => e.media.score));
    case 'released': return arr.sort((a, b) => (b.media.start_date || '').localeCompare(a.media.start_date || ''));
    default: return arr;
  }
}

export function matchesText(e, q) {
  if (!q) return true;
  const m = e.media;
  const hay = `${m.title} ${m.title_romaji || ''} ${m.title_native || ''} ${(e.notes || '')}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

// ── export ────────────────────────────────────────────────────────────────────

const MAL_STATUS = {
  CURRENT: 'Watching', REPEATING: 'Watching', COMPLETED: 'Completed',
  PAUSED: 'On-Hold', DROPPED: 'Dropped', PLANNING: 'Plan to Watch',
};

function uniqueEntries(lists) {
  const seen = new Map();
  for (const g of lists) for (const e of g.entries) if (!seen.has(e.media.id)) seen.set(e.media.id, e);
  return [...seen.values()];
}

const csvCell = (v) => {
  const s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const cdata = (s) => `<![CDATA[${String(s || '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

function rowsForExport(lists) {
  return uniqueEntries(lists).map((e) => ({
    title: e.media.title,
    title_romaji: e.media.title_romaji,
    title_native: e.media.title_native,
    anilist_id: e.media.id,
    mal_id: e.media.id_mal,
    format: e.media.format,
    status: e.status,
    score_100: e.score_100,
    progress: e.progress,
    episodes: e.media.episodes,
    rewatches: e.repeat,
    started_at: e.started_at,
    completed_at: e.completed_at,
    notes: e.notes,
    private: e.private,
    custom_lists: e.custom_lists,
    updated_at: e.updated_at ? new Date(e.updated_at * 1000).toISOString() : null,
  }));
}

export function buildMalXml(lists, userName = '') {
  const entries = uniqueEntries(lists);
  const withMal = entries.filter((e) => e.media.id_mal);
  const body = withMal.map((e) => [
    '  <anime>',
    `    <series_animedb_id>${e.media.id_mal}</series_animedb_id>`,
    `    <series_title>${cdata(e.media.title_romaji || e.media.title)}</series_title>`,
    `    <series_episodes>${e.media.episodes || 0}</series_episodes>`,
    `    <my_watched_episodes>${e.progress || 0}</my_watched_episodes>`,
    `    <my_start_date>${e.started_at || '0000-00-00'}</my_start_date>`,
    `    <my_finish_date>${e.completed_at || '0000-00-00'}</my_finish_date>`,
    `    <my_score>${Math.round(e.score_10 || 0)}</my_score>`,
    `    <my_status>${MAL_STATUS[e.status] || 'Plan to Watch'}</my_status>`,
    `    <my_times_watched>${e.repeat || 0}</my_times_watched>`,
    `    <my_rewatching>${e.status === 'REPEATING' ? 1 : 0}</my_rewatching>`,
    `    <my_comments>${cdata(e.notes)}</my_comments>`,
    '    <update_on_import>1</update_on_import>',
    '  </anime>',
  ].join('\n'));
  const xml = [
    '<?xml version="1.0" encoding="UTF-8" ?>',
    '<myanimelist>',
    '  <myinfo>',
    `    <user_name>${cdata(userName)}</user_name>`,
    '    <user_export_type>1</user_export_type>',
    `    <user_total_anime>${withMal.length}</user_total_anime>`,
    '  </myinfo>',
    ...body,
    '</myanimelist>',
  ].join('\n');
  return { xml, skipped: entries.length - withMal.length };
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function ExportMenu({ lists, userName }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const stamp = new Date().toISOString().slice(0, 10);
  const go = (kind) => {
    setOpen(false);
    if (kind === 'json') {
      download(`anilist-${stamp}.json`, JSON.stringify(rowsForExport(lists), null, 2), 'application/json');
    } else if (kind === 'csv') {
      const rows = rowsForExport(lists);
      const cols = Object.keys(rows[0] || { title: '' });
      const text = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
      download(`anilist-${stamp}.csv`, text, 'text/csv');
    } else {
      const { xml, skipped } = buildMalXml(lists, userName);
      download(`anilist-mal-${stamp}.xml`, xml, 'application/xml');
      if (skipped) toast(`${skipped} title${skipped === 1 ? ' has' : 's have'} no MyAnimeList id and were left out`, 'info');
    }
  };
  return (
    <div className={lt.menuWrap}>
      <button type="button" className={lt.tool} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Download size={13} /> Export
      </button>
      {open && (
        <div className={lt.menu} role="menu">
          <button type="button" role="menuitem" onClick={() => go('json')}>JSON <em>everything, for backups</em></button>
          <button type="button" role="menuitem" onClick={() => go('csv')}>CSV <em>for a spreadsheet</em></button>
          <button type="button" role="menuitem" onClick={() => go('mal')}>MyAnimeList XML <em>import on MAL / other trackers</em></button>
        </div>
      )}
    </div>
  );
}

// ── tonight's pick ────────────────────────────────────────────────────────────

const POOLS = [
  ['PLANNING', 'Planning'],
  ['PAUSED', 'Paused'],
  ['CURRENT', 'Watching'],
  ['ANY', 'Anything unfinished'],
];
const LENGTHS = [
  ['any', 'Any length', () => true],
  ['movie', 'A film', (m) => m.format === 'MOVIE'],
  ['short', 'An evening (≤ 2h)', (m) => (m.episodes || 12) * (m.duration || 24) <= 120],
  ['cour', 'One cour (≤ 13 eps)', (m) => m.episodes && m.episodes <= 13],
  ['long', 'Something long (26+)', (m) => (m.episodes || 0) >= 26],
];

function drawWeighted(pool) {
  // A tilt toward the well-loved, never a lock: weight by community score squared.
  const weights = pool.map((e) => Math.max(30, e.media.score || 60) ** 2);
  let x = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i];
    if (x <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function TonightsPick({ entries, onClose }) {
  const { queueListEdit } = useAnimeSync();
  const toast = useToast();
  const [poolKey, setPoolKey] = useState('PLANNING');
  const [len, setLen] = useState('any');
  const [genre, setGenre] = useState('');
  const [released, setReleased] = useState(true);
  const [spinning, setSpinning] = useState(null);
  const [pick, setPick] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);

  const pool = useMemo(() => {
    const test = LENGTHS.find(([k]) => k === len)[2];
    return entries.filter((e) => {
      const st = e.status;
      if (poolKey === 'ANY' ? !['PLANNING', 'PAUSED', 'CURRENT'].includes(st) : st !== poolKey) return false;
      const m = e.media;
      if (released && m.status === 'NOT_YET_RELEASED') return false;
      if (genre && !(m.genres || []).includes(genre)) return false;
      return test(m);
    });
  }, [entries, poolKey, len, genre, released]);
  const genres = useMemo(() => {
    const c = {};
    for (const e of entries) if (e.status === poolKey || poolKey === 'ANY') for (const g of e.media.genres || []) c[g] = (c[g] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([g]) => g);
  }, [entries, poolKey]);

  const spin = () => {
    if (!pool.length) return;
    setPick(null);
    let n = 0;
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      n += 1;
      setSpinning(pool[Math.floor(Math.random() * pool.length)]);
      if (n >= 14) {
        clearInterval(timer.current);
        setSpinning(null);
        setPick(drawWeighted(pool));
      }
    }, 85);
  };

  const shown = spinning || pick;
  const m = shown?.media;
  const start = () => {
    queueListEdit(pick.media, { status: 'CURRENT' });
    toast(`Enjoy “${pick.media.title}” — moved to Watching`, 'success');
  };

  return (
    <section className={lt.pickPanel}>
      <header className={lt.panelHead}>
        <span className={lt.panelTitle}><Dices size={16} /> Tonight's pick</span>
        <span className={lt.panelNote}>{pool.length} candidate{pool.length === 1 ? '' : 's'}</span>
        <button type="button" className={lt.x} onClick={onClose} aria-label="Close"><X size={15} /></button>
      </header>
      <div className={lt.pickControls}>
        <label>From
          <select value={poolKey} onChange={(e) => { setPoolKey(e.target.value); setGenre(''); }}>
            {POOLS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label>Length
          <select value={len} onChange={(e) => setLen(e.target.value)}>
            {LENGTHS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <label>Genre
          <select value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="">Any</option>
            {genres.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label className={lt.check}>
          <input type="checkbox" checked={released} onChange={(e) => setReleased(e.target.checked)} /> out already
        </label>
        <button type="button" className={lt.spin} onClick={spin} disabled={!pool.length || !!spinning}>
          <Dices size={15} /> {pick ? 'Spin again' : 'Spin'}
        </button>
      </div>
      {!pool.length && <p className={lt.muted}>Nothing fits — loosen a limit.</p>}
      {shown && (
        <div className={`${lt.pickCard} ${spinning ? lt.pickSpinning : lt.pickLanded}`} style={{ '--cover-c': m.color || 'var(--c-anime)' }}>
          {m.cover_xl || m.cover ? <img src={m.cover_xl || m.cover} alt="" /> : <span className={lt.pickBlank} />}
          <div className={lt.pickInfo}>
            <span className={lt.pickKicker}>{spinning ? 'shuffling…' : 'tonight, watch'}</span>
            <Link to={`/anime/${m.id}`} className={lt.pickTitle}>{m.title}</Link>
            <span className={lt.pickMeta}>
              {metaLine(m)}
              {m.episodes && m.duration ? ` · ${fmtDuration(m.episodes * m.duration)} in all` : ''}
              {m.score ? ` · ${m.score}%` : ''}
            </span>
            {!spinning && m.description && <p className={lt.pickBlurb}>{stripHtml(m.description).slice(0, 260)}…</p>}
            {!spinning && pick && (
              <div className={lt.pickActions}>
                {pick.status !== 'CURRENT' && (
                  <button type="button" className={lt.primary} onClick={start}><Play size={13} /> Start watching</button>
                )}
                <Link to={`/anime/${m.id}`} className={lt.secondary}>Open</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── the sequel radar ──────────────────────────────────────────────────────────

const RADAR_SEEN = 'tubcal.anime.radarSeen';

function RadarCard({ row, onPlan }) {
  const m = row.media;
  const atMs = m.next_airing_at ? m.next_airing_at * 1000 : 0;
  return (
    <div className={lt.radarCard} style={{ '--cover-c': m.color || 'var(--c-anime)' }}>
      <Link to={`/anime/${m.id}`} className={lt.radarCover}>
        {m.cover ? <img src={m.cover} alt="" loading="lazy" /> : <span />}
        <span className={lt.radarKind}>{row.kind}</span>
      </Link>
      <Link to={`/anime/${m.id}`} className={lt.radarTitle}>{m.title}</Link>
      <span className={lt.radarAfter}>after {row.after.map((a) => a.title).join(', ')}</span>
      <span className={lt.radarWhen}>
        {atMs && atMs > Date.now()
          ? <><Clock size={10} /> ep {m.next_episode} in {fmtCountdown(atMs - Date.now())}</>
          : m.status === 'NOT_YET_RELEASED'
            ? (m.start?.[0] ? `due ${m.start.filter(Boolean).join('-')}` : 'date TBA')
            : [m.format, m.episodes && `${m.episodes} ep`, m.year].filter(Boolean).join(' · ')}
      </span>
      <button type="button" className={lt.radarPlan} onClick={() => onPlan(m)}><Plus size={11} /> Plan</button>
    </div>
  );
}

export function SequelRadar() {
  const [armed, setArmed] = useState(() => {
    try { return localStorage.getItem(RADAR_SEEN) === '1'; } catch { return false; }
  });
  const radar = useApi('/anime/sequels', armed);
  const { overlay, queueListEdit } = useAnimeSync();
  const toast = useToast();
  const [tab, setTab] = useState('out_now');
  const [wide, setWide] = useState(false);
  const d = radar.data;
  useEffect(() => {
    if (d) { try { localStorage.setItem(RADAR_SEEN, '1'); } catch { /* private mode */ } }
  }, [d]);

  const plan = (m) => {
    queueListEdit(m, { status: 'PLANNING' });
    toast(`“${m.title}” → Planning`, 'success');
  };
  const keep = (rows) => (rows || []).filter((r) => (wide || r.kind === 'sequel') && !overlay[r.media.id]);
  const outNow = keep(d?.out_now);
  const coming = keep(d?.coming);
  const rows = tab === 'out_now' ? outNow : coming;
  const partial = d && d.scanned < Math.min(d.finished, 300);

  return (
    <section className={lt.radar}>
      <header className={lt.panelHead}>
        <span className={lt.panelTitle}><Radar size={16} /> Sequel radar</span>
        <span className={lt.panelNote}>what comes after the things you've finished — and isn't on your list</span>
      </header>
      {!armed && (
        <div className={lt.radarIdle}>
          <p>Scans the relations of everything you've completed for sequels, side stories and spin-offs you haven't added.</p>
          <button type="button" className={lt.primary} onClick={() => setArmed(true)}><Radar size={13} /> Scan my list</button>
        </div>
      )}
      {armed && radar.loading && !d && <Receiving label="sweeping the relations" />}
      {radar.error && <ErrorBox message={radar.error} />}
      {d && (
        <>
          <div className={lt.radarBar}>
            <button type="button" className={tab === 'out_now' ? lt.tabOn : lt.tab} onClick={() => setTab('out_now')}>
              Out now <span>{outNow.length}</span>
            </button>
            <button type="button" className={tab === 'coming' ? lt.tabOn : lt.tab} onClick={() => setTab('coming')}>
              Coming <span>{coming.length}</span>
            </button>
            <label className={lt.check}>
              <input type="checkbox" checked={wide} onChange={(e) => setWide(e.target.checked)} /> include side stories & spin-offs
            </label>
            <button type="button" className={lt.rescan} onClick={radar.reload}>rescan</button>
          </div>
          {partial && (
            <p className={lt.muted}>
              Checked {d.scanned} of {Math.min(d.finished, 300)} finished titles — AniList's rate limit paused the sweep; rescan in a minute to finish it.
            </p>
          )}
          {rows.length === 0 ? (
            <p className={lt.muted}>{tab === 'out_now' ? 'You’re caught up — nothing missed.' : 'Nothing announced yet.'}</p>
          ) : (
            <div className={lt.radarRow}>
              {rows.map((row) => <RadarCard key={row.media.id} row={row} onPlan={plan} />)}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── gathering dust ────────────────────────────────────────────────────────────

const DUST_DAYS = 45;

const DUST_KEY = 'tubcal.anime.dust';

/** `collapsible`: folded to one line until opened (remembered on this machine) —
 *  the desktop's My List keeps it out of the way of the shelf itself. */
export function GatheringDust({ entries, collapsible = false }) {
  const { overlay, queueListEdit } = useAnimeSync();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(() => {
    if (!collapsible) return true;
    try { return localStorage.getItem(DUST_KEY) === 'open'; } catch { return false; }
  });
  const fold = (v) => {
    setShown(v);
    try { localStorage.setItem(DUST_KEY, v ? 'open' : 'closed'); } catch { /* private mode */ }
  };
  const cutoff = Date.now() / 1000 - DUST_DAYS * 86400;
  const dusty = entries
    .filter((e) => {
      const eff = applyOverlay(e.media.id, e, overlay);
      return eff && ['CURRENT', 'REPEATING'].includes(eff.status) && e.updated_at && e.updated_at < cutoff && !overlay[e.media.id];
    })
    .sort((a, b) => a.updated_at - b.updated_at);
  if (!dusty.length) return null;
  const note = `${dusty.length} show${dusty.length === 1 ? '' : 's'} you're “watching” but haven't touched in ${DUST_DAYS}+ days`;
  if (!shown) {
    return (
      <button type="button" className={lt.dustBar} onClick={() => fold(true)}>
        <Clock size={15} />
        <b>Gathering dust</b>
        <span className={lt.dustFaces} aria-hidden="true">
          {dusty.slice(0, 6).map((e) => e.media.cover && <img key={e.entry_id} src={e.media.cover} alt="" loading="lazy" />)}
        </span>
        <span className={lt.panelNote}>{note}</span>
        <span className={lt.dustOpen}>Review</span>
      </button>
    );
  }
  const visible = open ? dusty : dusty.slice(0, 4);
  return (
    <section className={lt.dust}>
      <header className={lt.panelHead}>
        <span className={lt.panelTitle}><Clock size={16} /> Gathering dust</span>
        <span className={lt.panelNote}>{note}</span>
        {collapsible && (
          <button type="button" className={lt.dustFold} onClick={() => fold(false)}>Hide</button>
        )}
      </header>
      <div className={lt.dustList}>
        {visible.map((e) => {
          const m = e.media;
          return (
            <div key={e.entry_id} className={lt.dustRow}>
              <Link to={`/anime/${m.id}`} className={lt.dustCover}>{m.cover && <img src={m.cover} alt="" loading="lazy" />}</Link>
              <span className={lt.dustInfo}>
                <Link to={`/anime/${m.id}`}>{m.title}</Link>
                <em>ep {e.progress || 0}{m.episodes ? `/${m.episodes}` : ''} · last touched {timeAgo(e.updated_at)} ago</em>
              </span>
              <span className={lt.dustActions}>
                <button type="button" onClick={() => queueListEdit(m, { progress: (e.progress || 0) + 1 })} title="Watched another episode"><Plus size={12} /> ep</button>
                <button type="button" onClick={() => queueListEdit(m, { status: 'PAUSED' })}><Pause size={12} /> Pause</button>
                <button type="button" onClick={() => queueListEdit(m, { status: 'DROPPED' })}><CircleSlash size={12} /> Drop</button>
              </span>
            </div>
          );
        })}
      </div>
      {dusty.length > 4 && (
        <button type="button" className={lt.rescan} onClick={() => setOpen((v) => !v)}>
          {open ? 'fewer' : `all ${dusty.length}`}
        </button>
      )}
    </section>
  );
}

// ── bulk edit ─────────────────────────────────────────────────────────────────

export function BulkBar({ selected, onClear, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ids = [...selected];
  const run = async (body, label) => {
    setBusy(true);
    try {
      await api('/anime/list/bulk', { method: 'POST', body: JSON.stringify({ entry_ids: ids, ...body }) });
      toast(`${label} — ${ids.length} title${ids.length === 1 ? '' : 's'}`, 'success');
      onClear();
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  };
  return (
    <div className={lt.bulk} role="toolbar" aria-label="Bulk edit">
      <span className={lt.bulkCount}><Check size={13} /> {ids.length} selected</span>
      <select
        disabled={busy || !ids.length}
        value=""
        onChange={(e) => e.target.value && run({ status: e.target.value }, `Moved to ${STATUS_LABEL[e.target.value]}`)}
        aria-label="Move to shelf"
      >
        <option value="">Move to…</option>
        {STATUS_META.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      <button type="button" disabled={busy || !ids.length} onClick={() => run({ private: true }, 'Made private')}><Lock size={12} /> Private</button>
      <button type="button" disabled={busy || !ids.length} onClick={() => run({ private: false }, 'Made public')}><Unlock size={12} /> Public</button>
      <button type="button" disabled={busy || !ids.length} onClick={() => run({ hidden: true }, 'Hidden from status lists')}><EyeOff size={12} /> Hide</button>
      <button
        type="button"
        className={lt.danger}
        disabled={busy || !ids.length}
        onClick={() => window.confirm(`Remove ${ids.length} title${ids.length === 1 ? '' : 's'} from your AniList? This can't be undone.`) && run({ delete: true }, 'Removed')}
      >
        <Trash2 size={12} /> Remove
      </button>
      <button type="button" className={lt.bulkClear} onClick={onClear}>clear</button>
    </div>
  );
}

// ── the ledger-row view ───────────────────────────────────────────────────────
