import json
import os
import sqlite3
import time

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  platform     TEXT NOT NULL CHECK (platform IN ('youtube','reddit')),
  source_id    TEXT NOT NULL,
  display_name TEXT NOT NULL,
  thumbnail    TEXT,
  added_at     INTEGER NOT NULL,
  UNIQUE (platform, source_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  ttl        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth (
  provider      TEXT PRIMARY KEY,
  client_id     TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    INTEGER,
  scopes        TEXT
);

CREATE TABLE IF NOT EXISTS history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  platform    TEXT NOT NULL,
  item_id     TEXT NOT NULL UNIQUE,
  title       TEXT,
  source_id   TEXT,
  source_name TEXT,
  thumbnail   TEXT,
  url         TEXT,
  watch_count INTEGER NOT NULL DEFAULT 1,
  position    REAL NOT NULL DEFAULT 0,
  duration    REAL NOT NULL DEFAULT 0,
  watched_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saved (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  platform  TEXT NOT NULL,
  item_id   TEXT NOT NULL UNIQUE,
  payload   TEXT NOT NULL,
  saved_at  INTEGER NOT NULL
);
"""

DEFAULT_SETTINGS = {
    "theme": "dark",
    "reddit_sort": "hot",
    "hn_list": "top",
    "foryou_weights": {"youtube": 2, "reddit": 2, "hackernews": 1},
    # Player preferences.
    "solo_audio": True,   # only the focused video plays sound; others auto-mute
    "playback_rate": 1,   # remembered across videos
}


def connect():
    config.DATA_DIR.mkdir(exist_ok=True)
    con = sqlite3.connect(config.DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


def init_db():
    con = connect()
    with con:
        con.executescript(SCHEMA)
        # Migrate older DBs that predate the resume-position columns.
        for col, decl in (("position", "REAL NOT NULL DEFAULT 0"),
                          ("duration", "REAL NOT NULL DEFAULT 0")):
            try:
                con.execute(f"ALTER TABLE history ADD COLUMN {col} {decl}")
            except sqlite3.OperationalError:
                pass  # column already exists
        for key, value in DEFAULT_SETTINGS.items():
            con.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, json.dumps(value)),
            )
    con.close()
    try:
        os.chmod(config.DB_PATH, 0o600)
    except OSError:
        pass
    prune_old_data()


def prune_old_data(history_cap=2000, cache_max_age=7 * 86400):
    """Keep tubcal.db lean: cap watch history and drop long-dead cache rows
    (kept past their TTL only for stale-while-error; a week old is useless)."""
    con = connect()
    try:
        with con:
            con.execute(
                "DELETE FROM history WHERE id NOT IN "
                "(SELECT id FROM history ORDER BY watched_at DESC LIMIT ?)",
                (history_cap,),
            )
            con.execute(
                "DELETE FROM cache WHERE fetched_at < ?",
                (int(time.time()) - cache_max_age,),
            )
    except sqlite3.OperationalError:
        pass  # cache table may not exist on a very first run
    con.close()


# ---- settings ----

def get_settings():
    con = connect()
    rows = con.execute("SELECT key, value FROM settings").fetchall()
    con.close()
    return {r["key"]: json.loads(r["value"]) for r in rows if not r["key"].startswith("_")}


def get_setting(key, default=None):
    con = connect()
    row = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    con.close()
    return json.loads(row["value"]) if row else default


def set_setting(key, value):
    con = connect()
    with con:
        con.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )
    con.close()


def delete_setting(key):
    con = connect()
    with con:
        con.execute("DELETE FROM settings WHERE key=?", (key,))
    con.close()


# ---- subscriptions ----

def list_subscriptions(platform=None):
    con = connect()
    if platform:
        rows = con.execute(
            "SELECT * FROM subscriptions WHERE platform=? ORDER BY display_name COLLATE NOCASE",
            (platform,),
        ).fetchall()
    else:
        rows = con.execute(
            "SELECT * FROM subscriptions ORDER BY platform, display_name COLLATE NOCASE"
        ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def add_subscription(platform, source_id, display_name, thumbnail):
    con = connect()
    try:
        with con:
            cur = con.execute(
                "INSERT INTO subscriptions (platform, source_id, display_name, thumbnail, added_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (platform, source_id, display_name, thumbnail, int(time.time())),
            )
            rid = cur.lastrowid
    except sqlite3.IntegrityError:
        con.close()
        return None
    row = con.execute("SELECT * FROM subscriptions WHERE id=?", (rid,)).fetchone()
    con.close()
    return dict(row)


def delete_subscription(sub_id):
    con = connect()
    with con:
        cur = con.execute("DELETE FROM subscriptions WHERE id=?", (sub_id,))
        deleted = cur.rowcount
    con.close()
    return deleted > 0


# ---- watch history ----

def add_history(platform, item_id, title, source_id, source_name, thumbnail, url):
    con = connect()
    with con:
        con.execute(
            "INSERT INTO history (platform, item_id, title, source_id, source_name, thumbnail, url, watched_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(item_id) DO UPDATE SET watch_count=watch_count+1, watched_at=excluded.watched_at",
            (platform, item_id, title, source_id, source_name, thumbnail, url, int(time.time())),
        )
    con.close()


def get_history(platform=None, limit=200):
    con = connect()
    if platform:
        rows = con.execute(
            "SELECT * FROM history WHERE platform=? ORDER BY watched_at DESC LIMIT ?",
            (platform, limit),
        ).fetchall()
    else:
        rows = con.execute(
            "SELECT * FROM history ORDER BY watched_at DESC LIMIT ?", (limit,)
        ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def set_progress(item_id, position, duration):
    """Save a video's last playback position (seconds). Upserts so progress is
    kept even if the watch row was somehow not created first."""
    con = connect()
    with con:
        con.execute(
            "INSERT INTO history (platform, item_id, position, duration, watched_at) "
            "VALUES ('youtube', ?, ?, ?, ?) "
            "ON CONFLICT(item_id) DO UPDATE SET position=excluded.position, "
            "duration=excluded.duration",
            (item_id, position, duration, int(time.time())),
        )
    con.close()


def get_progress_map():
    """Map of item_id -> {position, duration} for every video with known length.
    Drives resume-from-where-you-left-off and tile progress bars everywhere."""
    con = connect()
    rows = con.execute(
        "SELECT item_id, position, duration FROM history WHERE duration > 0"
    ).fetchall()
    con.close()
    return {
        r["item_id"]: {"position": r["position"], "duration": r["duration"]}
        for r in rows
    }


def get_continue_watching(limit=30, ratio=0.95):
    """Videos started but not finished, newest first — drives the
    'Continue watching' shelf. >5s in so a stray click doesn't qualify."""
    con = connect()
    rows = con.execute(
        "SELECT * FROM history WHERE platform='youtube' AND duration > 0 "
        "AND position > 5 AND position < duration * ? "
        "ORDER BY watched_at DESC LIMIT ?",
        (ratio, limit),
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


# ---- saved (watch-later / bookmarks, cross-platform) ----

def add_saved(item):
    con = connect()
    with con:
        con.execute(
            "INSERT INTO saved (platform, item_id, payload, saved_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(item_id) DO UPDATE SET payload=excluded.payload",
            (item.get("platform"), item.get("id"), json.dumps(item), int(time.time())),
        )
    con.close()


def remove_saved(item_id):
    con = connect()
    with con:
        cur = con.execute("DELETE FROM saved WHERE item_id=?", (item_id,))
        n = cur.rowcount
    con.close()
    return n


def list_saved(platform=None, limit=500):
    con = connect()
    if platform:
        rows = con.execute(
            "SELECT payload FROM saved WHERE platform=? ORDER BY saved_at DESC LIMIT ?",
            (platform, limit),
        ).fetchall()
    else:
        rows = con.execute(
            "SELECT payload FROM saved ORDER BY saved_at DESC LIMIT ?", (limit,)
        ).fetchall()
    con.close()
    return [json.loads(r["payload"]) for r in rows]


# ---- oauth ----

def get_oauth(provider):
    con = connect()
    row = con.execute("SELECT * FROM oauth WHERE provider=?", (provider,)).fetchone()
    con.close()
    return dict(row) if row else None


def set_oauth_credentials(provider, client_id, client_secret):
    con = connect()
    with con:
        con.execute(
            "INSERT INTO oauth (provider, client_id, client_secret) VALUES (?, ?, ?) "
            "ON CONFLICT(provider) DO UPDATE SET client_id=excluded.client_id, "
            "client_secret=excluded.client_secret, access_token=NULL, "
            "refresh_token=NULL, expires_at=NULL, scopes=NULL",
            (provider, client_id, client_secret),
        )
    con.close()


def set_oauth_tokens(provider, access_token, refresh_token, expires_at, scopes=None):
    con = connect()
    with con:
        if refresh_token:
            con.execute(
                "UPDATE oauth SET access_token=?, refresh_token=?, expires_at=?, scopes=? "
                "WHERE provider=?",
                (access_token, refresh_token, expires_at, scopes, provider),
            )
        else:
            con.execute(
                "UPDATE oauth SET access_token=?, expires_at=? WHERE provider=?",
                (access_token, expires_at, provider),
            )
    con.close()


def delete_oauth(provider):
    con = connect()
    with con:
        con.execute("DELETE FROM oauth WHERE provider=?", (provider,))
    con.close()
