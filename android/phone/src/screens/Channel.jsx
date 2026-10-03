// A channel, as a phone page: its face, Subscribe and Play all up top, then its
// videos (newest, popular or oldest — or search the whole catalogue) and its
// playlists. Opening it clears the channel's "new" badges everywhere else.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExternalLink, ListVideo, Play, Search, Share2, X } from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';
import { Avatar } from '@pc/components/ui/Avatar.jsx';
import { markSeen, seenSince } from '@pc/components/screening/feed.js';
import { SubscribeButton } from '@pc/components/screening/SubscribeButton.jsx';
import { useDebounced } from '@pc/components/layout/Section.jsx';
import { useParamState } from '@pc/lib/urlState.js';
import { useProgress, useSubscriptions } from '@pc/state.jsx';

import { openExternal, share } from '../lib/bridge.js';
import { AppBar, Chips, Empty, ErrorNote, IconBtn, Loading, Sentinel, Skeleton } from '../shell/Shell.jsx';
import { usePlayAll, VideoCard } from './video.jsx';
import c from './channel.module.css';

function useChannelVideos(channelId, sort) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setPages([]);
    api(`/youtube/channel/${channelId}/videos?sort=${sort}`)
      .then((d) => { if (alive) { setPages([d]); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e.message); setLoading(false); } });
    return () => { alive = false; };
  }, [channelId, sort]);
  const cont = pages.length ? pages[pages.length - 1].continuation : null;
  const videos = useMemo(() => {
    const seen = new Set();
    return pages.flatMap((p) => p.items || []).filter((it) => (seen.has(it.id) ? false : seen.add(it.id)));
  }, [pages]);
  const loadMore = () => {
    if (!cont || more) return;
    setMore(true);
    api(`/youtube/channel/${channelId}/videos?sort=${sort}&continuation=${encodeURIComponent(cont)}`)
      .then((d) => setPages((p) => [...p, d]))
      .catch(() => {})
      .finally(() => setMore(false));
  };
  return { videos, loading, more, error, cont, loadMore };
}

export default function Channel() {
  const { channelId } = useParams();
  const { subs } = useSubscriptions();
  const sub = subs.youtube.find((x) => x.source_id === channelId);
  const { progress } = useProgress();
  const [tab, setTab] = useParamState('tab', 'videos');
  const [sort, setSort] = useParamState('sort', 'newest');
  const [q, setQ] = useParamState('q', '');
  const [searching, setSearching] = useState(!!q);
  const [text, setText] = useState(q);
  const dq = useDebounced(text.trim(), 450);
  useEffect(() => { if (dq !== q) setQ(dq); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  const since = useMemo(() => seenSince(channelId), [channelId]);
  useEffect(() => { markSeen(channelId); }, [channelId]);
  const fresh = (i) => !!i.published_at && i.published_at > since && i.published_at < Date.now() / 1000 && !progress[i.id];

  const vids = useChannelVideos(channelId, sort);
  const about = useApi(`/youtube/channel/${channelId}/about`, !sub);
  const playlists = useApi(`/youtube/channel/${channelId}/playlists`, tab === 'playlists');
  const found = useApi(`/youtube/channel/${channelId}/search?q=${encodeURIComponent(q)}`, tab === 'videos' && !!q);
  const name = sub?.display_name || about.data?.title || vids.videos[0]?.source || 'Channel';
  const face = sub?.thumbnail || about.data?.thumbnail;
  const url = `https://www.youtube.com/channel/${channelId}`;

  const playAll = usePlayAll();

  const shown = q ? found.data?.items || [] : vids.videos;

  return (
    <div>
      <AppBar
        title={name}
        sub={sub ? 'your channel' : 'channel'}
        back
        backTo="/youtube"
        tone="var(--c-youtube)"
        actions={
          <>
            <IconBtn label="Search this channel" active={searching} onClick={() => { setSearching((x) => !x); if (searching) setText(''); }}><Search size={20} /></IconBtn>
            <IconBtn label="Share" onClick={() => share({ title: name, url })}><Share2 size={20} /></IconBtn>
          </>
        }
      >
        {searching && (
          <label className={c.search}>
            <Search size={16} />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Search ${name}…`} autoFocus />
            {text && <button type="button" onClick={() => setText('')} aria-label="Clear"><X size={16} /></button>}
          </label>
        )}
      </AppBar>

      {!searching && (
        <header className={c.head}>
          <Avatar src={face} name={name} imgClass={c.face} letterClass={c.faceLetter} />
          <h2 className={c.name}>{name}</h2>
          <div className={c.headActs}>
            <SubscribeButton channelId={channelId} sub={sub} name={name} />
            {vids.videos.length > 0 && <button type="button" className={c.playAll} onClick={() => playAll(vids.videos)}><Play size={15} fill="currentColor" /> Play all</button>}
            <button type="button" className={c.out} onClick={() => openExternal(url)} aria-label="Open in YouTube"><ExternalLink size={17} /></button>
          </div>
        </header>
      )}

      {!q && (
        <div className={c.chips}>
          <Chips
            items={[{ key: 'videos', label: 'Videos' }, { key: 'playlists', label: 'Playlists', Icon: ListVideo }]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'videos' && (
            <Chips
              className={c.sorts}
              items={[{ key: 'newest', label: 'Latest' }, { key: 'popular', label: 'Popular' }, { key: 'oldest', label: 'Oldest' }]}
              value={sort}
              onChange={setSort}
            />
          )}
        </div>
      )}

      {tab === 'videos' && (
        <>
          {(q ? found.error : vids.error) && <ErrorNote message={q ? found.error : vids.error} />}
          {(q ? found.loading && !found.data : vids.loading) && <Skeleton kind="cards" n={3} />}
          {q && found.data && !shown.length && <Empty Icon={Search} title="No matches" text={`Nothing in ${name} matches “${q}”.`} />}
          {shown.map((i) => <VideoCard key={i.id} item={i} fresh={fresh(i)} />)}
          {!q && <Sentinel onReach={vids.loadMore} active={!!vids.cont && !vids.more} />}
          {vids.more && <Loading label="more reels" />}
        </>
      )}

      {tab === 'playlists' && (
        <>
          {playlists.loading && !playlists.data && <Skeleton kind="posters" n={6} />}
          {playlists.data && !(playlists.data.items || []).length && <Empty Icon={ListVideo} title="No playlists" text="This channel has no public playlists." />}
          <div className={c.lists}>
            {(playlists.data?.items || []).map((pl) => (
              <Link key={pl.playlist_id} to={`/youtube/playlist/${pl.playlist_id}`} className={c.list} data-reveal="pop">
                <span className={c.listPic}>
                  {pl.thumbnail ? <img src={pl.thumbnail} alt="" loading="lazy" /> : <ListVideo size={24} />}
                  <em><ListVideo size={12} /> {pl.video_count ?? '—'}</em>
                </span>
                <b>{pl.title}</b>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
