// Anime — the AniList section on a phone.
//
// It opens on what you're watching: one row per show with the next episode a
// thumb away (▶ plays it from the local source, +1 marks it watched), how far
// behind you are and when the next one airs, and a "catch-up" line totting up
// the time it would take. The other shelves are poster walls on chips, with the
// desktop list's tools in a sheet (pick for me, sequel radar, export, bulk edit
// via long-press → Select).
//
// Browse is a search box over a three-across poster wall: the four dials
// (trending, popular, this season, top rated), a finder sheet with every genre
// and tag (tap to require, again to exclude) plus AniList's advanced filters, and
// search across characters, voices, studios and users. The other views —
// Seasons, Schedule, Ledger, Community, Channel, Social — are the desktop's own,
// refitted for a phone by phone.css.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Check, CheckSquare, ChevronDown, ChevronRight, Clock, Dices, Download, Minus, MoreHorizontal, Play, Plus, Radar, Search, SlidersHorizontal,
  Sparkles, Tag, Trash2, Tv, X,
} from 'lucide-react';

import { useApi } from '@pc/api/client.js';
import { useDebounced } from '@pc/components/layout/Section.jsx';
import { AdvancedFilters, advancedPills, useAdvancedFilters } from '@pc/components/anime/Filters.jsx';
import {
  BulkBar, ExportMenu, GatheringDust, LIST_SORTS, matchesText, SequelRadar, sortEntries, TonightsPick,
} from '@pc/components/anime/ListTools.jsx';
import { PeopleGrid } from '@pc/components/anime/People.jsx';
import {
  EMPTY_SET, fmtCountdown, SET_PARAM, STATUS_LABEL, STATUS_META, SyncBadge, useInfinite, useParamState,
} from '@pc/components/anime/shared.jsx';
import { openCurtainCall } from '@pc/components/anime/CurtainCallHost.jsx';
import PcAnime from '@pc/pages/Anime.jsx';
import { applyOverlay, useAnimeSync, useToast } from '@pc/state.jsx';

import { haptic } from '../lib/bridge.js';
import { usePlay } from '../lib/play.js';
import {
  ActionSheet, AppBar, Chips, Empty, ErrorNote, IconBtn, Loading, Sentinel, Sheet, Skeleton, useLongPress, usePullToRefresh,
} from '../shell/Shell.jsx';
import { hm, playEpisode, Poster } from './animeKit.jsx';
import a from './anime.module.css';

const VIEWS = [
  { key: 'list', label: 'My list' },
  { key: 'browse', label: 'Browse' },
  { key: 'seasons', label: 'Seasons' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'discuss', label: 'Social' },
  { key: 'ledger', label: 'Ledger' },
  { key: 'community', label: 'Community' },
  { key: 'channel', label: 'Channel' },
];
const VIEW_KEYS = new Set(VIEWS.map((v) => v.key));

// ── my list ──────────────────────────────────────────────────────────────────

const STATUS_ORDER = ['CURRENT', 'REPEATING', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED'];
const groupKey = (g) => g.status || g.name;
const DAY = 86400;
const WINDOWS = [['any', 'Any time', null], ['7d', 'Past week', 7 * DAY], ['30d', 'Past month', 30 * DAY], ['1y', 'Past year', 365 * DAY], ['older', 'Over a year', null]];
const RELEASE = [['released', 'Released'], ['airing', 'Airing'], ['announced', 'Announced'], ['tba', 'TBA']];
function releaseClass(m) {
  switch (m.status) {
    case 'FINISHED': return 'released';
    case 'RELEASING': return 'airing';
    case 'NOT_YET_RELEASED': return (m.next_airing_at || m.start_year) ? 'announced' : 'tba';
    default: return null;
  }
}
function windowMatch(key) {
  const w = WINDOWS.find(([k]) => k === key);
  if (!w || key === 'any') return null;
  const cutoff = Date.now() / 1000 - (w[2] ?? 365 * DAY);
  return key === 'older' ? (t) => t != null && t < cutoff : (t) => t != null && t >= cutoff;
}

/** How a show on your list stands: progress, what's aired, what's behind. */
function standing(m, eff) {
  const prog = eff?.progress || 0;
  const total = m.episodes || 0;
  const aired = m.next_episode ? m.next_episode - 1 : total;
  return { prog, total, aired, behind: Math.max(0, aired - prog), mins: m.duration || 24 };
}

/** One show you're watching: cover, title, where you are, ▶ next, +1. */
function WatchRow({ entry, onMenu, select }) {
  const { overlay, syncState, queueListEdit } = useAnimeSync();
  const { play: playIt } = usePlay();
  const toast = useToast();
  const navigate = useNavigate();
  const cover = useRef(null);
  const [bursts, setBursts] = useState([]);
  const m = entry.media;
  const eff = applyOverlay(m.id, entry, overlay);
  const lp = useLongPress(() => onMenu({ entry, eff }));
  if (!eff) return null;
  const { prog, total, aired, behind } = standing(m, eff);
  const next = prog + 1;
  const canNext = !total || next <= (aired || total);
  const nextAt = m.next_airing_at ? m.next_airing_at * 1000 - Date.now() : 0;
  const play = async () => {
    const ok = await playEpisode(m, next, (item) => playIt(item, cover.current));
    if (!ok) toast(`Episode ${next} isn't on the local source — the title page has the official links`, 'info');
  };
  // +1: the episode is marked, and a "+1" floats up off the button
  const bump = () => {
    haptic('done');
    queueListEdit(m, { progress: next });
    const id = Date.now();
    setBursts((b) => [...b, id]);
    setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 900);
  };
  return (
    <div className={`${a.row} ${select?.on ? a.rowPicked : ''}`} {...lp} data-reveal>
      {select && (
        <button type="button" className={a.pick} onClick={select.toggle} aria-pressed={select.on} aria-label="Select">
          {select.on ? <Check size={16} /> : null}
        </button>
      )}
      <button type="button" className={a.rowCover} onClick={() => navigate(`/anime/${m.id}`)} ref={cover}>
        {m.cover ? <img src={m.cover} alt="" loading="lazy" /> : <Tv size={20} />}
      </button>
      <div className={a.rowMain} onClick={() => (select ? select.toggle() : navigate(`/anime/${m.id}`))}>
        <b className={a.rowTitle}>{m.title}</b>
        <span className={a.rowMeta}>
          <span>EP <b key={prog} className="ph-tick">{prog}</b>{total ? ` / ${total}` : ''}</span>
          {behind > 0 && <em key={behind} className={`${a.behind} ph-tick`}>{behind} behind</em>}
          {nextAt > 0 && <span>EP {m.next_episode} in {fmtCountdown(nextAt)}</span>}
          <SyncBadge status={syncState[m.id]} label={false} />
        </span>
        <span className={a.track}><i style={{ width: `${total ? Math.min(100, (prog / total) * 100) : prog ? 100 : 0}%` }} /><i className={a.trackAired} style={{ width: `${total && aired ? Math.min(100, (aired / total) * 100) : 0}%` }} /></span>
      </div>
      {!select && (
        <div className={a.rowActs}>
          {canNext && behind > 0 && (
            <button type="button" className={a.playBtn} onClick={play} aria-label={`Play episode ${next}`}>
              <Play size={16} fill="currentColor" />
              <span key={next} className="ph-tick">{next}</span>
            </button>
          )}
          {canNext && (
            <button type="button" className={a.plusBtn} onClick={bump} aria-label="Mark the next episode watched">
              <Plus size={18} />
              {bursts.map((id) => <i key={id} className={a.burst}>+1</i>)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PosterEntry({ entry, scoreFormat, onMenu, select }) {
  const { overlay } = useAnimeSync();
  const m = entry.media;
  const eff = applyOverlay(m.id, entry, overlay);
  const lp = useLongPress(() => onMenu({ entry, eff }));
  if (!eff) return null;
  const { prog, total } = standing(m, eff);
  return (
    <div className={`${a.posterCell} ${select?.on ? a.rowPicked : ''}`} {...lp} onClickCapture={select ? (e) => { e.preventDefault(); e.stopPropagation(); select.toggle(); } : undefined}>
      {select && <span className={a.pickDot}>{select.on ? <Check size={14} /> : null}</span>}
      <Poster media={{ ...m, list_entry: eff }} scoreFormat={scoreFormat} sub={prog ? `${prog}${total ? `/${total}` : ''} ep` : undefined} />
    </div>
  );
}

/** Long-press on a list entry. */
function EntryMenu({ target, onClose, onSelect }) {
  const { queueListEdit, removeListEntry } = useAnimeSync();
  const navigate = useNavigate();
  if (!target) return null;
  const { entry, eff } = target;
  const m = entry.media;
  const prog = eff?.progress || 0;
  return (
    <ActionSheet
      open
      onClose={onClose}
      title={m.title}
      actions={[
        { label: 'Open the title', Icon: Tv, onClick: () => navigate(`/anime/${m.id}`) },
        { label: 'One episode back', Icon: Minus, hint: `${prog} → ${Math.max(0, prog - 1)}`, onClick: () => queueListEdit(m, { progress: Math.max(0, prog - 1) }) },
        ...STATUS_META.filter(([v]) => v !== eff?.status).map(([v, label, Icon]) => ({ label: `Move to ${label}`, Icon, onClick: () => queueListEdit(m, { status: v }) })),
        eff?.status === 'COMPLETED' && m.status === 'FINISHED' && { label: 'Curtain call', Icon: Sparkles, onClick: () => openCurtainCall(m.id) },
        { label: 'Select for bulk edit', Icon: CheckSquare, onClick: () => onSelect(entry.entry_id) },
        { label: 'Remove from list', Icon: Trash2, danger: true, onClick: () => removeListEntry(m, eff?.id) },
      ]}
    />
  );
}

function MyList({ registerRefresh }) {
  const lists = useApi('/anime/lists');
  const { overlay } = useAnimeSync();
  const [shelf, setShelf] = useParamState('shelf', '');
  const [lsort, setLsort] = useParamState('lsort', 'default');
  const [seen, setSeen] = useParamState('seen', 'any');
  const [release, setRelease] = useParamState('release', EMPTY_SET, SET_PARAM);
  const [find, setFind] = useState(null);
  const [tools, setTools] = useState(null); // 'menu' | 'sort' | 'pick' | 'radar'
  const [menu, setMenu] = useState(null);
  const [selected, setSelected] = useState(null); // Set of entry ids while selecting
  registerRefresh(lists.reload);

  const scoreFormat = lists.data?.viewer?.score_format;
  const groups = useMemo(() => (lists.data?.lists || [])
    .filter((g) => g.entries.length > 0)
    .sort((x, y) => {
      const xi = STATUS_ORDER.indexOf(x.status); const yi = STATUS_ORDER.indexOf(y.status);
      return (xi < 0 ? 99 : xi) - (yi < 0 ? 99 : yi);
    }), [lists.data]);
  const uniq = useMemo(() => {
    const ids = new Set(); const out = [];
    for (const g of groups) for (const e of g.entries) if (!ids.has(e.media.id)) { ids.add(e.media.id); out.push(e); }
    return out;
  }, [groups]);

  if (lists.loading && !lists.data) return <Skeleton kind="rows" n={6} />;
  if (lists.error) {
    return (
      <Empty
        Icon={Tv}
        title="Connect AniList"
        text="Add your AniList app credentials in Settings → Connections, then connect. Your watching, planning and completed shelves show up here."
        action={<a className={a.cta} href="/settings">Open Settings</a>}
      />
    );
  }
  if (!groups.length) return <Empty Icon={Tv} title="Your list is empty" text="Browse and add a show — it lands here." />;

  const cur = groups.find((g) => groupKey(g) === shelf) || groups[0];
  const key = groupKey(cur);
  const text = (find || '').trim();
  const match = ['CURRENT', 'REPEATING', 'COMPLETED', 'PAUSED', 'DROPPED'].includes(key) ? windowMatch(seen) : null;
  let entries = cur.entries;
  if (key === 'PLANNING' && release.size) entries = entries.filter((e) => release.has(releaseClass(e.media)));
  if (match) entries = entries.filter((e) => match(e.updated_at));
  if (text) entries = entries.filter((e) => matchesText(e, text));
  entries = sortEntries(entries, lsort);
  const rows = key === 'CURRENT' || key === 'REPEATING';

  // the catch-up line: how much aired-but-unwatched there is across this shelf
  let catchEps = 0; let catchMin = 0; let catchShows = 0;
  if (rows) {
    for (const e of cur.entries) {
      const eff = applyOverlay(e.media.id, e, overlay);
      const { behind, mins } = standing(e.media, eff);
      if (behind > 0) { catchShows += 1; catchEps += behind; catchMin += behind * mins; }
    }
  }
  // "watching" but untouched for 45 days (the same test the dust panel runs)
  const dustCut = Date.now() / 1000 - 45 * DAY;
  const dusty = uniq.filter((e) => {
    const eff = applyOverlay(e.media.id, e, overlay);
    return eff && ['CURRENT', 'REPEATING'].includes(eff.status) && e.updated_at && e.updated_at < dustCut && !overlay[e.media.id];
  }).length;
  const toggleSel = (id) => setSelected((prev) => {
    const n = new Set(prev || []);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <>
      <Chips
        items={groups.map((g) => ({ key: groupKey(g), label: STATUS_LABEL[g.status] || g.name, count: g.entries.length }))}
        value={key}
        onChange={(k) => { setShelf(k === groupKey(groups[0]) ? '' : k); setSelected(null); }}
        className={a.shelves}
      />
      <div className={a.tools}>
        {find != null ? (
          <label className={a.find}>
            <Search size={15} />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find on your list…" autoFocus />
            <button type="button" onClick={() => setFind(null)} aria-label="Close"><X size={16} /></button>
          </label>
        ) : (
          <>
            <button type="button" className={a.tool} onClick={() => setFind('')}><Search size={15} /> Find</button>
            <button type="button" className={a.tool} onClick={() => setTools('sort')}>
              {(LIST_SORTS.find(([v]) => v === lsort) || LIST_SORTS[0])[1]} <ChevronDown size={14} />
            </button>
            <button type="button" className={a.tool} onClick={() => setTools('menu')} aria-label="List tools"><MoreHorizontal size={17} /></button>
          </>
        )}
      </div>

      {key === 'PLANNING' && (
        <Chips
          items={RELEASE.map(([k, label]) => ({ key: k, label, Icon: release.has(k) ? Check : undefined, count: cur.entries.filter((e) => releaseClass(e.media) === k).length }))}
          value={null}
          onChange={(k) => setRelease((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
          className={a.subChips}
        />
      )}
      {['REPEATING', 'COMPLETED', 'PAUSED', 'DROPPED'].includes(key) && (
        <Chips items={WINDOWS.map(([k, label]) => ({ key: k, label }))} value={seen} onChange={setSeen} className={a.subChips} />
      )}

      {rows && catchShows > 0 && !text && (
        <p className={a.catchUp} data-reveal="fade">
          <b>{catchEps} episode{catchEps === 1 ? '' : 's'}</b> to catch up on across {catchShows} show{catchShows === 1 ? '' : 's'} · about <b>{hm(catchMin)}</b>
          <span> — start now, done by {new Date(Date.now() + catchMin * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </p>
      )}
      {key === 'CURRENT' && !text && dusty > 0 && (
        <button type="button" className={a.dust} onClick={() => setTools('dust')} data-reveal="fade">
          <Clock size={17} />
          <span><b>{dusty} show{dusty === 1 ? '' : 's'} gathering dust</b> — untouched for 45+ days</span>
          <ChevronRight size={18} />
        </button>
      )}

      {!entries.length && <Empty Icon={Search} title="Nothing here" text={text ? `Nothing on this shelf matches “${text}”.` : 'No titles match these filters.'} />}
      {rows ? (
        <div className={a.rows}>
          {entries.map((e) => (
            <WatchRow
              key={e.entry_id}
              entry={e}
              onMenu={setMenu}
              select={selected ? { on: selected.has(e.entry_id), toggle: () => toggleSel(e.entry_id) } : null}
            />
          ))}
        </div>
      ) : (
        <div className={a.wall}>
          {entries.map((e) => (
            <PosterEntry
              key={e.entry_id}
              entry={e}
              scoreFormat={scoreFormat}
              onMenu={setMenu}
              select={selected ? { on: selected.has(e.entry_id), toggle: () => toggleSel(e.entry_id) } : null}
            />
          ))}
        </div>
      )}

      {selected && (
        <div className={`${a.bulk} ph-reuse`}>
          <BulkBar selected={selected} onClear={() => setSelected(null)} onDone={lists.reload} />
        </div>
      )}

      <EntryMenu target={menu} onClose={() => setMenu(null)} onSelect={(id) => setSelected(new Set([id]))} />
      <ActionSheet
        open={tools === 'menu'}
        onClose={() => setTools(null)}
        title="Your list"
        actions={[
          { label: 'Pick something for tonight', Icon: Dices, onClick: () => setTools('pick') },
          { label: 'Sequel radar', Icon: Radar, hint: 'sequels you haven’t added', onClick: () => setTools('radar') },
          { label: 'Select for bulk edit', Icon: CheckSquare, onClick: () => setSelected(new Set()) },
          { label: 'Export the list', Icon: Download, onClick: () => setTools('export') },
        ]}
      />
      <Sheet open={tools === 'sort'} onClose={() => setTools(null)} title="Order this shelf by">
        <div className={a.sortList}>
          {LIST_SORTS.map(([v, label]) => (
            <button key={v} type="button" className={lsort === v ? a.sortOn : ''} onClick={() => { setLsort(v); setTools(null); }}>
              {label}{lsort === v && <Check size={18} />}
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={tools === 'dust'} onClose={() => setTools(null)} title="Gathering dust" full>
        <div className="ph-reuse ph-tight"><GatheringDust entries={uniq} /></div>
      </Sheet>
      <Sheet open={tools === 'pick'} onClose={() => setTools(null)} title="Tonight's pick" full>
        <div className="ph-reuse ph-tight"><TonightsPick entries={uniq} onClose={() => setTools(null)} /></div>
      </Sheet>
      <Sheet open={tools === 'radar'} onClose={() => setTools(null)} title="Sequel radar" full>
        <div className="ph-reuse ph-tight"><SequelRadar /></div>
      </Sheet>
      <Sheet open={tools === 'export'} onClose={() => setTools(null)} title="Export your list">
        <div className="ph-reuse ph-tight ph-export"><ExportMenu lists={groups} userName={lists.data?.viewer?.name} /></div>
      </Sheet>
    </>
  );
}

// ── browse ───────────────────────────────────────────────────────────────────

const KINDS = [
  { key: 'trending', label: 'Trending', ranked: true },
  { key: 'popular', label: 'Popular', ranked: true },
  { key: 'seasonal', label: 'This season', ranked: false },
  { key: 'top', label: 'Top rated', ranked: true },
];
const SORTS = [
  ['popular', 'Most popular'], ['trending', 'Trending now'], ['score', 'Highest rated'],
  ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['title', 'Title A–Z'],
];
const SEARCH_IN = [
  { key: 'anime', label: 'Anime' },
  { key: 'characters', label: 'Characters' },
  { key: 'staff', label: 'Voices & staff' },
  { key: 'studios', label: 'Studios' },
  { key: 'users', label: 'Users' },
];

/** A three-state chip: required ✓, excluded −, or not in play. */
function Tri({ label, state, onTap }) {
  return (
    <button type="button" className={`${a.tri} ${state === 'on' ? a.triOn : state === 'x' ? a.triNo : ''}`} onClick={onTap} aria-pressed={state === 'on' ? true : state === 'x' ? 'mixed' : false}>
      {state === 'on' ? <Check size={13} /> : state === 'x' ? <Minus size={13} /> : null}
      {label}
    </button>
  );
}

function Finder({ open, onClose, coll, sel, cycle, af, services, sort, setSort, onClear, total }) {
  const [tq, setTq] = useState('');
  const [openCat, setOpenCat] = useState(null);
  const data = coll.data;
  const q = tq.trim().toLowerCase();
  const matches = q && data ? (data.tags || []).filter((t) => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)) : null;
  const st = (key, inc, exc) => (inc.has(key) ? 'on' : exc.has(key) ? 'x' : null);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Find anime"
      full
      footer={
        <div className={a.finderFoot}>
          <button type="button" className={a.ghost} onClick={onClear} disabled={!total}>Clear {total || ''}</button>
          <button type="button" className={a.primary} onClick={onClose}>Show results</button>
        </div>
      }
    >
      {coll.loading && !data && <Loading label="pulling the genre index" />}
      {coll.error && <ErrorNote message={coll.error} />}
      {data && (
        <>
          <h3 className={a.finderHead}>Order</h3>
          <Chips items={SORTS.map(([key, label]) => ({ key, label }))} value={sort} onChange={setSort} className={a.finderChips} />
          <h3 className={a.finderHead}>Genres <em>tap to require · again to exclude</em></h3>
          <div className={a.triWrap}>
            {(data.genres || []).map((g) => <Tri key={g} label={g} state={st(g, sel.genres, sel.xGenres)} onTap={() => cycle.genre(g)} />)}
          </div>
          <h3 className={a.finderHead}>Tags</h3>
          <label className={a.find}>
            <Tag size={15} />
            <input value={tq} onChange={(e) => setTq(e.target.value)} placeholder="Filter tags — “healing”, “time travel”…" />
            {tq && <button type="button" onClick={() => setTq('')} aria-label="Clear"><X size={16} /></button>}
          </label>
          {[...sel.tags, ...sel.xTags].length > 0 && (
            <div className={a.triWrap}>
              {[...sel.tags, ...sel.xTags].sort().map((t) => <Tri key={t} label={t} state={st(t, sel.tags, sel.xTags)} onTap={() => cycle.tag(t)} />)}
            </div>
          )}
          {matches ? (
            <div className={a.triWrap}>
              {matches.slice(0, 80).map((t) => <Tri key={t.name} label={t.name} state={st(t.name, sel.tags, sel.xTags)} onTap={() => cycle.tag(t.name)} />)}
              {!matches.length && <p className={a.muted}>No tag matches “{tq}”.</p>}
            </div>
          ) : (
            (data.tag_groups || []).map((g) => {
              const on = openCat === g.category;
              const n = g.tags.filter((t) => sel.tags.has(t.name) || sel.xTags.has(t.name)).length;
              return (
                <div key={g.category} className={a.cat}>
                  <button type="button" className={a.catHead} onClick={() => setOpenCat(on ? null : g.category)} aria-expanded={on}>
                    {g.category.replace(/-/g, ' · ')} <em>{g.tags.length}</em>{n > 0 && <b>{n}</b>}
                    <ChevronDown size={16} className={on ? a.flip : ''} />
                  </button>
                  {on && (
                    <div className={a.triWrap}>
                      {g.tags.map((t) => <Tri key={t.name} label={t.name} state={st(t.name, sel.tags, sel.xTags)} onTap={() => cycle.tag(t.name)} />)}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <h3 className={a.finderHead}>Year, format &amp; more</h3>
          <div className="ph-reuse ph-tight ph-filters"><AdvancedFilters af={af} services={services} /></div>
        </>
      )}
    </Sheet>
  );
}

function Browse() {
  const [urlQ, setUrlQ] = useParamState('q', '');
  const [rawIn, setIn] = useParamState('in', 'anime');
  const searchIn = SEARCH_IN.some((x) => x.key === rawIn) ? rawIn : 'anime';
  const [rawKind, setKind] = useParamState('kind', 'trending');
  const kind = KINDS.find((x) => x.key === rawKind) || KINDS[0];
  const [genres, setGenres] = useParamState('g', EMPTY_SET, SET_PARAM);
  const [tags, setTags] = useParamState('t', EMPTY_SET, SET_PARAM);
  const [xGenres, setXGenres] = useParamState('xg', EMPTY_SET, SET_PARAM);
  const [xTags, setXTags] = useParamState('xt', EMPTY_SET, SET_PARAM);
  const [sort, setSort] = useParamState('sort', 'popular');
  const af = useAdvancedFilters();
  const [finder, setFinder] = useState(false);
  const [text, setText] = useState(urlQ);
  const dq = useDebounced(text.trim(), 500);
  useEffect(() => { if (dq !== urlQ) setUrlQ(dq); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  const chipCount = genres.size + tags.size + xGenres.size + xTags.size;
  const filtering = chipCount > 0 || af.count > 0;
  const cycleOf = (inc, setInc, exc, setExc) => (key) => {
    if (inc.has(key)) { setInc((p) => { const n = new Set(p); n.delete(key); return n; }); setExc((p) => new Set(p).add(key)); }
    else if (exc.has(key)) setExc((p) => { const n = new Set(p); n.delete(key); return n; });
    else setInc((p) => new Set(p).add(key));
  };
  const cycle = { genre: cycleOf(genres, setGenres, xGenres, setXGenres), tag: cycleOf(tags, setTags, xTags, setXTags) };
  const clearAll = () => { setGenres(new Set()); setTags(new Set()); setXGenres(new Set()); setXTags(new Set()); af.clear(); };

  const mode = searchIn !== 'anime' ? 'people' : filtering ? 'discover' : dq ? 'search' : 'browse';
  const csv = (set) => encodeURIComponent([...set].sort().join(','));
  const sig = mode === 'discover'
    ? `d|${csv(genres)}|${csv(tags)}|${csv(xGenres)}|${csv(xTags)}|${af.query}|${sort}|${dq}`
    : mode === 'search' ? `s|${dq}` : `b|${kind.key}`;
  const buildUrl = useCallback((p) => {
    if (mode === 'discover') {
      return `/anime/discover?genres=${csv(genres)}&tags=${csv(tags)}&xg=${csv(xGenres)}&xt=${csv(xTags)}${af.query ? `&${af.query}` : ''}&sort=${sort}&q=${encodeURIComponent(dq)}&page=${p}`;
    }
    if (mode === 'search') return `/anime/search?q=${encodeURIComponent(dq)}&page=${p}`;
    return `/anime/browse?kind=${kind.key}&page=${p}`;
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const feed = useInfinite(sig, buildUrl, { enabled: mode !== 'people' });
  const people = useInfinite(`${searchIn}|${dq}`, (p) => `/anime/people?kind=${searchIn}&q=${encodeURIComponent(dq)}&page=${p}`, { enabled: mode === 'people' && (searchIn !== 'users' || !!dq) });
  const me = useApi('/anime/me');
  const coll = useApi('/anime/genres', finder || af.v.svc.size > 0);

  const items = feed.items || [];
  const without = (setter, key) => () => setter((p) => { const n = new Set(p); n.delete(key); return n; });
  const pills = [
    ...[...genres].map((g) => ({ k: `g:${g}`, label: g, drop: without(setGenres, g) })),
    ...[...xGenres].map((g) => ({ k: `xg:${g}`, label: `not ${g}`, x: true, drop: without(setXGenres, g) })),
    ...[...tags].map((t) => ({ k: `t:${t}`, label: t, drop: without(setTags, t) })),
    ...[...xTags].map((t) => ({ k: `xt:${t}`, label: `not ${t}`, x: true, drop: without(setXTags, t) })),
  ];
  const extra = advancedPills(af, coll.data?.services || []);

  return (
    <>
      <div className={a.browseBar}>
        <label className={a.find}>
          <Search size={16} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={searchIn === 'anime' ? 'Search AniList…' : `Search ${SEARCH_IN.find((x) => x.key === searchIn).label.toLowerCase()}…`}
            enterKeyHint="search"
          />
          {text && <button type="button" onClick={() => setText('')} aria-label="Clear"><X size={16} /></button>}
        </label>
        {searchIn === 'anime' && (
          <button type="button" className={`${a.filterBtn} ${filtering ? a.filterOn : ''}`} onClick={() => setFinder(true)} aria-label="Genres, tags and filters">
            <SlidersHorizontal size={18} />
            {chipCount + af.count > 0 && <em>{chipCount + af.count}</em>}
          </button>
        )}
      </div>
      {(text || searchIn !== 'anime') && <Chips items={SEARCH_IN} value={searchIn} onChange={setIn} className={a.subChips} />}
      {mode === 'browse' && <Chips items={KINDS} value={kind.key} onChange={setKind} className={a.subChips} />}
      {mode === 'discover' && (
        <div className={a.pills}>
          {pills.map((p) => <button key={p.k} type="button" className={p.x ? a.pillX : a.pill} onClick={p.drop}>{p.label} <X size={12} /></button>)}
          {extra.map((p) => <button key={p.key} type="button" className={a.pill} onClick={p.remove}>{p.label} <X size={12} /></button>)}
          <button type="button" className={a.pillClear} onClick={clearAll}>clear all</button>
        </div>
      )}

      {mode === 'people' ? (
        <>
          {searchIn === 'users' && !dq && <Empty Icon={Search} title="Find someone" text="Type a username to find someone on AniList." />}
          {people.error && <ErrorNote message={people.error} />}
          {people.loading && !people.items?.length && <Skeleton kind="posters" n={6} />}
          {people.items?.length > 0 && <div className="ph-reuse ph-tight ph-people"><PeopleGrid kind={searchIn} items={people.items} ranked={!dq} /></div>}
          <Sentinel onReach={people.loadMore} active={!!people.items?.length && people.hasMore && !people.error} />
        </>
      ) : (
        <>
          {feed.error && <ErrorNote message={feed.error} />}
          {feed.loading && !items.length && <Skeleton kind="posters" n={9} />}
          {!feed.loading && !feed.error && !items.length && <Empty Icon={Search} title="No anime" text={filtering ? 'Nothing matches this combination — loosen a filter.' : `Nothing matches “${dq}”.`} />}
          <div className={a.wall}>
            {items.map((m, i) => (
              <Poster key={m.id} media={m} scoreFormat={me.data?.score_format} rank={mode === 'browse' && kind.ranked ? i + 1 : null} />
            ))}
          </div>
          <Sentinel onReach={feed.loadMore} active={items.length > 0 && feed.hasMore && !feed.error} />
          {feed.loadingMore && <Loading label="dealing more titles" />}
        </>
      )}

      <Finder
        open={finder}
        onClose={() => setFinder(false)}
        coll={coll}
        sel={{ genres, tags, xGenres, xTags }}
        cycle={cycle}
        af={af}
        services={coll.data?.services || []}
        sort={sort}
        setSort={setSort}
        onClear={clearAll}
        total={chipCount + af.count}
      />
    </>
  );
}

// ── the hub ──────────────────────────────────────────────────────────────────

export default function AnimeHub() {
  const navigate = useNavigate();
  const me = useApi('/anime/me');
  const unread = useApi('/anime/notifications/count', !!me.data);
  const connected = !!me.data;
  const [rawTab, setTab] = useParamState('tab', '');
  const tab = VIEW_KEYS.has(rawTab) ? rawTab : (me.loading && !me.data && !me.error ? null : connected ? 'list' : 'browse');
  const refresher = useRef(null);
  const registerRefresh = useCallback((f) => { refresher.current = f; }, []);
  const pull = usePullToRefresh(async () => { await refresher.current?.(); }, tab === 'list');
  const n = unread.data?.unread || 0;

  const pick = (k) => {
    // a view switch starts clean: the desktop views read their own params
    navigate(k === (connected ? 'list' : 'browse') ? '/anime' : `/anime?tab=${k}`, { replace: true });
    window.scrollTo(0, 0);
  };

  return (
    <div className={a.screen}>
      <AppBar
        title="Anime"
        sub={connected ? me.data.name : 'AniList'}
        tone="var(--c-anime)"
        actions={
          <>
            <IconBtn label="Search anime" onClick={() => { setTab('browse'); }}><Search size={21} /></IconBtn>
            {connected && (
              <IconBtn label="Inbox" onClick={() => navigate('/anime?tab=discuss&d=inbox')} className={a.bell}>
                <Bell size={21} />
                {n > 0 && <em>{n > 99 ? '99+' : n}</em>}
              </IconBtn>
            )}
          </>
        }
      >
        <Chips items={VIEWS} value={tab} onChange={pick} />
      </AppBar>
      {pull}

      {tab == null && <Loading label="checking in with AniList" />}
      {tab === 'list' && <MyList registerRefresh={registerRefresh} />}
      {tab === 'browse' && <Browse />}
      {tab && tab !== 'list' && tab !== 'browse' && (
        <div className={`ph-reuse ph-anime ph-anime-${tab}`}>
          <PcAnime />
        </div>
      )}
    </div>
  );
}
