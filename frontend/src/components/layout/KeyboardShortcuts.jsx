import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// Vim-style global navigation.
//   g + letter   jump between rooms (ge/gf/gy/gr/gn/gs)
//   gg / G       jump to the first / last tile on the page
//   h j k l      move a roving focus across tiles by geometry — works in both the
//                horizontal shelves and the wall grids (arrows mirror them once a
//                tile is focused, so they still scroll the page otherwise)
//   Enter/Space  activate the focused tile (handled by the tile itself)
// `/` and Ctrl-K belong to the command palette. Stands down while typing or while
// a video is expanded (the player owns those keys then).
const GOTO = {
  h: '/',
  f: '/',
  e: '/edition',
  y: '/youtube',
  r: '/reddit',
  n: '/hackernews',
  w: '/hackernews',
  s: '/saved',
};

const DIRS = {
  j: 'down', k: 'up', h: 'left', l: 'right',
  ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right',
};

const typingInField = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

export default function KeyboardShortcuts() {
  const navigate = useNavigate();
  const gPending = useRef(0);

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

    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (typingInField(e.target)) return;
      if (document.body.dataset.playerExpanded) return; // the player owns the keys

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
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return null;
}
