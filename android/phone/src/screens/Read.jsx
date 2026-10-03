// Read — the text rooms on one tab: The Wire (Hacker News), The Dispatch
// (Reddit) and GitHub, switched from the bar. Each keeps the desktop room's
// reach: HN's six lists and its whole archive search; your subreddits (or your
// Reddit home feed when connected), hot/new/top and a search of all of Reddit;
// trending repos, your repos' activity, and repo search. Lines are thumb-sized:
// tap a story for the article (or the post), the comment pill for the
// discussion, long-press for everything else.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowUpRight, Bookmark, BookmarkCheck, Briefcase, Clock, ExternalLink, Flame, GitFork, HelpCircle, Inbox, ListTree,
  MessageSquare, Plus, Rocket, Search, Share2, Sparkles, Star, Trash2, TrendingUp, X,
} from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';
import { useDebounced } from '@pc/components/layout/Section.jsx';
import AddSubscriptionModal from '@pc/components/modals/AddSubscriptionModal.jsx';
import { Avatar } from '@pc/components/ui/Avatar.jsx';
import { splitKind } from '@pc/components/wire/HNReader.jsx';
import { useWireSeen } from '@pc/components/wire/seen.js';
import { compact } from '@pc/lib/format.js';
import { DEFAULT_ACTIVE_ROOMS } from '@pc/lib/rooms.js';
import { ago, timeAgo } from '@pc/lib/time.js';
import { useParamState } from '@pc/lib/urlState.js';
import { useSaved, useSettings, useSubscriptions, useToast } from '@pc/state.jsx';

import { openExternal, share } from '../lib/bridge.js';
import {
  ActionSheet, AppBar, Chips, Empty, ErrorNote, IconBtn, Loading, Sentinel, Sheet, Skeleton, useLongPress, usePullToRefresh,
} from '../shell/Shell.jsx';
import { HNPage, RedditPage, RepoPage } from './discuss.jsx';
import r from './read.module.css';

const ROOMS = [
  { key: 'wire', id: 'hackernews', label: 'The Wire', path: '/hackernews', c: 'var(--c-hn)' },
  { key: 'dispatch', id: 'reddit', label: 'Dispatch', path: '/reddit', c: 'var(--c-reddit)' },
  { key: 'github', id: 'github', label: 'GitHub', path: '/github', c: 'var(--c-github)' },
];

/** A search field that lives in the app bar. */
function BarSearch({ value, onChange, placeholder, onClose }) {
  return (
    <label className={r.search}>
      <Search size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus spellCheck={false} enterKeyHint="search" />
      <button type="button" onClick={() => (value ? onChange('') : onClose())} aria-label={value ? 'Clear' : 'Close search'}><X size={17} /></button>
    </label>
  );
}

/** Paged feed loader: `/feed/<x>?page=N` with has_more. */
function usePaged(url, enabled = true) {
  const [items, setItems] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(null);
  const load = useCallback(async (p, append) => {
    if (append) setMore(true); else setLoading(true);
    setError(null);
    try {
      const d = await api(`${url}${url.includes('?') ? '&' : '?'}page=${p}`);
      setItems((prev) => (append && prev ? [...prev, ...d.items.filter((x) => !prev.some((y) => y.id === x.id))] : d.items));
      setHasMore(!!d.has_more);
      setPage(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setMore(false);
    }
  }, [url]);
  useEffect(() => {
    if (!enabled) return;
    setItems(null);
    load(0, false);
  }, [load, enabled]);
  return { items, loading, more, error, hasMore, reload: () => load(0, false), next: () => load(page + 1, true) };
}

function SaveShareActions(item, saved, toggleSaved) {
  const on = !!saved[item.id];
  return [
    { label: on ? 'Remove from Saved' : 'Save for later', Icon: on ? BookmarkCheck : Bookmark, onClick: () => toggleSaved(item) },
    { label: 'Share', Icon: Share2, onClick: () => share({ title: item.title, url: item.url }) },
  ];
}

// ── The Wire ─────────────────────────────────────────────────────────────────

const LISTS = [
  { key: 'top', label: 'Top', Icon: TrendingUp },
  { key: 'best', label: 'Best', Icon: Star },
  { key: 'new', label: 'New', Icon: Sparkles },
  { key: 'ask', label: 'Ask', Icon: HelpCircle },
  { key: 'show', label: 'Show', Icon: Rocket },
  { key: 'job', label: 'Jobs', Icon: Briefcase },
];
const RANGES = [['all', 'Any time'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']];

function heatOf(item) {
  if (!item.score || !item.published_at) return 0;
  const hours = Math.max(1, (Date.now() / 1000 - item.published_at) / 3600);
  return Math.min(1, item.score / hours / 60);
}

const linkOut = (it) => it.url && !it.url.includes('news.ycombinator.com/item');

function WireLine({ item, rank, seen, fresh, onDiscuss, onMenu }) {
  const { kind, rest } = splitKind(item.title);
  const heat = heatOf(item);
  const lp = useLongPress(() => onMenu(item));
  const tap = () => (linkOut(item) ? openExternal(item.url) : onDiscuss(item));
  return (
    <div className={`${r.wire} ${seen ? r.isRead : ''}`} data-reveal>
      <button type="button" className={r.wireHit} onClick={tap} {...lp}>
        <span className={r.rank}>{rank}</span>
        <span className={r.wireText}>
          <b>{kind && <em className={r.kind}>{kind}</em>}{rest}</b>
          <span className={r.meta}>
            {item.extra?.domain && <span className={r.domain}>{item.extra.domain}</span>}
            <span className={r.points}>{heat > 0.6 && <Flame size={11} />}▲ {compact(item.score) ?? 0}</span>
            {item.published_at ? <span>{timeAgo(item.published_at)}</span> : null}
          </span>
          <span className={r.gauge} aria-hidden="true"><i style={{ width: `${Math.max(4, heat * 100)}%` }} /></span>
        </span>
      </button>
      <button type="button" className={r.cmts} onClick={() => onDiscuss(item)} aria-label={`${item.comments_count ?? 0} comments`}>
        <MessageSquare size={16} />
        <span>{compact(item.comments_count) ?? 0}</span>
        {fresh > 0 && <em key={fresh}>+{compact(fresh)}</em>}
      </button>
    </div>
  );
}

function Wire({ search, onDiscuss, onMenu, registerRefresh }) {
  const { settings, updateSettings } = useSettings();
  const [list, setList] = useParamState('l', settings?.hn_list || 'top');
  const [q, setQ] = useParamState('q', '');
  const [by, setBy] = useParamState('by', 'relevance');
  const [range, setRange] = useParamState('t', 'all');
  const dq = useDebounced((search ?? '').trim(), 400);
  useEffect(() => { if (search != null && dq !== q) setQ(dq); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (search == null && q) setQ(''); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const searching = search != null && q.length >= 2;
  const { seen, newSince } = useWireSeen();
  const feed = usePaged(`/feed/hackernews?list=${list}`, !searching);
  const found = useApi(
    `/hackernews/search?q=${encodeURIComponent(q)}${by === 'date' ? '&sort=date' : ''}${range !== 'all' ? `&range=${range}` : ''}`,
    searching,
  );
  registerRefresh(async () => {
    try { await api('/refresh?scope=hackernews', { method: 'POST' }); } catch { /* best-effort */ }
    return searching ? found.reload() : feed.reload();
  });
  const shown = searching ? found.data?.items : feed.items;
  const loading = searching ? found.loading && !found.data : feed.loading && !feed.items;
  const error = searching ? found.error : feed.error;

  return (
    <>
      {search == null ? (
        <Chips items={LISTS} value={list} onChange={(k) => { setList(k); updateSettings({ hn_list: k }); }} className={r.chips} />
      ) : (
        <div className={r.filters}>
          <Chips items={[{ key: 'relevance', label: 'Best match' }, { key: 'date', label: 'Newest', Icon: Clock }]} value={by} onChange={setBy} />
          <Chips items={RANGES.map(([key, label]) => ({ key, label }))} value={range} onChange={setRange} />
        </div>
      )}
      {error && <ErrorNote message={error} onRetry={searching ? found.reload : feed.reload} />}
      {loading && <Skeleton kind="lines" n={7} />}
      {search != null && !searching && <Empty Icon={Search} title="Search every story on HN" text="Type two letters or more. Order by best match or newest, and narrow it to a time window." />}
      {shown && !shown.length && !loading && <Empty Icon={Inbox} title="Nothing on the wire" text={searching ? 'No story matches that.' : 'The wire is quiet.'} />}
      {shown?.map((it, i) => (
        <WireLine key={it.id} item={it} rank={i + 1} seen={!!seen[it.extra?.hn_id]} fresh={newSince(it)} onDiscuss={onDiscuss} onMenu={onMenu} />
      ))}
      {!searching && <Sentinel onReach={feed.next} active={!!feed.items && feed.hasMore && !feed.more} />}
      {feed.more && <Loading label="feeding paper" />}
    </>
  );
}

// ── The Dispatch ─────────────────────────────────────────────────────────────

function Letter({ item, onOpen, onMenu }) {
  const x = item.extra || {};
  const lp = useLongPress(() => onMenu(item));
  return (
    <article className={r.letter} data-reveal>
      <button type="button" className={r.letterHit} onClick={() => onOpen(item)} {...lp}>
        <span className={r.letterTop}>
          <b className={r.sub}>{item.source}</b>
          <span>{item.author && `u/${item.author} · `}{ago(item.published_at)}</span>
        </span>
        <span className={r.letterMain}>
          <span className={r.letterWords}>
            <strong>{item.title}</strong>
            {x.selftext_preview && <span className={r.excerpt}>{x.selftext_preview}</span>}
            {x.link_url && <span className={r.linkOut}><ArrowUpRight size={12} /> {x.link_url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</span>}
          </span>
          {item.thumbnail && <img className={r.letterPic} src={item.thumbnail} alt="" loading="lazy" />}
        </span>
      </button>
      <div className={r.letterFoot}>
        {item.score != null && <span><TrendingUp size={14} /> {compact(item.score)}</span>}
        <button type="button" onClick={() => onOpen(item)}><MessageSquare size={14} /> {compact(item.comments_count ?? 0)}</button>
        <button type="button" className={r.letterMore} onClick={() => onMenu(item)} aria-label="More">⋯</button>
      </div>
    </article>
  );
}

function FaceRow({ subs, onAdd, onPick, current, label = 'Add' }) {
  return (
    <div className={r.faces}>
      {subs.map((s) => (
        <button key={s.id} type="button" className={`${r.face} ${current === s.source_id ? r.faceOn : ''}`} onClick={() => onPick(s)} data-reveal="pop">
          <Avatar src={s.thumbnail} name={s.display_name} imgClass={r.faceImg} letterClass={r.faceLetter} />
          <span>{s.display_name.replace(/^r\//, '')}</span>
        </button>
      ))}
      {onAdd && (
        <button type="button" className={r.face} onClick={onAdd} data-reveal="pop">
          <span className={`${r.faceLetter} ${r.faceAdd}`}><Plus size={20} /></span>
          <span>{label}</span>
        </button>
      )}
    </div>
  );
}

const SORTS = [{ key: 'hot', label: 'Hot', Icon: Flame }, { key: 'new', label: 'New', Icon: Sparkles }, { key: 'top', label: 'Top', Icon: TrendingUp }];

function Dispatch({ search, onOpen, onMenu, registerRefresh, onAdd }) {
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();
  const { subs } = useSubscriptions();
  const sort = settings?.reddit_sort || 'hot';
  const [source, setSource] = useParamState('src', 'curated');
  const oauth = useApi('/oauth/status');
  const connected = !!oauth.data?.reddit?.connected;
  const hasSubs = subs.reddit.length > 0;
  const enabled = source === 'account' || hasSubs;
  const dq = useDebounced((search ?? '').trim(), 450);
  const searching = search != null && dq.length >= 2;
  const feed = useApi(`/feed/reddit?sort=${sort}&source=${source}`, enabled && !searching);
  const found = useApi(`/reddit/search?q=${encodeURIComponent(dq)}`, searching);
  const active = searching ? found : feed;
  registerRefresh(async () => {
    try { await api('/refresh?scope=reddit', { method: 'POST' }); } catch { /* best-effort */ }
    return active.reload();
  });
  return (
    <>
      {search == null && (
        <>
          {hasSubs && <FaceRow subs={subs.reddit} onAdd={onAdd} onPick={(s) => navigate(`/reddit/r/${s.source_id}`)} />}
          <div className={r.filters}>
            <Chips items={SORTS} value={sort} onChange={(v) => updateSettings({ reddit_sort: v })} />
            {connected && <Chips items={[{ key: 'curated', label: 'Your subreddits' }, { key: 'account', label: 'Home feed' }]} value={source} onChange={setSource} />}
          </div>
        </>
      )}
      {!enabled && !searching && search == null && (
        <Empty
          Icon={Inbox}
          title="No letters yet"
          text="Subscribe to the forums you care about and their posts are set here."
          action={<button type="button" className={r.cta} onClick={onAdd}><Plus size={16} /> Add a subreddit</button>}
        />
      )}
      {search != null && !searching && <Empty Icon={Search} title="Search all of Reddit" text="Type two letters or more." />}
      {active.error && <ErrorNote message={active.error} onRetry={active.reload} />}
      {(enabled || searching) && active.loading && !active.data && <Skeleton kind="lines" n={5} />}
      {active.data?.items.map((it) => <Letter key={it.id} item={it} onOpen={onOpen} onMenu={onMenu} />)}
      {searching && active.data && !active.data.items.length && <Empty Icon={Search} title="Nothing found" text={`Reddit returned nothing for “${dq}”.`} />}
    </>
  );
}

// ── GitHub ───────────────────────────────────────────────────────────────────

function RepoLine({ item, onOpen, onMenu }) {
  const x = item.extra || {};
  const lp = useLongPress(() => onMenu(item));
  const inApp = x.type === 'repo' || x.type === 'release';
  const Icon = x.type === 'repo' ? Star : x.type === 'release' ? GitFork : ListTree;
  return (
    <button type="button" className={r.repo} onClick={() => (inApp ? onOpen(item) : openExternal(item.url))} {...lp} data-reveal>
      <span className={r.repoIcon}><Icon size={16} /></span>
      <span className={r.repoText}>
        <b>{item.title}</b>
        <span className={r.meta}>
          {item.source && <span className={r.domain}>{item.source}</span>}
          {item.author && <span>{item.author}</span>}
          {item.published_at ? <span>{timeAgo(item.published_at)}</span> : null}
        </span>
        {x.type === 'repo' && x.description && <span className={r.excerpt}>{x.description}</span>}
        <span className={r.tags}>
          {x.language && <em>{x.language}</em>}
          {x.stars != null && <span><Star size={11} /> {compact(x.stars)}</span>}
          {x.forks != null && <span><GitFork size={11} /> {compact(x.forks)}</span>}
          {x.type === 'release' && x.tag && <em>{x.tag}</em>}
          {x.prerelease && <em className={r.pre}>pre-release</em>}
          {x.type === 'event' && x.event_type && <em>{x.event_type}</em>}
          {x.type === 'repo' && x.topics?.slice(0, 2).map((t) => <span key={t} className={r.topic}>{t}</span>)}
        </span>
      </span>
      {!inApp && <ExternalLink size={15} className={r.repoOut} />}
    </button>
  );
}

function Github({ search, onOpen, onMenu, registerRefresh, onAdd }) {
  const { subs, refreshSubs } = useSubscriptions();
  const toast = useToast();
  const [view, setView] = useParamState('gv', 'trending');
  const [period, setPeriod] = useParamState('p', 'daily');
  const [manage, setManage] = useState(false);
  const dq = useDebounced((search ?? '').trim(), 450);
  const searching = search != null && dq.length >= 2;
  const trending = useApi(`/github/trending?period=${period}`, !searching && view === 'trending');
  const feed = usePaged('/feed/github', !searching && view === 'yours' && subs.github.length > 0);
  const found = useApi(`/github/search?q=${encodeURIComponent(dq)}`, searching);
  registerRefresh(async () => {
    try { await api('/refresh?scope=github', { method: 'POST' }); } catch { /* best-effort */ }
    return searching ? found.reload() : view === 'trending' ? trending.reload() : feed.reload();
  });
  const remove = async (row) => {
    try {
      await api(`/subscriptions/${row.id}`, { method: 'DELETE' });
      toast(`Removed ${row.display_name}`, 'success');
      refreshSubs();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const openSub = (s) => (s.source_id.includes('/') ? onOpen({ id: `gh:${s.source_id}`, platform: 'github', title: s.display_name, source: s.source_id, extra: { repo: s.source_id } }) : openExternal(`https://github.com/${s.source_id}`));

  const list = searching ? found : view === 'trending' ? trending : null;
  const items = list ? list.data?.items : feed.items;
  return (
    <>
      {search == null && (
        <>
          <FaceRow subs={subs.github} onAdd={onAdd} onPick={openSub} label="Follow" />
          <div className={r.filters}>
            <Chips
              items={[{ key: 'trending', label: 'Trending', Icon: TrendingUp }, { key: 'yours', label: 'Your repos', Icon: ListTree, count: subs.github.length }]}
              value={view}
              onChange={setView}
            />
            {view === 'trending' && (
              <Chips items={[{ key: 'daily', label: 'Today' }, { key: 'weekly', label: 'This week' }, { key: 'monthly', label: 'This month' }]} value={period} onChange={setPeriod} />
            )}
          </div>
        </>
      )}
      {search != null && !searching && <Empty Icon={Search} title="Search GitHub" text="Repositories by name, topic or description." />}
      {view === 'yours' && !searching && search == null && (
        subs.github.length ? (
          <button type="button" className={r.manage} onClick={() => setManage(true)}><ListTree size={15} /> Manage {subs.github.length} followed</button>
        ) : (
          <Empty Icon={ListTree} title="Nothing followed" text="Follow repos or users to see their releases and activity here." action={<button type="button" className={r.cta} onClick={onAdd}><Plus size={16} /> Follow a repo or user</button>} />
        )
      )}
      {(list ? list.error : feed.error) && <ErrorNote message={list ? list.error : feed.error} />}
      {(list ? list.loading && !list.data : feed.loading && !feed.items && subs.github.length > 0) && <Skeleton kind="lines" n={6} />}
      {items?.map((it) => <RepoLine key={it.id} item={it} onOpen={onOpen} onMenu={onMenu} />)}
      {items && !items.length && searching && <Empty Icon={Search} title="No results" />}
      {!list && <Sentinel onReach={feed.next} active={!!feed.items && feed.hasMore && !feed.more} />}
      <Sheet open={manage} onClose={() => setManage(false)} title="Followed on GitHub">
        <div className={r.manageList}>
          {subs.github.map((row) => (
            <div key={row.id}>
              <Avatar src={row.thumbnail} name={row.display_name} imgClass={r.faceImg} letterClass={r.faceLetter} />
              <span>{row.display_name}</span>
              <button type="button" onClick={() => remove(row)} aria-label={`Unfollow ${row.display_name}`}><Trash2 size={18} /></button>
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}

// ── the screen ───────────────────────────────────────────────────────────────

// Switching rooms changes the route (and remounts the page), so the switch
// remembers where its pill was and glides it over from there.
let lastRoomIdx = null;

function RoomSwitch({ rooms, cur, onPick }) {
  const idx = Math.max(0, rooms.findIndex((x) => x.key === cur.key));
  const [shown, setShown] = useState(lastRoomIdx ?? idx);
  useEffect(() => {
    lastRoomIdx = idx;
    const f = requestAnimationFrame(() => setShown(idx));
    return () => cancelAnimationFrame(f);
  }, [idx]);
  return (
    <div className={r.rooms} role="tablist" style={{ '--rn': rooms.length, '--ri': shown, '--pc': rooms[shown]?.c || cur.c }}>
      <span className={r.roomPill} aria-hidden="true" />
      {rooms.map((x) => (
        <button key={x.key} type="button" role="tab" aria-selected={x.key === cur.key} className={x.key === cur.key ? r.roomOn : ''} onClick={() => onPick(x)}>
          {x.label}
        </button>
      ))}
    </div>
  );
}

function useItemMenu() {
  const { saved, toggleSaved } = useSaved();
  const [menu, setMenu] = useState(null);
  return [menu, setMenu, saved, toggleSaved];
}

export default function Read({ room = 'wire' }) {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const active = settings?.active_rooms || DEFAULT_ACTIVE_ROOMS;
  const rooms = ROOMS.filter((x) => active.includes(x.id) || x.key === room);
  const cur = ROOMS.find((x) => x.key === room) || ROOMS[0];
  const [q] = useParamState('q', '');
  const [search, setSearch] = useState(q ? q : null);
  const [hn, setHn] = useState(null);
  const [post, setPost] = useState(null);
  const [repo, setRepo] = useState(null);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu, saved, toggleSaved] = useItemMenu();
  // the room on screen hands up its refresh as it renders; pull-to-refresh calls it
  const refresher = useRef(null);
  const registerRefresh = useCallback((f) => { refresher.current = f; }, []);
  const pull = usePullToRefresh(async () => { await refresher.current?.(); });
  const lastRoom = useRef(room);
  useEffect(() => {
    if (lastRoom.current !== room) { lastRoom.current = room; setSearch(null); }
  }, [room]);

  const menuActions = useMemo(() => {
    if (!menu) return [];
    if (menu.platform === 'hackernews') {
      return [
        linkOut(menu) && { label: 'Read the article', Icon: ExternalLink, hint: menu.extra?.domain, onClick: () => openExternal(menu.url) },
        { label: 'Discussion', Icon: MessageSquare, onClick: () => setHn(menu) },
        ...SaveShareActions(menu, saved, toggleSaved),
        { label: 'Open on Hacker News', Icon: ExternalLink, onClick: () => openExternal(`https://news.ycombinator.com/item?id=${menu.extra?.hn_id}`) },
      ];
    }
    if (menu.platform === 'reddit') {
      return [
        { label: 'Read the post', Icon: MessageSquare, onClick: () => setPost(menu) },
        menu.extra?.link_url && { label: 'Open the link', Icon: ArrowUpRight, onClick: () => openExternal(menu.extra.link_url) },
        { label: `Go to ${menu.source}`, Icon: Inbox, onClick: () => navigate(`/reddit/r/${(menu.extra?.subreddit || menu.source || '').replace(/^r\//, '')}`) },
        ...SaveShareActions(menu, saved, toggleSaved),
        { label: 'Open on Reddit', Icon: ExternalLink, onClick: () => openExternal(menu.url) },
      ];
    }
    return [
      { label: 'Details', Icon: Star, onClick: () => setRepo(menu) },
      ...SaveShareActions(menu, saved, toggleSaved),
      { label: 'Open on GitHub', Icon: ExternalLink, onClick: () => openExternal(menu.url) },
    ];
  }, [menu, saved, toggleSaved, navigate]);

  const placeholder = { wire: 'Search every story on HN…', dispatch: 'Search all of Reddit…', github: 'Search GitHub repositories…' }[cur.key];
  const common = { search, onMenu: setMenu, registerRefresh };

  return (
    <div className={r.screen} style={{ '--c': cur.c }}>
      <AppBar
        title={search != null ? <BarSearch value={search} onChange={setSearch} placeholder={placeholder} onClose={() => { setSearch(null); }} /> : 'Read'}
        sub={search != null ? null : cur.label}
        tone={cur.c}
        actions={search == null && (
          <>
            <IconBtn label="Search" onClick={() => setSearch('')}><Search size={21} /></IconBtn>
            {cur.key !== 'wire' && <IconBtn label={cur.key === 'github' ? 'Follow a repo or user' : 'Add a subreddit'} onClick={() => setAdding(true)}><Plus size={22} /></IconBtn>}
          </>
        )}
      >
        {search == null && rooms.length > 1 && (
          <RoomSwitch rooms={rooms} cur={cur} onPick={(x) => navigate(x.path, { replace: true })} />
        )}
      </AppBar>
      {pull}

      {cur.key === 'wire' && <Wire {...common} onDiscuss={setHn} />}
      {cur.key === 'dispatch' && <Dispatch {...common} onOpen={setPost} onAdd={() => setAdding(true)} />}
      {cur.key === 'github' && <Github {...common} onOpen={setRepo} onAdd={() => setAdding(true)} />}

      <ActionSheet open={!!menu} onClose={() => setMenu(null)} title={menu?.title} actions={menuActions} />
      {hn && <HNPage item={hn} onClose={() => setHn(null)} />}
      {post && <RedditPage item={post} onClose={() => setPost(null)} />}
      {repo && <RepoPage item={repo} onClose={() => setRepo(null)} />}
      <AddSubscriptionModal open={adding} onClose={() => setAdding(false)} initialPlatform={cur.key === 'github' ? 'github' : 'reddit'} />
    </div>
  );
}

/** One subreddit, on its own page. */
export function Subreddit() {
  const { sub } = useParams();
  const { subs } = useSubscriptions();
  const row = subs.reddit.find((x) => x.source_id === sub);
  const { settings, updateSettings } = useSettings();
  const sort = settings?.reddit_sort || 'hot';
  const [search, setSearch] = useState(null);
  const [post, setPost] = useState(null);
  const [menu, setMenu, saved, toggleSaved] = useItemMenu();
  const dq = useDebounced((search ?? '').trim(), 450);
  const searching = search != null && dq.length >= 2;
  const feed = useApi(`/feed/reddit?sort=${sort}&subs=${sub}`, !searching);
  const found = useApi(`/reddit/search?q=${encodeURIComponent(dq)}&sub=${sub}`, searching);
  const active = searching ? found : feed;
  const pull = usePullToRefresh(async () => { await active.reload(); });
  const name = row?.display_name || `r/${sub}`;

  return (
    <div className={r.screen} style={{ '--c': 'var(--c-reddit)' }}>
      <AppBar
        title={search != null ? <BarSearch value={search} onChange={setSearch} placeholder={`Search ${name}…`} onClose={() => setSearch(null)} /> : name}
        sub={search != null ? null : row ? 'your subreddit' : 'subreddit'}
        back={search == null}
        backTo="/reddit"
        tone="var(--c-reddit)"
        actions={search == null && (
          <>
            <IconBtn label="Search" onClick={() => setSearch('')}><Search size={21} /></IconBtn>
            <IconBtn label="Share" onClick={() => share({ title: name, url: `https://www.reddit.com/r/${sub}` })}><Share2 size={20} /></IconBtn>
          </>
        )}
      >
        {search == null && <Chips items={SORTS} value={sort} onChange={(v) => updateSettings({ reddit_sort: v })} />}
      </AppBar>
      {pull}
      {active.error && <ErrorNote message={active.error} onRetry={active.reload} />}
      {active.loading && !active.data && <Skeleton kind="lines" n={6} />}
      {active.data?.items.map((it) => <Letter key={it.id} item={it} onOpen={setPost} onMenu={setMenu} />)}
      {active.data && !active.data.items.length && <Empty Icon={Inbox} title="Nothing here" text={searching ? `No posts in ${name} match “${dq}”.` : 'This subreddit is quiet.'} />}
      <ActionSheet
        open={!!menu}
        onClose={() => setMenu(null)}
        title={menu?.title}
        actions={menu ? [
          { label: 'Read the post', Icon: MessageSquare, onClick: () => setPost(menu) },
          menu.extra?.link_url && { label: 'Open the link', Icon: ArrowUpRight, onClick: () => openExternal(menu.extra.link_url) },
          ...SaveShareActions(menu, saved, toggleSaved),
          { label: 'Open on Reddit', Icon: ExternalLink, onClick: () => openExternal(menu.url) },
        ] : []}
      />
      {post && <RedditPage item={post} onClose={() => setPost(null)} />}
    </div>
  );
}
