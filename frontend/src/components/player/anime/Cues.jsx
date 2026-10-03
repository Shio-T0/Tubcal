// What the anime player says over the picture, from the source's own timings:
// "Skip opening" while the OP plays (its fill tracks how much is left), "Next
// episode" (or "Skip ending" on the last one) while the ED rolls, and — when an
// episode ends — a countdown into the next one. With auto-skip on (Settings → The
// Anime) the opening is jumped once per episode, and a chip offers it back.

import { useEffect, useRef, useState } from 'react';
import { Play, SkipForward, Undo2 } from 'lucide-react';

import a from './anime.module.css';

const within = (span, t) => span && t >= span.start && t < span.end - 1;

export function SkipCue({ current, skip, next, onSeek, onNext, autoSkip }) {
  const intro = skip?.intro;
  const outro = skip?.outro;
  const skipped = useRef(false);
  const [undo, setUndo] = useState(null); // seconds to return to, while the chip shows

  useEffect(() => {
    if (!autoSkip || skipped.current || !within(intro, current)) return;
    skipped.current = true; // once per episode: seeking back into it is a choice
    setUndo(Math.max(intro.start, current));
    onSeek(intro.end);
  }, [autoSkip, intro, current, onSeek]);
  useEffect(() => {
    if (undo == null) return undefined;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  if (undo != null) {
    return (
      <div className={a.cue}>
        <span className={a.cueNote}>Opening skipped</span>
        <button type="button" className={a.cueBtn} onClick={() => { onSeek(undo); setUndo(null); }}>
          <Undo2 size={15} /> Watch it
        </button>
      </div>
    );
  }
  const span = within(intro, current) ? intro : within(outro, current) ? outro : null;
  if (!span) return null;
  const fill = Math.min(1, (current - span.start) / (span.end - span.start));
  const isIntro = span === intro;
  const goNext = !isIntro && next;
  return (
    <div className={a.cue}>
      <button
        type="button"
        className={a.cueBtn}
        style={{ '--fill': fill }}
        onClick={() => (goNext ? onNext() : onSeek(span.end))}
      >
        <span className={a.cueFill} aria-hidden="true" />
        {goNext ? <Play size={15} fill="currentColor" /> : <SkipForward size={15} fill="currentColor" />}
        {isIntro ? 'Skip opening' : goNext ? `Next episode` : 'Skip ending'}
      </button>
    </div>
  );
}

const COUNT = 8;

export function NextUp({ ep, show, onPlay, onCancel }) {
  const [left, setLeft] = useState(COUNT);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return undefined;
    if (left <= 0) { onPlay(); return undefined; }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, held, onPlay]);

  return (
    <div className={a.nextUp} role="dialog" aria-label={`Episode ${ep.number} is next`}>
      <div className={a.nextCard} onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
        <span className={a.nextThumb}>
          {ep.still ? <img src={ep.still} alt="" /> : <span className={a.railSlate}><b>{ep.number}</b></span>}
        </span>
        <div className={a.nextText}>
          <span className={a.nextKicker}>{held ? 'Up next' : `Up next in ${left}s`}</span>
          <b>Episode {ep.number}</b>
          {ep.title && <em>{ep.title}</em>}
          <span className={a.nextShow}>{show}</span>
          <div className={a.nextActs}>
            <button type="button" className={a.nextPlay} onClick={onPlay} autoFocus>
              <Play size={15} fill="currentColor" /> Play now
            </button>
            <button type="button" className={a.nextCancel} onClick={onCancel}>Stay here</button>
          </div>
        </div>
        <span className={a.nextRing} style={{ '--p': held ? 1 : left / COUNT }} aria-hidden="true" />
      </div>
    </div>
  );
}
