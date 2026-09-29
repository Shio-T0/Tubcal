// `useApi`, shared: a tiny keyed store that dedupes in-flight fetches and treats a
// result younger than `maxAge` as fresh. Anything that two parts of the screen want
// at once — the Screening Room and its console index, the player and its notes
// panel — reads through this and costs one request between them.

import { useCallback, useEffect, useReducer } from 'react';

import { api } from '../api/client.js';

const store = new Map(); // path → { data, error, at, inflight, listeners }

function entryOf(path) {
  let e = store.get(path);
  if (!e) {
    e = { data: null, error: null, at: 0, inflight: null, listeners: new Set() };
    store.set(path, e);
  }
  return e;
}

function fetchInto(path) {
  const e = entryOf(path);
  if (e.inflight) return e.inflight;
  e.inflight = api(path)
    .then((d) => { e.data = d; e.error = null; e.at = Date.now(); })
    .catch((err) => { e.error = err.message; })
    .finally(() => {
      e.inflight = null;
      e.listeners.forEach((fn) => fn());
    });
  e.listeners.forEach((fn) => fn());
  return e.inflight;
}

/** `useApi`, shared: every component asking for `path` gets the one response. */
export function useShared(path, { enabled = true, maxAge = 90_000 } = {}) {
  const [, bump] = useReducer((n) => n + 1, 0);
  const on = enabled && !!path;
  useEffect(() => {
    if (!on) return undefined;
    const e = entryOf(path);
    e.listeners.add(bump);
    if (!e.inflight && (e.data == null || Date.now() - e.at > maxAge)) fetchInto(path);
    return () => { e.listeners.delete(bump); };
  }, [path, on, maxAge]);
  const reload = useCallback(() => (path ? fetchInto(path) : Promise.resolve()), [path]);
  const e = on ? store.get(path) : null;
  return {
    data: e?.data ?? null,
    error: e?.error ?? null,
    loading: on && (!e || !!e.inflight || (e.data == null && !e.error)),
    reload,
  };
}

/** Fetch `path` into the shared store (or reuse what's there) and hand back the
 *  data — for a click that needs it now, and warms it for whoever reads it next. */
export async function fetchShared(path, maxAge = 90_000) {
  const e = entryOf(path);
  if (e.data != null && Date.now() - e.at <= maxAge) return e.data;
  await fetchInto(path);
  if (e.error && e.data == null) throw new Error(e.error);
  return e.data;
}
