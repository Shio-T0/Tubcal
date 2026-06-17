import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Clapperboard,
  History,
  ListVideo,
  Play,
  Plus,
  RefreshCw,
  Shuffle,
  Trash2,
} from 'lucide-react';

import { api, useApi } from '../api/client.js';
import {
  chipStyles as c,
  ErrorBox,
  Receiving,
  SearchBar,
  SectionHead,
  useDebounced,
} from '../components/layout/Section.jsx';
import AddSubscriptionModal from '../components/modals/AddSubscriptionModal.jsx';
import { Button, EmptyState, IconButton, SegmentedControl } from '../components/ui/index.jsx';
import { timeAgo } from '../lib/time.js';
import { COMPLETE_RATIO, usePlayer, useProgress, useSubscriptions, useToast } from '../state.jsx';
import s from './screening.module.css';

const SUGGESTIONS = ['@veritasium', '@kurzgesagt', '@3blue1brown', '@fireship'];

// The channel name links to that channel's page. stopPropagation keeps a click
// on the name from also triggering the tile's play handler.
export function ChannelLink({ item, className }) {
  const channelId = item.extra?.channel_id;
  if (!channelId) return <>{item.source}</>;
  return (
    <Link
      to={`/youtube/c/${channelId}`}
      className={`${s.metaLink} ${className || ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {item.source}
    </Link>
  );
}

export function VideoTile({ item, onPlay, meta }) {
  const { progress } = useProgress();
  const p = progress[item.id];
  const ratio = p && p.duration ? Math.min(1, p.position / p.duration) : 0;
  const done = ratio >= COMPLETE_RATIO;
  return (
    <div className={s.tile} onClick={() => onPlay(item)}>
      <div className={s.tileThumbWrap}>
        <img className={s.tileThumb} src={item.thumbnail} alt="" loading="lazy" />
        <div className={s.tilePlay}>
          <span>
            <Play size={18} fill="currentColor" />
          </span>
        </div>
        {ratio > 0 && (
          <div className={s.tileProgress} title={done ? 'Watched' : `${Math.round(ratio * 100)}% watched`}>
            <div
              className={`${s.tileProgressFill} ${done ? s.tileProgressDone : ''}`}
              style={{ width: `${done ? 100 : Math.max(3, ratio * 100)}%` }}
            />
          </div>
        )}
      </div>
      <div className={s.tileTitle}>{item.title}</div>
      <div className={s.tileMeta}>
        {meta != null ? (
          meta
        ) : (
          <>
            <ChannelLink item={item} />
            {timeAgo(item.published_at) && ` · ${timeAgo(item.published_at)}`}
          </>
        )}
      </div>
    </div>
  );
}

function Shelf({ title, count, items, onPlay, allTo, onShuffle, shuffling, className }) {
  return (
    <section className={`${s.shelf} ${className || ''}`}>
      <div className={s.shelfHead}>
        <h2 className={s.shelfTitle}>{title}</h2>
        {count != null && <span className={s.shelfCount}>{count} new</span>}
        {onShuffle && (
          <button className={s.shelfAll} onClick={onShuffle}>
            <Shuffle size={12} className={shuffling ? s.spin : ''} /> reshuffle
          </button>
        )}
        {allTo && (
          <Link className={s.shelfAll} to={allTo}>
            view all <ArrowRight size={12} />
          </Link>
        )}
      </div>
      <div className={s.shelfRow}>
        {items.map((item) => (
          <VideoTile key={item.id} item={item} onPlay={onPlay} />
        ))}
      </div>
    </section>
  );
}

function ChannelChips({ subs, onAdd, activeId }) {
  return (
    <div className={c.chips} style={{ '--chip-c': 'var(--c-youtube)' }}>
      {subs.map((sub) => (
        <Link
          key={sub.id}
          to={`/youtube/c/${sub.source_id}`}
          className={`${c.chip} ${activeId === sub.source_id ? c.chipActive : ''}`}
        >
          {sub.thumbnail ? (
            <img className={c.chipAvatar} src={sub.thumbnail} alt="" />
          ) : (
            <span className={c.chipLetter}>{sub.display_name.charAt(0).toUpperCase()}</span>
          )}
          {sub.display_name}
        </Link>
      ))}
      <button className={`${c.chip} ${c.chipGhost}`} onClick={onAdd}>
        <Plus size={13} /> add channel
      </button>
    </div>
  );
}

export default function ScreeningRoom() {
  const navigate = useNavigate();
  const { subs } = useSubscriptions();
  const { open: setVideo } = usePlayer();
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('curated');

  const hasSubs = subs.youtube.length > 0;
  const oauth = useApi('/oauth/status');
  const connected = oauth.data?.google?.connected;
  const enabled = source === 'account' || hasSubs;

  const feed = useApi(`/feed/youtube?source=${source}`, enabled);
  const discover = useApi('/youtube/discover', hasSubs);
  // Always live — the "random video" pool from Invidious trending/popular, so the
  // home is populated even with zero subscriptions.
  const trending = useApi('/youtube/trending');

  // Real YouTube-wide search via Invidious (debounced), not just a local filter.
  const q = query.trim();
  const dq = useDebounced(q);
  const search = useApi(`/youtube/search?q=${encodeURIComponent(dq)}`, dq.length > 0);
  const searching = dq.length > 0;

  const refresh = async () => {
    try {
      await api('/refresh?scope=youtube', { method: 'POST' });
    } catch {
      /* best-effort */
    }
    feed.reload();
    discover.reload();
    trending.reload();
  };

  const items = feed.data?.items || [];
  const searchItems = search.data?.items || [];

  const hero = !searching && items.length > 0 ? items[0] : null;
  const shelves = useMemo(() => {
    if (searching) return [];
    const byChannel = new Map();
    for (const item of items) {
      const key = item.extra.channel_id;
      if (!byChannel.has(key)) byChannel.set(key, []);
      byChannel.get(key).push(item);
    }
    return subs.youtube
      .map((sub) => ({ sub, items: byChannel.get(sub.source_id) || [] }))
      .filter((x) => x.items.length > 0);
  }, [items, subs.youtube, searching]);

  const projection = (discover.data?.items || []).filter((i) => i.id !== hero?.id).slice(0, 12);
  const random = (trending.data?.items || []).filter((i) => i.id !== hero?.id).slice(0, 12);

  return (
    <>
      <SectionHead
        kicker="No 02 — Screening Room"
        title="Tonight's programme"
        note="Every channel gets its own shelf. Films roll in the no-cookie projector."
        color="var(--c-youtube)"
      >
        {connected && (
          <SegmentedControl
            options={[
              { value: 'curated', label: 'Curated' },
              { value: 'account', label: 'Subscriptions' },
            ]}
            value={source}
            onChange={setSource}
          />
        )}
        <IconButton title="Watch history" onClick={() => navigate('/youtube/history')}>
          <History size={16} />
        </IconButton>
        <IconButton title="Refresh" onClick={refresh} spinning={feed.loading}>
          <RefreshCw size={16} />
        </IconButton>
      </SectionHead>

      <SearchBar value={query} onChange={setQuery} placeholder="search all of YouTube…" />
      {hasSubs && <ChannelChips subs={subs.youtube} onAdd={() => setAddOpen(true)} />}

      {searching && (
        <>
          {search.error && <ErrorBox message={search.error} />}
          {search.loading && !search.data && <Receiving label={`searching YouTube for “${dq}”`} />}
          {!search.loading && (
            <div className={s.grid}>
              {searchItems.map((item) => (
                <VideoTile key={item.id} item={item} onPlay={setVideo} />
              ))}
            </div>
          )}
          {!search.loading && searchItems.length === 0 && (
            <p style={{ color: 'var(--paper-faint)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              no results on YouTube for “{dq}”.
            </p>
          )}
        </>
      )}

      {!searching && !enabled && (
        <EmptyState
          icon={<Clapperboard size={32} />}
          color="var(--c-youtube)"
          title="No channels yet — here's what's airing tonight"
          subtitle="Add channels by handle or URL for your own shelves, or just dive into the random picks below."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add a channel
            </Button>
          }
          suggestions={SUGGESTIONS}
          onSuggestion={() => setAddOpen(true)}
        />
      )}

      {!searching && enabled && feed.error && <ErrorBox message={feed.error} />}
      {!searching && enabled && feed.loading && !feed.data && (
        <Receiving label="warming up the projector" />
      )}

      {!searching && hero && (
        <div className={s.hero} onClick={() => setVideo(hero)}>
          <img
            className={s.heroThumb}
            src={hero.thumbnail.replace('hqdefault', 'maxresdefault')}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = hero.thumbnail;
            }}
            alt=""
          />
          <div className={s.heroScrim} />
          <div className={s.heroPlay}>
            <Play size={22} fill="currentColor" />
          </div>
          <div className={s.heroText}>
            <span className={s.heroKicker}>Now showing — latest release</span>
            <h2 className={s.heroTitle}>{hero.title}</h2>
            <span className={s.heroMeta}>
              {hero.source} · {timeAgo(hero.published_at)}
            </span>
          </div>
        </div>
      )}

      {!searching && projection.length > 0 && (
        <Shelf
          title="The Projection — picked for you"
          count={null}
          items={projection}
          onPlay={setVideo}
          className={`${s.projection} ${s.shelfTall}`}
        />
      )}

      {!searching && random.length > 0 && (
        <Shelf
          title="Off the air — random from across YouTube"
          count={null}
          items={random}
          onPlay={setVideo}
          onShuffle={() => trending.reload()}
          shuffling={trending.loading}
          className={s.projection}
        />
      )}
      {!searching && trending.loading && random.length === 0 && (
        <Receiving label="tuning into random channels" />
      )}

      {!searching &&
        shelves.map(({ sub, items: shelfItems }) => (
          <Shelf
            key={sub.id}
            title={sub.display_name}
            count={shelfItems.length}
            items={shelfItems}
            onPlay={setVideo}
            allTo={`/youtube/c/${sub.source_id}`}
          />
        ))}

      <AddSubscriptionModal open={addOpen} onClose={() => setAddOpen(false)} initialPlatform="youtube" />
    </>
  );
}

function PlaylistCard({ playlist }) {
  return (
    <Link to={`/youtube/playlist/${playlist.playlist_id}`} className={s.plCard}>
      <div className={s.plThumbWrap}>
        {playlist.thumbnail ? (
          <img className={s.plThumb} src={playlist.thumbnail} alt="" loading="lazy" />
        ) : (
          <div className={s.plThumbFallback}>
            <ListVideo size={26} />
          </div>
        )}
        <div className={s.plCount}>
          <ListVideo size={13} /> {playlist.video_count ?? '—'}
        </div>
      </div>
      <div className={s.tileTitle}>{playlist.title}</div>
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
    return () => {
      alive = false;
    };
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

// Subscribe / Unsubscribe toggle for a channel. `sub` is the subscription row
// if the user already follows the channel, otherwise undefined.
function SubscribeButton({ channelId, sub, name }) {
  const { refreshSubs } = useSubscriptions();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const subscribed = !!sub;

  const toggle = async () => {
    setBusy(true);
    try {
      if (subscribed) {
        await api(`/subscriptions/${sub.id}`, { method: 'DELETE' });
        toast(`Unsubscribed from ${name}`, 'info');
      } else {
        await api('/subscriptions', {
          method: 'POST',
          body: JSON.stringify({ platform: 'youtube', input: channelId }),
        });
        toast(`Subscribed to ${name}`, 'success');
      }
      await refreshSubs();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant={subscribed ? 'ghost' : 'solid'} onClick={toggle} disabled={busy}>
      {busy ? '…' : subscribed ? 'Unsubscribe' : 'Subscribe'}
    </Button>
  );
}

export function ChannelPage() {
  const { channelId } = useParams();
  const { subs } = useSubscriptions();
  const sub = subs.youtube.find((x) => x.source_id === channelId);
  const { open: setVideo } = usePlayer();
  const [query, setQuery] = useState('');
  const [view, setView] = useState('videos');
  const [sort, setSort] = useState('newest');

  const vids = useChannelVideos(channelId, sort);
  const playlists = useApi(`/youtube/channel/${channelId}/playlists`, view === 'playlists');

  // Real search across the channel's whole catalogue (not just loaded pages).
  const q = query.trim();
  const dq = useDebounced(q);
  const searching = view === 'videos' && dq.length > 0;
  const chSearch = useApi(
    `/youtube/channel/${channelId}/search?q=${encodeURIComponent(dq)}`,
    searching,
  );
  const searchItems = chSearch.data?.items || [];

  const name = sub?.display_name || vids.videos[0]?.source || channelId;
  const pls = playlists.data?.items || [];

  return (
    <>
      <Link to="/youtube" className={c.backLink}>
        <ArrowLeft size={13} /> back to the screening room
      </Link>
      <div className={s.channelHead}>
        {sub?.thumbnail ? (
          <img className={s.channelAvatar} src={sub.thumbnail} alt="" />
        ) : (
          <span className={s.channelLetter}>{name.charAt(0).toUpperCase()}</span>
        )}
        <div>
          <span className="kicker" style={{ color: 'var(--c-youtube)' }}>
            Private screening
          </span>
          <h1 className={s.channelName}>{name}</h1>
        </div>
        <div className={s.channelActions}>
          <SubscribeButton channelId={channelId} sub={sub} name={name} />
        </div>
      </div>

      <div className={s.channelTabs}>
        <SegmentedControl
          options={[
            { value: 'videos', label: 'Videos' },
            { value: 'playlists', label: 'Playlists' },
          ]}
          value={view}
          onChange={setView}
        />
        {view === 'videos' && (
          <SegmentedControl
            options={[
              { value: 'newest', label: 'Latest' },
              { value: 'oldest', label: 'Oldest' },
              { value: 'popular', label: 'Popular' },
            ]}
            value={sort}
            onChange={setSort}
          />
        )}
      </div>

      {view === 'videos' && (
        <>
          <SearchBar value={query} onChange={setQuery} placeholder={`search all of ${name}…`} />

          {searching ? (
            <>
              {chSearch.error && <ErrorBox message={chSearch.error} />}
              {chSearch.loading && !chSearch.data && (
                <Receiving label={`searching ${name} for “${dq}”`} />
              )}
              {!chSearch.loading && (
                <div className={s.grid}>
                  {searchItems.map((item) => (
                    <VideoTile key={item.id} item={item} onPlay={setVideo} />
                  ))}
                </div>
              )}
              {!chSearch.loading && searchItems.length === 0 && (
                <p style={{ color: 'var(--paper-faint)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  no videos in {name} match “{dq}”.
                </p>
              )}
            </>
          ) : (
            <>
              {vids.error && <ErrorBox message={vids.error} />}
              {vids.loading && <Receiving label="rewinding the reels" />}
              <div className={s.grid}>
                {vids.videos.map((item) => (
                  <VideoTile key={item.id} item={item} onPlay={setVideo} />
                ))}
              </div>
              {!vids.loading && vids.continuation && (
                <div className={s.loadMoreWrap}>
                  <Button variant="ghost" onClick={vids.loadMore} disabled={vids.loadingMore}>
                    {vids.loadingMore ? 'loading…' : 'Load more videos'}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {view === 'playlists' && (
        <>
          {playlists.error && <ErrorBox message={playlists.error} />}
          {playlists.loading && !playlists.data && <Receiving label="pulling the playlists" />}
          {!playlists.loading && pls.length === 0 && (
            <p style={{ color: 'var(--paper-faint)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              this channel has no public playlists.
            </p>
          )}
          <div className={s.grid}>
            {pls.map((p) => (
              <PlaylistCard key={p.playlist_id} playlist={p} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function PlaylistPage() {
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const pl = useApi(`/youtube/playlist/${playlistId}`);
  const { open: setVideo } = usePlayer();
  const [query, setQuery] = useState('');

  const items = pl.data?.items || [];
  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items;
  const title = pl.data?.title || 'Playlist';
  const count = pl.data?.video_count;

  return (
    <>
      <button onClick={() => navigate(-1)} className={c.backLink} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
        <ArrowLeft size={13} /> back
      </button>
      <div className={s.channelHead}>
        <span className={s.channelLetter}>
          <ListVideo size={22} />
        </span>
        <div>
          <span className="kicker" style={{ color: 'var(--c-youtube)' }}>
            Playlist{pl.data?.author ? ` · ${pl.data.author}` : ''}
          </span>
          <h1 className={s.channelName}>{title}</h1>
          {count != null && (
            <span className={s.plMeta}>
              {count} videos{items.length < count ? ` · showing latest ${items.length}` : ''}
            </span>
          )}
        </div>
      </div>

      <SearchBar value={query} onChange={setQuery} placeholder="search this playlist…" />
      {pl.error && <ErrorBox message={pl.error} />}
      {pl.loading && !pl.data && <Receiving label="queuing the reels" />}

      <div className={s.grid}>
        {filtered.map((item) => (
          <VideoTile key={item.id} item={item} onPlay={setVideo} />
        ))}
      </div>
    </>
  );
}

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

export function HistoryPage() {
  const hist = useApi('/history?platform=youtube');
  const { open: setVideo } = usePlayer();
  const [query, setQuery] = useState('');

  const clearAll = async () => {
    if (!window.confirm('Clear your entire YouTube watch history?')) return;
    try {
      await api('/history?platform=youtube', { method: 'DELETE' });
    } catch {
      /* best-effort */
    }
    hist.reload();
  };

  const remove = async (row, e) => {
    e.stopPropagation();
    try {
      await api(`/history?item_id=${encodeURIComponent(row.item_id)}`, { method: 'DELETE' });
    } catch {
      /* best-effort */
    }
    hist.reload();
  };

  const rows = hist.data?.items || [];
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          (r.title || '').toLowerCase().includes(q) ||
          (r.source_name || '').toLowerCase().includes(q),
      )
    : rows;

  return (
    <>
      <Link to="/youtube" className={c.backLink}>
        <ArrowLeft size={13} /> back to the screening room
      </Link>

      <SectionHead
        kicker="No 02 — Screening Room"
        title="Watch history"
        note="Everything you've played here, newest first. Stored only on this machine."
        color="var(--c-youtube)"
      >
        {rows.length > 0 && (
          <Button variant="danger" onClick={clearAll}>
            <Trash2 size={14} /> Clear history
          </Button>
        )}
      </SectionHead>

      {rows.length > 0 && (
        <SearchBar value={query} onChange={setQuery} placeholder="search your history…" />
      )}

      {hist.error && <ErrorBox message={hist.error} />}
      {hist.loading && !hist.data && <Receiving label="rewinding the tape" />}

      {!hist.loading && rows.length === 0 && (
        <EmptyState
          icon={<History size={32} />}
          color="var(--c-youtube)"
          title="Nothing watched yet"
          subtitle="Play a video anywhere in the Screening Room and it will show up here."
        />
      )}

      <div className={s.grid}>
        {filtered.map((row) => {
          const item = historyItemFromRow(row);
          return (
            <div key={row.item_id} className={s.histTile}>
              <button
                className={s.histRemove}
                title="Remove from history"
                onClick={(e) => remove(row, e)}
              >
                <Trash2 size={13} />
              </button>
              <VideoTile
                item={item}
                onPlay={setVideo}
                meta={
                  <>
                    {row.source_name && `${row.source_name} · `}
                    watched {timeAgo(row.watched_at)}
                    {row.watch_count > 1 && ` · ${row.watch_count}×`}
                  </>
                }
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
