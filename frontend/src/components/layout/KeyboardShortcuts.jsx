import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// Vim-ish global navigation. `g` then a letter jumps between rooms; `j`/`k`
// move a roving focus across feed tiles (anything with [data-kbd-tile]), and
// Enter/Space activates the focused tile. Search (/) and the palette (Ctrl-K)
// are owned by CommandPalette.
const GOTO = {
  h: '/',
  f: '/',
  y: '/youtube',
  r: '/reddit',
  n: '/hackernews',
  w: '/hackernews',
  s: '/saved',
};

const typingInField = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

export default function KeyboardShortcuts() {
  const navigate = useNavigate();
  const gPending = useRef(0);

  useEffect(() => {
    const tiles = () => Array.from(document.querySelectorAll('[data-kbd-tile]'));

    const moveFocus = (dir) => {
      const els = tiles();
      if (els.length === 0) return;
      const idx = els.indexOf(document.activeElement);
      let next = idx + dir;
      if (idx === -1) next = dir > 0 ? 0 : els.length - 1;
      next = Math.max(0, Math.min(els.length - 1, next));
      els[next]?.focus();
      els[next]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (typingInField(e.target)) return;

      // Second key of a `g` chord.
      if (gPending.current && Date.now() - gPending.current < 1200) {
        const dest = GOTO[e.key.toLowerCase()];
        gPending.current = 0;
        if (dest) {
          e.preventDefault();
          navigate(dest);
          return;
        }
      }

      if (e.key === 'g') {
        gPending.current = Date.now();
        return;
      }
      if (e.key === 'j') {
        e.preventDefault();
        moveFocus(1);
      } else if (e.key === 'k') {
        e.preventDefault();
        moveFocus(-1);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return null;
}
