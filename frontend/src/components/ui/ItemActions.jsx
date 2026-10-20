import { Bookmark, BookmarkCheck, Check, ListChecks, ListPlus } from 'lucide-react';

import { COMPLETE_RATIO, usePlayer, useProgress, useSaved } from '../../state.jsx';
import s from './itemActions.module.css';

// Save / un-save anything (a video, a post, a title, a file, a page…) for later.
// Works inside a link or a clickable tile: the click stays with the button. Taking
// something off the list offers an Undo. `label` draws it as a pill with words,
// for headers and toolbars.
export function SaveButton({ item, className, label = false, size = 15 }) {
  const { saved, toggleSaved } = useSaved();
  if (!item?.id) return null;
  const on = !!saved[item.id];
  const words = on ? 'Remove from Saved' : 'Save for later';
  return (
    <button
      type="button"
      className={`${label ? s.labelled : s.action} ${on ? s.actionOn : ''} ${className || ''}`}
      title={words}
      aria-label={label ? undefined : words}
      aria-pressed={on}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSaved(item, { undo: true });
      }}
      // Enter/Space press this button, not the tile around it
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
    >
      {on ? <BookmarkCheck size={size} /> : <Bookmark size={size} />}
      {label && <span>{on ? 'Saved' : 'Save'}</span>}
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

// Put a video on the player's up-next queue (or take it off again). A finished
// video rolls straight into the next one queued.
export function QueueButton({ item, className }) {
  const { queue, enqueue, dequeue } = usePlayer();
  const on = queue.some((x) => x.id === item.id);
  return (
    <button
      className={`${s.action} ${on ? s.actionOn : ''} ${className || ''}`}
      title={on ? 'Take off Up next' : 'Play next — add to Up next'}
      aria-label={on ? 'Remove from Up next' : 'Add to Up next'}
      onClick={(e) => {
        e.stopPropagation();
        if (on) dequeue(item.id); else enqueue(item);
      }}
    >
      {on ? <ListChecks size={15} /> : <ListPlus size={15} />}
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
