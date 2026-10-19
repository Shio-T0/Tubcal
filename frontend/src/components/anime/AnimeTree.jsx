// The Anime's index — a file tree, hung under "The Anime" in the Video console.
//
// Every view of the Anime is a folder (Browse, Seasons, Schedule, My List…) and
// every useful place inside one is a file you can open in one click: a shelf of
// your list with its live count, next season, Hot takes in the Ledger, the Inbox
// with its unread badge. Folders open by themselves when you're inside them and
// remember the ones you opened by hand. Your AniList account sits above it: your
// face (to your profile) and whether every edit has reached AniList yet. On a
// phone it becomes two rows of chips.
//
// The console keeps it put — and useful — on a title, a character or a studio
// page too. The section's layout (AnimeLayout) adds the one-line path bar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  CalendarDays, CalendarRange, Check, ChevronRight, Compass, Library,
  MessagesSquare, Scale, Tv, Users,
} from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { useShared } from '../../lib/useShared.js';
import { useAnimeSync } from '../../state.jsx';
import { asPerson, PersonAvatar } from './Person.jsx';
import { STATUS_LABEL, SyncBadge } from './shared.jsx';
import t from './animetree.module.css';

// ── the tree's shape ──────────────────────────────────────────────────────────

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const cap = (w) => w.charAt(0) + w.slice(1).toLowerCase();

/** The AniList season `offset` seasons from the one on air (December is already
 *  next year's Winter, as AniList counts it). */
function seasonAt(offset) {
  const now = new Date();
  const m = now.getMonth() + 1;
  let i = Math.floor((m % 12) / 3) + offset;
  let y = now.getFullYear() + (m === 12 ? 1 : 0);
  while (i < 0) { i += 4; y -= 1; }
  while (i > 3) { i -= 4; y += 1; }
  return { season: SEASONS[i], year: y };
}

// Each view's own defaults: a file matches when every parameter it names equals
// the URL's value, or that parameter's default when the URL leaves it out.
const DEFAULTS = {
  browse: { kind: 'trending', in: 'anime' },
  schedule: { wk: '0', tmine: '0' },
  list: { shelf: 'all', tool: '' },
  community: { c: 'reviews' },
  discuss: { d: 'forum' },
};
const STATUS_ORDER = ['CURRENT', 'REPEATING', 'PLANNING', 'COMPLETED', 'PAUSED', 'DROPPED'];

function shelvesOf(lists) {
  const groups = (lists || []).filter((g) => g.entries?.length);
  groups.sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.status);
    const bi = STATUS_ORDER.indexOf(b.status);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const seen = new Set();
  for (const g of groups) for (const e of g.entries) seen.add(e.media.id);
  return {
    total: seen.size,
    shelves: groups.map((g) => ({
      key: g.status || g.name, label: STATUS_LABEL[g.status] || g.name, count: g.entries.length, custom: !!g.custom,
    })),
  };
}

export function buildTree({ lists, unread }) {
  const now = seasonAt(0);
  const next = seasonAt(1);
  const last = seasonAt(-1);
  const seasonFile = (s, note) => ({
    label: `${cap(s.season)} ${s.year}`,
    note,
    params: note === 'now' ? {} : { season: s.season, year: String(s.year) },
    // "now" matches whether the URL names the season or leaves it to default
    match: (p) => (p.get('season') || now.season) === s.season && Number(p.get('year') || now.year) === s.year,
  });
  const { total, shelves } = shelvesOf(lists);

  return [
    {
      id: 'browse', label: 'Browse', icon: Compass,
      files: [
        { label: 'Trending', params: { kind: 'trending', in: 'anime' } },
        { label: 'Popular', params: { kind: 'popular', in: 'anime' } },
        { label: 'This season', params: { kind: 'seasonal', in: 'anime' } },
        { label: 'Top rated', params: { kind: 'top', in: 'anime' } },
        { sep: 'search in' },
        { label: 'Characters', params: { in: 'characters' } },
        { label: 'Voices & staff', params: { in: 'staff' } },
        { label: 'Studios', params: { in: 'studios' } },
        { label: 'Users', params: { in: 'users' } },
      ],
    },
    {
      id: 'seasons', label: 'Seasons', icon: CalendarRange,
      files: [
        seasonFile(now, 'now'),
        seasonFile(next, 'next'),
        seasonFile(last, 'last'),
        { toggle: 'smine', label: 'Only my list' },
      ],
    },
    {
      id: 'schedule', label: 'Schedule', icon: CalendarDays,
      files: [
        { label: 'This week', params: { wk: '0' } },
        { label: 'Next week', params: { wk: '1' } },
        { label: 'Last week', params: { wk: '-1' } },
        { toggle: 'tmine', label: 'Only my shows' },
      ],
    },
    {
      id: 'list', label: 'My List', icon: Library,
      files: [
        { label: 'All', params: { shelf: 'all' }, count: total || null },
        ...shelves.map((sh) => ({ label: sh.label, params: { shelf: sh.key }, count: sh.count, custom: sh.custom })),
        { sep: 'tools' },
        { toggle: 'tool', value: 'pick', label: 'Pick for me' },
        { toggle: 'tool', value: 'radar', label: 'Sequel radar' },
      ],
    },
    {
      id: 'ledger', label: 'Ledger', icon: Scale,
      files: [
        { label: 'Overview', hash: '' },
        { label: 'Hot takes', hash: 'takes' },
        { label: 'Year in review', hash: 'wrapped' },
        { label: 'Compare tastes', hash: 'compare' },
      ],
    },
    {
      id: 'community', label: 'Community', icon: Users,
      files: [
        { label: 'Reviews', params: { c: 'reviews' } },
        { label: 'Pairings', params: { c: 'recs' } },
        { label: 'Birthdays', params: { c: 'birthdays' } },
        { label: 'Hall of fame', params: { c: 'fame' } },
      ],
    },
    { id: 'channel', label: 'Channel', icon: Tv, files: [] },
    {
      id: 'discuss', label: 'Social', icon: MessagesSquare,
      files: [
        { label: 'Forum', params: { d: 'forum' } },
        { label: 'Everyone', params: { d: 'activity' } },
        { label: 'Following', params: { d: 'following' } },
        { label: 'Inbox', params: { d: 'inbox' }, badge: unread || null },
        { label: 'Your people', params: { d: 'people' } },
      ],
    },
  ];
}

// ── where a file points, and whether you're in it ─────────────────────────────

function hrefFor(folder, file, current) {
  const defaults = DEFAULTS[folder.id] || {};
  const q = new URLSearchParams();
  if (folder.id !== 'browse') q.set('tab', folder.id);
  if (file?.toggle) {
    // a switch: flip one parameter on the view you're already looking at
    const here = current.tab === folder.id ? new URLSearchParams(current.params) : new URLSearchParams(q);
    const on = file.value || '1';
    if (here.get(file.toggle) === on) here.delete(file.toggle); else here.set(file.toggle, on);
    if (folder.id === 'browse') here.delete('tab'); else here.set('tab', folder.id);
    const s = here.toString();
    return `/anime${s ? `?${s}` : ''}`;
  }
  for (const [k, v] of Object.entries(file?.params || {})) {
    if (defaults[k] !== v) q.set(k, v);
  }
  const s = q.toString();
  return `/anime${s ? `?${s}` : ''}${file?.hash ? `#${file.hash}` : ''}`;
}

function isOpenFile(folder, file, current) {
  if (current.tab !== folder.id || current.leaf) return false;
  const p = current.params;
  if (file.match) return file.match(p);
  if (file.toggle) return p.get(file.toggle) === (file.value || '1');
  if (file.hash !== undefined) return current.hash === file.hash;
  const defaults = DEFAULTS[folder.id] || {};
  return Object.entries(file.params || {}).every(([k, v]) => (p.get(k) ?? defaults[k] ?? '') === v);
}

function useCurrent() {
  const { pathname, search, hash } = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(search);
    const onRoom = pathname === '/anime';
    // A thread, a person or a post is a place inside Social: keep that folder open.
    const social = pathname.match(/^\/anime\/(thread|user|activity)\/([^/]+)/);
    return {
      onRoom,
      params,
      hash: hash.replace(/^#/, ''),
      tab: onRoom ? (params.get('tab') || 'browse') : social ? 'discuss' : null,
      leaf: social ? { kind: social[1], name: decodeURIComponent(social[2]) } : null,
    };
  }, [pathname, search, hash]);
}

// ── persistence (a convenience: works without it) ─────────────────────────────

const OPEN_KEY = 'tubcal.anime.tree.open';
const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
};
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
};

// ── the tree ──────────────────────────────────────────────────────────────────

function FileRow({ folder, file, current, index }) {
  if (file.sep) return <li className={t.sep}>{file.sep}</li>;
  const open = isOpenFile(folder, file, current);
  return (
    <li className={`${t.file} ${open ? t.fileOpen : ''}`} style={{ '--i': index }}>
      <Link to={hrefFor(folder, file, current)} aria-current={open ? 'page' : undefined}>
        {file.toggle && <span className={t.box}>{open && <Check size={9} />}</span>}
        <span className={`${t.fileName} ${file.custom ? t.custom : ''}`}>{file.label}</span>
        {file.note && <em className={t.note}>{file.note}</em>}
        {file.count != null && <span className={t.count}>{file.count}</span>}
        {file.badge != null && <span className={t.badge}>{file.badge > 99 ? '99+' : file.badge}</span>}
      </Link>
    </li>
  );
}

export function AnimeTree({ tree }) {
  const current = useCurrent();
  const [explicit, setExplicit] = useState(() => load(OPEN_KEY, { list: true }));
  const setOpen = useCallback((id, v) => {
    setExplicit((prev) => { const next = { ...prev, [id]: v }; save(OPEN_KEY, next); return next; });
  }, []);

  return (
    <nav className={t.tree} aria-label="Anime index">
      <ul className={t.folders}>
        {tree.map((f) => {
          const Icon = f.icon;
          const active = current.tab === f.id;
          const open = f.files.length > 0 && (explicit[f.id] ?? active);
          const first = f.files.find((x) => !x.sep && !x.toggle);
          return (
            <li key={f.id} className={`${t.folder} ${active ? t.folderActive : ''}`}>
              <div className={t.folderRow}>
                {f.files.length > 0 ? (
                  <button
                    type="button"
                    className={`${t.caret} ${open ? t.caretOpen : ''}`}
                    onClick={() => setOpen(f.id, !open)}
                    aria-expanded={open}
                    aria-label={`${open ? 'Close' : 'Open'} ${f.label}`}
                  >
                    <ChevronRight size={13} />
                  </button>
                ) : <span className={t.caretSpacer} />}
                <Link
                  to={hrefFor(f, first, current)}
                  className={t.folderLink}
                  onClick={() => f.files.length && setOpen(f.id, true)}
                  aria-current={active && !first ? 'page' : undefined}
                >
                  <Icon size={15} />
                  <span>{f.label}</span>
                </Link>
              </div>
              {open && (
                <ul className={t.files}>
                  {f.files.map((file, i) => (
                    <FileRow key={file.sep ? `sep-${i}` : `${file.label}-${i}`} folder={f} file={file} current={current} index={i} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A phone's version: the folders as one row of chips, the open folder's files as
 *  a second. Same links, same state — just laid flat. */
function MobileIndex({ tree }) {
  const current = useCurrent();
  const folder = tree.find((f) => f.id === current.tab);
  return (
    <nav className={t.mobile} aria-label="Anime index">
      <div className={t.chips}>
        {tree.map((f) => {
          const Icon = f.icon;
          return (
            <Link key={f.id} to={hrefFor(f, f.files.find((x) => !x.sep && !x.toggle), current)}
                  className={current.tab === f.id ? t.chipOn : t.chip}>
              <Icon size={13} /> {f.label}
            </Link>
          );
        })}
      </div>
      {folder?.files.length > 0 && (
        <div className={t.subChips}>
          {folder.files.filter((x) => !x.sep).map((file, i) => (
            <Link key={`${file.label}-${i}`} to={hrefFor(folder, file, current)}
                  className={isOpenFile(folder, file, current) ? t.subOn : t.sub}>
              {file.label}
              {file.count != null && <em>{file.count}</em>}
              {file.badge != null && <b>{file.badge}</b>}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

/** The file path of where you are — the one line that replaced the big header. */
const LEAF_LABEL = { thread: (n) => `thread ${n}`, user: (n) => n, activity: () => 'post' };

function PathBar({ tree }) {
  const current = useCurrent();
  if (current.leaf) {
    const social = tree.find((f) => f.id === 'discuss');
    const via = current.leaf.kind === 'user' ? 'people' : current.leaf.kind === 'thread' ? 'forum' : 'activity';
    return (
      <p className={t.path}>
        <Link to="/anime">anime</Link>
        <span>/</span>
        <Link to="/anime?tab=discuss">{(social?.label || 'social').toLowerCase()}</Link>
        <span>/</span>
        <Link to={`/anime?tab=discuss&d=${via}`}>{via}</Link>
        <span>/</span>
        <b>{LEAF_LABEL[current.leaf.kind](current.leaf.name)}</b>
      </p>
    );
  }
  if (!current.onRoom) return null;
  const folder = tree.find((f) => f.id === current.tab) || tree[0];
  const file = folder.files.find((x) => !x.sep && !x.toggle && isOpenFile(folder, x, current));
  const switches = folder.files.filter((x) => x.toggle && isOpenFile(folder, x, current));
  return (
    <p className={t.path}>
      <Link to="/anime">anime</Link>
      <span>/</span>
      <Link to={hrefFor(folder, folder.files.find((x) => !x.sep && !x.toggle), current)}>{folder.label.toLowerCase()}</Link>
      {file && <><span>/</span><b>{file.label.toLowerCase()}</b></>}
      {switches.map((x) => <i key={x.label}>+ {x.label.toLowerCase()}</i>)}
    </p>
  );
}

// ── your account, above the tree ──────────────────────────────────────────────

/** Worst-of sync status across every title with a pending/in-flight edit — at a
 *  glance you know whether everything has reached AniList or is still flushing. */
function SyncStatus() {
  const { syncState } = useAnimeSync();
  const vals = Object.values(syncState || {});
  const status = vals.includes('syncing') ? 'syncing'
    : vals.includes('pending') ? 'pending'
      : vals.includes('error') ? 'error' : null;
  if (!status) return null;
  const n = vals.filter((v) => v === status).length;
  return (
    <span className={t.sync}>
      <SyncBadge status={status} />
      {n > 1 && <em>{n}</em>}
    </span>
  );
}

/** The connected AniList account: your face, to your profile page (where the
 *  profile studio, your AniList settings, is one button away). */
function Account() {
  const me = useApi('/anime/me');
  const u = asPerson(me.data);
  if (!u) return null;
  return (
    <div className={t.account}>
      <Link to={`/anime/user/${encodeURIComponent(u.name)}`} className={t.profile} title="Your AniList profile">
        <PersonAvatar user={u} size="sm" />
        <span className={t.profileName}>{u.name}</span>
      </Link>
      <SyncStatus />
    </div>
  );
}

// ── the tree's data ───────────────────────────────────────────────────────────

/** The tree with live counts: your shelves (refreshed when you come back to My
 *  List, since they go stale as you edit) and the inbox's unread badge. */
function useLiveTree() {
  const current = useCurrent();
  const lists = useShared('/anime/lists', { maxAge: 60_000 });
  const [unread, setUnread] = useState(0);

  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) { firstTab.current = false; return; }
    if (current.tab === 'list') lists.reload();
  }, [current.tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    api('/anime/notifications/count').then((d) => alive && setUnread(d.unread || 0)).catch(() => {});
    const read = () => setUnread(0);
    window.addEventListener('anime-inbox-read', read);
    return () => { alive = false; window.removeEventListener('anime-inbox-read', read); };
  }, []);

  return useMemo(() => buildTree({ lists: lists.data?.lists, unread }), [lists.data, unread]);
}

/** The Anime's index as the Video console shows it, under "The Anime": your
 *  account and the tree — or, on a phone (`compact`), the two rows of chips. */
export function AnimePlaces({ compact = false }) {
  const tree = useLiveTree();
  if (compact) return <MobileIndex tree={tree} />;
  return (
    <>
      <Account />
      <AnimeTree tree={tree} />
    </>
  );
}

// ── the section's layout: the path bar over the page ──────────────────────────

export function AnimeLayout({ children }) {
  const lists = useShared('/anime/lists', { maxAge: 60_000 });
  const tree = useMemo(() => buildTree({ lists: lists.data?.lists, unread: 0 }), [lists.data]);
  return (
    <div className={t.main}>
      <PathBar tree={tree} />
      {children ?? <Outlet />}
    </div>
  );
}
