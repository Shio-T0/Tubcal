// A playlist: its cover and count, Play all / Shuffle within thumb reach, then
// the numbered list. Long lists get a find-in-playlist field.

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ListVideo, Play, Search, Share2, Shuffle, X } from 'lucide-react';

import { useApi } from '@pc/api/client.js';

import { share } from '../lib/bridge.js';
import { AppBar, Empty, ErrorNote, IconBtn, Skeleton } from '../shell/Shell.jsx';
import { shuffled, usePlayAll, VideoRow } from './video.jsx';
import l from './lists.module.css';

export default function Playlist() {
  const { playlistId } = useParams();
  const pl = useApi(`/youtube/playlist/${playlistId}`);
  const playAll = usePlayAll();
  const [find, setFind] = useState(null);

  const items = pl.data?.items || [];
  const ql = (find || '').trim().toLowerCase();
  const shown = ql ? items.filter((i) => i.title.toLowerCase().includes(ql)) : items;
  const title = pl.data?.title || 'Playlist';
  const count = pl.data?.video_count;
  const cover = items[0]?.thumbnail;
  const url = `https://www.youtube.com/playlist?list=${playlistId}`;

  return (
    <div>
      <AppBar
        title={find != null ? '' : title}
        sub={find != null ? null : pl.data?.author || 'playlist'}
        back
        backTo="/youtube"
        tone="var(--c-youtube)"
        actions={
          <>
            {items.length > 8 && (
              <IconBtn label="Find in playlist" active={find != null} onClick={() => setFind(find != null ? null : '')}><Search size={20} /></IconBtn>
            )}
            <IconBtn label="Share" onClick={() => share({ title, url })}><Share2 size={20} /></IconBtn>
          </>
        }
      >
        {find != null && (
          <label className={l.find}>
            <Search size={16} />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in this playlist…" autoFocus />
            {find && <button type="button" onClick={() => setFind('')} aria-label="Clear"><X size={16} /></button>}
          </label>
        )}
      </AppBar>

      {find == null && (
        <header className={l.cover}>
          <span className={l.coverPic}>
            {cover ? <img src={cover} alt="" /> : <ListVideo size={34} />}
          </span>
          <div className={l.coverText}>
            <h2>{title}</h2>
            {count != null && <span>{count} video{count === 1 ? '' : 's'}{items.length < count ? ` · ${items.length} here` : ''}</span>}
          </div>
          {items.length > 0 && (
            <div className={l.coverActs}>
              <button type="button" className={l.primary} onClick={() => playAll(items)}><Play size={16} fill="currentColor" /> Play all</button>
              <button type="button" className={l.ghost} onClick={() => playAll(shuffled(items))}><Shuffle size={16} /> Shuffle</button>
            </div>
          )}
        </header>
      )}

      {pl.error && <ErrorNote message={pl.error} onRetry={pl.reload} />}
      {pl.loading && !pl.data && <Skeleton kind="rows" n={5} />}
      {shown.map((i) => <VideoRow key={i.id} item={i} index={items.indexOf(i) + 1} />)}
      {pl.data && !shown.length && <Empty Icon={ListVideo} title={ql ? 'No matches' : 'Empty'} text={ql ? `Nothing here matches “${find}”.` : 'This playlist is empty.'} />}
    </div>
  );
}
