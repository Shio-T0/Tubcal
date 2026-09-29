// No 02 — the Screening Room. Your YouTube, without YouTube.
//
// No page title and no blurb: the room opens on a slim control bar (search all of
// YouTube, the three ways to look at your channels, the knobs) and then straight
// into what's on:
//
//   Programme  the newest upload on the big screen with the rest of what just came
//              in beside it (and anything live), then pick-up-where-you-left-off,
//              the recommendations, a shelf per channel — busiest first — and a
//              random reel from off your map.
//   Latest     every upload from every channel, newest first, in days; filter to
//              one channel, hide what you've watched, mark it all seen.
//   On air     live streams and scheduled premieres.
//
// "New" means new since you last looked at that channel (feed.js). Search, the view,
// the filters and the source all live in the URL, so back from a video, a channel
// or anywhere else lands exactly where you were.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CheckCheck, Clapperboard, ExternalLink, Eye, EyeOff, History, ListVideo, Play, Plus, Radio,
  RefreshCw, Rows3, Search, Shuffle, Trash2, Tv, X,
} from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { ErrorBox, Receiving, useDebounced } from '../components/layout/Section.jsx';
import AddSubscriptionModal from '../components/modals/AddSubscriptionModal.jsx';
import { Avatar } from '../components/ui/Avatar.jsx';
import { Button, EmptyState } from '../components/ui/index.jsx';
import { QueueButton, SaveButton } from '../components/ui/ItemActions.jsx';
import {
  markSeen, seenSince, useChannelFeed, useChannelRoster, useSeen, useShared, useWatched,
} from '../components/screening/feed.js';
import { SubscribeButton } from '../components/screening/SubscribeButton.jsx';
import {
  ChannelLink, LiveBadge, Shelf, VideoRow, VideoTile, Wall, useChannelFaces,
} from '../components/screening/tiles.jsx';
import { ago, clock, timeAgo } from '../lib/time.js';
import { useParamState } from '../lib/urlState.js';
import { usePlayer, useProgress, useSubscriptions } from '../state.jsx';
import s from './screening.module.css';

const SUGGESTIONS = ['@veritasium', '@kurzgesagt', '@3blue1brown', '@fireship'];
const QUIET_AFTER = 45 * 86400; // a channel with nothing newer than this sits in "quiet lately"
const BOOL = { parse: (v) => v === '1', format: (v) => (v ? '1' : '') };

/** Queue a run of videos: the first plays now, the rest line up behind it. */
function usePlayAll() {
  const { open, enqueue } = usePlayer();
  return (items) => {
    const list = (items || []).filter((i) => !i.extra?.live_status || i.extra.live_status === 'is_live');
    if (!list.length) return;
    open(list[0]);
    list.slice(1, 50).forEach((i) => enqueue(i));
  };
}

function shuffled(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A day heading for an epoch: Today, Yesterday, a weekday this week, then dates. */
function dayLabel(sec) {
  if (!sec) return 'Undated';
  const d = new Date(sec * 1000);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function byDay(items, at = (i) => i.published_at) {
  const out = [];
  for (const it of items) {
    const label = dayLabel(at(it));
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}

function Muted({ children }) {
  return <p className={s.muted}>{children}</p>;
}

/** A search box whose text is local while you type and lands in the URL once you
 *  pause — and follows the URL when back/forward changes it under you. */
function useSearchText(q, setQ, delay = 450) {
  const [text, setText] = useState(q);
  const dq = useDebounced(text.trim(), delay);
  useEffect(() => { if (dq !== q) setQ(dq); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (q !== dq) setText(q); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return [text, setText];
}

function SearchField({ value, onChange, placeholder, autoFocus = false, big = false }) {
  const ref = useRef(null);
  return (
    <label className={`${s.search} ${big ? s.searchBig : ''}`}>
      <Search size={big ? 17 : 15} />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.preventDefault(); onChange(''); } }}
        placeholder={placeholder}
        spellCheck={false}
        autoFocus={autoFocus}
      />
      {value && (
        <button type="button" className={s.clear} onClick={() => { onChange(''); ref.current?.focus(); }} aria-label="Clear search">
          <X size={14} />
        </button>
      )}
    </label>
  );
}

// ── the room ─────────────────────────────────────────────────────────────────

const VIEWS = [
  { key: 'programme', label: 'Programme', Icon: Tv },
  { key: 'latest', label: 'Latest', Icon: Rows3 },
  { key: 'live', label: 'On air', Icon: Radio },
];

function RoomBar({ q, setQ, view, source, setSource, connected, counts, onRefresh, refreshing, onAdd }) {
  const [text, setText] = useSearchText(q, setQ);
  const withSrc = (v) => {
    const p = new URLSearchParams();
    if (v !== 'programme') p.set('v', v);
    if (source !== 'curated') p.set('src', source);
    const qs = p.toString();
    return `/youtube${qs ? `?${qs}` : ''}`;
  };
  return (
    <div className={s.bar}>
      <SearchField value={text} onChange={setText} placeholder="Search all of YouTube…" big />
      <nav className={s.views} aria-label="Views">
        {VIEWS.filter((v) => v.key !== 'live' || counts.live).map(({ key, label: name, Icon }) => {
          const label = key === 'live' && !counts.onAir ? 'Coming up' : name;
          const on = !q && view === key;
          const n = counts[key];
          return (
            <Link key={key} to={withSrc(key)} className={`${s.view} ${on ? s.viewOn : ''}`} aria-current={on ? 'page' : undefined}>
              <Icon size={14} /> {label}
              {n ? <em className={`${s.viewCount} ${key === 'live' && counts.onAir ? s.viewHot : ''}`}>{n}</em> : null}
            </Link>
          );
        })}
      </nav>
      <div className={s.knobs}>
        {connected && (
          <div className={s.source} role="group" aria-label="Whose channels">
            {[['curated', 'Mine here'], ['account', 'My YouTube']].map(([k, l]) => (
              <button key={k} type="button" className={source === k ? s.sourceOn : ''} onClick={() => setSource(k)} aria-pressed={source === k}>
                {l}
              </button>
            ))}
          </div>
        )}
        <button type="button" className={s.knob} onClick={onAdd} title="Add a channel">
          <Plus size={15} /> <span>Channel</span>
        </button>
        <button type="button" className={s.knobIcon} onClick={onRefresh} title="Refresh everything" aria-label="Refresh">
          <RefreshCw size={15} className={refreshing ? s.spin : ''} />
        </button>
      </div>
    </div>
  );
}

export default function ScreeningRoom() {
  const { open: play } = usePlayer();
  const [q, setQ] = useParamState('q', '');
  const [view, setView] = useParamState('v', 'programme');
  const [source, setSource] = useParamState('src', 'curated');
  const [adding, setAdding] = useState(false);
  const oauth = useApi('/oauth/status');
  const connected = !!oauth.data?.google?.connected;
  const src = connected ? source : 'curated';
  const { feed, live, hasSubs } = useChannelFeed(src);
  const { newCount } = useSeen();
  const [refreshing, setRefreshing] = useState(false);
  const reloaders = useRef([]);

  const liveItems = live.data?.items || [];
  const counts = {
    latest: newCount(feed.data?.items),
    live: liveItems.length,
    onAir: liveItems.some((i) => i.extra?.live_status === 'is_live'),
  };
  // "On air" only exists while something is — fall back if it ends under you.
  const v = VIEWS.some((x) => x.key === view) && (view !== 'live' || liveItems.length || live.loading) ? view : 'programme';
  useEffect(() => { if (v !== view && !live.loading) setView('programme'); }, [v, view, live.loading, setView]);

  const refresh = async () => {
    setRefreshing(true);
    try { await api('/refresh?scope=youtube', { method: 'POST' }); } catch { /* best-effort */ }
    await Promise.allSettled([feed.reload(), live.reload(), ...reloaders.current.map((fn) => fn())]);
    setRefreshing(false);
  };

  return (
    <div className={s.room}>
      <RoomBar
        q={q} setQ={setQ} view={v} source={src} setSource={setSource} connected={connected}
        counts={counts} onRefresh={refresh} refreshing={refreshing || feed.loading} onAdd={() => setAdding(true)}
      />

      {q ? (
        <SearchResults q={q} onPlay={play} />
      ) : v === 'latest' ? (
        <Latest feed={feed} hasSubs={hasSubs || src === 'account'} onPlay={play} onAdd={() => setAdding(true)} />
      ) : v === 'live' ? (
        <OnAir live={live} onPlay={play} />
      ) : (
        <Programme
          feed={feed} live={live} onPlay={play} hasSubs={hasSubs} src={src}
          onAdd={() => setAdding(true)} reloaders={reloaders}
        />
      )}

      <AddSubscriptionModal open={adding} onClose={() => setAdding(false)} initialPlatform="youtube" />
    </div>
  );
}

// ── programme ────────────────────────────────────────────────────────────────

function Feature({ item, fresh, onPlay }) {
  const watched = useWatched();
  const faces = useChannelFaces();
  const { ratio } = watched(item);
  const cid = item.extra?.channel_id;
  const desc = (item.extra?.description || '').split('\n').find((l) => l.trim()) || '';
  const big = item.thumbnail?.replace('hqdefault', 'maxresdefault');
  return (
    <div
      className={s.feature}
      data-kbd-tile
      tabIndex={0}
      role="button"
      onClick={() => onPlay(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(item); } }}
    >
      <img
        className={s.featureImg}
        src={big}
        alt=""
        // A missing maxres answers with a 120px grey placeholder rather than an error.
        onLoad={(e) => { if (e.currentTarget.naturalWidth <= 120 && e.currentTarget.src !== item.thumbnail) e.currentTarget.src = item.thumbnail; }}
        onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = item.thumbnail; }}
      />
      <span className={s.featureScrim} aria-hidden="true" />
      <LiveBadge item={item} />
      <div className={s.featureText}>
        <span className={s.featureKicker}>
          {fresh && <b className={s.featureNew}>new</b>}
          <ChannelLink item={item} face={cid && faces.has(cid) ? faces.get(cid) : undefined} className={s.featureChannel} />
          {item.published_at ? <span>{ago(item.published_at)}</span> : null}
        </span>
        <h2 className={s.featureTitle}>{item.title}</h2>
        {desc && <p className={s.featureDesc}>{desc}</p>}
        <div className={s.featureActs} onClick={(e) => e.stopPropagation()}>
          <button type="button" className={s.playBtn} onClick={() => onPlay(item)}>
            <Play size={15} fill="currentColor" /> {ratio > 0.02 && ratio < 0.95 ? 'Resume' : 'Play'}
          </button>
          <QueueButton item={item} className={s.featureAct} />
          <SaveButton item={item} className={s.featureAct} />
        </div>
      </div>
      {ratio > 0 && (
        <div className={s.featureProgress}><span style={{ width: `${Math.max(3, ratio * 100)}%` }} /></div>
      )}
    </div>
  );
}

function OnNow({ feature, justIn, liveItems, isNew, onPlay, latestCount }) {
  const onAir = liveItems.filter((i) => i.extra?.live_status === 'is_live');
  const soon = liveItems.filter((i) => i.extra?.live_status !== 'is_live');
  return (
    <section className={s.band} aria-label="On now">
      <Feature item={feature} fresh={isNew(feature)} onPlay={onPlay} />
      <div className={s.guide}>
        {onAir.length > 0 && (
          <div className={s.guideBlock}>
            <h3 className={`${s.guideHead} ${s.guideLive}`}><span className={s.liveDot} /> On air now</h3>
            {onAir.slice(0, 2).map((i) => <VideoRow key={i.id} item={i} onPlay={onPlay} />)}
          </div>
        )}
        <div className={s.guideBlock}>
          <h3 className={s.guideHead}>
            Just in
            {latestCount > 0 && <em className={s.guideNew}>{latestCount} new</em>}
          </h3>
          {justIn.map((i) => <VideoRow key={i.id} item={i} onPlay={onPlay} fresh={isNew(i)} />)}
        </div>
        {soon.length > 0 && (
          <Link to="/youtube?v=live" className={s.soon}>
            <Radio size={13} />
            <span><b>{soon[0].source}</b> goes live <LiveBadge item={soon[0]} className={s.soonBadge} /></span>
            {soon.length > 1 && <em>+{soon.length - 1}</em>}
          </Link>
        )}
        <Link to="/youtube?v=latest" className={s.guideMore}>
          Every upload, newest first <ArrowRight size={13} />
        </Link>
      </div>
    </section>
  );
}

function QuietChannels({ roster }) {
  return (
    <section className={s.quiet} aria-label="Quiet lately">
      <h3 className={s.quietHead}>Quiet lately <span>nothing new in six weeks</span></h3>
      <div className={s.quietRow}>
        {roster.map(({ sub, latest }) => (
          <Link key={sub.id} to={`/youtube/c/${sub.source_id}`} className={s.quietChip} data-kbd-tile>
            <Avatar src={sub.thumbnail} name={sub.display_name} imgClass={s.quietFace} letterClass={s.quietLetter} />
            <span>{sub.display_name}</span>
            {latest?.published_at ? <em>{timeAgo(latest.published_at)}</em> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

function Programme({ feed, live, onPlay, hasSubs, src, onAdd, reloaders }) {
  const { progress } = useProgress();
  const { isNew, newCount } = useSeen();
  const watched = useWatched();
  const items = useMemo(() => feed.data?.items || [], [feed.data]);
  const liveItems = live.data?.items || [];
  const roster = useChannelRoster(items);
  const cont = useApi('/youtube/continue');
  const discover = useShared('/youtube/discover', { enabled: hasSubs, maxAge: 300_000 });
  const trending = useShared('/youtube/trending', { maxAge: 600_000 });
  reloaders.current = [cont.reload, discover.reload, trending.reload];

  const feature = items.find((i) => !watched(i).done) || items[0] || null;
  const justIn = items.filter((i) => i !== feature).slice(0, 4);

  const [projShown, setProjShown] = useState(20);
  const projFocusAt = useRef(null);
  const projectionAll = (discover.data?.items || []).filter((i) => i.id !== feature?.id);
  const projection = projectionAll.slice(0, projShown);
  // After a load-more, hand keyboard focus to the first new tile so hjkl carries on.
  useEffect(() => {
    if (projFocusAt.current == null) return;
    const idx = projFocusAt.current;
    projFocusAt.current = null;
    const el = document.querySelectorAll('[data-shelf="projection"] [data-kbd-tile]')[idx];
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }, [projShown]);

  const byChannel = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      const k = it.extra?.channel_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return m;
  }, [items]);
  const cutoff = Date.now() / 1000 - QUIET_AFTER;
  const busy = src === 'curated' ? roster.filter((r) => r.latest && r.latest.published_at > cutoff) : [];
  const quiet = src === 'curated' ? roster.filter((r) => !(r.latest && r.latest.published_at > cutoff)) : [];

  const resumable = (cont.data?.items || []).slice(0, 14);
  const random = (trending.data?.items || []).slice(0, 14);
  const enabled = src === 'account' || hasSubs;

  return (
    <>
      {!enabled && (
        <EmptyState
          icon={<Clapperboard size={32} />}
          color="var(--c-youtube)"
          title="No channels yet — here's what's airing tonight"
          subtitle="Add channels by handle or URL and they get their own shelves here. Or just dive into the random reel below."
          action={<Button onClick={onAdd}><Plus size={15} /> Add a channel</Button>}
          suggestions={SUGGESTIONS}
          onSuggestion={onAdd}
        />
      )}
      {enabled && feed.error && <ErrorBox message={feed.error} />}
      {enabled && feed.loading && !feed.data && <Receiving label="warming up the projector" />}

      {feature && (
        <OnNow
          feature={feature} justIn={justIn} liveItems={liveItems} isNew={isNew} onPlay={onPlay}
          latestCount={newCount(items)}
        />
      )}

      {resumable.length > 0 && (
        <Shelf
          id="continue"
          title="Pick up where you left off"
          tone="#e0a955"
          items={resumable}
          onPlay={onPlay}
          allTo="/youtube/history"
          allLabel="history"
          tileMeta={(i) => {
            const p = progress[i.id];
            return (
              <>
                <ChannelLink item={i} />
                {p?.duration ? <span>{clock(p.duration - p.position)} left</span> : null}
              </>
            );
          }}
        />
      )}

      {projection.length > 0 && (
        <Shelf
          id="projection"
          title="The Projection — picked for you"
          tone="#6fae9f"
          tall
          items={projection}
          onPlay={onPlay}
          onLoadMore={() => { projFocusAt.current = projShown; setProjShown((n) => n + 12); }}
          hasMore={projShown < projectionAll.length}
        />
      )}

      {busy.length > 0 && (
        <div className={s.groupLabel}>
          <span>Your channels</span>
          <em>freshest first{quiet.length ? ` · ${quiet.length} quiet lately, at the bottom` : ''}</em>
        </div>
      )}
      {busy.map(({ sub, fresh }) => (
        <Shelf
          key={sub.id}
          id={`ch-${sub.source_id}`}
          title={<Link to={`/youtube/c/${sub.source_id}`} className={s.shelfName}>{sub.display_name}</Link>}
          lead={
            <Link to={`/youtube/c/${sub.source_id}`} className={s.shelfFace} tabIndex={-1} aria-hidden="true">
              <Avatar src={sub.thumbnail} name={sub.display_name} imgClass={s.shelfFaceImg} letterClass={s.shelfFaceLetter} />
            </Link>
          }
          note={fresh ? <b className={s.shelfNew}>{fresh} new</b> : null}
          items={byChannel.get(sub.source_id) || []}
          onPlay={onPlay}
          isNew={isNew}
          allTo={`/youtube/c/${sub.source_id}`}
          allLabel="channel"
          tileMeta={(i) => <span>{ago(i.published_at)}</span>}
        />
      ))}
      {src === 'account' && items.length > 0 && (
        <Shelf id="account" title="From your YouTube subscriptions" items={items.slice(0, 40)} onPlay={onPlay} isNew={isNew} />
      )}
      {quiet.length > 0 && <QuietChannels roster={quiet} />}

      {random.length > 0 && (
        <Shelf
          id="random"
          title="Off the air — a random reel from across YouTube"
          tone="#9a8fcf"
          items={random}
          onPlay={onPlay}
          onShuffle={() => trending.reload()}
          shuffling={trending.loading}
        />
      )}
      {trending.loading && !random.length && <Receiving label="tuning into random channels" />}
    </>
  );
}

// ── latest ───────────────────────────────────────────────────────────────────

function Latest({ feed, hasSubs, onPlay, onAdd }) {
  const items = useMemo(() => feed.data?.items || [], [feed.data]);
  const [ch, setCh] = useParamState('ch', '');
  const [hideWatched, setHideWatched] = useParamState('hw', false, BOOL);
  const { isNew, newCount } = useSeen();
  const watched = useWatched();
  const roster = useChannelRoster(items).filter((r) => r.latest);
  const playAll = usePlayAll();

  const shown = items.filter((i) => (!ch || i.extra?.channel_id === ch) && (!hideWatched || !watched(i).done));
  const fresh = newCount(items);
  const days = byDay(shown);

  if (!hasSubs) {
    return (
      <EmptyState
        icon={<Rows3 size={32} />}
        color="var(--c-youtube)"
        title="Nothing to line up yet"
        subtitle="Every upload from your channels lands here, newest first. Add a channel to start."
        action={<Button onClick={onAdd}><Plus size={15} /> Add a channel</Button>}
      />
    );
  }

  return (
    <>
      <div className={s.filters}>
        <div className={s.filterRow} role="group" aria-label="Channel">
          <button type="button" className={`${s.fchip} ${!ch ? s.fchipOn : ''}`} onClick={() => setCh('')}>
            Everyone <em>{items.length}</em>
          </button>
          {roster.map(({ sub, fresh: n }) => (
            <button
              key={sub.id}
              type="button"
              className={`${s.fchip} ${ch === sub.source_id ? s.fchipOn : ''}`}
              onClick={() => setCh(ch === sub.source_id ? '' : sub.source_id)}
            >
              <Avatar src={sub.thumbnail} name={sub.display_name} imgClass={s.fface} letterClass={s.fletter} />
              {sub.display_name}
              {n > 0 && <b>{n}</b>}
            </button>
          ))}
        </div>
        <div className={s.filterKnobs}>
          <button type="button" className={`${s.toggle} ${hideWatched ? s.toggleOn : ''}`} onClick={() => setHideWatched(!hideWatched)} aria-pressed={hideWatched}>
            {hideWatched ? <EyeOff size={14} /> : <Eye size={14} />} {hideWatched ? 'Watched hidden' : 'Hide watched'}
          </button>
          <button type="button" className={s.toggle} onClick={() => playAll(shown.filter((i) => !watched(i).done))}>
            <Play size={14} /> Play all unwatched
          </button>
          {fresh > 0 && (
            <button type="button" className={s.toggle} onClick={() => markSeen()} title="Clear every new badge">
              <CheckCheck size={14} /> Mark {fresh} seen
            </button>
          )}
        </div>
      </div>

      {feed.error && <ErrorBox message={feed.error} />}
      {feed.loading && !feed.data && <Receiving label="gathering the reels" />}
      {feed.data && !shown.length && <Muted>{hideWatched ? "You've watched everything here." : 'Nothing from this channel lately.'}</Muted>}

      {days.map((d) => (
        <section key={d.label} className={s.day}>
          <h3 className={s.dayHead}>
            <span>{d.label}</span>
            <em>{d.items.length} upload{d.items.length === 1 ? '' : 's'}</em>
          </h3>
          <Wall>
            {d.items.map((i) => <VideoTile key={i.id} item={i} onPlay={onPlay} fresh={isNew(i)} />)}
          </Wall>
        </section>
      ))}
    </>
  );
}

// ── on air ───────────────────────────────────────────────────────────────────

function OnAir({ live, onPlay }) {
  const items = [...(live.data?.items || [])].sort((a, b) => {
    const la = a.extra?.live_status === 'is_live' ? 0 : 1;
    const lb = b.extra?.live_status === 'is_live' ? 0 : 1;
    return la - lb || (a.extra?.scheduled_at || 0) - (b.extra?.scheduled_at || 0);
  });
  return (
    <>
      {live.error && <ErrorBox message={live.error} />}
      {live.loading && !live.data && <Receiving label="checking the listings" />}
      {live.data && !items.length && <Muted>Nothing live or scheduled on your channels right now.</Muted>}
      <Wall>{items.map((i) => <VideoTile key={i.id} item={i} onPlay={onPlay} />)}</Wall>
    </>
  );
}

// ── search ───────────────────────────────────────────────────────────────────

/** YouTube-wide search that accumulates pages. The backend paginates by
 *  continuation token (YouTube's own InnerTube API); ?page=N is still sent so the
 *  Invidious fallback — which has no tokens — can keep numbering. */
function useYoutubeSearch(query) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!query) {
      setPages([]);
      setError(null);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setPages([]);
    api(`/youtube/search?q=${encodeURIComponent(query)}&page=1`)
      .then((d) => alive && (setPages([d]), setLoading(false)))
      .catch((e) => alive && (setError(e.message), setLoading(false)));
    return () => { alive = false; };
  }, [query]);

  const last = pages.length ? pages[pages.length - 1] : null;
  const hasMore = !!last?.has_more;
  const items = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of pages) {
      for (const it of p.items || []) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        out.push(it);
      }
    }
    return out;
  }, [pages]);

  const loadMore = () => {
    if (!hasMore || loadingMore || !query) return;
    const next = (last?.page || pages.length) + 1;
    const cont = last?.continuation ? `&continuation=${encodeURIComponent(last.continuation)}` : '';
    setLoadingMore(true);
    api(`/youtube/search?q=${encodeURIComponent(query)}&page=${next}${cont}`)
      .then((d) => setPages((p) => [...p, d]))
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  return { items, loading, loadingMore, error, hasMore, loadMore };
}

function SearchResults({ q, onPlay }) {
  const search = useYoutubeSearch(q);
  return (
    <>
      <div className={s.resultsHead}>
        <span>Results for <b>“{q}”</b></span>
        {search.items.length > 0 && <em>{search.items.length}{search.hasMore ? '+' : ''}</em>}
      </div>
      {search.error && <ErrorBox message={search.error} />}
      {search.loading && <Receiving label={`searching YouTube for “${q}”`} />}
      {!search.loading && <Wall>{search.items.map((i) => <VideoTile key={i.id} item={i} onPlay={onPlay} />)}</Wall>}
      {!search.loading && search.hasMore && (
        <div className={s.moreWrap}>
          <Button variant="ghost" onClick={search.loadMore} disabled={search.loadingMore}>
            {search.loadingMore ? 'loading…' : 'More results'}
          </Button>
        </div>
      )}
      {!search.loading && !search.error && !search.items.length && <Muted>No results on YouTube for “{q}”.</Muted>}
    </>
  );
}

// ── a channel ────────────────────────────────────────────────────────────────

function PlaylistCard({ playlist }) {
  return (
    <Link to={`/youtube/playlist/${playlist.playlist_id}`} className={s.plCard} data-kbd-tile>
      <div className={s.plThumbWrap}>
        {playlist.thumbnail ? (
          <img className={s.plThumb} src={playlist.thumbnail} alt="" loading="lazy" />
        ) : (
          <div className={s.plThumbFallback}><ListVideo size={26} /></div>
        )}
        <div className={s.plCount}><ListVideo size={13} /> {playlist.video_count ?? '—'}</div>
      </div>
      <div className={s.plTitle}>{playlist.title}</div>
    </Link>
  );
}

/** Paginated, sortable channel-videos loader (Invidious). Accumulates pages. */
function useChannelVideos(channelId, sort) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setPages([]);
    api(`/youtube/channel/${channelId}/videos?sort=${sort}`)
      .then((d) => alive && (setPages([d]), setLoading(false)))
      .catch((e) => alive && (setError(e.message), setLoading(false)));
    return () => { alive = false; };
  }, [channelId, sort]);

  const continuation = pages.length ? pages[pages.length - 1].continuation : null;
  const videos = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of pages) {
      for (const it of p.items || []) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        out.push(it);
      }
    }
    return out;
  }, [pages]);

  const loadMore = () => {
    if (!continuation || loadingMore) return;
    setLoadingMore(true);
    api(`/youtube/channel/${channelId}/videos?sort=${sort}&continuation=${encodeURIComponent(continuation)}`)
      .then((d) => setPages((p) => [...p, d]))
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  return { videos, loading, loadingMore, error, continuation, loadMore };
}

const SORTS = [['newest', 'Latest'], ['popular', 'Popular'], ['oldest', 'Oldest']];

export function ChannelPage() {
  const { channelId } = useParams();
  const { subs } = useSubscriptions();
  const sub = subs.youtube.find((x) => x.source_id === channelId);
  const { open: play } = usePlayer();
  const playAll = usePlayAll();
  const [tab, setTab] = useParamState('tab', 'videos');
  const [sort, setSort] = useParamState('sort', 'newest');
  const [q, setQ] = useParamState('q', '');
  const [text, setText] = useSearchText(q, setQ);
  const { progress } = useProgress();

  // What was new before this visit stays marked while you're here; opening the
  // channel is what clears its badges everywhere else.
  const since = useMemo(() => seenSince(channelId), [channelId]);
  useEffect(() => { markSeen(channelId); }, [channelId]);
  const fresh = (i) => !!i.published_at && i.published_at > since && i.published_at < Date.now() / 1000 && !progress[i.id];

  const vids = useChannelVideos(channelId, sort);
  const playlists = useApi(`/youtube/channel/${channelId}/playlists`, tab === 'playlists');
  const about = useApi(`/youtube/channel/${channelId}/about`, !sub);
  const searching = tab === 'videos' && q.length > 0;
  const chSearch = useApi(`/youtube/channel/${channelId}/search?q=${encodeURIComponent(q)}`, searching);
  const searchItems = chSearch.data?.items || [];

  const name = sub?.display_name || about.data?.title || vids.videos[0]?.source || channelId;
  const avatar = sub?.thumbnail || about.data?.thumbnail;
  const pls = playlists.data?.items || [];
  const newest = sort === 'newest' ? vids.videos.find((i) => i.published_at && i.published_at * 1000 <= Date.now()) : null;
  const freshCount = vids.videos.filter(fresh).length;

  return (
    <div className={s.room}>
      <header className={s.chHead}>
        <Avatar src={avatar} name={name} imgClass={s.chAvatar} letterClass={s.chLetter} />
        <div className={s.chText}>
          <span className={s.kicker}>{sub ? 'Your channel' : 'Channel'}</span>
          <h1 className={s.chName}>{name}</h1>
          <span className={s.chMeta}>
            {newest?.published_at ? <span>last upload {ago(newest.published_at)}</span> : null}
            {freshCount > 0 && <span className={s.chFresh}>{freshCount} new since you last looked</span>}
            <a href={`https://www.youtube.com/channel/${channelId}`} target="_blank" rel="noreferrer noopener">
              on YouTube <ExternalLink size={11} />
            </a>
          </span>
        </div>
        <div className={s.chActs}>
          {vids.videos.length > 0 && (
            <button type="button" className={s.ghostBtn} onClick={() => playAll(vids.videos)} title="Play these in order — the rest queue up">
              <Play size={14} /> Play all
            </button>
          )}
          <SubscribeButton channelId={channelId} sub={sub} name={name} />
        </div>
      </header>

      <div className={s.chBar}>
        <div className={s.tabs} role="tablist">
          {[['videos', 'Videos'], ['playlists', 'Playlists']].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? s.tabOn : s.tab} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        {tab === 'videos' && !searching && (
          <div className={s.sorts} role="group" aria-label="Sort">
            {SORTS.map(([k, l]) => (
              <button key={k} type="button" className={sort === k ? s.sortOn : ''} onClick={() => setSort(k)} aria-pressed={sort === k}>
                {l}
              </button>
            ))}
          </div>
        )}
        {tab === 'videos' && <SearchField value={text} onChange={setText} placeholder={`Search all of ${name}…`} />}
      </div>

      {tab === 'videos' && searching && (
        <>
          {chSearch.error && <ErrorBox message={chSearch.error} />}
          {chSearch.loading && !chSearch.data && <Receiving label={`searching ${name} for “${q}”`} />}
          {!chSearch.loading && <Wall>{searchItems.map((i) => <VideoTile key={i.id} item={i} onPlay={play} />)}</Wall>}
          {!chSearch.loading && chSearch.data && !searchItems.length && <Muted>No videos in {name} match “{q}”.</Muted>}
        </>
      )}

      {tab === 'videos' && !searching && (
        <>
          {vids.error && <ErrorBox message={vids.error} />}
          {vids.loading && <Receiving label="rewinding the reels" />}
          <Wall>{vids.videos.map((i) => <VideoTile key={i.id} item={i} onPlay={play} fresh={fresh(i)} />)}</Wall>
          {!vids.loading && vids.continuation && (
            <div className={s.moreWrap}>
              <Button variant="ghost" onClick={vids.loadMore} disabled={vids.loadingMore}>
                {vids.loadingMore ? 'loading…' : 'More videos'}
              </Button>
            </div>
          )}
        </>
      )}

      {tab === 'playlists' && (
        <>
          {playlists.error && <ErrorBox message={playlists.error} />}
          {playlists.loading && !playlists.data && <Receiving label="pulling the playlists" />}
          {!playlists.loading && playlists.data && !pls.length && <Muted>This channel has no public playlists.</Muted>}
          <div className={s.plGrid}>{pls.map((p) => <PlaylistCard key={p.playlist_id} playlist={p} />)}</div>
        </>
      )}
    </div>
  );
}

// ── a playlist ───────────────────────────────────────────────────────────────

export function PlaylistPage() {
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const pl = useApi(`/youtube/playlist/${playlistId}`);
  const { open: play } = usePlayer();
  const playAll = usePlayAll();
  const [q, setQ] = useParamState('q', '');
  const [text, setText] = useSearchText(q, setQ, 200);

  const items = pl.data?.items || [];
  const ql = q.toLowerCase();
  const shown = ql ? items.filter((i) => i.title.toLowerCase().includes(ql)) : items;
  const title = pl.data?.title || 'Playlist';
  const count = pl.data?.video_count;
  const cover = items[0]?.thumbnail;

  return (
    <div className={s.room}>
      <header className={s.plHead}>
        <button type="button" className={s.back} onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={15} /></button>
        <div className={s.plCover}>
          {cover ? <img src={cover} alt="" /> : <ListVideo size={28} />}
        </div>
        <div className={s.chText}>
          <span className={s.kicker}>Playlist{pl.data?.author ? ` · ${pl.data.author}` : ''}</span>
          <h1 className={s.chName}>{title}</h1>
          {count != null && (
            <span className={s.chMeta}>
              <span>{count} video{count === 1 ? '' : 's'}</span>
              {items.length < count && <span>showing {items.length}</span>}
            </span>
          )}
        </div>
        {items.length > 0 && (
          <div className={s.chActs}>
            <button type="button" className={s.playAll} onClick={() => playAll(items)}><Play size={14} fill="currentColor" /> Play all</button>
            <button type="button" className={s.ghostBtn} onClick={() => playAll(shuffled(items))}><Shuffle size={14} /> Shuffle</button>
          </div>
        )}
      </header>

      {items.length > 8 && (
        <div className={s.chBar}>
          <SearchField value={text} onChange={setText} placeholder="Find in this playlist…" />
        </div>
      )}
      {pl.error && <ErrorBox message={pl.error} />}
      {pl.loading && !pl.data && <Receiving label="queuing the reels" />}
      <div className={s.list}>
        {shown.map((i) => (
          <VideoRow key={i.id} item={i} onPlay={play} index={items.indexOf(i) + 1} />
        ))}
      </div>
      {pl.data && !shown.length && <Muted>{q ? `Nothing here matches “${q}”.` : 'This playlist is empty.'}</Muted>}
    </div>
  );
}

// ── the logbook (watch history) ──────────────────────────────────────────────

function historyItemFromRow(row) {
  const videoId = row.item_id.startsWith('yt:') ? row.item_id.slice(3) : row.item_id;
  return {
    id: row.item_id,
    platform: 'youtube',
    title: row.title || 'Untitled',
    url: row.url || `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: row.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    source: row.source_name || '',
    published_at: 0,
    extra: { video_id: videoId, channel_id: row.source_id },
  };
}

function atTime(sec) {
  return new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function HistoryPage() {
  const hist = useApi('/history?platform=youtube');
  const { open: play } = usePlayer();
  const [q, setQ] = useParamState('q', '');
  const [text, setText] = useSearchText(q, setQ, 200);
  const [gone, setGone] = useState(() => new Set());

  const clearAll = async () => {
    if (!window.confirm('Clear your entire YouTube watch history?')) return;
    try { await api('/history?platform=youtube', { method: 'DELETE' }); } catch { /* best-effort */ }
    hist.reload();
  };

  const remove = async (row, e) => {
    e.stopPropagation();
    setGone((g) => new Set(g).add(row.item_id));
    try { await api(`/history?item_id=${encodeURIComponent(row.item_id)}`, { method: 'DELETE' }); } catch { /* best-effort */ }
  };

  const rows = (hist.data?.items || []).filter((r) => !gone.has(r.item_id));
  const ql = q.toLowerCase();
  const shown = ql
    ? rows.filter((r) => (r.title || '').toLowerCase().includes(ql) || (r.source_name || '').toLowerCase().includes(ql))
    : rows;
  const days = byDay(shown, (r) => r.watched_at);

  return (
    <div className={s.room}>
      <header className={s.logHead}>
        <History size={20} className={s.logIcon} />
        <h1 className={s.logTitle}>History</h1>
        {rows.length > 0 && <em className={s.logCount}>{rows.length} watched · kept only on this machine</em>}
        <div className={s.logKnobs}>
          {rows.length > 0 && <SearchField value={text} onChange={setText} placeholder="Search your history…" />}
          {rows.length > 0 && (
            <button type="button" className={s.danger} onClick={clearAll}><Trash2 size={14} /> Clear</button>
          )}
        </div>
      </header>

      {hist.error && <ErrorBox message={hist.error} />}
      {hist.loading && !hist.data && <Receiving label="rewinding the tape" />}
      {!hist.loading && hist.data && !rows.length && (
        <EmptyState
          icon={<History size={32} />}
          color="var(--c-youtube)"
          title="Nothing watched yet"
          subtitle="Play a video anywhere in the Screening Room and it shows up here."
        />
      )}
      {rows.length > 0 && !shown.length && <Muted>Nothing in your history matches “{q}”.</Muted>}

      {days.map((d) => (
        <section key={d.label} className={s.logDay}>
          <h3 className={s.dayHead}><span>{d.label}</span><em>{d.items.length}</em></h3>
          <div className={s.list}>
            {d.items.map((row) => {
              const item = historyItemFromRow(row);
              return (
                <VideoRow
                  key={row.item_id}
                  item={item}
                  onPlay={play}
                  meta={
                    <>
                      <ChannelLink item={item} />
                      <span>{atTime(row.watched_at)}</span>
                      {row.watch_count > 1 && <span>{row.watch_count}×</span>}
                    </>
                  }
                  aside={
                    <button type="button" className={s.rowRemove} title="Remove from history" onClick={(e) => remove(row, e)}>
                      <Trash2 size={13} />
                    </button>
                  }
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
