"""Daily snapshots of tubcal.db, kept beside it and never anywhere else.

Everything personal lives in one SQLite file: saved things and their notes,
subscriptions, settings, account links, watch history, the Archive's
transcripts. A bad disk sector, a crash mid-write or an unlucky migration would
take all of it, so once a day the server copies it to
`data/snapshots/tubcal-YYYY-MM-DD.db` and keeps the newest `snapshots_keep`
(setting, default 7; 0 stops the daily copy).

- The copy uses SQLite's online backup API, so it is consistent while the
  server keeps writing (WAL and all).
- The cache table is emptied in the copy and the file vacuumed: it is the
  biggest table and every row of it can be fetched again.
- Snapshots hold the same secrets as the database (OAuth tokens), so the folder
  is 0700 and each file 0600, like tubcal.db itself.
- `restore(name)` first snapshots the current state ("before-restore"), then
  copies the chosen snapshot back over the live database with the same API, so
  the server needn't stop. Migrations re-run afterwards, so an older snapshot
  comes back in the current shape.
"""

import os
import re
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path

from . import config, db

_NAME = re.compile(r"^tubcal-\d{4}-\d{2}-\d{2}(-\d{4})?(-before-restore)?\.db$")
_lock = threading.Lock()


def folder():
    return Path(config.DATA_DIR) / "snapshots"


def _today(now=None):
    return datetime.fromtimestamp(now or time.time()).strftime("%Y-%m-%d")


def keep_setting():
    try:
        n = int(db.get_setting("snapshots_keep", 7))
    except (TypeError, ValueError):
        n = 7
    return max(0, min(30, n))


def _entry(path):
    st = path.stat()
    return {"name": path.name, "taken_at": int(st.st_mtime), "size": st.st_size,
            "before_restore": path.name.endswith("-before-restore.db"), "_order": st.st_mtime_ns}


def list_snapshots():
    """Every snapshot, newest first."""
    d = folder()
    if not d.is_dir():
        return []
    out = [_entry(p) for p in d.iterdir() if p.is_file() and _NAME.match(p.name)]
    out.sort(key=lambda e: (e.pop("_order"), e["name"]), reverse=True)
    return out


def due(now=None):
    """True when the daily copy is on and none was taken today."""
    if keep_setting() == 0:
        return False
    day = f"tubcal-{_today(now)}"
    return not any(e["name"].startswith(day) for e in list_snapshots())


def _copy_to(dest):
    """A consistent, compacted copy of the live database at `dest`."""
    part = dest.with_name(dest.name + ".partial")
    part.unlink(missing_ok=True)
    src = db.connect()
    out = sqlite3.connect(part)
    try:
        src.backup(out)
        out.execute("DELETE FROM cache")
        out.commit()
        out.execute("PRAGMA journal_mode=DELETE")  # one self-contained file
        out.execute("VACUUM")
    finally:
        out.close()
        src.close()
    os.chmod(part, 0o600)
    os.replace(part, dest)


def take(label=None, now=None, protect=()):
    """Snapshot now. A plain daily copy is named for the day; one taken by hand
    (or before a restore) also carries the time, so it never replaces the day's.
    Rotation afterwards spares the names in `protect`."""
    with _lock:
        d = folder()
        d.mkdir(mode=0o700, exist_ok=True)
        try:
            os.chmod(d, 0o700)
        except OSError:
            pass
        stamp = _today(now)
        if label is not None:
            stamp += datetime.fromtimestamp(now or time.time()).strftime("-%H%M")
            if label:
                stamp += f"-{label}"
        dest = d / f"tubcal-{stamp}.db"
        _copy_to(dest)
        rotate(protect={dest.name, *protect})
        entry = _entry(dest)
        entry.pop("_order")
        return entry


def rotate(keep=None, protect=()):
    """Drop the oldest snapshots past `keep` (the setting when omitted). With the
    daily copy off (0), nothing is dropped: whatever is there was kept by hand."""
    keep = keep_setting() if keep is None else keep
    if keep <= 0:
        return []
    gone = []
    for e in list_snapshots()[keep:]:
        if e["name"] in protect:
            continue
        try:
            (folder() / e["name"]).unlink()
            gone.append(e["name"])
        except OSError:
            pass
    return gone


def daily(now=None):
    """The housekeeping hook: take today's copy if it's due."""
    if due(now):
        return take(now=now)
    return None


def restore(name):
    """Put a snapshot back as the live database. Returns the safety snapshot
    taken of what was there before."""
    if not isinstance(name, str) or not _NAME.match(name):
        raise ValueError("not a snapshot name")
    path = folder() / name
    if not path.is_file():
        raise FileNotFoundError(name)
    # the safety copy's rotation must not drop the snapshot being restored
    safety = take(label="before-restore", protect={name})
    with _lock:
        src = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        live = db.connect()
        try:
            src.backup(live)
        finally:
            live.close()
            src.close()
    db.init_db()  # bring an older snapshot up to the current schema
    from . import cache

    cache.invalidate("")  # nothing in memory may outlive the data it came from
    return safety


def summary():
    """What the Settings page shows: where the data is, how big, what it holds,
    and the snapshots."""
    path = Path(config.DB_PATH)
    size = sum(p.stat().st_size for p in (path, path.with_name(path.name + "-wal")) if p.exists())
    counts = {}
    con = db.connect()
    try:
        for key, table in (("saved", "saved"), ("watched", "history"), ("subscriptions", "subscriptions"),
                           ("transcripts", "brain_docs")):
            try:
                counts[key] = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            except sqlite3.OperationalError:
                pass
        try:
            row = con.execute("SELECT COUNT(*), COALESCE(SUM(LENGTH(payload)), 0) FROM cache").fetchone()
            cache_rows, cache_bytes = row[0], row[1]
        except sqlite3.OperationalError:
            cache_rows, cache_bytes = 0, 0
    finally:
        con.close()
    return {
        "path": str(path),
        "folder": str(folder()),
        "size": size,
        "counts": counts,
        "cache": {"rows": cache_rows, "bytes": cache_bytes},
        "keep": keep_setting(),
        "snapshots": list_snapshots(),
    }
