import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { Link } from 'react-router-dom';
import {
  Calculator, ChevronRight, Clock, Eraser, Film, Flag, Hourglass, Minus, Moon,
  Plus, Sun, X,
} from 'lucide-react';

import { applyOverlay, useAnimeSync } from '../../state.jsx';
import s from './WatchCalculator.module.css';

// AniList leaves `duration` null on plenty of titles (shorts, ONAs, un-scraped
// runs). Rather than drop them from the tally we assume a standard TV slot and
// flag the row as an estimate — an honest guess beats a silent zero.
const DEFAULT_EP_MIN = 24;
// Below this the app-shell's own side margin can't hold the dock without biting
// into the content column, so the dock rides as a rail you pop open instead.
const SHELL_MAX = 1280;
const PANEL_W = 296; // dock width + a hair of breathing room; mirrors the CSS
const STORE_KEY = 'tubcal:reckoner';

const CalcCtx = createContext(null);
// A no-op shape so a stray <AnimeCard> rendered outside the section (or in a test)
// can still call the hook without a guard and simply not arm anything.
const NOOP = { enabled: false, hoverProps: () => ({}), add: () => {} };
export const useAnimeCalc = () => useContext(CalcCtx) || NOOP;

const typingInField = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

/** Episodes aired so far: for an airing show it's the one before next-to-air,
 *  otherwise the full run. This is the ceiling on what can be tallied "now". */
const airedCount = (m) =>
  m.next_episode ? m.next_episode - 1 : (m.episodes || 0);

// ── time arithmetic ─────────────────────────────────────────────────────────

/** A minute span as up-to-two human units, largest first, zeros dropped:
 *  614 → [{v:10,u:'h'},{v:14,u:'m'}], 3120 → [{v:2,u:'d'},{v:4,u:'h'}]. */
function runtimeParts(totalMin) {
  const m = Math.max(0, Math.round(totalMin));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return [{ v: d, u: 'd' }, ...(h ? [{ v: h, u: 'h' }] : [])];
  if (h > 0) return [{ v: h, u: 'h' }, ...(mm ? [{ v: mm, u: 'm' }] : [])];
  return [{ v: mm, u: 'm' }];
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** When a marathon begun *now* would end: wall-clock, a friendly day word, and a
 *  moon/sun glyph so a 3am finish reads at a glance as the late night it is. */
function finishLabel(totalMin, now) {
  const at = new Date(now.getTime() + totalMin * 60000);
  const diff = Math.round((startOfDay(at) - startOfDay(now)) / 86400000);
  const day =
    diff <= 0 ? 'today'
      : diff === 1 ? 'tomorrow'
        : at.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const hour = at.getHours();
  const nocturnal = hour >= 22 || hour < 5;
  return {
    clock: at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    day,
    nocturnal,
  };
}

const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

// ── provider ────────────────────────────────────────────────────────────────

function loadStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && v.entries ? v.entries : {};
  } catch {
    return {};
  }
}

export function AnimeCalcProvider({ children }) {
  const { overlay } = useAnimeSync();
  // Keyed by media id → a snapshot taken at add-time plus a running `count`
  // (episodes watched+1 … watched+count). Insertion order via `addedAt`.
  const [entries, setEntries] = useState(loadStored);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(null); // {kind, title} transient hint
  // The title the pointer is currently over — a ref, so hovering never re-renders
  // the wall of cards; the key handler reads it live.
  const hoverRef = useRef(null);
  const lastG = useRef(0);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const noticeTimer = useRef(null);

  // Persist so a plan survives leaving the room, a reload, or a lazy-chunk remount.
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ entries }));
    } catch { /* private mode / quota — the plan just won't persist */ }
  }, [entries]);

  const flash = useCallback((kind, title) => {
    setNotice({ kind, title, n: Date.now() });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2600);
  }, []);

  // Add the next unseen episode of `media` to the tally (the C-key action). First
  // press queues watched+1, each subsequent press extends the run by one, capping
  // at the last aired episode. Fully-watched or unaired titles flash a gentle note.
  const addNext = useCallback((media) => {
    if (!media?.id) return;
    const eff = applyOverlay(media.id, media.list_entry, overlayRef.current);
    const watched = eff?.progress || 0;
    const available = airedCount(media);
    const title = media.title || 'This title';
    if (available <= 0) { flash('unaired', title); return; }
    const maxCount = available - watched;
    if (maxCount <= 0) { flash('caught', title); return; }

    setEntries((prev) => {
      const cur = prev[media.id];
      const already = cur?.count || 0;
      if (already >= maxCount) {
        flash('capped', title);
        return prev; // nothing new to add; leave the row untouched
      }
      return {
        ...prev,
        [media.id]: {
          id: media.id,
          title,
          cover: media.cover || media.cover_xl || null,
          color: media.color || null,
          perEp: media.duration || DEFAULT_EP_MIN,
          estimated: !media.duration,
          watched,
          available,
          count: already + 1,
          addedAt: cur?.addedAt ?? Date.now(),
          bump: (cur?.bump || 0) + 1, // re-keys the row animation on each add
        },
      };
    });
    setOpen(true);
  }, [flash]);

  // Nudge one row's episode count by ±1, clamped to its available run; 0 removes it.
  const step = useCallback((id, delta) => {
    setEntries((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      const maxCount = cur.available - cur.watched;
      const count = Math.max(0, Math.min(cur.count + delta, maxCount));
      if (count === 0) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: { ...cur, count, bump: (cur.bump || 0) + 1 } };
    });
  }, []);

  const removeRow = useCallback((id) => {
    setEntries((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const clearAll = useCallback(() => setEntries({}), []);

  const hoverProps = useCallback((media) => ({
    onMouseEnter: () => { hoverRef.current = media; },
    onMouseLeave: () => { if (hoverRef.current?.id === media.id) hoverRef.current = null; },
  }), []);

  // The C-key listener. Deliberately narrow: no modifiers (so Ctrl-C copies), not
  // while typing or when the player/editor own the keys, and it stands down for the
  // 1s window after a `g` so the `g c` room-jump chord still reaches the editor.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'g') { lastG.current = Date.now(); return; }
      if (e.key !== 'c' && e.key !== 'C') return;
      if (Date.now() - lastG.current < 1000) return;
      if (typingInField(e.target)) return;
      if (document.body.dataset.playerExpanded || document.body.dataset.editorFocused) return;
      const media = hoverRef.current;
      if (!media) return;
      e.preventDefault();
      addNext(media);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addNext]);

  const value = useMemo(() => ({ enabled: true, hoverProps, add: addNext }), [hoverProps, addNext]);

  return (
    <CalcCtx.Provider value={value}>
      {children}
      <ReckonerDock
        entries={entries}
        open={open}
        notice={notice}
        onOpen={setOpen}
        onStep={step}
        onRemove={removeRow}
        onClear={clearAll}
      />
    </CalcCtx.Provider>
  );
}

// ── the dock ────────────────────────────────────────────────────────────────

const NOTICE_TEXT = {
  caught: (t) => `You're all caught up on ${t}.`,
  capped: (t) => `Every aired episode of ${t} is already tallied.`,
  unaired: (t) => `${t} hasn't aired an episode yet.`,
};

/** A single planned title: cover, the episode run it stands for, its runtime, and
 *  a stepper. The `bump` key restarts the tick animation each time it changes. */
function ReckonerRow({ e, onStep, onRemove }) {
  const from = e.watched + 1;
  const to = e.watched + e.count;
  const mins = e.count * e.perEp;
  const runtime = runtimeParts(mins);
  return (
    <li className={s.row} style={{ '--cover-c': e.color || 'var(--c-anime)' }}>
      <Link to={`/anime/${e.id}`} className={s.rowCover} title={`Open ${e.title}`}>
        {e.cover ? <img src={e.cover} alt="" loading="lazy" /> : <Film size={15} />}
      </Link>
      <div className={s.rowBody}>
        <Link to={`/anime/${e.id}`} className={s.rowTitle} title={e.title}>{e.title}</Link>
        <div className={s.rowMeta}>
          <span className={s.rowRange}>
            {e.count === 1 ? `EP ${from}` : `EP ${from}–${to}`}
            <i>· {e.count} {plural(e.count, 'ep', 'eps')}</i>
          </span>
          <span
            key={e.bump}
            className={`${s.rowTime} ${e.estimated ? s.rowTimeEst : ''}`}
            title={e.estimated
              ? `AniList lists no episode length — estimated at ${DEFAULT_EP_MIN} min each`
              : `${e.perEp} min × ${e.count}`}
          >
            {runtime.map((p) => (
              <span key={p.u}>{p.v}<i>{p.u}</i></span>
            ))}
          </span>
        </div>
      </div>
      <div className={s.rowSteps}>
        <button className={s.stepBtn} onClick={() => onStep(e.id, 1)}
          disabled={e.count >= e.available - e.watched}
          aria-label={`Add an episode of ${e.title}`}>
          <Plus size={12} />
        </button>
        <button className={s.stepBtn} onClick={() => onStep(e.id, -1)}
          aria-label={`Drop an episode of ${e.title}`}>
          <Minus size={12} />
        </button>
      </div>
      <button className={s.rowX} onClick={() => onRemove(e.id)} aria-label={`Remove ${e.title}`}>
        <X size={13} />
      </button>
    </li>
  );
}

function ReckonerDock({ entries, open, notice, onOpen, onStep, onRemove, onClear }) {
  const rows = useMemo(
    () => Object.values(entries).sort((a, b) => a.addedAt - b.addedAt),
    [entries],
  );
  // Whether the side margin is wide enough to seat the dock without covering the
  // content column. Below that the dock defaults to its rail and floats on open.
  const [roomy, setRoomy] = useState(
    () => typeof window !== 'undefined' && (window.innerWidth - SHELL_MAX) / 2 >= PANEL_W,
  );
  useEffect(() => {
    const measure = () => setRoomy((window.innerWidth - SHELL_MAX) / 2 >= PANEL_W);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Reveal a persisted plan on entry when the margin can hold it — but only once,
  // so folding the dock (or a fresh empty visit) is honoured from then on.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (rows.length > 0 && roomy) onOpen(true);
  }, [rows.length, roomy, onOpen]);

  // Keep the finish clock honest: it's always "if you start now", so re-read the
  // time every 20s (and it recomputes for free whenever the tally changes).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!rows.length) return undefined;
    const t = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(t);
  }, [rows.length]);

  const totalMin = useMemo(() => rows.reduce((n, e) => n + e.count * e.perEp, 0), [rows]);
  const totalEps = useMemo(() => rows.reduce((n, e) => n + e.count, 0), [rows]);
  const anyEst = rows.some((e) => e.estimated);
  const total = runtimeParts(totalMin);
  const fin = finishLabel(totalMin, now);

  const shown = open;

  // Collapsed rail — a slim spine in the margin. Carries a live count badge so a
  // folded-away plan still shows its weight.
  if (!shown) {
    return (
      <button className={s.rail} onClick={() => onOpen(true)} aria-label="Open the watch calculator">
        <Calculator size={16} />
        <span className={s.railWord}>Reckoner</span>
        {rows.length > 0 && <span className={s.railBadge}>{rows.length}</span>}
      </button>
    );
  }

  return (
    <aside
      className={`${s.dock} ${roomy ? s.docked : s.floating}`}
      role="complementary"
      aria-label="Watch-time calculator"
    >
      <header className={s.head}>
        <span className={s.headMark}><Calculator size={15} /></span>
        <div className={s.headText}>
          <h2 className={s.headTitle}>The Reckoner</h2>
          <span className={s.headSub}>marathon time ledger</span>
        </div>
        <button className={s.headFold} onClick={() => onOpen(false)} aria-label="Collapse">
          <ChevronRight size={16} />
        </button>
      </header>

      {notice && (
        <p key={notice.n} className={s.notice}>
          {(NOTICE_TEXT[notice.kind] || (() => 'Nothing to add.'))(notice.title)}
        </p>
      )}

      {rows.length === 0 ? (
        <div className={s.empty}>
          <span className={s.emptyGlyph}><Hourglass size={22} /></span>
          <p className={s.emptyLead}>Plan a marathon.</p>
          <p className={s.emptyHow}>
            Hover any title and tap <kbd className={s.kbd}>C</kbd> to tally its next
            unwatched episode. Tap again for the one after, and the one after that.
          </p>
        </div>
      ) : (
        <>
          <ol className={s.rows}>
            {rows.map((e) => (
              <ReckonerRow key={e.id} e={e} onStep={onStep} onRemove={onRemove} />
            ))}
          </ol>

          <div className={s.totals}>
            <div className={s.grandRow}>
              <span className={s.grandLabel}><Clock size={12} /> Total sitting</span>
              <span key={totalMin} className={s.grand}>
                {total.map((p) => (
                  <span key={p.u} className={s.grandPart}>{p.v}<i>{p.u}</i></span>
                ))}
              </span>
            </div>
            <p className={s.grandUnder}>
              {totalEps} {plural(totalEps, 'episode')} across {rows.length} {plural(rows.length, 'title')}
              {anyEst && <span className={s.estNote} title="Some runtimes are estimated"> · some estimated</span>}
            </p>

            <div className={s.finish} aria-live="polite">
              <span className={s.finishGlyph}>
                {fin.nocturnal ? <Moon size={14} /> : <Sun size={14} />}
              </span>
              <span className={s.finishText}>
                <span className={s.finishLead}><Flag size={11} /> Start now, finish</span>
                <span className={s.finishWhen}>
                  <strong>{fin.clock}</strong>
                  <em>{fin.day}</em>
                </span>
              </span>
            </div>

            <button className={s.clear} onClick={onClear}>
              <Eraser size={12} /> Clear the tally
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
