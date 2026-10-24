// The turning shared by the things you turn round with 3D objects on: the home
// box (components/home/TheBox.jsx) and the Wire's sorter (By topic).
//
// Drag it sideways (a mouse, a pen, a finger, or a trackpad's two-finger
// swipe), press ← or → (not while a tile has focus: there the arrows walk the
// tiles), press Tab while nothing has focus, or walk off a face's edge with
// h / l. A released turn settles on a critically damped spring, so it never
// wobbles; Fast mode and reduced motion turn at once.
//
// Script moves one number, --turn, on the turning element (registered and not
// inherited in CSS, so a frame restyles that element and not what's on it), and
// darkens each face by how far it faces away through its `.shade`. While a turn
// is under way the stage carries data-turning (and data-dragging while held),
// for the CSS to lift it. The caller marks the faces not facing you inert.
//
// Once it has stopped and been set down, the stage carries data-still, and the
// CSS shows the face you're looking at flat, out of 3D: browsers paint anything
// under a 3D transform into a texture and then resample it, which blurs text
// (Firefox most). The 3D comes back as soon as anything moves it again.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { isStill } from './motion.js';

export const mod = (a, n) => ((a % n) + n) % n;

// How far a drag must go before it's a turn rather than a click, in px.
const SLOP = 8;
// The spring a released turn settles on: critically damped.
const STIFF = 110;
const DAMP = 2 * Math.sqrt(STIFF);
// How long it takes to be set down after a turn (the CSS's lift transition).
const SET_DOWN_MS = 520;

const idle = () => {
  const el = document.activeElement;
  return !el || el === document.body || el === document.documentElement;
};

const typing = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/**
 * ids: the faces in order round it. side: the id facing you. onSide(id): a turn
 * landed on (or set off towards) id. enabled: false holds it still (nothing turns
 * it, from inside or out). front: a ref to a flat stand-in the caller shows over
 * the face you're facing while it's still (the sorter's), which then holds that
 * face's focus. onStill(still): it came to rest (true) or started moving (false).
 *
 * Returns the refs to attach (stage: what you drag; turner: what --turn moves;
 * faces[i] and shades[i]), `stageProps` for the stage, the face `facing` you,
 * commit / turnBy / towards to turn it by hand, and hold / angle for something
 * else turning it for a while (it carries on from wherever that left it).
 */
export function useTurntable({ ids, side, onSide, enabled = true, front, onStill }) {
  const n = ids.length;
  const step = 360 / n;
  const start = Math.max(0, ids.indexOf(side));

  const stage = useRef(null);
  const turner = useRef(null);
  const faces = useRef([]);
  const shades = useRef([]);
  const spin = useRef(start); // the face turned to, counted round and round (…-1, 0, 1, 2…)
  const at = useRef(-start * step); // where --turn is now, in degrees
  const raf = useRef(0);
  const drag = useRef(null);
  const dragged = useRef(false);
  const wheel = useRef(null);
  const rest = useRef(0);
  const landed = useRef(0);
  const [facing, setFacing] = useState(start);

  const latest = useRef({});
  latest.current = { ids, onSide, enabled, onStill };

  const paint = (deg) => {
    at.current = deg;
    turner.current?.style.setProperty('--turn', `${deg}deg`);
    // a face turning away goes into shadow
    shades.current.forEach((el, i) => {
      if (el) el.style.opacity = (0.72 * (1 - Math.cos(((deg + i * step) * Math.PI) / 180))).toFixed(3);
    });
  };
  const unsettle = () => {
    clearTimeout(rest.current);
    const el = stage.current;
    if (!el?.hasAttribute('data-still')) return;
    el.removeAttribute('data-still');
    latest.current.onStill?.(false);
  };
  /** Still, once it has been set down. */
  const settle = () => {
    clearTimeout(rest.current);
    rest.current = setTimeout(() => {
      const el = stage.current;
      if (!el || el.hasAttribute('data-still')) return;
      el.setAttribute('data-still', '');
      latest.current.onStill?.(true);
    }, Math.max(0, landed.current + SET_DOWN_MS - performance.now()));
  };
  const lift = () => {
    unsettle();
    if (!isStill()) stage.current?.setAttribute('data-turning', '');
  };
  const land = () => {
    const el = stage.current;
    if (!el?.hasAttribute('data-turning')) return;
    el.removeAttribute('data-turning');
    landed.current = performance.now();
  };

  /** Settle on face number `target` (round and round), from velocity v (°/s). */
  const glide = (target, v0 = 0) => {
    cancelAnimationFrame(raf.current);
    const goal = -target * step;
    if (isStill()) { unsettle(); paint(goal); land(); settle(); return; }
    lift();
    let x = at.current;
    let v = v0;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      v += (-STIFF * (x - goal) - DAMP * v) * dt;
      x += v * dt;
      // set it down during the last few degrees, so it lands as it stops
      if (Math.abs(x - goal) < 6) land();
      if (Math.abs(x - goal) < 0.05 && Math.abs(v) < 1) { paint(goal); land(); settle(); return; }
      paint(x);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  /** Turn to face number `target` and say so. */
  const commit = (target, v = 0, { tell = true } = {}) => {
    const was = mod(spin.current, n);
    spin.current = target;
    const i = mod(target, n);
    // focus left on a face that's turning away would be stuck there
    const el = document.activeElement;
    if (el && (faces.current.some((f, k) => k !== i && f?.contains(el))
      || (was !== i && front?.current?.contains(el)))) el.blur();
    setFacing(i);
    glide(target, v);
    if (tell) latest.current.onSide(latest.current.ids[i]);
  };
  const turnBy = (d) => { if (latest.current.enabled) commit(spin.current + d); };
  /** The shortest way round to face i (either way when it's straight behind). */
  const towards = (i) => {
    let d = i - mod(spin.current, n);
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    return spin.current + d;
  };

  /** Stand at `deg`, turned by someone else; the nearest face counts as facing. */
  const hold = (deg) => {
    cancelAnimationFrame(raf.current);
    unsettle();
    spin.current = Math.round(-deg / step);
    paint(deg);
  };
  const angle = () => at.current;

  // The first paint already faces the right way, at rest.
  useLayoutEffect(() => {
    paint(at.current);
    stage.current?.setAttribute('data-still', '');
  }, []);
  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    clearTimeout(rest.current);
  }, []);

  // Turned from outside: tabs, a key on the page, Back.
  useEffect(() => {
    const i = ids.indexOf(side);
    if (!enabled || i < 0) return;
    if (i !== mod(spin.current, n)) commit(towards(i), 0, { tell: false });
    // left between two faces by someone else (the sorter's slow turn): square up
    else if (at.current !== -spin.current * step) glide(spin.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, n, enabled]);

  // ── keys ──
  useEffect(() => {
    const onKey = (e) => {
      if (!latest.current.enabled) return;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.body.dataset.playerExpanded || document.body.dataset.editorFocused) return;
      if (typing(e.target) || document.querySelector('[data-kbd-scope]')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // on a tile the arrows walk the tiles (KeyboardShortcuts), and turn only
        // at a face's edge (onEdge)
        if (e.shiftKey || document.activeElement?.closest?.('[data-kbd-tile]')) return;
        e.preventDefault();
        turnBy(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'Tab' && idle()) {
        e.preventDefault();
        turnBy(e.shiftKey ? -1 : 1);
      }
    };
    // h / l with nowhere further to go on this face (KeyboardShortcuts says so):
    // turn, and carry on from the near edge of the next face.
    const onEdge = (e) => {
      if (!latest.current.enabled) return;
      const { dir, from } = e.detail || {};
      if (dir !== 'left' && dir !== 'right') return;
      if (!from || !(faces.current[mod(spin.current, n)]?.contains(from) || front?.current?.contains(from))) return;
      turnBy(dir === 'right' ? 1 : -1);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const host = front?.current || faces.current[mod(spin.current, n)];
        const tiles = host?.querySelectorAll('[data-kbd-tile]');
        const el = tiles?.length ? tiles[dir === 'right' ? 0 : tiles.length - 1] : null;
        el?.focus({ preventScroll: true });
      }));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('tubcal:kbd-edge', onEdge);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('tubcal:kbd-edge', onEdge);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  // ── a trackpad's sideways swipe (or Shift + wheel) ──
  useEffect(() => {
    const el = stage.current;
    if (!el || n < 2) return undefined;
    const onWheel = (e) => {
      if (!latest.current.enabled) return;
      const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
      if (!dx || Math.abs(dx) < Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
      e.preventDefault(); // and no browser back/forward swipe
      const px = e.deltaMode === 1 ? dx * 32 : dx;
      if (!wheel.current) {
        cancelAnimationFrame(raf.current);
        lift();
        wheel.current = { from: at.current, moved: 0, timer: 0 };
      }
      const w = wheel.current;
      w.moved -= px;
      const deg = (w.moved / (el.clientWidth || 1)) * step;
      paint(w.from + deg);
      clearTimeout(w.timer);
      // the swipe is over once the events stop: a swipe an eighth of a face long
      // turns on from the face it was going to, a shorter one settles back there
      w.timer = setTimeout(() => {
        wheel.current = null;
        const d = Math.abs(deg) > step * 0.12 ? (deg < 0 ? 1 : -1) * Math.max(1, Math.round(Math.abs(deg) / step)) : 0;
        if (d) commit(spin.current + d);
        else glide(spin.current);
      }, 140);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(wheel.current?.timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  // ── dragging ──
  const onPointerDown = (e) => {
    if (!latest.current.enabled || n < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest?.('input, textarea, select, video, audio, [contenteditable="true"]')) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, from: 0, v: 0, lastX: e.clientX, lastT: e.timeStamp };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; } // a scroll
      if (Math.abs(dx) < SLOP) return;
      d.on = true;
      d.from = at.current;
      d.width = stage.current?.clientWidth || 1;
      cancelAnimationFrame(raf.current);
      lift();
      stage.current?.setAttribute('data-dragging', '');
      window.getSelection?.()?.removeAllRanges();
      try { stage.current?.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    }
    paint(d.from + ((dx - Math.sign(dx) * SLOP) / d.width) * step);
    const dt = (e.timeStamp - d.lastT) / 1000;
    if (dt > 0) {
      const inst = (((e.clientX - d.lastX) / d.width) * step) / dt;
      d.v = d.v * 0.6 + inst * 0.4;
      d.lastX = e.clientX;
      d.lastT = e.timeStamp;
    }
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    if (!d.on) return;
    stage.current?.removeAttribute('data-dragging');
    dragged.current = true; // the click that follows this release isn't one
    setTimeout(() => { dragged.current = false; }, 0);
    const v = e.timeStamp - d.lastT > 90 ? 0 : d.v; // held still before letting go
    // how many faces it went (or was flung), negative towards the next one; a
    // fifth of a face is enough to mean "turn"
    const rel = (at.current + v * 0.14 + spin.current * step) / step;
    const most = Math.max(1, Math.ceil(Math.abs(e.clientX - d.x) / d.width));
    const by = Math.abs(rel) < 0.2 ? 0 : -Math.sign(rel) * Math.min(most, Math.max(1, Math.round(Math.abs(rel))));
    if (by) commit(spin.current + by, v);
    else glide(spin.current, v);
  };

  const stageProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onClickCapture: (e) => { if (dragged.current) { e.preventDefault(); e.stopPropagation(); } },
    onDragStart: (e) => e.preventDefault(),
  };

  return { n, step, facing, stage, turner, faces, shades, stageProps, commit, turnBy, towards, hold, angle };
}

/** How far the page's margins reach past `wrap`, written as --gutter on `bleed`,
 *  so a turning corner may use them without making a sideways scrollbar. */
export function useGutter(wrap, bleed) {
  useLayoutEffect(() => {
    const measure = () => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r || !bleed.current) return;
      const room = Math.max(0, Math.floor(Math.min(r.left, document.documentElement.clientWidth - r.right)));
      bleed.current.style.setProperty('--gutter', `${room}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [wrap, bleed]);
}
