// The box — the home screen with 3D objects on (Settings → Appearance, or the
// installer's `3d` option). The set is its front; each channel is one of the
// other sides, with what's in it and doors straight to the places inside.
//
// Turning it: drag it sideways (a mouse, a pen, a finger, or a trackpad's
// two-finger swipe), press ← or →, press Tab while nothing on the page has focus,
// pick a side under it, or walk off a side's edge with h / l. Home adds the
// channel numbers on a channel's side (1 2 3, and 0 for the set).
//
// The geometry is all CSS (box.module.css): every side sits in the same grid
// cell, so the box is as tall as its tallest side, and each side is turned to its
// place around the middle — rotateY(i · 360°/n), then out by the apothem. The
// turning itself is lib/turntable.js (shared with the Wire's sorter): it moves
// --turn on the cube, darkens each side by how far it faces away, and says when
// the box is lifted (data-turning). The sides not facing you are inert: no focus,
// clicks, h/j/k/l or screen reader.

import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useGutter, useTurntable } from '../../lib/turntable.js';
import b from './box.module.css';

/** The cap on top of the box: the n-gon its sides make, as a clip-path over a
 *  square as wide as the corners are apart. The cap's lower edge is the front. */
function capShape(n) {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const phi = ((i + 0.5) * 2 * Math.PI) / n;
    pts.push(`${(50 + 50 * Math.sin(phi)).toFixed(3)}% ${(50 + 50 * Math.cos(phi)).toFixed(3)}%`);
  }
  return `polygon(${pts.join(', ')})`;
}

/**
 * sides: [{ id, label, n?, tone, node }] in order around the box.
 * side: the id facing you. onSide(id): a turn landed on (or set off towards) id.
 */
export default function TheBox({ sides, side, onSide }) {
  const wrap = useRef(null);
  const bleed = useRef(null);
  const {
    n, step, facing, stage, turner, faces, shades, stageProps, commit, turnBy, towards,
  } = useTurntable({ ids: sides.map((s) => s.id), side, onSide });
  useGutter(wrap, bleed);

  if (n < 2) return sides[0]?.node || null;

  const style = {
    '--step': `${step}deg`,
    '--apothem': 1 / Math.tan(Math.PI / n),
    '--corner': 1 / Math.sin(Math.PI / n),
  };

  return (
    <div ref={wrap} className={b.wrap}>
      <div ref={bleed} className={b.bleed}>
        <div
          ref={stage}
          className={b.stage}
          {...stageProps}
          role="region"
          aria-roledescription="box"
          aria-label={`Home, turned to ${sides[facing].label}`}
        >
          <div className={b.box}>
            <div ref={turner} className={b.cube} style={style}>
              {n > 2 && <div className={b.cap} style={{ clipPath: capShape(n) }} aria-hidden="true" />}
              {sides.map((s, i) => (
                <div
                  key={s.id}
                  ref={(el) => { faces.current[i] = el; }}
                  className={b.side}
                  style={{ '--i': i, '--tone': s.tone }}
                  inert={i !== facing}
                >
                  {s.node}
                  <span ref={(el) => { shades.current[i] = el; }} className={b.shade} aria-hidden="true" />
                </div>
              ))}
            </div>
          </div>
          <span className={b.floor} aria-hidden="true" />
        </div>
      </div>

      <nav className={`${b.dial} tc-strip`} aria-label="Sides of the box">
        <button type="button" className={b.step} onClick={() => turnBy(-1)} aria-label="Turn left" title="Turn left (←)">
          <ChevronLeft size={16} />
        </button>
        {sides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`${b.tab} ${i === facing ? b.tabOn : ''}`}
            style={{ '--tone': s.tone }}
            aria-current={i === facing || undefined}
            onClick={() => { if (i !== facing) commit(towards(i)); }}
          >
            <b>{s.n ?? '0'}</b>
            <span>{s.label}</span>
          </button>
        ))}
        <button type="button" className={b.step} onClick={() => turnBy(1)} aria-label="Turn right" title="Turn right (→)">
          <ChevronRight size={16} />
        </button>
      </nav>
    </div>
  );
}
