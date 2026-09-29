// The forum, as a reading room: the list of threads down the left, the open
// thread beside it — the list stays put while you read, so moving from one
// conversation to the next is one click, not a modal and a close button.
//
// Everything that shapes the view lives in the URL (category, sort, spoiler
// filter, search, title, the open thread), so Back and reloads land where you
// were. Threads remember when you last read them, and say so: a dot for new
// replies since, a quieter title for ones you've caught up on.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BellRing, CalendarClock, Eye, Layers, Lock, Megaphone, MessageCircle, MessageSquare, MessagesSquare,
  PenLine, Pin, Search, Sparkles, Tv, Users, X,
} from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { compact } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import { useToast } from '../../state.jsx';
import { ErrorBox, Receiving, useDebounced } from '../layout/Section.jsx';
import { MarkdownComposer } from './Composer.jsx';
import { PersonAvatar } from './Person.jsx';
import { InfiniteSentinel, latestParams, useInfinite, useParamState } from './shared.jsx';
import { ThreadView } from './Thread.jsx';
import f from './forum.module.css';

// Curated top-level categories mapped to real AniList forum category ids.
// `media` = can narrow to one anime; `spoiler` = the spoiler filter applies.
export const CATEGORIES = [
  { key: 'all', cat: null, label: 'All', desc: 'Every thread on AniList, most recently active first.', Icon: Layers },
  { key: 'anime', cat: 1, label: 'Anime', desc: 'Open anime discussion — narrow it to one title.', Icon: Tv, media: true, spoiler: true },
  { key: 'releases', cat: 5, label: 'Releases', desc: 'Episode-by-episode talk as the season airs.', Icon: CalendarClock, spoiler: true },
  { key: 'recs', cat: 15, label: 'Recommendations', desc: 'Ask for, and hand out, what to watch next.', Icon: Sparkles },
  { key: 'meetups', cat: 16, label: 'Games & meetups', desc: 'Community games, watch-alongs and meetups.', Icon: Users },
  { key: 'general', cat: 7, label: 'General', desc: 'Off-topic and everything else.', Icon: MessageCircle },
  { key: 'anilist', cat: 13, label: 'AniList', desc: "AniList's own announcements.", Icon: Megaphone },
  { key: 'following', cat: null, subscribed: true, label: 'Following', desc: 'Threads you follow — their new replies also land in your inbox.', Icon: BellRing },
];
const SORTS = [['active', 'Latest activity'], ['new', 'Newest'], ['replies', 'Most replies'], ['views', 'Most viewed']];
const SPOILERS = [['all', 'All'], ['safe', 'No spoilers'], ['only', 'Spoilers only']];

// ── read receipts (this browser only; a convenience) ──────────────────────────

const SEEN_KEY = 'tubcal.anime.forum.seen';
function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { return {}; }
}
function markSeen(id, at) {
  try {
    const seen = loadSeen();
    seen[id] = Math.max(at || 0, Math.floor(Date.now() / 1000));
    const keys = Object.keys(seen);
    if (keys.length > 400) keys.sort((a, b) => seen[a] - seen[b]).slice(0, keys.length - 400).forEach((k) => delete seen[k]);
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch { /* private mode */ }
}

// ── a row in the list ─────────────────────────────────────────────────────────

function ThreadRow({ th, open, seenAt, onOpen }) {
  const tags = (th.categories || []).filter((x) => x.id !== 1).slice(0, 2);
  const fresh = seenAt && th.replied_at && th.replied_at > seenAt;
  const read = seenAt && !fresh;
  const last = th.reply_user && th.replied_at;
  return (
    <Link
      to={`/anime/thread/${th.id}`}
      className={`${f.row} ${open ? f.rowOpen : ''} ${read ? f.rowRead : ''}`}
      aria-current={open ? 'true' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab = the full page
        e.preventDefault();
        onOpen(th);
      }}
    >
      <span className={f.rowMain}>
        <span className={f.rowTitle}>
          {fresh && <i className={f.newDot} title="New replies since you last read it" />}
          {th.sticky && <Pin size={12} className={f.pin} aria-label="pinned" />}
          {th.locked && <Lock size={12} className={f.lock} aria-label="locked" />}
          <span>{th.title}</span>
        </span>
        {th.snippet && <span className={f.rowSnippet}>{th.snippet}</span>}
        <span className={f.rowMeta}>
          <span className={f.stack}>
            <PersonAvatar user={th.user} size="xs" />
            {last && th.reply_user.id !== th.user?.id && <PersonAvatar user={th.reply_user} size="xs" />}
          </span>
          <span className={f.rowWho}>
            {last
              ? <><b>{th.reply_user.name}</b> replied {timeAgo(th.replied_at)}</>
              : <><b>{th.user?.name}</b> posted {timeAgo(th.created_at)}</>}
          </span>
          {th.spoiler && <span className={f.spoil}>spoilers</span>}
          {tags.map((x) => <span key={x.id} className={f.tag}>{x.name}</span>)}
        </span>
      </span>
      <span className={f.rowSide}>
        {th.media?.cover
          ? <img className={f.cover} src={th.media.cover} alt="" loading="lazy" title={th.media.title} />
          : null}
        <span className={f.count} title={`${th.replies || 0} replies · ${th.views || 0} views`}>
          <b>{compact(th.replies || 0)}</b>
          <MessageSquare size={11} />
        </span>
      </span>
    </Link>
  );
}

// ── pick a title (the Anime category's sub-category) ─────────────────────────

function MediaPicker({ onPick, placeholder = 'narrow to a title…' }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const res = useApi(`/anime/search?q=${encodeURIComponent(dq)}`, dq.trim().length > 1);
  const items = (res.data?.items || []).slice(0, 6);
  return (
    <div className={f.picker}>
      <Tv size={13} />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Filter by title" />
      {dq.trim().length > 1 && items.length > 0 && (
        <div className={f.pickerMenu}>
          {items.map((m) => (
            <button key={m.id} type="button" className={f.pickerItem}
                    onMouseDown={(e) => { e.preventDefault(); onPick({ id: m.id, title: m.title, cover: m.cover }); setQ(''); }}>
              {m.cover && <img src={m.cover} alt="" />}
              <span>{m.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MediaChip({ id, onClear, label = 'about' }) {
  const card = useApi(`/anime/media_card/${id}`, !!id);
  const m = card.data;
  return (
    <span className={f.mediaChip}>
      {m?.cover && <img src={m.cover} alt="" />}
      <span>{label} <b>{m?.title || `#${id}`}</b></span>
      {onClear && <button type="button" onClick={onClear} aria-label="Clear title"><X size={12} /></button>}
    </span>
  );
}

// ── start a thread ────────────────────────────────────────────────────────────

export function NewThread({ presetMedia, presetCat, onPosted, onCancel }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState(presetCat || (presetMedia ? 1 : 7));
  const [mediaId, setMediaId] = useState(presetMedia || null);
  const post = async (body) => {
    try {
      const d = await api('/anime/thread', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), body, categories: [cat], media_ids: mediaId ? [mediaId] : [] }),
      });
      toast('Thread posted to AniList', 'success');
      setTitle('');
      onPosted?.(d?.id);
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  return (
    <section className={f.newThread} aria-label="Start a thread">
      <header className={f.newHead}>
        <PenLine size={16} />
        <h2>Start a thread</h2>
        {onCancel && <button type="button" className={f.newClose} onClick={onCancel} aria-label="Close"><X size={16} /></button>}
      </header>
      <input
        className={f.newTitle}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="A title that says what it's about"
        maxLength={200}
        autoFocus
      />
      <div className={f.newRow}>
        <label className={f.selectWrap}>
          <span>in</span>
          <select value={cat} onChange={(e) => setCat(Number(e.target.value))} aria-label="Category">
            {CATEGORIES.filter((x) => x.cat && x.cat !== 13).map((x) => <option key={x.key} value={x.cat}>{x.label}</option>)}
          </select>
        </label>
        {mediaId
          ? <MediaChip id={mediaId} onClear={() => setMediaId(null)} />
          : <MediaPicker onPick={(m) => setMediaId(m.id)} placeholder="about a title? (optional)" />}
      </div>
      <MarkdownComposer
        previewAs="thread"
        title={title}
        submitLabel="Post thread"
        placeholder="What's on your mind? ~!Spoilers!~ stay veiled until clicked."
        draftKey="newthread"
        rows={8}
        canSubmit={title.trim().length >= 3}
        onSubmit={post}
        onCancel={onCancel}
      />
    </section>
  );
}

// ── the forum ─────────────────────────────────────────────────────────────────

function ReaderIdle({ cat, connected, onWrite }) {
  return (
    <div className={f.idle}>
      <MessagesSquare size={34} />
      <h3>{cat.label === 'All' ? 'The forum' : cat.label}</h3>
      <p>{cat.desc}</p>
      <p className={f.idleHint}>Pick a thread — it opens here and the list stays where it is.</p>
      {connected && (
        <button type="button" className={f.writeBtn} onClick={onWrite}><PenLine size={14} /> Start a thread</button>
      )}
    </div>
  );
}

export function Forum() {
  const me = useApi('/anime/me');
  const connected = !!me.data;
  const [params, setParams] = useSearchParams();
  const [catKey] = useParamState('fc', 'all');
  const [sort, setSort] = useParamState('fs', 'active');
  const [spoiler, setSpoiler] = useParamState('sp', 'all');
  const [mediaId, setMediaId] = useParamState('fm', '');
  const [urlQ, setUrlQ] = useParamState('fq', '');
  const [q, setQ] = useState(urlQ);
  const dq = useDebounced(q);
  useEffect(() => { if (dq !== urlQ) setUrlQ(dq); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  const openId = params.get('t') || '';
  const writing = params.get('new') === '1';
  // Opening a thread is a destination (Back closes it), so it pushes; filters replace.
  const setParam = useCallback((mut, push = true) => {
    setParams(() => { const p = latestParams(); mut(p); return p; }, { replace: !push });
  }, [setParams]);
  const [seen, setSeen] = useState(loadSeen);

  const cat = CATEGORIES.find((x) => x.key === catKey) || CATEGORIES[0];
  const qs = new URLSearchParams();
  if (cat.subscribed) qs.set('subscribed', '1');
  if (cat.cat) qs.set('category', cat.cat);
  if (cat.media && mediaId) qs.set('media_id', mediaId);
  if (cat.spoiler && spoiler !== 'all') qs.set('spoiler', spoiler);
  if (dq.trim()) qs.set('q', dq.trim());
  if (sort !== 'active') qs.set('sort', sort);
  const signature = qs.toString();
  const list = useInfinite(signature, (page) => `/anime/threads?${signature}${signature ? '&' : ''}page=${page}`,
    { enabled: !(cat.subscribed && !connected) });

  const open = (th) => {
    markSeen(th.id, th.replied_at);
    setSeen(loadSeen());
    setParam((p) => { p.set('t', th.id); p.delete('new'); });
  };
  const close = () => setParam((p) => { p.delete('t'); p.delete('new'); });
  const write = () => setParam((p) => { p.set('new', '1'); p.delete('t'); });

  // Keep the open thread's receipt fresh while you're reading it.
  useEffect(() => {
    if (!openId || !list.items) return;
    const th = list.items.find((x) => String(x.id) === openId);
    if (th) markSeen(th.id, th.replied_at);
  }, [openId, list.items]);

  // Category, and a clean slate for its title/spoiler filters, in one URL write.
  const pick = (key) => setParam((p) => {
    if (key === 'all') p.delete('fc'); else p.set('fc', key);
    p.delete('fm');
    p.delete('sp');
  }, false);
  const detail = openId || writing;

  return (
    <div className={f.forum}>
      <div className={f.bar}>
        <nav className={f.cats} aria-label="Forum categories">
          {CATEGORIES.filter((x) => !x.subscribed || connected).map((x) => (
            <button key={x.key} type="button" className={`${f.cat} ${x.key === cat.key ? f.catOn : ''}`}
                    onClick={() => pick(x.key)} aria-pressed={x.key === cat.key} title={x.desc}>
              <x.Icon size={13} /> {x.label}
            </button>
          ))}
        </nav>
      </div>

      <div className={f.filters}>
        <label className={f.search}>
          <Search size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search threads…" aria-label="Search threads" />
          {q && <button type="button" onClick={() => setQ('')} aria-label="Clear search"><X size={12} /></button>}
        </label>
        <label className={f.selectWrap}>
          <span>sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort threads">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {cat.spoiler && (
          <div className={f.seg} role="group" aria-label="Spoilers">
            {SPOILERS.map(([v, l]) => (
              <button key={v} type="button" className={spoiler === v ? f.segOn : ''} onClick={() => setSpoiler(v)} aria-pressed={spoiler === v}>
                {l}
              </button>
            ))}
          </div>
        )}
        {cat.media && (mediaId
          ? <MediaChip id={mediaId} onClear={() => setMediaId('')} label="only" />
          : <MediaPicker onPick={(m) => setMediaId(String(m.id))} />)}
      </div>

      <div className={`${f.split} ${detail ? f.splitDetail : ''}`}>
        <div className={f.list}>
          {list.loading && !list.items && <Receiving label="opening the forum" />}
          {list.error && <ErrorBox message={list.error} />}
          {cat.subscribed && !connected && <p className={f.muted}>Connect AniList to see the threads you follow.</p>}
          {list.items && !list.items.length && !list.error && (
            <p className={f.muted}>{dq ? `No threads match “${dq}”.` : 'Nothing here yet.'}</p>
          )}
          {(list.items || []).map((th) => (
            <ThreadRow key={th.id} th={th} open={String(th.id) === openId} seenAt={seen[th.id]} onOpen={open} />
          ))}
          <InfiniteSentinel onReach={list.loadMore} active={list.hasMore} count={list.items?.length || 0} />
          {list.loadingMore && <p className={f.muted}>more threads…</p>}
        </div>
        <div className={f.reader}>
          {writing ? (
            <div className={f.readerCard}>
              <NewThread
                presetMedia={cat.media && mediaId ? Number(mediaId) : null}
                presetCat={cat.cat && cat.cat !== 13 ? cat.cat : null}
                onCancel={close}
                onPosted={(id) => { if (id) setParam((p) => { p.set('t', id); p.delete('new'); }, false); }}
              />
            </div>
          ) : openId ? (
            <ThreadView key={openId} threadId={Number(openId)} variant="pane" onClose={close} />
          ) : (
            <ReaderIdle cat={cat} connected={connected} onWrite={write} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── one title's threads (the detail page's Discussion block) ─────────────────

export function MediaThreads({ mediaId }) {
  const navigate = useNavigate();
  const me = useApi('/anime/me');
  const list = useInfinite(`m${mediaId}`, (page) => `/anime/threads?media_id=${mediaId}&page=${page}`);
  const seen = useMemo(loadSeen, []);
  const items = list.items || [];
  return (
    <div className={f.mediaThreads}>
      {list.loading && !list.items && <Receiving label="opening the discussion" />}
      {list.error && <ErrorBox message={list.error} />}
      {list.items && !items.length && !list.error && <p className={f.muted}>No threads about this title yet.</p>}
      <div className={f.plainList}>
        {items.map((th) => (
          <ThreadRow key={th.id} th={th} seenAt={seen[th.id]}
                     onOpen={(x) => { markSeen(x.id, x.replied_at); navigate(`/anime/thread/${x.id}`); }} />
        ))}
      </div>
      <div className={f.mediaFoot}>
        {list.hasMore && (
          <button type="button" className={f.moreBtn} onClick={list.loadMore} disabled={list.loadingMore}>
            {list.loadingMore ? 'fetching…' : 'More threads'}
          </button>
        )}
        <Link className={f.moreBtn} to={`/anime?tab=discuss&d=forum&fc=anime&fm=${mediaId}`}>
          <Eye size={12} /> Open in the forum
        </Link>
        {me.data && (
          <Link className={f.writeBtn} to={`/anime?tab=discuss&d=forum&fc=anime&fm=${mediaId}&new=1`}>
            <PenLine size={13} /> Start a thread about it
          </Link>
        )}
      </div>
    </div>
  );
}

export function ForumList({ mediaId }) {
  return mediaId ? <MediaThreads mediaId={mediaId} /> : <Forum />;
}
