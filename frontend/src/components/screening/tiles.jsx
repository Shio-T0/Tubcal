// The Screening Room's pieces of film: the video tile (walls and shelves), the
// compact row (lists — just in, the playlist, the logbook), and the shelf that
// strings tiles into a scrolling row. Anything that plays a YouTube video in the
// hub draws it with these, so a video looks — and behaves — the same everywhere.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, Play, Plus, Radio, Shuffle } from 'lucide-react';

import { Avatar } from '../ui/Avatar.jsx';
import { QueueButton, SaveButton, WatchedButton } from '../ui/ItemActions.jsx';
import { clock, formatWhen, timeAgo, timeUntil } from '../../lib/time.js';
import { useHorizontalWheel } from '../../lib/useHorizontalWheel.js';
import { useSubscriptions } from '../../state.jsx';
import { useWatched } from './feed.js';
import t from './tiles.module.css';

// Compact view counts: 1234 → "1.2K", 3_400_000 → "3.4M".
export const compactNum = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** channel id → avatar, from your subscriptions (RSS items carry no faces). */
export function useChannelFaces() {
  const { subs } = useSubscriptions();
  return useMemo(() => new Map(subs.youtube.map((x) => [x.source_id, x.thumbnail])), [subs.youtube]);
}

// The channel name links to that channel's page. stopPropagation keeps a click on
// the name from also triggering the tile's play handler.
export function ChannelLink({ item, className, face }) {
  const channelId = item.extra?.channel_id;
  const inner = (
    <>
      {face !== undefined && (
        <Avatar src={face} name={item.source} imgClass={t.face} letterClass={t.faceLetter} />
      )}
      <span className={t.channelName}>{item.source}</span>
    </>
  );
  if (!channelId) return <span className={`${t.channel} ${className || ''}`}>{inner}</span>;
  return (
    <Link
      to={`/youtube/c/${channelId}`}
      className={`${t.channel} ${t.channelLink} ${className || ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {inner}
    </Link>
  );
}

// LIVE / scheduled badge for a video, driven by extra.live_status set by the
// live-and-upcoming endpoint. Returns null for ordinary videos.
export function LiveBadge({ item, className }) {
  const status = item.extra?.live_status;
  if (status === 'is_live') {
    return (
      <span className={`${t.badge} ${t.live} ${className || ''}`}>
        <Radio size={11} /> LIVE
      </span>
    );
  }
  if (status === 'is_upcoming') {
    const at = item.extra?.scheduled_at;
    return (
      <span className={`${t.badge} ${t.upcoming} ${className || ''}`} title={at ? formatWhen(at) : 'Scheduled'}>
        <CalendarClock size={11} /> {at ? timeUntil(at) : 'Upcoming'}
      </span>
    );
  }
  return null;
}

function playKeys(onPlay, item) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPlay(item);
    }
  };
}

/** The standard meta line: face · channel · age · views (or whatever `meta` says). */
function MetaLine({ item, meta, faces }) {
  if (meta != null) return meta;
  const views = item.extra?.view_count ?? (typeof item.score === 'number' ? item.score : null);
  const cid = item.extra?.channel_id;
  return (
    <>
      <ChannelLink item={item} face={cid && faces?.has(cid) ? faces.get(cid) : undefined} />
      {item.published_at ? (
        <span>{item.published_at * 1000 > Date.now() + 60_000 ? timeUntil(item.published_at) : timeAgo(item.published_at)}</span>
      ) : null}
      {views ? <span>{compactNum.format(views)} views</span> : null}
    </>
  );
}

function ProgressBar({ ratio, done, className }) {
  if (!(ratio > 0)) return null;
  return (
    <div className={`${t.progress} ${className || ''}`} title={done ? 'Watched' : `${Math.round(ratio * 100)}% watched`}>
      <div className={`${t.progressFill} ${done ? t.progressDone : ''}`} style={{ width: `${done ? 100 : Math.max(3, ratio * 100)}%` }} />
    </div>
  );
}

/** A video on a wall or a shelf. `fresh` marks it new since you last looked. */
export function VideoTile({ item, onPlay, meta, fresh = false, className }) {
  const watched = useWatched();
  const faces = useChannelFaces();
  const { ratio, done } = watched(item);
  const length = item.extra?.length_seconds;
  return (
    <div
      className={`${t.tile} ${done ? t.tileDone : ''} ${className || ''}`}
      onClick={() => onPlay(item)}
      data-kbd-tile
      tabIndex={0}
      role="button"
      onKeyDown={playKeys(onPlay, item)}
    >
      <div className={t.thumbWrap}>
        <img className={t.thumb} src={item.thumbnail} alt="" loading="lazy" />
        <span className={t.scrim} aria-hidden="true" />
        <span className={t.sheen} aria-hidden="true" />
        <div className={t.play}>
          <span><Play size={18} fill="currentColor" /></span>
        </div>
        {item.extra?.live_status ? <LiveBadge item={item} /> : fresh && <span className={`${t.badge} ${t.fresh}`}>new</span>}
        <div className={t.actions}>
          <WatchedButton item={item} />
          <QueueButton item={item} />
          <SaveButton item={item} />
        </div>
        {length ? <span className={t.duration}>{clock(length)}</span> : null}
        <ProgressBar ratio={ratio} done={done} />
      </div>
      <div className={t.title}>{item.title}</div>
      <div className={t.meta}><MetaLine item={item} meta={meta} faces={faces} /></div>
    </div>
  );
}

/** A video as one line of a list: thumb left, words right. */
export function VideoRow({ item, onPlay, meta, fresh = false, index, aside, className }) {
  const watched = useWatched();
  const faces = useChannelFaces();
  const { ratio, done } = watched(item);
  const length = item.extra?.length_seconds;
  return (
    <div
      className={`${t.row} ${done ? t.tileDone : ''} ${className || ''}`}
      onClick={() => onPlay(item)}
      data-kbd-tile
      tabIndex={0}
      role="button"
      onKeyDown={playKeys(onPlay, item)}
    >
      {index != null && <span className={t.rowIndex}>{index}</span>}
      <div className={t.rowThumb}>
        <img src={item.thumbnail} alt="" loading="lazy" />
        {length ? <span className={t.duration}>{clock(length)}</span> : null}
        <LiveBadge item={item} className={t.rowBadge} />
        <ProgressBar ratio={ratio} done={done} />
      </div>
      <div className={t.rowText}>
        <div className={t.rowTitle}>
          {fresh && <span className={t.freshDot} title="New since you last looked" />}
          {item.title}
        </div>
        <div className={t.meta}><MetaLine item={item} meta={meta} faces={faces} /></div>
      </div>
      {aside}
      <div className={t.rowActions}>
        <QueueButton item={item} />
        <SaveButton item={item} />
      </div>
    </div>
  );
}

/** A named row of tiles that scrolls sideways (the wheel scrolls it too).
 *  `tone` tints the shelf's lamp; `tall` stacks two rows of larger tiles. */
export function Shelf({
  id, title, lead, note, items, onPlay, isNew, tone, tall = false, allTo, allLabel = 'view all',
  onShuffle, shuffling, onLoadMore, hasMore, loadingMore, tileMeta, className,
}) {
  const rowRef = useHorizontalWheel();
  return (
    <section
      id={id}
      className={`${t.shelf} ${tall ? t.shelfTall : ''} ${className || ''}`}
      style={tone ? { '--shelf-c': tone } : undefined}
      data-shelf={id}
    >
      <div className={t.shelfHead}>
        {lead || <span className={t.lamp} aria-hidden="true" />}
        <h2 className={t.shelfTitle}>{title}</h2>
        {note && <span className={t.shelfNote}>{note}</span>}
        <span className={t.shelfActs}>
          {onShuffle && (
            <button type="button" className={t.shelfAct} onClick={onShuffle}>
              <Shuffle size={12} className={shuffling ? t.spin : ''} /> reshuffle
            </button>
          )}
          {allTo && (
            <Link className={t.shelfAct} to={allTo}>
              {allLabel} <ArrowRight size={12} />
            </Link>
          )}
        </span>
      </div>
      <div className={t.shelfRow} ref={rowRef}>
        {items.map((item) => (
          <VideoTile
            key={item.id}
            item={item}
            onPlay={onPlay}
            fresh={isNew ? isNew(item) : false}
            meta={tileMeta ? tileMeta(item) : undefined}
          />
        ))}
        {onLoadMore && hasMore && (
          <button type="button" className={t.moreTile} onClick={onLoadMore} disabled={loadingMore} data-kbd-tile>
            <Plus size={20} />
            {loadingMore ? 'loading…' : 'load more'}
          </button>
        )}
      </div>
    </section>
  );
}

/** A wall of tiles — search results, a channel's catalogue, a day of uploads. */
export function Wall({ children, className }) {
  return <div className={`${t.wall} ${className || ''}`}>{children}</div>;
}
