import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ANIME_HOME, HUB_HOME } from '../../lib/rooms.js';
import k from './KeyboardShortcuts.module.css';

// Vim-style global navigation.
//   Space g h    the Hub (The Edition)       — the two channels, from anywhere
//   Space g a    The Anime
//   g + letter   jump between rooms (gh home, ge/gy/gr/gn/gc/gs)
//   gg / G       jump to the first / last tile on the page
//   h j k l      move a roving focus across tiles by geometry — works in both the
//                horizontal shelves and the wall grids (arrows mirror them once a
//                tile is focused, so they still scroll the page otherwise)
//   Enter/Space  activate the focused tile (handled by the tile itself)
// `/` and Ctrl-K belong to the command palette. Stands down while typing or while
// a video is expanded (the player owns those keys then).
const GOTO = {
  h: '/',
  e: '/edition',
  y: '/youtube',
  r: '/reddit',
  n: '/hackernews',
  w: '/hackernews',
  c: '/editor',
  s: '/saved',
};

const DIRS = {
  j: 'down', k: 'up', h: 'left', l: 'right',
  ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right',
};

const typingInField = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

// The Space leader: Space, then g, then a destination — each step within this long.
const LEADER_MS = 1500;
const LEADER_GOTO = { a: ANIME_HOME, h: HUB_HOME };

// Space keeps its own meaning on a control you *reached with the keyboard*: a
// focus-visible button presses, a checkbox toggles, a video plays. A control only
// left focused by a mouse click doesn't count (it isn't :focus-visible), so the
// leader still works right after clicking something — "anywhere" — without ever
// pressing a button you didn't mean to.
const NATIVE_SPACE =
  'button, select, summary, video, audio, input, [role="button"], [role="switch"], ' +
  '[role="checkbox"], [role="tab"], [role="menuitem"], [role="option"]';
const spaceIsNative = (el) => {
  if (!el || el === document.body || !el.closest) return false;
  if (el.closest('video, audio')) return true; // a player keeps Space however it got focus
  return !!(el.closest(NATIVE_SPACE) && el.matches?.(':focus-visible'));
};

export default function KeyboardShortcuts() {
  const navigate = useNavigate();
  const gPending = useRef(0);
  // stage 1: Space pressed, waiting for g · stage 2: Space g, waiting for a/h
  const leader = useRef({ stage: 0, at: 0 });
  const [hint, setHint] = useState(0);
  const hintTimer = useRef(null);

  useEffect(() => {
    // visible tiles only (an off-screen / display:none tile has no offsetParent)
    const tiles = () =>
      Array.from(document.querySelectorAll('[data-kbd-tile]')).filter((el) => el.offsetParent !== null);

    const focusTile = (el) => {
      if (!el) return;
      el.focus({ preventScroll: true });
      // Keep the focused tile centred in its horizontal scroller: near the start
      // it can't centre (no room to scroll left) so it just stays put, and the row
      // only begins to scroll once the selection has reached the middle.
      el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    };

    const focusEdge = (last) => {
      const els = tiles();
      if (els.length) focusTile(last ? els[els.length - 1] : els[0]);
    };

    // Geometry-based 2D move: the nearest tile in the requested direction, strongly
    // preferring ones aligned on the cross axis (same row for h/l, same column for j/k).
    const move = (dir) => {
      const els = tiles();
      if (!els.length) return;
      const cur = els.includes(document.activeElement) ? document.activeElement : null;
      if (!cur) {
        focusTile(els[0]);
        return;
      }
      const horizontal = dir === 'left' || dir === 'right';
      // Horizontal moves stay inside the current section (shelf): h/l never jump
      // to another section or wrap, so at a section's start 'h' and at its end 'l'
      // simply do nothing. j/k still cross sections vertically. (No <section>
      // ancestor → fall back to the global geometry, unchanged.)
      const curSection = horizontal ? cur.closest('section') : null;
      const a = cur.getBoundingClientRect();
      const ax = a.left + a.width / 2;
      const ay = a.top + a.height / 2;
      let best = null;
      let bestScore = Infinity;
      for (const el of els) {
        if (el === cur) continue;
        if (curSection && el.closest('section') !== curSection) continue;
        const b = el.getBoundingClientRect();
        const dx = b.left + b.width / 2 - ax;
        const dy = b.top + b.height / 2 - ay;
        if (dir === 'left' && dx > -4) continue;
        if (dir === 'right' && dx < 4) continue;
        if (dir === 'up' && dy > -4) continue;
        if (dir === 'down' && dy < 4) continue;
        const primary = Math.abs(horizontal ? dx : dy);
        const cross = Math.abs(horizontal ? dy : dx);
        const score = primary + cross * 3; // keep to the same row / column when possible
        if (score < bestScore) {
          bestScore = score;
          best = el;
        }
      }
      if (best) focusTile(best);
    };

    const setStage = (stage) => {
      leader.current = { stage, at: Date.now() };
      setHint(stage);
      clearTimeout(hintTimer.current);
      if (stage) hintTimer.current = setTimeout(() => { leader.current = { stage: 0, at: 0 }; setHint(0); }, LEADER_MS);
    };

    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (typingInField(e.target)) return;
      if (document.body.dataset.playerExpanded) return; // the player owns the keys
      if (document.body.dataset.editorFocused) return;  // the Composing Room owns the keys

      // ── the Space leader ── checked first, so Space g h never reads as `g h`
      const ld = leader.current;
      if (ld.stage && Date.now() - ld.at < LEADER_MS) {
        if (e.key === ' ' && e.repeat) { e.preventDefault(); return; } // held Space: no scroll
        if (ld.stage === 1 && e.key === 'g') { e.preventDefault(); setStage(2); return; }
        const dest = ld.stage === 2 && LEADER_GOTO[e.key.toLowerCase()];
        setStage(0); // anything else ends the chord (and keeps its own meaning)
        if (dest) { e.preventDefault(); navigate(dest); return; }
        if (e.key === 'Escape') return;
      }
      if (e.key === ' ' && !e.repeat && !e.defaultPrevented && !spaceIsNative(e.target)) {
        e.preventDefault(); // the leader, not a page scroll
        setStage(1);
        return;
      }

      // second key of a chord started by `g`
      if (gPending.current && Date.now() - gPending.current < 1000) {
        gPending.current = 0;
        if (e.key === 'g') { e.preventDefault(); focusEdge(false); return; } // gg → first tile
        const dest = GOTO[e.key.toLowerCase()];
        if (dest) { e.preventDefault(); navigate(dest); return; }
      }

      if (e.key === 'g') {
        gPending.current = Date.now();
        return;
      }
      if (e.key === 'G') {
        e.preventDefault();
        focusEdge(true); // G → last tile
        return;
      }

      const dir = DIRS[e.key];
      if (dir) {
        // Plain h/j/k/l always navigate; arrows only once you're already on a tile,
        // so they keep scrolling the page the rest of the time.
        if (e.key.startsWith('Arrow') && !tiles().includes(document.activeElement)) return;
        e.preventDefault();
        move(dir);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(hintTimer.current);
    };
  }, [navigate]);

  // A which-key whisper while the chord is open, so the next key is never a guess.
  if (!hint) return null;
  return (
    <div className={k.leader} role="status" aria-live="polite">
      <kbd>Space</kbd>
      {hint === 1 ? (
        <span className={k.next}><kbd>g</kbd> go to…</span>
      ) : (
        <>
          <kbd>g</kbd>
          <span className={k.next}><kbd>h</kbd> Hub</span>
          <span className={k.next}><kbd>a</kbd> Anime</span>
        </>
      )}
    </div>
  );
}
