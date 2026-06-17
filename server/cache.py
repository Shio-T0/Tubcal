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
