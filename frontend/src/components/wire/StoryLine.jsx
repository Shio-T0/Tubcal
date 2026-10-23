// One story on the Wire's tape, as the board and By topic's panels both draw
// it: rank, headline (straight to the article), where it's from, who and when,
// points with a little heat gauge (points per hour, so a rising story reads
// hot), and the comment count with how many arrived since you last read the
// thread. Stories you've read go quiet. Pressing the line opens its discussion.

import { Flame, MessageSquare } from 'lucide-react';

import { SaveButton } from '../ui/ItemActions.jsx';
import { compact, splitKind } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import s from './line.module.css';

/** Points per hour since posting, as a 0–1 "how hot" reading. */
export function heatOf(item) {
  if (!item.score || !item.published_at) return 0;
  const hours = Math.max(1, (Date.now() / 1000 - item.published_at) / 3600);
  return Math.min(1, item.score / hours / 60);
}

/** tight: the narrow form (beside the open reader, on a panel). */
export default function StoryLine({ item, rank, open, onOpen, seen, fresh, tight }) {
  const read = !!seen;
  const { kind, rest } = splitKind(item.title);
  const heat = heatOf(item);
  const domain = item.extra?.domain;
  const linkOut = item.url && !item.url.includes('news.ycombinator.com/item');
  return (
    <div
      className={`${s.line} ${read ? s.lineRead : ''} ${open ? s.lineOpen : ''} ${tight ? s.tight : ''}`}
      data-kbd-tile
      tabIndex={0}
      role="button"
      aria-current={open ? 'true' : undefined}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item); } }}
    >
      <span className={s.rank}>{String(rank).padStart(2, '0')}</span>
      <div className={s.main}>
        <div className={s.headline}>
          {kind && <span className={s.kind}>{kind}</span>}
          {linkOut ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open the article">
              {rest}
            </a>
          ) : (
            <span>{rest}</span>
          )}
        </div>
        <div className={s.meta}>
          {domain && <span className={s.domain}>{domain}</span>}
          {!tight && item.author && <span>{item.author}</span>}
          {item.published_at ? <span>{timeAgo(item.published_at)}</span> : null}
          {read && <span className={s.readMark}>read</span>}
        </div>
      </div>
      <div className={s.nums}>
        <span className={s.points} title={`${item.score ?? 0} points`}>
          {heat > 0.6 && <Flame size={12} className={s.flame} />}
          <b>{compact(item.score) ?? '–'}</b>
          <span className={s.gauge} aria-hidden="true"><i style={{ width: `${Math.max(6, heat * 100)}%` }} /></span>
        </span>
        <span className={s.cmts} title={`${item.comments_count ?? 0} comments`}>
          <MessageSquare size={13} /> {compact(item.comments_count) ?? 0}
          {fresh > 0 && <em className={s.freshN}>+{compact(fresh)}</em>}
        </span>
      </div>
      <div className={s.acts} onClick={(e) => e.stopPropagation()}>
        <SaveButton item={item} className={s.save} />
      </div>
    </div>
  );
}
