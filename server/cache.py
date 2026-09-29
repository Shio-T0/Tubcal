"""TTL cache with two layers (in-memory + SQLite) and stale-while-error.

Expired rows are kept on purpose: if an upstream fetch fails we serve the
stale payload instead of erroring (important for Reddit rate limits).
"""

import json
import threading
import time

from . import db

_mem = {}
_lock = threading.Lock()
_refreshing = set()


def _store(key, payload, now, ttl):
    entry = {"payload": payload, "fetched_at": now, "ttl": ttl}
    with _lock:
        _mem[key] = entry
    con = db.connect()
    with con:
        con.execute(
            "INSERT INTO cache (key, payload, fetched_at, ttl) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, "
            "fetched_at=excluded.fetched_at, ttl=excluded.ttl",
            (key, json.dumps(payload), int(now), ttl),
        )
    con.close()
    return entry


def _load_entry(key):
    with _lock:
        entry = _mem.get(key)
    if entry is not None:
        return entry
    con = db.connect()
    row = con.execute(
        "SELECT payload, fetched_at, ttl FROM cache WHERE key=?", (key,)
    ).fetchone()
    con.close()
    if row:
        entry = {
            "payload": json.loads(row["payload"]),
            "fetched_at": row["fetched_at"],
            "ttl": row["ttl"],
        }
        with _lock:
            _mem[key] = entry
        return entry
    return None


def cached_swr(key, ttl, fetcher):
    """Stale-while-revalidate. Always returns instantly when *any* cached value
    exists (even expired), kicking off a background refresh when it's stale.
    Only blocks on a genuinely cold cache. Returns (payload, stale).

    Use for expensive, non-critical-to-be-fresh payloads (e.g. the discover
    shelf) so the page paints immediately instead of waiting on upstream calls.
    """
    now = time.time()
    entry = _load_entry(key)

    if entry is None:
        payload = fetcher()  # cold — nothing to serve, must wait
        _store(key, payload, now, ttl)
        return payload, False

    stale = now - entry["fetched_at"] >= ttl
    if stale:
        _refresh_async(key, ttl, fetcher)
    return entry["payload"], stale


def _refresh_async(key, ttl, fetcher):
    with _lock:
        if key in _refreshing:
            return
        _refreshing.add(key)

    def run():
        try:
            _store(key, fetcher(), time.time(), ttl)
        except Exception:
            pass  # keep serving the stale value
        finally:
            with _lock:
                _refreshing.discard(key)

    threading.Thread(target=run, daemon=True).start()


def warm(key, ttl, fetcher):
    """Prime a key in the background if it's missing or stale (used at startup)."""
    entry = _load_entry(key)
    if entry is None or time.time() - entry["fetched_at"] >= ttl:
        _refresh_async(key, ttl, fetcher)


def cached(key, ttl, fetcher):
    """Return (payload, stale). Raises only if there is no stale fallback."""
    now = time.time()

    with _lock:
        entry = _mem.get(key)

    if entry is None:
        con = db.connect()
        row = con.execute(
            "SELECT payload, fetched_at FROM cache WHERE key=?", (key,)
        ).fetchone()
        con.close()
        if row:
            entry = {"payload": json.loads(row["payload"]), "fetched_at": row["fetched_at"]}
            with _lock:
                _mem[key] = entry

    if entry and now - entry["fetched_at"] < ttl:
        return entry["payload"], False

    try:
        payload = fetcher()
    except Exception:
        if entry:
            return entry["payload"], True
        raise

    entry = {"payload": payload, "fetched_at": now}
    with _lock:
        _mem[key] = entry
    con = db.connect()
    with con:
        con.execute(
            "INSERT INTO cache (key, payload, fetched_at, ttl) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, "
            "fetched_at=excluded.fetched_at, ttl=excluded.ttl",
            (key, json.dumps(payload), int(now), ttl),
        )
    con.close()
    return payload, False


def cached_dynamic(key, fetcher):
    """Like cached(), but the fetcher returns (payload, ttl) so the freshness
    window can depend on the *result*. Use when a fully-resolved value should be
    cached for a long time but a degraded/fallback value only briefly, so a
    transient upstream hiccup can't lock in a bad payload for the full TTL.
    Falls back to any stored value (even expired) when the fetch raises."""
    now = time.time()
    entry = _load_entry(key)
    if entry and now - entry["fetched_at"] < entry.get("ttl", 0):
        return entry["payload"]
    try:
        payload, ttl = fetcher()
    except Exception:
        if entry:
            return entry["payload"]
        raise
    _store(key, payload, now, ttl)
    return payload


def cached_many(keys, ttl, fetch_missing):
    """Batch form of cached(): {key: payload} for every key that can be answered.

    Fresh keys come straight from the cache; the rest go to ONE call of
    `fetch_missing(missing_keys) -> {key: payload}`, so a caller that can fetch
    many things per upstream request (AniList's `id_in`) pays per batch, not per
    key. Each result is stored under its own key, so the next caller asking for an
    overlapping set only fetches the difference.

    A key the fetcher leaves out falls back to its stale payload when one exists,
    else is omitted. A fetch that raises is survived the same way — unless it
    leaves nothing at all to show for a missing key, in which case it re-raises,
    so "the upstream is down" never masquerades as "there's nothing there"."""
    now = time.time()
    out, stale, missing = {}, {}, []
    for k in keys:
        entry = _load_entry(k)
        if entry and now - entry["fetched_at"] < ttl:
            out[k] = entry["payload"]
        else:
            if entry:
                stale[k] = entry["payload"]
            missing.append(k)
    if not missing:
        return out
    try:
        fresh = fetch_missing(missing) or {}
    except Exception:
        if any(k not in stale for k in missing):
            raise
        fresh = {}
    for k in missing:
        if k in fresh:
            _store(k, fresh[k], now, ttl)
            out[k] = fresh[k]
        elif k in stale:
            out[k] = stale[k]
    return out


def peek(key):
    """Return the cached payload for a key if it exists (even if expired), or None.
    Does NOT trigger a fetch. Useful for fuzzy fallback: check what's cached
    without hitting the API."""
    entry = _load_entry(key)
    return entry["payload"] if entry else None


def invalidate(prefix=""):
    """Drop cache entries whose key starts with prefix. Returns count removed."""
    with _lock:
        for k in [k for k in _mem if k.startswith(prefix)]:
            del _mem[k]
    con = db.connect()
    with con:
        cur = con.execute("DELETE FROM cache WHERE key LIKE ?", (prefix + "%",))
        n = cur.rowcount
    con.close()
    return n
