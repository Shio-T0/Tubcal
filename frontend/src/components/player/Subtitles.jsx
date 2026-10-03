// Subtitles, drawn by Tubcal rather than the browser, so they look the way you set
// them, in every player. The browser's own ::cue rendering can't be sized relative
// to the picture, moved up from the bottom, or styled the same way in Firefox and
// Android's WebView. So the browser still parses the WebVTT (the chosen track is
// set to `hidden`: its cues load and `activeCues` update, nothing is drawn) and
// this layer draws the active cues over the picture.
//
//   useSubtitleStyle()   [style, set, reset]. One style for the whole app, saved in
//                        the `subtitle_style` setting; edits show at once in every
//                        player and editor and are saved a moment after you stop.
//   SubtitleOverlay      the layer over a <video>, for the track index given
//   SubtitleStyleEditor  the controls, with a sample line (Settings) or without
//                        one (in a player, where the episode is the sample)

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

import { useSettings } from '../../state.jsx';
import {
  SUBTITLE_COLORS, SUBTITLE_DEFAULTS, SUBTITLE_EDGES, SUBTITLE_FONTS, SUBTITLE_LANGS, SUBTITLE_WEIGHTS,
  subtitleStyle, subtitleVars,
} from '../../lib/subtitleStyle.js';
import u from './subtitles.module.css';

// An edit in progress, shared by every instance so a player's subtitles follow the
// slider in the editor next to them; saved once you pause.
let draft = null;
let saveTimer = null;
const listeners = new Set();
const setDraft = (d) => {
  draft = d;
  listeners.forEach((f) => f());
};

export function useSubtitleStyle() {
  const { settings, updateSettings } = useSettings();
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    listeners.add(bump);
    return () => { listeners.delete(bump); };
  }, []);
  const saved = settings?.subtitle_style;
  const style = subtitleStyle(draft || saved);
  const save = useCallback((next) => {
    setDraft(next);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await updateSettings({ subtitle_style: next });
      if (draft === next) setDraft(null);
    }, 450);
  }, [updateSettings]);
  const set = useCallback((patch) => save({ ...subtitleStyle(draft || saved), ...patch }), [save, saved]);
  const reset = useCallback(() => save({ ...SUBTITLE_DEFAULTS }), [save]);
  return [style, set, reset];
}

/** Top or bottom of the picture, from a cue's WebVTT `line` setting. */
function atTop(cue) {
  if (cue.line === 'auto' || cue.line == null) return false;
  return cue.snapToLines ? cue.line >= 0 : cue.line < 50;
}

function Cue({ cue }) {
  // getCueAsHTML builds only WebVTT's own tags (i, b, u, ruby, span) and text, so
  // dropping it in is safe; newlines are kept by `white-space: pre-line`.
  const fill = (el) => {
    if (!el) return;
    try {
      el.replaceChildren(cue.getCueAsHTML());
    } catch {
      el.textContent = cue.text || '';
    }
  };
  return <span className={u.line}><span ref={fill} /></span>;
}

/** The subtitle layer for `videoRef`'s text track `track` (-1 = off). `playKey`
 *  changes when the <video> is swapped, so the tracks are re-read. */
export function SubtitleOverlay({ videoRef, track, playKey }) {
  const [style] = useSubtitleStyle();
  const boxRef = useRef(null);
  const [px, setPx] = useState(20);
  const [cues, setCues] = useState([]);

  // The base size is 5% of the picture's height, so it scales with the player,
  // fullscreen included.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setPx(e.contentRect.height * 0.05));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    let tt = null;
    const read = () => setCues(tt?.activeCues ? Array.from(tt.activeCues) : []);
    const apply = () => {
      tt?.removeEventListener('cuechange', read);
      const list = v.textTracks;
      for (let i = 0; i < list.length; i += 1) list[i].mode = i === track ? 'hidden' : 'disabled';
      tt = track >= 0 ? list[track] || null : null;
      tt?.addEventListener('cuechange', read);
      read();
    };
    apply();
    // <track> children can attach after this runs; pick them up when they do
    v.textTracks.addEventListener?.('addtrack', apply);
    return () => {
      tt?.removeEventListener('cuechange', read);
      v.textTracks.removeEventListener?.('addtrack', apply);
    };
  }, [videoRef, track, playKey]);

  const top = cues.filter(atTop);
  const bottom = cues.filter((c) => !atTop(c));
  return (
    <div className={u.layer} ref={boxRef} style={subtitleVars(style, px)} aria-hidden="true">
      {track >= 0 && top.length > 0 && (
        <div className={u.top}>{top.map((c, i) => <Cue key={`${c.startTime}-${c.id}-${i}`} cue={c} />)}</div>
      )}
      {track >= 0 && bottom.length > 0 && (
        <div className={u.bottom}>{bottom.map((c, i) => <Cue key={`${c.startTime}-${c.id}-${i}`} cue={c} />)}</div>
      )}
    </div>
  );
}

function Choice({ label, options, value, onPick }) {
  return (
    <div className={u.field}>
      <span className={u.fieldLabel}>{label}</span>
      <div className={u.choices} role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === value ? u.choiceOn : u.choice}
            aria-pressed={o.value === value}
            onClick={() => onPick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Slider({ label, min, max, step, value, format, onChange }) {
  return (
    <label className={u.field}>
      <span className={u.fieldLabel}>{label}</span>
      <span className={u.slider}>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <output>{format(value)}</output>
      </span>
    </label>
  );
}

/** Every setting of the subtitle style. `sample` shows a line rendered with it
 *  (Settings); in a player the episode's own subtitles are the sample. */
export function SubtitleStyleEditor({ sample = false, className }) {
  const [st, set, reset] = useSubtitleStyle();
  const custom = !SUBTITLE_COLORS.includes(st.color.toLowerCase());
  return (
    <div className={`${u.editor} ${className || ''}`}>
      {sample && (
        <div className={u.sample} style={subtitleVars(st, 26)}>
          <div className={u.bottom}>
            <span className={u.line}><span>Rin, the mountain path is quiet tonight.{'\n'}<i>Too quiet.</i></span></span>
          </div>
        </div>
      )}
      <Slider label="Size" min={0.5} max={2.5} step={0.05} value={st.size} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ size: v })} />
      <Choice label="Font" options={SUBTITLE_FONTS} value={st.font} onPick={(v) => set({ font: v })} />
      <Choice label="Weight" options={SUBTITLE_WEIGHTS} value={st.weight} onPick={(v) => set({ weight: v })} />
      <div className={u.field}>
        <span className={u.fieldLabel}>Colour</span>
        <div className={u.swatches}>
          {SUBTITLE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={st.color.toLowerCase() === c ? u.swatchOn : u.swatch}
              style={{ '--sw': c }}
              aria-label={c}
              aria-pressed={st.color.toLowerCase() === c}
              onClick={() => set({ color: c })}
            />
          ))}
          <label className={custom ? u.swatchOn : u.swatch} style={{ '--sw': custom ? st.color : 'transparent' }} title="Any colour">
            <input type="color" value={st.color} onChange={(e) => set({ color: e.target.value })} aria-label="Any colour" />
            {!custom && <span>+</span>}
          </label>
        </div>
      </div>
      <Choice label="Edge" options={SUBTITLE_EDGES} value={st.edge} onPick={(v) => set({ edge: v })} />
      <Slider label="Backdrop" min={0} max={1} step={0.05} value={st.bg} format={(v) => (v ? `${Math.round(v * 100)}%` : 'None')} onChange={(v) => set({ bg: v })} />
      <Slider label="Height" min={2} max={30} step={1} value={st.position} format={(v) => `${v}%`} onChange={(v) => set({ position: v })} />
      <label className={u.field}>
        <span className={u.fieldLabel}>Language</span>
        <select className={u.select} value={st.lang} onChange={(e) => set({ lang: e.target.value })}>
          {SUBTITLE_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <Choice
        label="When a video starts"
        options={[{ value: true, label: 'Subtitles on' }, { value: false, label: 'Off' }]}
        value={st.show}
        onPick={(v) => set({ show: v })}
      />
      <button type="button" className={u.reset} onClick={reset}>
        <RotateCcw size={13} /> Reset to default
      </button>
    </div>
  );
}
