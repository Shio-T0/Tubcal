// The sleep timer: one for the whole station, so it outlives the video it was set
// on (an episode handing over to the next, Up next advancing).
//
//   { mode: 'at', at, minutes }  fade the sound out and pause at `at` (ms)
//   { mode: 'end' }              stop when the video now playing ends: no Up next,
//                                no next-episode countdown
//   { mode: 'asleep' }           it just went off; every player pauses, the layer
//                                says goodnight and clears it
//
// The store schedules the moment itself. Players only react: the one you can
// hear starts its fade FADE_MS early (`fadeOut`), so it is silent right on time,
// and every player pauses when the state turns 'asleep'.

import { useEffect, useState, useSyncExternalStore } from 'react';

export const FADE_MS = 12_000;
export const SLEEP_MINUTES = [15, 30, 45, 60, 90];

let state = null;
let alarm = 0;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

function set(next) {
  clearTimeout(alarm);
  state = next;
  if (next?.mode === 'at') {
    alarm = setTimeout(() => set({ mode: 'asleep', at: next.at }), Math.max(0, next.at - Date.now()));
  }
  emit();
}

export const sleepAfter = (minutes) => set({ mode: 'at', at: Date.now() + minutes * 60_000, minutes });
export const sleepAtEnd = () => set({ mode: 'end' });
/** Go off now; `atEnd` when a video just finished under "stop at the end" (its
 *  player is already closing, but it still deserves a goodnight). */
export const fallAsleep = ({ atEnd = false } = {}) => set({ mode: 'asleep', at: Date.now(), atEnd });
export const clearSleep = () => { if (state) set(null); };
export const getSleep = () => state;
export const stopsAtEnd = () => state?.mode === 'end';

const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

export function useSleepTimer() {
  return useSyncExternalStore(subscribe, getSleep, getSleep);
}

/** The timer, re-rendered every 15s while it counts down (for "23m" labels). */
export function useSleepCountdown() {
  const st = useSleepTimer();
  const [, tick] = useState(0);
  useEffect(() => {
    if (st?.mode !== 'at') return undefined;
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [st]);
  return st;
}

/** "23m", "end", or null: what the moon button says. */
export function sleepLabel(st, now = Date.now()) {
  if (st?.mode === 'end') return 'end';
  if (st?.mode !== 'at') return null;
  return `${Math.max(1, Math.ceil((st.at - now) / 60_000))}m`;
}

/** Which menu entry is on: 'off', 'end', or the minutes chosen. */
export const sleepChoice = (st) => (st?.mode === 'end' ? 'end' : st?.mode === 'at' ? st.minutes : 'off');

/** Apply a menu choice. */
export function chooseSleep(v) {
  if (v === 'off') clearSleep();
  else if (v === 'end') sleepAtEnd();
  else sleepAfter(Number(v));
}

/** The order `z` steps through. */
export function nextSleepChoice(st) {
  const order = ['off', 'end', 15, 30, 60];
  const i = order.indexOf(sleepChoice(st));
  return order[(i + 1) % order.length];
}

/** Lower a media element's volume to nothing over `ms`, then leave it paused at
 *  its old volume (so your setting is there in the morning). Returns a cancel
 *  that puts the volume back at once. */
export function fadeOut(el, ms = FADE_MS) {
  const from = el.volume;
  const start = performance.now();
  const step = setInterval(() => {
    const k = Math.min(1, (performance.now() - start) / ms);
    el.volume = from * (1 - k) * (1 - k); // eases out: the last of it goes slowly
    if (k >= 1) clearInterval(step);
  }, 100);
  return () => {
    clearInterval(step);
    el.volume = from;
  };
}
