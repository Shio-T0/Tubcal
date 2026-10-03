// Motion, app-wide. Everything moves for a reason: things arrive from where they
// come from, leave toward where they go, and answer a touch at once. Nothing here
// runs for someone who asked the system for reduced motion.
//
//  - reveal: anything marked `data-reveal` (or matching REVEAL_EXTRA — rows in
//    the desktop screens the phone reuses) rises into place the first time it
//    scrolls into view; a batch that lands together cascades. State lives in
//    data attributes (data-in, data-loaded), never classes: React rewrites a
//    className it owns, and would wipe a class added from outside.
//  - images fade in as they load instead of popping.
//  - morph(update, {from}): a View Transition around a state change, so a
//    thumbnail grows into the player, the player shrinks into the mini bar, a
//    skin washes over the screen. Falls back to a plain update.
//  - html[data-scrolled] lets the app bar lift once the page moves.

import { flushSync } from 'react-dom';

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Rows in reused desktop screens that should arrive like the phone's own.
const REVEAL_EXTRA = [
  '.pc_wire_reader__thread > *',
  '.pc_modals_comments__comment',
  '.pc_player_watch__comment',
  '.pc_anime_forum__row',
  '.pc_anime_activity__entry',
].join(',');
const REVEAL = `[data-reveal],${REVEAL_EXTRA}`;

export function installReveal() {
  if (typeof IntersectionObserver === 'undefined') return;
  const root = document.documentElement;
  if (reducedMotion()) { root.dataset.motion = 'off'; return; }
  root.dataset.motion = 'on';
  let batch = 0;
  let batchTimer = 0;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      io.unobserve(el);
      // a batch arriving together cascades; a lone row just rises
      el.style.setProperty('--rd', `${Math.min(batch, 9) * 42}ms`);
      batch += 1;
      el.setAttribute('data-in', '');
    }
    clearTimeout(batchTimer);
    batchTimer = setTimeout(() => { batch = 0; }, 90);
  }, { rootMargin: '0px 0px -4% 0px', threshold: 0.01 });

  const watch = (el) => {
    if (el.hasAttribute('data-in') || el.dataset.revealWatched) return;
    el.dataset.revealWatched = '1';
    io.observe(el);
  };
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches(REVEAL)) watch(node);
    node.querySelectorAll(REVEAL).forEach(watch);
  };
  scan(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach(scan);
  }).observe(document.body, { childList: true, subtree: true });
}

/** Images fade in when they've loaded (load doesn't bubble, but it does capture).
 *  React sets `src` before it inserts an <img>, so a cached picture can finish
 *  loading while still detached — out of the document listener's reach. Those
 *  are caught as they're inserted: already complete means shown at once. */
export function installImageFade() {
  if (reducedMotion()) return;
  const mark = (img) => img.setAttribute('data-loaded', '');
  const done = (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG') mark(t);
  };
  document.addEventListener('load', done, true);
  document.addEventListener('error', done, true);
  const check = (img) => { if (img.complete && !img.hasAttribute('data-loaded')) mark(img); };
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') { if (m.target.tagName === 'IMG') { m.target.removeAttribute('data-loaded'); check(m.target); } continue; }
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.tagName === 'IMG') check(n);
        else n.querySelectorAll?.('img').forEach(check);
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
}

/** html[data-scrolled] while the page is scrolled — the app bar lifts off it. */
export function installScrollFlag() {
  let on = null;
  let raf = 0;
  const check = () => {
    raf = 0;
    const next = window.scrollY > 4;
    if (next !== on) { on = next; document.documentElement.dataset.scrolled = next ? '1' : '0'; }
  };
  window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(check); }, { passive: true });
  check();
}

/** Run `update` inside a View Transition. `from` is an element whose picture
 *  should travel to the element named `name` in the new state (the player's
 *  stage). `kind` tags the transition for CSS (html[data-vt=kind]). */
export function morph(update, { from = null, name = 'ph-stage', kind = 'stage' } = {}) {
  const root = document.documentElement;
  if (!document.startViewTransition || reducedMotion() || root.dataset.vt) {
    update();
    return null;
  }
  root.dataset.vt = kind;
  if (from) {
    root.dataset.vtFrom = '1';
    from.style.viewTransitionName = name;
  }
  let t;
  try {
    t = document.startViewTransition(() => {
      if (from) from.style.viewTransitionName = '';
      delete root.dataset.vtFrom;
      flushSync(update);
    });
  } catch {
    if (from) from.style.viewTransitionName = '';
    delete root.dataset.vtFrom;
    delete root.dataset.vt;
    update();
    return null;
  }
  t.finished.finally(() => {
    if (from) from.style.viewTransitionName = '';
    delete root.dataset.vtFrom;
    delete root.dataset.vt;
  });
  return t;
}

/** Parallax: sets --py (how far to shift) and --pz (how much to grow) on `el`
 *  as the page scrolls, for its CSS transform to use. Returns a cleanup. */
export function parallax(el, factor = 0.35, max = 240) {
  if (!el || reducedMotion()) return () => {};
  let raf = 0;
  const paint = () => {
    raf = 0;
    const y = Math.min(max, Math.max(0, window.scrollY));
    el.style.setProperty('--py', `${(y * factor).toFixed(1)}px`);
    el.style.setProperty('--pz', (y / 2400).toFixed(4));
  };
  const on = () => { if (!raf) raf = requestAnimationFrame(paint); };
  window.addEventListener('scroll', on, { passive: true });
  paint();
  return () => { window.removeEventListener('scroll', on); cancelAnimationFrame(raf); };
}
