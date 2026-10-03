// The phone shell's furniture: the app bar at the top of every screen, the tab
// bar at the bottom, bottom sheets (and action sheets built on them), chip rows,
// pull-to-refresh, and the small empty/loading states. Everything is sized for a
// thumb: 44px+ targets, primary actions in the bottom half of the screen.

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, LayoutGrid, Newspaper, Clapperboard, Radio, RotateCw, Tv } from 'lucide-react';

import { haptic } from '../lib/bridge.js';
import { useBack } from './back.js';
import s from './shell.module.css';

// ── the app bar ──────────────────────────────────────────────────────────────

/** A screen's top bar. `back` shows a back arrow (history back, or `backTo`);
 *  `actions` sit on the right; `children` is an extra row (chips, a search) that
 *  stays pinned with the bar. */
export function AppBar({ title, sub, back = false, backTo, actions, children, tone, className }) {
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.length > 1 && window.history.state?.idx > 0) navigate(-1);
    else navigate(backTo || '/');
  };
  return (
    <header className={`${s.bar} ${className || ''}`} style={tone ? { '--tone': tone } : undefined}>
      <div className={s.barRow}>
        {back && (
          <button type="button" className={s.back} onClick={goBack} aria-label="Back">
            <ChevronLeft size={24} />
          </button>
        )}
        <div className={`${s.titles} ${back ? '' : s.titlesRoot}`}>
          {typeof title === 'string' ? <h1 className={s.title}>{title}</h1> : title}
          {sub && <span className={s.sub}>{sub}</span>}
        </div>
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
      {children && <div className={s.barExtra}>{children}</div>}
    </header>
  );
}

/** A round icon button for app bars and cards. */
export function IconBtn({ label, onClick, children, active = false, className, ...rest }) {
  return (
    <button
      type="button"
      className={`${s.iconBtn} ${active ? s.iconBtnOn : ''} ${className || ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── the tab bar ──────────────────────────────────────────────────────────────

export const TABS = [
  { key: 'today', label: 'Today', root: '/edition', Icon: Newspaper, match: (p) => p.startsWith('/edition') },
  { key: 'watch', label: 'Watch', root: '/youtube', Icon: Clapperboard, match: (p) => p.startsWith('/youtube') },
  { key: 'anime', label: 'Anime', root: '/anime', Icon: Tv, match: (p) => p.startsWith('/anime') },
  { key: 'read', label: 'Read', root: '/hackernews', Icon: Radio, match: (p) => /^\/(hackernews|reddit|github)/.test(p) },
  { key: 'more', label: 'More', root: '/more', Icon: LayoutGrid, match: (p) => /^\/(more|archive|dev|saved|settings|search)/.test(p) },
];
const LAST_KEY = 'tubcal.phone.lastPath';

function loadLast() {
  try { return JSON.parse(sessionStorage.getItem(LAST_KEY)) || {}; } catch { return {}; }
}

export function tabOf(pathname) {
  return TABS.find((t) => t.match(pathname)) || null;
}

/** The bottom tab bar. Each tab remembers where you were inside it; tapping the
 *  tab you're on goes back to its top. `badges` maps tab key → a count. */
export function TabBar({ badges = {}, hidden = false }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const cur = tabOf(pathname);
  const last = useRef(loadLast());

  useEffect(() => {
    if (!cur) return;
    last.current[cur.key] = pathname + search;
    try {
      sessionStorage.setItem(LAST_KEY, JSON.stringify(last.current));
      localStorage.setItem('tubcal.phone.lastTab', cur.root);
    } catch { /* fine */ }
  }, [cur, pathname, search]);

  const go = (t) => {
    haptic('tick');
    if (cur?.key === t.key) {
      if (pathname === t.root && !search) window.scrollTo({ top: 0, behavior: 'smooth' });
      else navigate(t.root);
      return;
    }
    navigate(last.current[t.key] || t.root);
  };

  const idx = cur ? TABS.findIndex((t) => t.key === cur.key) : -1;
  return (
    <nav className={`${s.tabs} ${hidden ? s.tabsHidden : ''}`} aria-label="Sections">
      {/* the lit pill glides to the tab you pick, stretching as it goes */}
      <span className={s.track} aria-hidden="true">
        <span className={s.pill} style={{ '--ti': Math.max(0, idx), opacity: idx < 0 ? 0 : 1 }}>
          <i key={idx} />
        </span>
      </span>
      {TABS.map((t) => {
        const on = cur?.key === t.key;
        const n = badges[t.key];
        return (
          <button key={t.key} type="button" className={`${s.tab} ${on ? s.tabOn : ''}`} onClick={() => go(t)} aria-current={on ? 'page' : undefined}>
            <span className={s.tabIcon}>
              <span key={on ? 'on' : 'off'} className={on ? s.iconOn : s.iconOff}>
                <t.Icon size={22} strokeWidth={on ? 2.3 : 1.9} />
              </span>
              {n > 0 && <em key={n} className={s.badge}>{n > 99 ? '99+' : n}</em>}
            </span>
            <span className={s.tabLabel}>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ── sheets ───────────────────────────────────────────────────────────────────

/** A bottom sheet: rises from the bottom edge; pull it down to close — by the
 *  handle, or anywhere on it while its content is scrolled to the top — or tap
 *  outside, or Back. The drag is direct (the sheet's transform is written each
 *  frame, no React render), the dim lightens as it goes, and a release carries
 *  your finger's speed into the exit. `full` makes it a near-full-height sheet
 *  with its own scroll. While it closes it keeps showing what it showed, even if
 *  the caller has already let go of the content. */
export function Sheet({ open, onClose, title, children, full = false, footer }) {
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);
  const sheetRef = useRef(null);
  const dimRef = useRef(null);
  const swiped = useRef(0); // ms of the exit a swipe already started (0 = not swiped)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const last = useRef({ title, children, footer });
  if (open) last.current = { title, children, footer };
  useBack(open, onClose);

  useEffect(() => {
    if (open) {
      swiped.current = 0;
      setShown(true);
      setClosing(false);
      // reopened mid-exit: take back whatever the swipe left behind
      for (const el of [sheetRef.current, dimRef.current]) el?.removeAttribute('style');
      return undefined;
    }
    if (!shown) return undefined;
    setClosing(true);
    const t = setTimeout(() => { setShown(false); setClosing(false); }, swiped.current || 260);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!shown) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [shown]);

  // the pull-down gesture, on native listeners (touchmove must be cancelable)
  useEffect(() => {
    const sheet = sheetRef.current;
    const dim = dimRef.current;
    if (!shown || !sheet || !dim) return undefined;
    let st = null;
    let dy = 0;
    let raf = 0;
    let swallowClick = false;
    const paint = () => {
      raf = 0;
      sheet.style.transform = `translate3d(0, ${dy}px, 0)`;
      dim.style.opacity = String(Math.max(0, 1 - dy / Math.max(1, sheet.offsetHeight)));
    };
    const start = (e) => {
      if (e.touches.length !== 1) { st = null; return; }
      const t = e.target;
      if (t.closest?.('input, textarea, select, [contenteditable="true"]')) { st = null; return; }
      const body = t.closest?.(`.${s.sheetBody}`);
      // a scrolled body scrolls; only at its top does a pull move the sheet
      const can = !body || body.scrollTop <= 0;
      st = { x: e.touches[0].clientX, y: e.touches[0].clientY, can, drag: false, hist: [] };
    };
    const move = (e) => {
      if (!st || !st.can) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      if (!st.drag) {
        const ddx = x - st.x;
        const ddy = y - st.y;
        if (Math.abs(ddy) < 6 || Math.abs(ddx) > Math.abs(ddy)) return;
        if (ddy < 0) { st.can = false; return; } // pushing up is a scroll
        st.drag = true;
        st.y = y;
        sheet.style.transition = 'none';
        dim.style.transition = 'none';
      }
      if (e.cancelable) e.preventDefault();
      const raw = y - st.y;
      dy = raw >= 0 ? raw : -Math.sqrt(-raw) * 2.5; // a little give upward, no more
      st.hist.push({ y, t: e.timeStamp });
      if (st.hist.length > 6) st.hist.shift();
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const end = () => {
      if (!st) return;
      const g = st;
      st = null;
      if (!g.drag) return;
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 350);
      cancelAnimationFrame(raf);
      raf = 0;
      // speed over the last stretch of the drag, px/ms
      const h = g.hist;
      const now = h[h.length - 1];
      const then = h.find((p) => now && now.t - p.t < 100) || h[0];
      const v = now && then && now.t > then.t ? (now.y - then.y) / (now.t - then.t) : 0;
      const height = sheet.offsetHeight || 600;
      if (dy > Math.min(130, height * 0.28) || v > 0.55) {
        // carry the release speed out: never slower than the finger was going
        const remain = Math.max(0, height - dy);
        const ms = Math.round(Math.min(280, Math.max(120, remain / Math.max(v, 1.3))));
        swiped.current = ms;
        sheet.style.transition = `transform ${ms}ms cubic-bezier(0.25, 0.85, 0.4, 1)`;
        dim.style.transition = `opacity ${ms}ms linear`;
        sheet.style.transform = 'translate3d(0, 105%, 0)';
        dim.style.opacity = '0';
        haptic('tick');
        onCloseRef.current();
      } else {
        // not far enough: spring back into place
        sheet.style.transition = 'transform 0.45s var(--e-spring)';
        dim.style.transition = 'opacity 0.3s ease';
        sheet.style.transform = '';
        dim.style.opacity = '';
      }
      dy = 0;
    };
    const click = (e) => {
      if (swallowClick) { e.preventDefault(); e.stopPropagation(); swallowClick = false; }
    };
    sheet.addEventListener('touchstart', start, { passive: true });
    sheet.addEventListener('touchmove', move, { passive: false });
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', end);
    sheet.addEventListener('click', click, true);
    return () => {
      cancelAnimationFrame(raf);
      sheet.removeEventListener('touchstart', start);
      sheet.removeEventListener('touchmove', move);
      sheet.removeEventListener('touchend', end);
      sheet.removeEventListener('touchcancel', end);
      sheet.removeEventListener('click', click, true);
    };
  }, [shown]);

  if (!shown) return null;
  const c = open ? { title, children, footer } : last.current;
  // a swipe already animates the exit itself; other closes use the CSS one
  const out = closing && !swiped.current;

  return createPortal(
    <div className={`ph-portal ${s.sheetBack} ${closing ? s.sheetBackClosing : ''}`}>
      <div className={`${s.sheetDim} ${out ? s.sheetDimOut : ''}`} ref={dimRef} onClick={open ? onClose : undefined} />
      <div
        className={`${s.sheet} ${full ? s.sheetFull : ''} ${out ? s.sheetOut : ''}`}
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof c.title === 'string' ? c.title : undefined}
      >
        <div className={s.grab}>
          <span className={s.handle} />
          {c.title && <h2 className={s.sheetTitle}>{c.title}</h2>}
        </div>
        <div className={s.sheetBody}>{c.children}</div>
        {c.footer && <div className={s.sheetFoot}>{c.footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A sheet of actions: [{ label, Icon, onClick, danger, hint }] (falsy rows skipped). */
export function ActionSheet({ open, onClose, title, head, actions }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {head}
      <div className={s.actionList}>
        {actions.filter(Boolean).map(({ label, Icon, onClick, danger, hint }) => (
          <button
            key={label}
            type="button"
            className={`${s.action} ${danger ? s.actionDanger : ''}`}
            onClick={() => { haptic('tick'); onClose(); onClick(); }}
            data-reveal="side"
          >
            {Icon && <Icon size={20} />}
            <span>{label}</span>
            {hint && <em>{hint}</em>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Long-press (≈450ms, finger held still) → `onLong`, with a haptic tick. Spread
 *  the returned props on the element; a long-press swallows the click after it. */
export function useLongPress(onLong) {
  const timer = useRef(null);
  const fired = useRef(false);
  const origin = useRef(null);
  const clear = () => { clearTimeout(timer.current); timer.current = null; };
  return {
    onTouchStart: (e) => {
      fired.current = false;
      origin.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      clear();
      timer.current = setTimeout(() => { fired.current = true; haptic('press'); onLong(); }, 450);
    },
    onTouchMove: (e) => {
      const o = origin.current;
      if (o && Math.hypot(e.touches[0].clientX - o.x, e.touches[0].clientY - o.y) > 10) clear();
    },
    onTouchEnd: clear,
    onTouchCancel: clear,
    onContextMenu: (e) => { e.preventDefault(); if (!fired.current) { fired.current = true; onLong(); } },
    onClickCapture: (e) => {
      if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; }
    },
  };
}

// ── chips ────────────────────────────────────────────────────────────────────

/** A horizontally scrolling row of choice chips: [{ key, label, Icon, count }].
 *  The chosen one sits on a lit pill that slides (and stretches) to the next. */
export function Chips({ items, value, onChange, className }) {
  const row = useRef(null);
  const [pill, setPill] = useState(null);
  const [ready, setReady] = useState(false);
  const list = items.filter(Boolean);
  const sig = list.map((x) => `${x.key}:${x.label}:${x.count || ''}`).join('|');
  useLayoutEffect(() => {
    const el = row.current?.querySelector('[aria-pressed="true"]');
    if (!el) { setPill(null); return undefined; }
    const measure = () => setPill({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [value, sig]);
  useEffect(() => {
    if (pill && !ready) requestAnimationFrame(() => setReady(true));
  }, [pill, ready]);
  useEffect(() => {
    row.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: ready ? 'smooth' : 'auto' });
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`${s.chips} ${className || ''}`} ref={row}>
      <span
        className={s.chipPill}
        data-ready={ready ? '' : undefined}
        style={pill ? { transform: `translate(${pill.x}px, ${pill.y}px)`, width: pill.w, height: pill.h } : { opacity: 0 }}
        aria-hidden="true"
      />
      {list.map(({ key, label, Icon, count }) => (
        <button
          key={key}
          type="button"
          className={`${s.chip} ${value === key ? s.chipOn : ''}`}
          aria-pressed={value === key}
          onClick={() => { haptic('tick'); onChange(key); }}
        >
          {Icon && <Icon size={15} />}
          {label}
          {count ? <em key={count}>{count > 99 ? '99+' : count}</em> : null}
        </button>
      ))}
    </div>
  );
}

// ── pull to refresh ──────────────────────────────────────────────────────────

/** Pull down at the top of the page to refresh. Returns the indicator element. */
export function usePullToRefresh(onRefresh, enabled = true) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef(null);
  const fire = useCallback(async () => {
    setBusy(true);
    haptic('done');
    try { await onRefresh(); } catch { /* the screen shows its own error */ }
    setBusy(false);
    setPull(0);
  }, [onRefresh]);
  useEffect(() => {
    if (!enabled) return undefined;
    const down = (e) => {
      start.current = window.scrollY <= 0 && !document.body.style.overflow ? e.touches[0].clientY : null;
    };
    const move = (e) => {
      if (start.current == null || busy) return;
      const d = e.touches[0].clientY - start.current;
      if (d > 0 && window.scrollY <= 0) setPull(Math.min(110, d * 0.5));
      else if (d < 0) { start.current = null; setPull(0); }
    };
    const up = () => {
      if (start.current == null) return;
      start.current = null;
      setPull((p) => {
        if (p > 64) fire();
        return p > 64 ? 64 : 0;
      });
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [enabled, busy, fire]);
  if (!pull && !busy) return null;
  return (
    <div className={s.pull} style={{ height: busy ? 56 : pull }} aria-hidden="true">
      <span className={`${s.pullDot} ${busy ? s.pullSpin : ''}`} style={{ transform: `rotate(${pull * 4}deg)`, opacity: Math.min(1, pull / 64 + (busy ? 1 : 0)) }}>
        <RotateCw size={18} />
      </span>
    </div>
  );
}

// ── small states ─────────────────────────────────────────────────────────────

export function Loading({ label = 'tuning in' }) {
  return (
    <div className={s.loading} role="status">
      <span className={s.loadingBar} />
      <span>{label}…</span>
    </div>
  );
}

/** The shape of what's loading, with a sheen passing over it:
 *  'cards' (videos), 'rows', 'lines' (stories), 'posters' (anime). */
export function Skeleton({ kind = 'cards', n = 3 }) {
  if (kind === 'posters') {
    return (
      <div className="ph-skel ph-skel-posters" role="status" aria-label="Loading">
        {Array.from({ length: n }, (_, i) => <span key={i}><i /><i /><i /></span>)}
      </div>
    );
  }
  const one = {
    cards: <div className="ph-skel-card"><i /><div className="ph-skel-cardText"><i /><i /><i /></div></div>,
    rows: <div className="ph-skel-row"><i /><i /><i /><i /></div>,
    lines: <div className="ph-skel-line"><i /><i /><i /></div>,
  }[kind];
  return (
    <div className="ph-skel" role="status" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => <Fragment key={i}>{one}</Fragment>)}
    </div>
  );
}

export function Empty({ Icon, title, text, action }) {
  return (
    <div className={s.empty}>
      {Icon && <Icon size={34} />}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function ErrorNote({ message, onRetry }) {
  return (
    <div className={s.error}>
      <span>Signal lost — {message}</span>
      {onRetry && <button type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** A section heading inside a screen, with an optional action on the right. */
export function SectionTitle({ children, action, onAction }) {
  return (
    <div className={s.section} data-reveal="fade">
      <h2>{children}</h2>
      {action && <button type="button" onClick={onAction}>{action}</button>}
    </div>
  );
}

// ── overlay pages ────────────────────────────────────────────────────────────

let overlays = 0;
const markOverlay = (d) => {
  overlays = Math.max(0, overlays + d);
  document.documentElement.dataset.overlay = overlays ? '1' : '0';
};

/** A full-screen page that slides in over the current one — a discussion, a
 *  post — without leaving it (so Back drops you exactly where you were). The page
 *  beneath draws back and dims while it's up. Swipe in from the left edge (the
 *  page follows your finger directly, and the one beneath comes forward with
 *  it), the arrow, or Back closes it: it slides away first, then calls
 *  `onClose`. `onBack`, if given, gets first refusal (return true when it
 *  handled Back itself — e.g. stepping back inside a thread). */
export function Overlay({ open, onClose, onBack, title, sub, actions, tone, children, bodyRef }) {
  const [closing, setClosing] = useState(false);
  const ref = useRef(null);
  const timer = useRef(0);
  const marked = useRef(false);
  const swiped = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const unmark = () => {
    if (marked.current) { marked.current = false; markOverlay(-1); }
  };
  const requestClose = () => {
    if (closing) return;
    if (onBack?.()) return;
    setClosing(true);
    unmark();
    timer.current = setTimeout(onClose, 270);
  };
  useBack(open && !closing, requestClose);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    marked.current = true;
    markOverlay(1);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(timer.current);
      unmark();
      const root = document.documentElement;
      delete root.dataset.ovDrag;
      root.style.removeProperty('--ovp');
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) { setClosing(false); swiped.current = false; } }, [open]);

  // the edge swipe, on native listeners: written to the DOM per frame, no renders
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return undefined;
    const root = document.documentElement;
    let st = null;
    let dx = 0;
    let raf = 0;
    const width = () => el.offsetWidth || window.innerWidth;
    const paint = () => {
      raf = 0;
      el.style.transform = `translate3d(${dx}px, 0, 0)`;
      root.style.setProperty('--ovp', (dx / width()).toFixed(3));
    };
    const start = (e) => {
      const x = e.touches[0].clientX;
      st = x < 28 && e.touches.length === 1 ? { x, y: e.touches[0].clientY, drag: false, hist: [] } : null;
    };
    const move = (e) => {
      if (!st) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      if (!st.drag) {
        if (Math.abs(y - st.y) > 30 && x - st.x < 20) { st = null; return; }
        if (x - st.x < 8) return;
        st.drag = true;
        el.style.transition = 'none';
        root.dataset.ovDrag = '1';
      }
      if (e.cancelable) e.preventDefault();
      dx = Math.max(0, x - st.x);
      st.hist.push({ x, t: e.timeStamp });
      if (st.hist.length > 6) st.hist.shift();
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const end = () => {
      const g = st;
      st = null;
      if (!g?.drag) return;
      cancelAnimationFrame(raf);
      raf = 0;
      const h = g.hist;
      const now = h[h.length - 1];
      const then = h.find((p) => now && now.t - p.t < 100) || h[0];
      const v = now && then && now.t > then.t ? (now.x - then.x) / (now.t - then.t) : 0;
      const w = width();
      delete root.dataset.ovDrag;
      if (dx > w * 0.33 || v > 0.5) {
        const ms = Math.round(Math.min(300, Math.max(130, (w - dx) / Math.max(v, 1.3))));
        swiped.current = true;
        el.style.transition = `transform ${ms}ms cubic-bezier(0.25, 0.85, 0.4, 1)`;
        el.style.transform = 'translate3d(100%, 0, 0)';
        root.style.setProperty('--ov-ms', `${ms}ms`);
        root.style.removeProperty('--ovp');
        unmark(); // the page beneath comes forward in step
        haptic('tick');
        setClosing(true);
        timer.current = setTimeout(() => { root.style.removeProperty('--ov-ms'); onCloseRef.current(); }, ms);
      } else {
        el.style.transition = 'transform 0.45s var(--e-spring)';
        el.style.transform = '';
        root.style.removeProperty('--ovp');
      }
      dx = 0;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`ph-portal ${s.overlay} ${closing && !swiped.current ? s.overlayOut : ''}`}
      style={tone ? { '--tone': tone } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <header className={`${s.bar} ${s.overlayBar}`}>
        <div className={s.barRow}>
          <button type="button" className={s.back} onClick={requestClose} aria-label="Back"><ChevronLeft size={24} /></button>
          <div className={s.titles}>
            {typeof title === 'string' ? <h1 className={s.title}>{title}</h1> : title}
            {sub && <span className={s.sub}>{sub}</span>}
          </div>
          {actions && <div className={s.actions}>{actions}</div>}
        </div>
      </header>
      <div className={s.overlayBody} ref={bodyRef}>{children}</div>
    </div>,
    document.body,
  );
}

/** Calls `onReach` as this (invisible) marker nears the viewport — infinite lists. */
export function Sentinel({ onReach, active }) {
  const ref = useRef(null);
  const cb = useRef(onReach);
  cb.current = onReach;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) cb.current(); }, { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [active]);
  return <div ref={ref} style={{ height: 1 }} />;
}
