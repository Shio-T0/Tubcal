import { Bookmark, BookmarkCheck, Check } from 'lucide-react';

import { COMPLETE_RATIO, useProgress, useSaved } from '../../state.jsx';
import s from './itemActions.module.css';

// Save / un-save any item (video, post, story) for later.
export function SaveButton({ item, className }) {
  const { saved, toggleSaved } = useSaved();
  const on = !!saved[item.id];
  return (
    <button
      className={`${s.action} ${on ? s.actionOn : ''} ${className || ''}`}
      title={on ? 'Remove from Saved' : 'Save for later'}
      aria-label={on ? 'Remove from Saved' : 'Save for later'}
      onClick={(e) => {
        e.stopPropagation();
        toggleSaved(item);
      }}
    >
      {on ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
    </button>
  );
}

// Mark a video watched / unwatched (YouTube only — fills the progress bar).
export function WatchedButton({ item, className }) {
  const { progress, markWatched } = useProgress();
  const p = progress[item.id];
  const done = p && p.duration ? p.position / p.duration >= COMPLETE_RATIO : false;
  return (
    <button
      className={`${s.action} ${done ? s.actionOn : ''} ${className || ''}`}
      title={done ? 'Mark as unwatched' : 'Mark as watched'}
      aria-label={done ? 'Mark as unwatched' : 'Mark as watched'}
      onClick={(e) => {
        e.stopPropagation();
        markWatched(item, !done);
      }}
    >
      <Check size={15} />
    </button>
  );
}

// Corner cluster used on thumbnails. `watched` adds the mark-watched toggle.
export function TileActions({ item, watched = false }) {
  return (
    <div className={s.cluster}>
      {watched && <WatchedButton item={item} />}
      <SaveButton item={item} />
    </div>
  );
}
