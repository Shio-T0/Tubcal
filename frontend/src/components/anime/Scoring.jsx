// The two score controls the Anime room shares.
//
//   ScoreDial        your overall score, in your own AniList format: ten tiles on
//                    the point scales (with a fine-tune for 100-point and decimal),
//                    five stars, or three faces. Hovering previews, so the host can
//                    say the word ("Very good") before you commit.
//   CategoryScores   AniList's advanced scoring — one meter per category (Story,
//                    Characters, …), their average, and a one-tap "use as score".
//
// Both commit through a callback; neither knows about AniList. CategoryScores has
// two ways of committing: `live` (every change goes out, the desktop's way) and
// `confirm` (read-only until you tap Edit, nothing written until Save — on a phone
// a thumb that only meant to scroll must never move a score).

import { useEffect, useRef, useState } from 'react';
import { Check, Frown, Meh, Minus, Pencil, Plus, Smile, Star, X } from 'lucide-react';

import { FACE_WORDS, categoryAverage, fmtScore, fromTen, scaleOf, snap, tenOf, WORDS } from './scoring.js';
import k from './scoring.module.css';

const TENS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const FACES = [[1, Frown], [2, Meh], [3, Smile]];

/** The overall score control. `onPreview(v)` reports the hovered score (0 when the
 *  pointer leaves) in the viewer's format. */
export function ScoreDial({ format, value, onSet, onPreview }) {
  const [hover, setHover] = useState(0);
  const preview = (v) => { setHover(v); onPreview?.(v); };
  const lit = hover || value;

  if (format === 'POINT_5') {
    return (
      <div className={k.stars} onMouseLeave={() => preview(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={k.star}
            data-on={lit >= n ? '' : undefined}
            onMouseEnter={() => preview(n)}
            onClick={() => onSet(value === n ? 0 : n)}
            aria-label={`${n} of 5 — ${WORDS[n * 2]}`}
            aria-pressed={value === n}
          >
            <Star fill="currentColor" />
          </button>
        ))}
      </div>
    );
  }

  if (format === 'POINT_3') {
    return (
      <div className={k.faces}>
        {FACES.map(([n, Icon]) => (
          <button
            key={n}
            type="button"
            className={k.face}
            data-on={value === n ? '' : undefined}
            onMouseEnter={() => preview(n)}
            onMouseLeave={() => preview(0)}
            onClick={() => onSet(value === n ? 0 : n)}
            aria-label={FACE_WORDS[n]}
            aria-pressed={value === n}
          >
            <Icon />
          </button>
        ))}
      </div>
    );
  }

  const { max, step } = scaleOf(format);
  const fine = format === 'POINT_100' || format === 'POINT_10_DECIMAL';
  return (
    <div className={k.dial}>
      <div className={k.tens} onMouseLeave={() => preview(0)} role="radiogroup" aria-label="Score">
        {TENS.map((n) => {
          const on = tenOf(value, format) === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              className={k.ten}
              data-on={on ? '' : undefined}
              data-lit={tenOf(lit, format) >= n ? '' : undefined}
              onMouseEnter={() => preview(fromTen(n, format))}
              onClick={() => onSet(fromTen(n, format))}
              title={WORDS[n]}
            >
              {n}
            </button>
          );
        })}
      </div>
      {fine && value > 0 && (
        <label className={k.fine}>
          <span>fine-tune</span>
          <input
            type="range"
            min={step}
            max={max}
            step={step}
            value={value}
            style={{ '--pct': `${(value / max) * 100}%` }}
            onChange={(e) => onSet(Number(e.target.value))}
          />
          <b>{fmtScore(value, format)}</b>
        </label>
      )}
    </div>
  );
}

// ── category scores ──────────────────────────────────────────────────────────

/** One category's meter: ten segments, lit to the score. Pointer (click or drag
 *  along it) and keyboard set it; a vertical swipe that starts on it is handed back
 *  to the page (touch-action: pan-y) and changes nothing. */
function Meter({ label, value, format, interactive, onSet }) {
  const ref = useRef(null);
  // The drag lives in a ref as well as state: a quick tap's pointerup can arrive
  // before React has re-rendered with the pointerdown's value.
  const dragRef = useRef(null);
  const [drag, setDragState] = useState(null);
  const [hover, setHover] = useState(null);
  const { max, step } = scaleOf(format);
  const shown = drag ?? value;
  const setDrag = (v) => { dragRef.current = v; setDragState(v); };

  // The segment under the pointer counts as reached: anywhere inside the 8th of
  // ten is an 8, so a click on a segment means that segment.
  const at = (x) => {
    const r = ref.current.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (x - r.left) / r.width));
    return snap(Math.ceil((f * max) / step - 1e-9) * step, format);
  };
  const commit = (v) => { if (v !== value) onSet(v); };

  const handlers = interactive ? {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      setDrag(at(e.clientX));
      try { ref.current.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
    },
    onPointerMove: (e) => {
      if (dragRef.current != null) setDrag(at(e.clientX));
      else if (e.pointerType === 'mouse') setHover(at(e.clientX));
    },
    onPointerUp: () => {
      if (dragRef.current != null) commit(dragRef.current);
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null), // the page took the gesture (a scroll)
    onPointerLeave: () => setHover(null),
    onKeyDown: (e) => {
      const big = Math.max(step, max / 10);
      const next = {
        ArrowRight: value + step, ArrowUp: value + step, ArrowLeft: value - step, ArrowDown: value - step,
        PageUp: value + big, PageDown: value - big, Home: 0, End: max, Delete: 0, Backspace: 0,
      }[e.key];
      if (next == null) return;
      e.preventDefault();
      commit(snap(next, format));
    },
  } : {};

  return (
    <div
      ref={ref}
      className={k.meter}
      data-live={interactive ? '' : undefined}
      data-drag={drag != null ? '' : undefined}
      role={interactive ? 'slider' : 'meter'}
      tabIndex={interactive ? 0 : undefined}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={shown}
      aria-valuetext={shown ? `${fmtScore(shown, format)} of ${max}` : 'not scored'}
      style={{ '--f': shown / max, '--g': (hover ?? 0) / max }}
      {...handlers}
    >
      <span className={k.meterTrack} />
      {hover != null && drag == null && <span className={k.meterGhost} />}
      <span className={k.meterLit} />
      {hover != null && drag == null && (
        <span className={k.meterTip} aria-hidden="true">{hover ? fmtScore(hover, format) : 'clear'}</span>
      )}
    </div>
  );
}

/** Every category the viewer scores by, with their average.
 *
 *  - `scores` is the entry's {category: score}; `onCommit(next)` receives the
 *    whole map (AniList takes them as one ordered list).
 *  - `verdict` + `onUseAverage(avg)` offer the average as the overall score.
 *  - `confirm` makes it read-only until Edit, with nothing written until Save. */
export function CategoryScores({ categories, scores, format, onCommit, verdict = 0, onUseAverage, confirm = false }) {
  const [draft, setDraft] = useState(null);
  const editing = !confirm || draft != null;
  const shown = draft || scores || {};
  const { step } = scaleOf(format);
  const avg = categoryAverage(shown, categories, format);
  const scored = categories.filter((c) => Number(shown[c]) > 0).length;
  const changed = draft != null && categories.some((c) => (Number(draft[c]) || 0) !== (Number(scores?.[c]) || 0));

  // A different title (or a fresh save echoed back) drops an edit in progress.
  const sig = categories.map((c) => Number(scores?.[c]) || 0).join(',');
  useEffect(() => { setDraft(null); }, [sig]);

  const set = (c, v) => {
    const next = { ...shown, [c]: v };
    if (confirm) setDraft(next);
    else onCommit(next);
  };

  return (
    <div className={k.cats} data-editing={editing ? '' : undefined}>
      <div className={k.catRows} data-step={confirm && editing ? '' : undefined}>
        {categories.map((c) => {
          const v = Number(shown[c]) || 0;
          return (
            <div key={c} className={k.catRow}>
              <span className={k.catName} title={c}>{c}</span>
              <Meter label={c} value={v} format={format} interactive={editing} onSet={(x) => set(c, x)} />
              <span className={k.catVal} data-empty={v ? undefined : ''}>{fmtScore(v, format)}</span>
              {confirm && editing && (
                <span className={k.catStep}>
                  <button type="button" disabled={v <= 0} onClick={() => set(c, snap(v - step, format))} aria-label={`${c}: lower`}>
                    <Minus size={14} />
                  </button>
                  <button type="button" disabled={v >= scaleOf(format).max} onClick={() => set(c, snap(v + step, format))} aria-label={`${c}: raise`}>
                    <Plus size={14} />
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className={k.catFoot}>
        <span className={k.catAvg}>
          {avg != null ? (
            <>
              <span>average</span>
              <b>{fmtScore(avg, format)}</b>
              <em>{WORDS[tenOf(avg, format)]}</em>
            </>
          ) : (
            <span>{confirm && editing ? 'not scored yet — tap a meter' : 'not scored yet'}</span>
          )}
          <i className={k.catCount}>{scored}/{categories.length}</i>
        </span>

        <span className={k.catActs}>
          {onUseAverage && avg != null && draft == null && snap(avg, format) !== snap(verdict, format) && (
            <button type="button" className={k.useAvg} onClick={() => onUseAverage(avg)} title="Set your overall score to the categories' average">
              Use {fmtScore(avg, format)} as your score
            </button>
          )}
          {confirm && draft == null && (
            <button type="button" className={k.editBtn} onClick={() => setDraft({ ...(scores || {}) })}>
              <Pencil size={14} /> {scored ? 'Edit' : 'Score by category'}
            </button>
          )}
          {confirm && draft != null && (
            <>
              <button type="button" className={k.cancelBtn} onClick={() => setDraft(null)}>
                <X size={14} /> Cancel
              </button>
              <button type="button" className={k.saveBtn} disabled={!changed} onClick={() => { onCommit(draft); setDraft(null); }}>
                <Check size={14} /> Save
              </button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
