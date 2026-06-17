import { useCallback, useEffect, useState } from 'react';

export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  let body = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error */
  }
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body.data;
}

/** Fetch a GET endpoint whenever its path changes; exposes reload(). */
export function useApi(pathWithQuery, enabled = true) {
  const [state, setState] = useState({ data: null, loading: enabled, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setState((s) => ({ data: s.data, loading: true, error: null }));
    api(pathWithQuery)
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e) => alive && setState({ data: null, loading: false, error: e.message }));
    return () => {
      alive = false;
    };
  }, [pathWithQuery, enabled, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
