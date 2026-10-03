// Videos, drawn for a thumb. A card is a full-width picture with the channel's
// face and the title under it; a row is the compact list form (picture left,
// words right). Both play on tap and open a sheet of actions on a long-press (or
// the ⋮): play next, save, mark watched, share, the channel, open in YouTube.

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bookmark, BookmarkCheck, Check, CircleDot, ExternalLink, ListPlus, MoreVertical, Share2, Tv, CalendarClock,
} from 'lucide-react';

import { Avatar } from '@pc/components/ui/Avatar.jsx';
import { useWatched } from '@pc/components/screening/feed.js';
import { compactNum, useChannelFaces } from '@pc/components/screening/tiles.jsx';
import { clock, formatWhen, timeAgo, timeUntil } from '@pc/lib/time.js';
import { usePlayer, useProgress, useSaved, useToast } from '@pc/state.jsx';

import { openExternal, share } from '../lib/bridge.js';
import { usePlay } from '../lib/play.js';
import { ActionSheet, useLongPress } from '../shell/Shell.jsx';
import v from './video.module.css';

function when(item) {
  if (!item.published_at) return null;
  if (item.published_at * 1000 > Date.now() + 60_000) return `in ${timeUntil(item.published_at).replace(/^in /, '')}`;
  const t = timeAgo(item.published_at);
  return t === 'now' ? 'just now' : `${t} ago`;
}

/** The ⋮ / long-press sheet for one video. */
export function VideoMenu({ item, open, onClose }) {
  const navigate = useNavigate();
  const { enqueue, queue } = usePlayer();
  const { saved, toggleSaved } = useSaved();
  const { markWatched } = useProgress();
  const toast = useToast();
  const watched = useWatched();
  const { done } = watched(item);
  const queued = queue.some((q) => q.id === item.id);
  const cid = item.extra?.channel_id;
  const isSaved = !!saved[item.id];
  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      head={
        <div className={v.menuHead}>
          {item.thumbnail && <img src={item.thumbnail} alt="" />}
          <span><b>{item.title}</b><em>{item.source}</em></span>
        </div>
      }
      actions={[
        !queued && { label: 'Play next', Icon: ListPlus, onClick: () => { enqueue(item); toast('Queued — plays next', 'success'); } },
        { label: isSaved ? 'Remove from Saved' : 'Save for later', Icon: isSaved ? BookmarkCheck : Bookmark, onClick: () => toggleSaved(item) },
        item.platform === 'youtube' && { label: done ? 'Mark as unwatched' : 'Mark as watched', Icon: done ? CircleDot : Check, onClick: () => markWatched(item, !done) },
        { label: 'Share', Icon: Share2, onClick: () => share({ title: item.title, url: item.url }) },
        cid && { label: `Go to ${item.source || 'the channel'}`, Icon: Tv, onClick: () => navigate(`/youtube/c/${cid}`) },
        item.url && { label: 'Open in YouTube', Icon: ExternalLink, onClick: () => openExternal(item.url) },
      ]}
    />
  );
}

function Badges({ item, fresh }) {
  const st = item.extra?.live_status;
  if (st === 'is_live') return <span className={`${v.badge} ${v.live}`}><i className={v.liveDot} /> LIVE</span>;
  if (st === 'is_upcoming') {
    const at = item.extra?.scheduled_at;
    return <span className={`${v.badge} ${v.soon}`} title={at ? formatWhen(at) : ''}><CalendarClock size={11} /> {at ? timeUntil(at) : 'soon'}</span>;
  }
  if (fresh) return <span className={`${v.badge} ${v.fresh}`}>new</span>;
  return null;
}

function Thumb({ item, fresh, className }) {
  const watched = useWatched();
  const { ratio, done } = watched(item);
  const length = item.extra?.length_seconds;
  return (
    <div className={`${v.thumb} ${done ? v.done : ''} ${className || ''}`}>
      {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <span className={v.noPic} />}
      <Badges item={item} fresh={fresh} />
      {length ? <span className={v.len}>{clock(length)}</span> : null}
      {ratio > 0 && (
        <span className={v.prog}><i className={done ? v.progDone : undefined} style={{ width: `${done ? 100 : Math.max(4, ratio * 100)}%` }} /></span>
      )}
    </div>
  );
}

/** Full-width card: picture, then face + title + meta, ⋮ on the right. */
export function VideoCard({ item, fresh = false, meta, size = 'full', onPlay }) {
  const { play: playIt } = usePlay();
  const faces = useChannelFaces();
  const [menu, setMenu] = useState(false);
  const lp = useLongPress(() => setMenu(true));
  const pic = useRef(null);
  const cid = item.extra?.channel_id;
  const face = cid ? faces.get(cid) : undefined;
  const views = item.extra?.view_count ?? (typeof item.score === 'number' ? item.score : null);
  // the thumbnail itself grows into the player
  const play = () => (onPlay ? onPlay(item) : playIt(item, pic.current));
  return (
    <article className={`${v.card} ${v[size]}`} data-reveal>
      <button type="button" className={v.cardHit} onClick={play} ref={pic} {...lp}>
        <Thumb item={item} fresh={fresh} />
      </button>
      <div className={v.cardText}>
        {size === 'full' && <Avatar src={face} name={item.source} imgClass={v.face} letterClass={v.faceLetter} />}
        <button type="button" className={v.cardWords} onClick={play} {...lp}>
          <b>{item.title}</b>
          <span className={v.meta}>
            {meta ?? (
              <>
                {item.source && <span>{item.source}</span>}
                {views ? <span>{compactNum.format(views)} views</span> : null}
                {when(item) && <span>{when(item)}</span>}
              </>
            )}
          </span>
        </button>
        <button type="button" className={v.more} onClick={() => setMenu(true)} aria-label="More">
          <MoreVertical size={19} />
        </button>
      </div>
      <VideoMenu item={item} open={menu} onClose={() => setMenu(false)} />
    </article>
  );
}

/** Compact row: picture left (40%), words right. */
export function VideoRow({ item, fresh = false, meta, index, aside, onPlay }) {
  const { play: playIt } = usePlay();
  const [menu, setMenu] = useState(false);
  const lp = useLongPress(() => setMenu(true));
  const pic = useRef(null);
  const play = () => (onPlay ? onPlay(item) : playIt(item, pic.current));
  return (
    <div className={v.row} data-reveal>
      {index != null && <span className={v.index}>{index}</span>}
      <button type="button" className={v.rowHit} onClick={play} ref={pic} {...lp}>
        <Thumb item={item} fresh={fresh} className={v.rowThumb} />
        <span className={v.rowWords}>
          <b>{item.title}</b>
          <span className={v.meta}>
            {meta ?? (
              <>
                {item.source && <span>{item.source}</span>}
                {when(item) && <span>{when(item)}</span>}
              </>
            )}
          </span>
        </span>
      </button>
      {aside}
      <button type="button" className={v.more} onClick={() => setMenu(true)} aria-label="More">
        <MoreVertical size={18} />
      </button>
      <VideoMenu item={item} open={menu} onClose={() => setMenu(false)} />
    </div>
  );
}

/** A sideways-scrolling strip of medium cards. */
export function Strip({ items, isNew, meta }) {
  return (
    <div className={v.rail}>
      {items.map((it) => (
        <VideoCard key={it.id} item={it} fresh={isNew ? isNew(it) : false} meta={meta ? meta(it) : undefined} size="strip" />
      ))}
    </div>
  );
}

/** Queue a run of videos: the first plays now, the rest line up behind it. */
export function usePlayAll() {
  const { enqueue } = usePlayer();
  const { play } = usePlay();
  return (items) => {
    const list = (items || []).filter((i) => !i.extra?.live_status || i.extra.live_status === 'is_live');
    if (!list.length) return;
    play(list[0]);
    list.slice(1, 50).forEach((i) => enqueue(i));
  };
}

export function shuffled(items) {
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
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

export function byDay(items, at = (i) => i.published_at) {
  const out = [];
  for (const it of items) {
    const label = dayLabel(at(it));
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}

export { when };
