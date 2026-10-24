// The bench radio: one for the whole station, so a podcast keeps playing while you
// go from the Workbench to the editor, or anywhere else. This store holds what's
// tuned; `components/radio/RadioHost.jsx` owns the one <audio> and reports what it
// does (a pause can come from media keys, the sleep timer or a video starting, and
// every button must follow). Each episode's place is kept, so one you stopped
// half-way picks up where you were.
//
//   episode  { id, title, show, show_art, audio, duration, url, lang, accent } or null
//   playing  what the element last said
//   waiting  playing, but the sound hasn't come yet (a cold file, a seek, a stall)
//   clock    { pos, dur } in seconds, its own snapshot so only readouts re-render
//   places   [[episode id, seconds], …] newest first, in localStorage

import { useSyncExternalStore } from 'react';

const KEY = 'tubcal.radio';
const KEEP = 40;        // episodes whose place is remembered
const HEARD_END = 30;   // this close to the end counts as heard to the end
const SAVE_EVERY = 10;  // seconds of listening between saves of the place

let el = null;
let tuned = { episode: null, playing: false, waiting: false };
let clock = { pos: 0, dur: 0 };
let places = readPlaces();
let savedAt = 0;

const subs = new Set();
const emit = () => subs.forEach((f) => f());
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

function readPlaces() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v.filter((p) => Array.isArray(p) && typeof p[1] === 'number') : [];
  } catch {
    return [];
  }
}

// Where you stopped in an episode, in seconds (0: never started, or heard).
const placeOf = (id) => places.find(([k]) => k === id)?.[1] || 0;
// A file served without a length says its duration is Infinity.
const finite = (n) => (Number.isFinite(n) ? n : 0);

function keepPlace() {
  const ep = tuned.episode;
  if (!el || !ep) return;
  const at = el.currentTime || 0;
  const total = finite(el.duration) || ep.duration || 0;
  const rest = places.filter(([k]) => k !== ep.id);
  const heard = total && at >= total - HEARD_END;
  places = (at > 5 && !heard ? [[ep.id, Math.floor(at)], ...rest] : rest).slice(0, KEEP);
  savedAt = at;
  try { localStorage.setItem(KEY, JSON.stringify(places)); } catch { /* private mode */ }
}

function setTuned(next) {
  tuned = { ...tuned, ...next };
  emit();
}

// A play() that fails (a newer load interrupted it, the file is gone) only counts
// if the element really stayed paused.
const play = () => el.play().catch(() => {
  if (el?.paused) setTuned({ playing: false, waiting: false });
});

/** Play an episode from where you left it (the one already tuned carries on). */
export function tune(ep) {
  if (!el || !ep?.audio) return;
  if (tuned.episode?.id === ep.id) {
    if (el.paused) play();
    return;
  }
  keepPlace();
  const at = placeOf(ep.id);
  clock = { pos: at, dur: ep.duration || 0 };
  savedAt = at;
  setTuned({ episode: ep, playing: true, waiting: true });
  el.src = ep.audio;
  // Before the metadata loads this sets where playback will start.
  if (at) el.currentTime = at;
  play();
}

export function toggle() {
  if (!el || !tuned.episode) return;
  if (el.paused) play();
  else el.pause();
}

export function seek(secs) {
  if (!el || !tuned.episode) return;
  el.currentTime = secs;
  clock = { ...clock, pos: secs };
  emit();
}

/** Stop and clear the radio; the episode's place is kept for next time. */
export function switchOff() {
  if (!tuned.episode) return;
  keepPlace();
  clock = { pos: 0, dur: 0 };
  setTuned({ episode: null, playing: false, waiting: false });
  if (el) {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }
}

// ── for RadioHost ─────────────────────────────────────────────────────────────

/** The host hands over its <audio>, and takes it back when it unmounts (on the
 *  phone the Workbench is the host, so leaving it ends the broadcast). */
export function attach(node) {
  el = node;
  return () => {
    if (el !== node) return;
    keepPlace();
    el = null;
    clock = { pos: 0, dur: 0 };
    setTuned({ episode: null, playing: false, waiting: false });
  };
}

export const tunedEpisode = () => tuned.episode;

export const heardPlay = () => { if (!tuned.playing) setTuned({ playing: true }); };
export const heardWaiting = () => { if (!tuned.waiting) setTuned({ waiting: true }); };
export const heardPlaying = () => { if (tuned.waiting || !tuned.playing) setTuned({ playing: true, waiting: false }); };

export function heardPause() {
  keepPlace();
  if (tuned.playing || tuned.waiting) setTuned({ playing: false, waiting: false });
}

export function heardTime() {
  if (!el) return;
  clock = { pos: el.currentTime || 0, dur: finite(el.duration) || tuned.episode?.duration || 0 };
  if (Math.abs(clock.pos - savedAt) >= SAVE_EVERY) keepPlace();
  emit();
}

/** The tab is closing: keep the place to the second, not to the last save. */
export const heardLeave = () => keepPlace();

/** The episode ran out: switch off (heard to the end, its place is dropped). */
export const heardEnd = () => switchOff();

// ── hooks ─────────────────────────────────────────────────────────────────────

const getTuned = () => tuned;
const getClock = () => clock;
const getPlaces = () => places;

/** `{ episode, playing, waiting }`: re-renders on a new episode or play/pause only. */
export const useRadio = () => useSyncExternalStore(subscribe, getTuned, getTuned);
/** `{ pos, dur }`: re-renders as the episode plays. */
export const useRadioClock = () => useSyncExternalStore(subscribe, getClock, getClock);
/** The kept places, for "46:10 left" on episodes you stopped half-way. */
export const useRadioPlaces = () => useSyncExternalStore(subscribe, getPlaces, getPlaces);
