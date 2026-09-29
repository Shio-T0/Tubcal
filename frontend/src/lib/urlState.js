// View state that lives in the query string instead of in a component.
//
// Opening a detail route unmounts the room, so anything held in useState is gone
// by the time you press back — you'd land with your filters cleared. Parking it in
// the URL means the history entry itself carries the view, so back (the button,
// the browser, or a gesture) restores what you left, and a reload or a copied link
// opens the same place. Every room shares these two helpers.

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** The URL's params as they are *now*. React Router hands a functional update the
 *  params of the current render, so two writes in one handler (set the season,
 *  then the year) would each start from the old URL and the second would undo the
 *  first. BrowserRouter writes history synchronously, so the live location already
 *  holds every earlier write — build on that and consecutive writes stack. */
export function latestParams() {
  return new URLSearchParams(window.location.search);
}

/** `[value, set]` for one query-string key.
 *
 * Updates replace rather than push: a filter toggle isn't a destination, and
 * pushing would make back walk through every toggle before leaving the room.
 * Values equal to `fallback` drop out of the URL so the default view stays clean.
 */
export function useParamState(key, fallback, { parse = (v) => v, format = String } = {}) {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = raw == null ? fallback : parse(raw);

  const set = useCallback(
    (next) => {
      setParams(
        () => {
          const prev = latestParams();
          const cur = prev.get(key) == null ? fallback : parse(prev.get(key));
          const v = typeof next === 'function' ? next(cur) : next;
          const p = new URLSearchParams(prev);
          const str = v == null ? '' : format(v);
          if (!str || str === format(fallback)) p.delete(key);
          else p.set(key, str);
          return p;
        },
        { replace: true },
      );
    },
    // parse/format are inline literals at every call site; re-creating `set` when
    // they change would defeat memoization for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, fallback, setParams],
  );

  return [value, set];
}
