// The title page's opening theme: a few bars of the show's OP as its page opens,
// the way a broadcast leads into a programme.
//
// Themes come from AnimeThemes (server/sources/animethemes.py), audio straight from
// its CDN. Which opening: the one that plays over the episode you're up to (OP2
// from episode 14 on), else the first. Autoplay is a setting (Settings → The Anime,
// on by default): it plays `anime_theme_seconds` with a fade at both ends and steps
// aside for anything else — it won't start over a playing video, and it fades out
// the moment one opens, the tab is hidden, or you leave the page. The chip stays as
// a manual control either way; pressed, a song plays in full.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Music2, Play, Square } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { usePlayer, useSettings } from '../../state.jsx';
import t from './themeplayer.module.css';

const FADE_IN = 1500;
const FADE_OUT = 2500;
const FADE_QUICK = 450;
// Back-and-forth between a title and its cast within a session shouldn't replay
// the opening every time; the chip still plays it on request.
const REPLAY_AFTER = 10 * 60_000;
const recent = new Map(); // anilist id → when its opening last autoplayed

/** Where `theme`'s span covering episode n begins (-1 if it doesn't cover it). */
const coverStart = (theme, n) => theme.ranges.reduce(
  (best, [lo, hi]) => (n >= lo && (hi == null || n <= hi) ? Math.max(best, lo) : best), -1);

/** The opening for episode `nextEp` (the one you'd watch next), else the first.
 *  Spans overlap in AnimeThemes' data — an airing show's OP1 reads "1-" even after
 *  OP2 took over at 14 — so of the openings covering the episode, the one that
 *  starts latest is the one actually playing over it. */
export function pickTheme(themes, nextEp) {
  const ops = themes.filter((x) => x.type === 'OP');
  const pool = ops.length ? ops : themes;
  let pick = null;
  let at = -1;
  if (nextEp) {
    for (const x of pool) {
      const s = coverStart(x, nextEp);
      if (s > at) { at = s; pick = x; }
    }
  }
  return pick || pool[0] || null;
}

/** Is anything else on the page making sound? (Our own <audio> is never in the DOM.) */
function othersPlaying() {
  return [...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.muted && m.volume > 0);
}

// AnimeThemes' own slug tells variants apart ("ED1" vs the broadcast-only "ED1-TV").
const label = (x) => x.slug || `${x.type}${x.sequence}`;

export default function ThemePlayer({ mediaId, nextEp }) {
  const { settings } = useSettings();
  const { players, expandedId } = usePlayer();
  const themes = useApi(`/anime/themes/${mediaId}`);
  const list = themes.data?.themes || [];

  // One element for the page's life, made up front so its listeners are in place
  // before anything plays. Never attached to the DOM.
  const [audio] = useState(() => {
    const a = new Audio();
    a.preload = 'auto';
    return a;
  });
  const audioRef = useRef(audio);
  const rafRef = useRef(0);
  const limitRef = useRef(0); // seconds; 0 = the whole song
  const fadingRef = useRef(false);
  const triedRef = useRef(false);
  const [current, setCurrent] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | playing | blocked
  const [frac, setFrac] = useState(0);
  // The menu is portalled to <body> at the chip's position: the title header clips
  // its overflow (the banner art), which would cut a long list of themes short.
  const [menu, setMenu] = useState(null); // null | {top, left, width}
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const openMenu = () => {
    if (menu) { setMenu(null); return; }
    const r = wrapRef.current.getBoundingClientRect();
    setMenu({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 300) });
  };

  const autoplay = settings?.anime_theme_audio !== false;
  const volume = Math.min(1, Math.max(0, settings?.anime_theme_volume ?? 0.35));
  const seconds = settings?.anime_theme_seconds ?? 30;
  const volRef = useRef(volume);
  volRef.current = volume;

  const ramp = useCallback((to, ms, done) => {
    const a = audioRef.current;
    if (!a) return;
    cancelAnimationFrame(rafRef.current);
    const from = a.volume;
    const t0 = performance.now();
    const step = (now) => {
      const k = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
      a.volume = Math.min(1, Math.max(0, from + (to - from) * k));
      if (k < 1) rafRef.current = requestAnimationFrame(step);
      else done?.();
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const stop = useCallback((ms = FADE_QUICK) => {
    const a = audioRef.current;
    if (!a || a.paused) { setPhase((p) => (p === 'blocked' ? p : 'idle')); return; }
    fadingRef.current = true;
    ramp(0, ms, () => {
      a.pause();
      fadingRef.current = false;
      setPhase('idle');
      setFrac(0);
    });
  }, [ramp]);

  const start = useCallback((theme, limit) => {
    const a = audioRef.current;
    cancelAnimationFrame(rafRef.current);
    fadingRef.current = false;
    if (a.src !== theme.audio) a.src = theme.audio;
    a.currentTime = 0;
    a.volume = 0;
    limitRef.current = limit;
    setCurrent(theme);
    setFrac(0);
    a.play().then(
      () => {
        setPhase('playing');
        ramp(volRef.current, limit ? FADE_IN : FADE_QUICK);
      },
      (err) => {
        // NotAllowedError: the browser wants a gesture first (a cold page load).
        // AbortError: a newer play() replaced this one — nothing to report.
        if (err?.name === 'NotAllowedError') setPhase('blocked');
        else if (err?.name !== 'AbortError') setPhase('idle');
      },
    );
  }, [ramp]);

  // The play-window: drain the chip's line, fade out ahead of the limit, and
  // settle back to idle when a full song ends.
  useEffect(() => {
    const a = audio;
    const onTime = () => {
      const limit = limitRef.current;
      const span = limit || a.duration || 0;
      if (span) setFrac(Math.min(1, a.currentTime / span));
      if (limit && !fadingRef.current && a.currentTime >= limit - FADE_OUT / 1000) stop(FADE_OUT);
    };
    const onEnd = () => { setPhase('idle'); setFrac(0); };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnd);
    };
  }, [audio, stop]);

  // A volume change in Settings applies to a song already playing.
  useEffect(() => {
    if (phase === 'playing' && !fadingRef.current) audio.volume = volume;
  }, [volume, phase, audio]);

  // Autoplay, once per page view, when everything says yes.
  useEffect(() => {
    if (triedRef.current || !settings || !list.length) return;
    triedRef.current = true;
    const theme = pickTheme(list, nextEp);
    setCurrent(theme);
    if (!autoplay || !theme) return;
    if (Date.now() - (recent.get(mediaId) || 0) < REPLAY_AFTER) return;
    if (document.visibilityState !== 'visible' || expandedId || othersPlaying()) return;
    recent.set(mediaId, Date.now());
    start(theme, seconds);
  }, [settings, list, nextEp, autoplay, mediaId, expandedId, seconds, start]);

  // Step aside: a video opening (or one brought to the front), the tab going to
  // the background. `players` is every open video; `expandedId` the one in front.
  const opened = players.length;
  const seenRef = useRef({ opened, expandedId });
  useEffect(() => {
    const was = seenRef.current;
    if (opened > was.opened || (expandedId && expandedId !== was.expandedId)) stop();
    seenRef.current = { opened, expandedId };
  }, [opened, expandedId, stop]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'hidden') stop(0); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [stop]);

  // Leaving the page: a short fade, then silence. The element isn't in the DOM, so
  // it would otherwise keep playing after the page that started it is gone.
  useEffect(() => () => {
    const a = audioRef.current;
    cancelAnimationFrame(rafRef.current);
    if (a.paused) return;
    const from = a.volume;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / FADE_QUICK);
      a.volume = from * (1 - k);
      if (k < 1) requestAnimationFrame(step);
      else { a.pause(); a.removeAttribute('src'); a.load(); }
    };
    requestAnimationFrame(step);
  }, []);

  const menuOpen = !!menu;
  useEffect(() => {
    if (!menuOpen) return undefined;
    const inside = (el) => wrapRef.current?.contains(el) || listRef.current?.contains(el);
    const close = (e) => { if (!inside(e.target)) setMenu(null); };
    const esc = (e) => { if (e.key === 'Escape') setMenu(null); };
    // fixed to where the chip was — so the page scrolling away closes it
    const scrolled = (e) => { if (!listRef.current?.contains(e.target)) setMenu(null); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', scrolled);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', scrolled);
    };
  }, [menuOpen]);

  if (!current) return null;
  const playing = phase === 'playing';
  const toggle = () => (playing ? stop() : start(current, 0));

  return (
    <div className={t.wrap} ref={wrapRef}>
      <div className={t.chip} data-playing={playing || undefined}>
        <button
          type="button"
          className={t.toggle}
          onClick={toggle}
          aria-label={playing ? 'Stop the theme' : `Play ${label(current)}${current.title ? `, ${current.title}` : ''}`}
        >
          {playing ? <Square size={12} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
        </button>
        <button
          type="button"
          className={t.meta}
          onClick={openMenu}
          aria-expanded={menuOpen}
          aria-haspopup="true"
          title={list.length > 1 ? 'Every opening and ending' : undefined}
        >
          <span className={t.song}>
            {playing ? (
              <span className={t.bars} aria-hidden="true"><i /><i /><i /></span>
            ) : (
              <Music2 size={12} className={t.note} />
            )}
            <span className={t.songName}>{current.title || label(current)}</span>
          </span>
          <span className={t.by}>
            {phase === 'blocked' ? 'Press play to hear the opening' : (
              <>{label(current)}{current.artists?.length ? ` · ${current.artists.join(', ')}` : ''}</>
            )}
          </span>
          {list.length > 1 && <ChevronDown size={13} className={t.caret} />}
        </button>
        <span className={t.line} style={{ transform: `scaleX(${playing ? 1 - frac : 0})` }} aria-hidden="true" />
      </div>

      {menu && createPortal(
        <ul className={t.menu} role="menu" ref={listRef} style={menu}>
          {list.map((x) => (
            <li key={x.slug} role="none">
              <button
                type="button"
                role="menuitem"
                className={x === current || x.slug === current.slug ? t.itemOn : t.item}
                onClick={() => { setMenu(null); start(x, 0); }}
              >
                <b>{label(x)}</b>
                <span>
                  {x.title || 'Untitled'}
                  {x.artists?.length > 0 && <em>{x.artists.join(', ')}</em>}
                </span>
                {x.episodes && <small>eps {x.episodes}</small>}
              </button>
            </li>
          ))}
          {themes.data?.page && (
            <li role="none" className={t.credit}>
              <a href={themes.data.page} target="_blank" rel="noreferrer">from AnimeThemes</a>
            </li>
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}
