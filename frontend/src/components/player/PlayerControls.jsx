import { useEffect, useRef, useState } from 'react';
import {
  Captions,
  Check,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';

import { clock } from '../../lib/time.js';
import s from './controls.module.css';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function VolumeIcon({ muted, volume, size = 18 }) {
  if (muted || volume === 0) return <VolumeX size={size} />;
  if (volume < 0.5) return <Volume1 size={size} />;
  return <Volume2 size={size} />;
}

/** The seek bar: a phosphor filament with buffered shading, a draggable bead, a
 *  hover time-chip, and a faint "resume" tick where you last left off. */
function Scrubber({ current, duration, buffered, resumeAt, disabled, onSeek, onScrub }) {
  const trackRef = useRef(null);
  const [hover, setHover] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverRatio, setHoverRatio] = useState(0);

  const pct = duration ? Math.min(100, (current / duration) * 100) : 0;
  const bufPct = duration ? Math.min(100, (buffered / duration) * 100) : 0;
  const active = hover || scrubbing;

  const ratioAt = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const down = (e) => {
    if (disabled || !duration) return;
    e.preventDefault();
    setScrubbing(true);
    onScrub?.(true);
    trackRef.current.setPointerCapture?.(e.pointerId);
    const ratio = ratioAt(e.clientX);
    setHoverRatio(ratio);
    onSeek(ratio * duration);
  };
  const move = (e) => {
    if (disabled || !duration) return;
    const ratio = ratioAt(e.clientX);
    setHoverRatio(ratio);
    if (scrubbing) onSeek(ratio * duration);
  };
  const up = (e) => {
    if (!scrubbing) return;
    setScrubbing(false);
    onScrub?.(false);
    trackRef.current.releasePointerCapture?.(e.pointerId);
  };
  const key = (e) => {
    if (disabled || !duration) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, current - 5)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(duration, current + 5)); }
    else if (e.key === 'Home') { e.preventDefault(); onSeek(0); }
    else if (e.key === 'End') { e.preventDefault(); onSeek(duration); }
  };

  const showResume = resumeAt > 1 && duration > 0 && current < resumeAt - 1;

  return (
    <div
      className={s.scrub}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.floor(duration) || 0}
      aria-valuenow={Math.floor(current) || 0}
      aria-valuetext={clock(current)}
      data-active={active ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={key}
    >
      <div className={s.track} ref={trackRef}>
        <span className={s.buf} style={{ width: `${bufPct}%` }} />
        <span className={s.played} style={{ width: `${pct}%` }} />
        {showResume && (
          <span
            className={s.ghost}
            style={{ left: `${(resumeAt / duration) * 100}%` }}
            title={`Resume ${clock(resumeAt)}`}
          />
        )}
        <span className={s.bead} style={{ left: `${pct}%` }} />
      </div>
      {active && duration > 0 && (
        <>
          <span className={s.guide} style={{ left: `${hoverRatio * 100}%` }} />
          <span className={s.chip} style={{ left: `${hoverRatio * 100}%` }}>
            {clock(hoverRatio * duration)}
          </span>
        </>
      )}
    </div>
  );
}

/** A small popover anchored above its trigger (speed / quality / captions). */
function Menu({ open, items, value, onPick, onClose, align = 'right' }) {
  if (!open) return null;
  return (
    <>
      <div className={s.menuScrim} onClick={onClose} />
      <div className={`${s.menu} ${align === 'right' ? s.menuRight : s.menuLeft}`} role="menu">
        {items.map((it) => (
          <button
            key={it.value}
            type="button"
            role="menuitemradio"
            aria-checked={it.value === value}
            className={s.menuItem}
            data-on={it.value === value ? '' : undefined}
            onClick={() => { onPick(it.value); onClose(); }}
          >
            <Check size={13} className={s.menuCheck} />
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}

export default function PlayerControls({
  expanded,
  isLive,
  dragging,
  videoRef,
  playKey,
  ctl,
  streams,
  quality,
  onQuality,
  subtitles,
  rate,
  onRate,
  resumeAt,
  canVolume,
  onVolumePersist,
}) {
  const [idle, setIdle] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [menu, setMenu] = useState(null); // 'speed' | 'quality' | 'cc' | null
  const [hud, setHud] = useState(null); // { node, key }
  const [ripple, setRipple] = useState(null); // { side, key }
  const [buffering, setBuffering] = useState(false);
  const [remaining, setRemaining] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [ccIndex, setCcIndex] = useState(subtitles.length ? 0 : -1);
  const idleTimer = useRef(null);
  const clickTimer = useRef(null);

  const hasMenuOpen = menu !== null;
  const visible = !idle || !ctl.playing || hasMenuOpen || scrubbing;

  // ── auto-hide: fade deck + cursor after a still moment while playing ─────────
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    if (ctl.playing && !hasMenuOpen && !scrubbing) {
      idleTimer.current = setTimeout(() => setIdle(true), 2500);
    }
  };
  useEffect(() => {
    if (!ctl.playing || hasMenuOpen || scrubbing) {
      setIdle(false);
      clearTimeout(idleTimer.current);
    } else {
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setIdle(true), 2500);
    }
    return () => clearTimeout(idleTimer.current);
  }, [ctl.playing, hasMenuOpen, scrubbing]);

  // ── transient center bloom ──────────────────────────────────────────────────
  const flash = (node) => setHud({ node, key: Date.now() });
  useEffect(() => {
    if (!hud) return undefined;
    const t = setTimeout(() => setHud(null), 620);
    return () => clearTimeout(t);
  }, [hud]);
  useEffect(() => {
    if (!ripple) return undefined;
    const t = setTimeout(() => setRipple(null), 500);
    return () => clearTimeout(t);
  }, [ripple]);

  // ── buffering ring, with a grace so quick stalls don't flicker ──────────────
  useEffect(() => {
    if (ctl.waiting && ctl.playing) {
      const t = setTimeout(() => setBuffering(true), 400);
      return () => clearTimeout(t);
    }
    setBuffering(false);
    return undefined;
  }, [ctl.waiting, ctl.playing]);

  // ── captions: drive the <video>'s text tracks from ccIndex ──────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const tracks = v.textTracks;
    for (let i = 0; i < tracks.length; i += 1) {
      tracks[i].mode = i === ccIndex ? 'showing' : 'hidden';
    }
  }, [ccIndex, playKey, videoRef, subtitles.length]);

  // ── actions (wrap ctl so buttons + keys share the same feedback) ────────────
  const actToggle = () => {
    const willPlay = !ctl.playing;
    ctl.toggle();
    flash(willPlay ? <Play size={42} fill="currentColor" /> : <Pause size={42} fill="currentColor" />);
  };
  const [spinBack, setSpinBack] = useState(0);
  const [spinFwd, setSpinFwd] = useState(0);
  const actSkip = (d, fromEdge) => {
    ctl.skip(d);
    if (d < 0) setSpinBack((n) => n + 1); else setSpinFwd((n) => n + 1);
    flash(<span className={s.hudText}>{d > 0 ? `+${d}s` : `${d}s`}</span>);
    if (fromEdge) setRipple({ side: d > 0 ? 'right' : 'left', key: Date.now() });
  };
  const nudgeVol = (d) => {
    const nv = Math.max(0, Math.min(1, (ctl.muted ? 0 : ctl.volume) + d));
    ctl.setVolume(nv);
    onVolumePersist?.(nv);
    flash(
      <span className={s.hudVol}>
        <VolumeIcon muted={nv === 0} volume={nv} size={30} />
        <i>{Math.round(nv * 100)}</i>
      </span>,
    );
  };
  const actMute = () => {
    const willMute = !ctl.muted && ctl.volume > 0;
    ctl.toggleMute();
    flash(<VolumeIcon muted={willMute} volume={ctl.volume} size={36} />);
  };
  const toggleCC = () => setCcIndex((i) => (i >= 0 ? -1 : 0));

  // ── keyboard (only the expanded card owns the keys) ─────────────────────────
  const kref = useRef();
  kref.current = { actToggle, actSkip, nudgeVol, actMute, toggleCC, ctl, subtitles, setShowKeys, wake };
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const h = kref.current;
      const k = e.key;
      if (k === ' ' || k === 'k') { e.preventDefault(); h.actToggle(); }
      else if (k === 'ArrowLeft') { e.preventDefault(); h.actSkip(-5); }
      else if (k === 'ArrowRight') { e.preventDefault(); h.actSkip(5); }
      else if (k === 'j') { e.preventDefault(); h.actSkip(-10); }
      else if (k === 'l') { e.preventDefault(); h.actSkip(10); }
      else if (k === 'ArrowUp') { e.preventDefault(); h.nudgeVol(0.05); }
      else if (k === 'ArrowDown') { e.preventDefault(); h.nudgeVol(-0.05); }
      else if (k === 'm') { h.actMute(); }
      else if (k === 'f') { h.ctl.toggleFullscreen(); }
      else if (k === 'c') { if (h.subtitles.length) h.toggleCC(); }
      else if (k === '?') { h.setShowKeys((v) => !v); }
      else if (/^[0-9]$/.test(k) && h.ctl.duration) {
        e.preventDefault();
        h.ctl.seek(h.ctl.duration * (Number(k) / 10));
      } else return;
      h.wake();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  // ── click-to-play, double-click edges to skip / center to fullscreen ────────
  const onFrameClick = (e) => {
    if (e.detail > 1) return; // belongs to a double-click
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => actToggle(), 220);
  };
  const onFrameDouble = (e) => {
    clearTimeout(clickTimer.current);
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (x < 0.35) actSkip(-10, true);
    else if (x > 0.65) actSkip(10, true);
    else ctl.toggleFullscreen();
  };
  const onWheel = (e) => {
    if (!canVolume) return;
    nudgeVol(e.deltaY < 0 ? 0.05 : -0.05);
  };

  // ── docked mini-variant: just a glanceable filament + a hover row ───────────
  if (!expanded) {
    const pct = ctl.duration ? Math.min(100, (ctl.current / ctl.duration) * 100) : 0;
    return (
      <div className={s.mini} data-drag={dragging ? '' : undefined}>
        <button className={s.miniCatch} onClick={() => ctl.toggle()} aria-label={ctl.playing ? 'Pause' : 'Play'} />
        <div className={s.miniRow}>
          <button className={s.miniBtn} onClick={() => ctl.toggle()} aria-label={ctl.playing ? 'Pause' : 'Play'}>
            {ctl.playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
          <Scrubber
            current={ctl.current}
            duration={ctl.duration}
            buffered={ctl.buffered}
            resumeAt={0}
            disabled={isLive}
            onSeek={ctl.seek}
          />
          <span className={s.miniTime}>{clock(ctl.current)}</span>
        </div>
        <div className={s.miniFilament}><span style={{ width: `${pct}%` }} /></div>
      </div>
    );
  }

  const qLabel = streams?.[quality]?.quality || 'Auto';
  const volValue = ctl.muted ? 0 : ctl.volume;

  return (
    <div className={s.overlay} data-hidden={!visible ? '' : undefined} onMouseMove={wake} onWheel={onWheel}>
      <button
        className={s.clickCatch}
        onClick={onFrameClick}
        onDoubleClick={onFrameDouble}
        aria-label={ctl.playing ? 'Pause' : 'Play'}
        tabIndex={-1}
      />

      {buffering && <div className={s.ring} aria-hidden="true" />}
      {hud && <div className={s.hud} key={hud.key}>{hud.node}</div>}
      {ripple && (
        <div className={`${s.edge} ${ripple.side === 'left' ? s.edgeLeft : s.edgeRight}`} key={ripple.key}>
          {ripple.side === 'left' ? '«10' : '10»'}
        </div>
      )}

      {showKeys && (
        <div className={s.keysCard} onClick={() => setShowKeys(false)}>
          <h4>Keyboard</h4>
          <dl>
            <div><dt>Space / K</dt><dd>play · pause</dd></div>
            <div><dt>← / →</dt><dd>seek 5s</dd></div>
            <div><dt>J / L</dt><dd>seek 10s</dd></div>
            <div><dt>↑ / ↓</dt><dd>volume</dd></div>
            <div><dt>0–9</dt><dd>jump to %</dd></div>
            <div><dt>M · F · C</dt><dd>mute · fullscreen · captions</dd></div>
          </dl>
        </div>
      )}

      <div className={s.deck}>
        <Scrubber
          current={ctl.current}
          duration={ctl.duration}
          buffered={ctl.buffered}
          resumeAt={resumeAt}
          disabled={isLive}
          onSeek={ctl.seek}
          onScrub={setScrubbing}
        />

        <div className={s.row}>
          <div className={s.cluster}>
            <button className={s.btn} onClick={actToggle} aria-label={ctl.playing ? 'Pause' : 'Play'} title={ctl.playing ? 'Pause (k)' : 'Play (k)'}>
              {ctl.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
            <button className={s.btn} onClick={() => actSkip(-10)} aria-label="Back 10 seconds" title="Back 10s (j)">
              <span className={s.skip}><RotateCcw key={spinBack} size={19} className={s.spinBack} /><i>10</i></span>
            </button>
            <button className={s.btn} onClick={() => actSkip(10)} aria-label="Forward 10 seconds" title="Forward 10s (l)">
              <span className={s.skip}><RotateCw key={spinFwd} size={19} className={s.spinFwd} /><i>10</i></span>
            </button>

            {isLive ? (
              <span className={s.liveTag}><span className={s.liveDot} /> LIVE</span>
            ) : (
              <button
                className={s.time}
                onClick={() => setRemaining((r) => !r)}
                title="Toggle remaining time"
              >
                <span className={s.timeCur}>
                  {remaining ? `-${clock(Math.max(0, ctl.duration - ctl.current))}` : clock(ctl.current)}
                </span>
                <span className={s.timeSep}>/</span>
                <span>{clock(ctl.duration)}</span>
              </button>
            )}
          </div>

          <div className={s.cluster}>
            {subtitles.length > 0 && (
              <div className={s.menuWrap}>
                <button
                  className={`${s.btn} ${ccIndex >= 0 ? s.btnOn : ''}`}
                  onClick={() => (subtitles.length > 1 ? setMenu(menu === 'cc' ? null : 'cc') : toggleCC())}
                  aria-label="Captions"
                  title="Captions (c)"
                >
                  <Captions size={18} />
                </button>
                {subtitles.length > 1 && (
                  <Menu
                    open={menu === 'cc'}
                    value={ccIndex}
                    onClose={() => setMenu(null)}
                    onPick={setCcIndex}
                    items={[{ value: -1, label: 'Off' }, ...subtitles.map((sub, i) => ({ value: i, label: sub.label || sub.lang || `Track ${i + 1}` }))]}
                  />
                )}
              </div>
            )}

            <div className={s.menuWrap}>
              <button
                className={`${s.pill} ${rate !== 1 ? s.pillOn : ''}`}
                onClick={() => setMenu(menu === 'speed' ? null : 'speed')}
                title="Playback speed"
              >
                {rate}×
              </button>
              <Menu
                open={menu === 'speed'}
                value={rate}
                onClose={() => setMenu(null)}
                onPick={onRate}
                items={SPEEDS.map((sp) => ({ value: sp, label: sp === 1 ? 'Normal' : `${sp}×` }))}
              />
            </div>

            {Array.isArray(streams) && streams.length > 1 && (
              <div className={s.menuWrap}>
                <button
                  className={s.pill}
                  onClick={() => setMenu(menu === 'quality' ? null : 'quality')}
                  title="Quality"
                >
                  {qLabel}
                </button>
                <Menu
                  open={menu === 'quality'}
                  value={quality}
                  onClose={() => setMenu(null)}
                  onPick={onQuality}
                  items={streams.map((st, i) => ({ value: i, label: st.quality || `Source ${i + 1}` }))}
                />
              </div>
            )}

            {canVolume && (
              <div className={s.vol}>
                <button className={s.btn} onClick={actMute} aria-label={ctl.muted ? 'Unmute' : 'Mute'} title="Mute (m)">
                  <VolumeIcon muted={ctl.muted} volume={ctl.volume} />
                </button>
                <span className={s.volWrap}>
                  <input
                    className={s.volRange}
                    type="range"
                    min="0"
                    max="1"
                    step="0.02"
                    value={volValue}
                    aria-label="Volume"
                    style={{ '--pct': `${volValue * 100}%` }}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      ctl.setVolume(v);
                      onVolumePersist?.(v);
                    }}
                  />
                </span>
              </div>
            )}

            <button
              className={s.btn}
              onClick={ctl.toggleFullscreen}
              aria-label={ctl.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title="Fullscreen (f)"
            >
              {ctl.fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
