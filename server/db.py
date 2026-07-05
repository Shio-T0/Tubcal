import json
import os
import sqlite3
import time

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  platform     TEXT NOT NULL CHECK (platform IN ('youtube','reddit','github')),
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

-- The Archive (local "second brain"): transcribed + embedded watched videos.
CREATE TABLE IF NOT EXISTS brain_docs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     TEXT NOT NULL UNIQUE,             -- 'yt:VIDEO_ID'
  platform    TEXT NOT NULL DEFAULT 'youtube',
  title       TEXT,
  source_id   TEXT,
  source_name TEXT,
  thumbnail   TEXT,
  url         TEXT,
  duration    REAL,
  status      TEXT NOT NULL DEFAULT 'queued',   -- queued|transcribing|embedding|ready|error
  error       TEXT,
  lang        TEXT,
  transcript  TEXT,                             -- full plaintext (segments joined)
  summary     TEXT,                             -- LLM TL;DR (null until generated)
  added_at    INTEGER NOT NULL,
  indexed_at  INTEGER
);

CREATE TABLE IF NOT EXISTS brain_chunks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id    INTEGER NOT NULL REFERENCES brain_docs(id) ON DELETE CASCADE,
  item_id   TEXT NOT NULL,
  idx       INTEGER NOT NULL,
  t_start   REAL NOT NULL,                      -- seconds into the video (deep-link target)
  t_end     REAL,
  text      TEXT NOT NULL,
  embedding BLOB                                -- packed float32 vector
);
CREATE INDEX IF NOT EXISTS idx_brain_chunks_doc ON brain_chunks(doc_id);

-- The Edition (No 00): embedded feed items + pre-built daily papers.
CREATE TABLE IF NOT EXISTS feed_vectors (
  item_id      TEXT PRIMARY KEY,                -- 'yt:ID' | 'rd:ID' | 'hn:ID'
  platform     TEXT NOT NULL,
  title        TEXT,
  snippet      TEXT,
  url          TEXT,
  source_id    TEXT,
  source_name  TEXT,
  thumbnail    TEXT,
  score        INTEGER,
  comments     INTEGER,
  published_at INTEGER,
  vector       BLOB,                            -- UNIT-normalized packed float32
  model        TEXT,                            -- embed model; mismatch => re-embed
  embedded_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_vectors_time ON feed_vectors(published_at);

CREATE TABLE IF NOT EXISTS editions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  date     TEXT NOT NULL UNIQUE,                -- 'YYYY-MM-DD' local
  status   TEXT NOT NULL,                       -- 'wire' | 'edited'
  model    TEXT,                                -- chat model used (null for wire)
  sources  INTEGER NOT NULL,                    -- item count that fed this paper
  build_ms INTEGER NOT NULL,
  payload  TEXT NOT NULL,                       -- the complete pre-rendered edition JSON
  built_at INTEGER NOT NULL
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
    "player_volume": 1,   # 0..1, remembered across videos (custom controls)
    # Desktop notify-send 10 min before a subscribed channel goes live.
    "notify_live": True,
    # The Archive (local second brain): transcription + semantic search + LLM.
    "brain_enabled": True,        # master gate for the background worker
    "brain_auto_index": False,    # opt-in: index videos as you watch them
    "brain_whisper_model": "base",        # faster-whisper size (tiny→medium)
    "brain_llm_model": "llama3.1:8b",     # Ollama chat model for summaries/ask
    "brain_embed_model": "nomic-embed-text",  # Ollama embedding model
    # The Edition (No 00): the daily synthesized paper.
    "edition_enabled": True,      # master gate for the builder thread
    "edition_hour": 6,            # local hour after which today's paper is composed
    "edition_llm_model": "",      # chat model override (blank -> brain_llm_model)
    # The Anime room: AniList sync + local episode source.
    "anime_autosync": True,       # finishing an episode bumps AniList progress
    "anime_sub_pref": "sub",      # 'sub' | 'dub'
    "anime_source_url": "",       # aggregator base URL (blank → config/env default)
    "anime_provider": "",         # adapter-specific provider hint (optional)
    # Room configuration.
    "active_rooms": ["edition", "frontpage", "youtube", "reddit", "hackernews", "archive", "anime"],
    "max_active_rooms": 7,
}


def connect():
    config.DATA_DIR.mkdir(exist_ok=True)
    con = sqlite3.connect(config.DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    # journal_mode is persisted in the file; the rest are per-connection tuning.
    # synchronous=NORMAL is safe (durable) under WAL and much faster on writes;
    # mmap reads avoid syscalls; a 16 MB page cache and in-memory temp tables cut
    # per-request latency for this local, single-user workload.
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    con.execute("PRAGMA mmap_size=268435456")   # 256 MB
    con.execute("PRAGMA cache_size=-16000")      # 16 MB (negative = KiB)
    con.execute("PRAGMA temp_store=MEMORY")
    return con


def _check_db_writable():
    """Verify the database file and its directory are writable. Logs a clear
    error if not, so permission/disk-space issues surface at startup instead
    of on the first save."""
    try:
        db_path = config.DB_PATH
        # Ensure parent directory exists and is writable.
        db_path.parent.mkdir(parents=True, exist_ok=True)
        if not db_path.parent.is_dir():
            raise OSError(f"Data directory does not exist or is not a directory: {db_path.parent}")
        # Touch the DB file if missing, then do a test write.
        con = sqlite3.connect(str(db_path), timeout=5)
        con.execute("CREATE TABLE IF NOT EXISTS _writability_check (id INTEGER PRIMARY KEY)")
        con.execute("INSERT INTO _writability_check (id) VALUES (1)")
        con.execute("DELETE FROM _writability_check")
        con.commit()
        con.close()
    except Exception as e:
        import logging
        logging.getLogger("tubcal").error(
            "tubcal.db is not writable at %s — check permissions/disk space: %s",
            config.DB_PATH, e,
        )


def init_db():
    _check_db_writable()
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
        # Migration: update subscriptions CHECK constraint to include 'github'.
        # SQLite can't ALTER a CHECK, so we recreate the table if the old
        # constraint is still in place (i.e. 'github' would be rejected).
        try:
            con.execute("INSERT INTO subscriptions (platform, source_id, display_name, added_at) "
                        "VALUES ('github', '_migration_test', '_', 0)")
            con.execute("DELETE FROM subscriptions WHERE platform='github' AND source_id='_migration_test'")
        except sqlite3.IntegrityError:
            # Old CHECK constraint — recreate the table with the updated constraint.
            con.executescript("""
                CREATE TABLE subscriptions_new (
                  id           INTEGER PRIMARY KEY AUTOINCREMENT,
                  platform     TEXT NOT NULL CHECK (platform IN ('youtube','reddit','github')),
                  source_id    TEXT NOT NULL,
                  display_name TEXT NOT NULL,
                  thumbnail    TEXT,
                  added_at     INTEGER NOT NULL,
                  UNIQUE (platform, source_id)
                );
                INSERT INTO subscriptions_new SELECT * FROM subscriptions;
                DROP TABLE subscriptions;
                ALTER TABLE subscriptions_new RENAME TO subscriptions;
            """)
        for key, value in DEFAULT_SETTINGS.items():
            con.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, json.dumps(value)),
            )
    con.close()
    _ensure_incremental_vacuum()
    try:
        os.chmod(config.DB_PATH, 0o600)
    except OSError:
        pass
    prune_old_data()


def _ensure_incremental_vacuum():
    """One-time: put the DB in INCREMENTAL auto_vacuum mode and reclaim free pages.

    auto_vacuum can only be changed by a full VACUUM, so this rewrites the file
    once (reclaiming pages left by prior deletes) and is a cheap no-op on every
    later startup once the mode is already INCREMENTAL. Thereafter prune_old_data
    reclaims space cheaply via `PRAGMA incremental_vacuum`."""
    con = sqlite3.connect(config.DB_PATH, timeout=30, isolation_level=None)
    try:
        mode = con.execute("PRAGMA auto_vacuum").fetchone()[0]
        if mode != 2:  # 2 == INCREMENTAL
            con.execute("PRAGMA auto_vacuum=INCREMENTAL")
            con.execute("VACUUM")
    except sqlite3.OperationalError:
        pass
    finally:
        con.close()


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
    try:
        feed_vectors_prune()
        edition_prune()
    except sqlite3.OperationalError:
        pass  # tables may not exist on a very first run
    # Hand freed pages back to the filesystem (cheap under INCREMENTAL auto_vacuum;
    # no-op otherwise). Runs outside any transaction on an autocommit connection.
    try:
        vac = sqlite3.connect(config.DB_PATH, timeout=30, isolation_level=None)
        vac.execute("PRAGMA incremental_vacuum")
        vac.close()
    except sqlite3.OperationalError:
        pass


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


def set_subscription_thumbnail(sub_id, thumbnail):
    con = connect()
    with con:
        con.execute("UPDATE subscriptions SET thumbnail=? WHERE id=?", (thumbnail, sub_id))
    con.close()


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


# ---- the archive (local second brain) ----

def brain_enqueue(item):
    """Queue a video for transcription + indexing. `item` is a normalized feed
    item ({id, platform, title, source, thumbnail, url, extra}). Idempotent: a
    doc that already exists is left as-is (re-queue only if it errored)."""
    item_id = item.get("id")
    if not item_id:
        return None
    vid = (item.get("extra") or {}).get("video_id")
    con = connect()
    with con:
        con.execute(
            "INSERT INTO brain_docs "
            "(item_id, platform, title, source_id, source_name, thumbnail, url, added_at, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued') "
            "ON CONFLICT(item_id) DO UPDATE SET "
            "  status=CASE WHEN brain_docs.status='error' THEN 'queued' ELSE brain_docs.status END, "
            "  error=CASE WHEN brain_docs.status='error' THEN NULL ELSE brain_docs.error END, "
            "  title=COALESCE(excluded.title, brain_docs.title)",
            (
                item_id,
                item.get("platform") or "youtube",
                item.get("title"),
                (item.get("extra") or {}).get("channel_id"),
                item.get("source"),
                item.get("thumbnail")
                or (f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else None),
                item.get("url")
                or (f"https://www.youtube.com/watch?v={vid}" if vid else None),
                int(time.time()),
            ),
        )
    row = con.execute("SELECT * FROM brain_docs WHERE item_id=?", (item_id,)).fetchone()
    con.close()
    return dict(row) if row else None


def brain_next_queued():
    """The oldest doc still waiting to be processed (FIFO), or None."""
    con = connect()
    row = con.execute(
        "SELECT * FROM brain_docs WHERE status='queued' ORDER BY added_at LIMIT 1"
    ).fetchone()
    con.close()
    return dict(row) if row else None


def brain_set_status(item_id, status, error=None):
    con = connect()
    with con:
        con.execute(
            "UPDATE brain_docs SET status=?, error=? WHERE item_id=?",
            (status, error, item_id),
        )
    con.close()


def brain_save_transcript(item_id, lang, transcript, duration=None):
    con = connect()
    with con:
        con.execute(
            "UPDATE brain_docs SET lang=?, transcript=?, duration=COALESCE(?, duration) "
            "WHERE item_id=?",
            (lang, transcript, duration, item_id),
        )
    con.close()


def brain_save_chunks(doc_id, item_id, chunks):
    """Replace a doc's chunk rows. `chunks` = [{idx, t_start, t_end, text, embedding}],
    where embedding is raw bytes (packed float32) or None."""
    con = connect()
    with con:
        con.execute("DELETE FROM brain_chunks WHERE doc_id=?", (doc_id,))
        con.executemany(
            "INSERT INTO brain_chunks (doc_id, item_id, idx, t_start, t_end, text, embedding) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (doc_id, item_id, c["idx"], c["t_start"], c.get("t_end"),
                 c["text"], c.get("embedding"))
                for c in chunks
            ],
        )
    con.close()


def brain_mark_ready(item_id):
    con = connect()
    with con:
        con.execute(
            "UPDATE brain_docs SET status='ready', error=NULL, indexed_at=? WHERE item_id=?",
            (int(time.time()), item_id),
        )
    con.close()


def brain_set_summary(item_id, text):
    con = connect()
    with con:
        con.execute("UPDATE brain_docs SET summary=? WHERE item_id=?", (text, item_id))
    con.close()


def brain_get(item_id, with_chunks=False):
    con = connect()
    row = con.execute("SELECT * FROM brain_docs WHERE item_id=?", (item_id,)).fetchone()
    if not row:
        con.close()
        return None
    doc = dict(row)
    if with_chunks:
        chunks = con.execute(
            "SELECT idx, t_start, t_end, text FROM brain_chunks WHERE doc_id=? ORDER BY idx",
            (doc["id"],),
        ).fetchall()
        doc["chunks"] = [dict(c) for c in chunks]
    con.close()
    return doc


def brain_list(status=None, limit=500):
    con = connect()
    if status:
        rows = con.execute(
            "SELECT item_id, platform, title, source_name, thumbnail, url, duration, "
            "status, error, added_at, indexed_at, (summary IS NOT NULL) AS has_summary "
            "FROM brain_docs WHERE status=? ORDER BY COALESCE(indexed_at, added_at) DESC LIMIT ?",
            (status, limit),
        ).fetchall()
    else:
        rows = con.execute(
            "SELECT item_id, platform, title, source_name, thumbnail, url, duration, "
            "status, error, added_at, indexed_at, (summary IS NOT NULL) AS has_summary "
            "FROM brain_docs ORDER BY COALESCE(indexed_at, added_at) DESC LIMIT ?",
            (limit,),
        ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def brain_counts():
    con = connect()
    rows = con.execute(
        "SELECT status, COUNT(*) AS n FROM brain_docs GROUP BY status"
    ).fetchall()
    con.close()
    return {r["status"]: r["n"] for r in rows}


def brain_all_vectors():
    """Every embedded chunk with its raw vector bytes, joined to its doc's
    display fields — the corpus brute-force semantic search scans."""
    con = connect()
    rows = con.execute(
        "SELECT c.item_id, c.t_start, c.t_end, c.text, c.embedding, "
        "       d.title, d.source_name, d.thumbnail "
        "FROM brain_chunks c JOIN brain_docs d ON d.id = c.doc_id "
        "WHERE c.embedding IS NOT NULL"
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def brain_keyword_search(query, limit=20):
    """LIKE fallback over chunk text when embeddings/Ollama are unavailable."""
    con = connect()
    rows = con.execute(
        "SELECT c.item_id, c.t_start, c.t_end, c.text, d.title, d.source_name, d.thumbnail "
        "FROM brain_chunks c JOIN brain_docs d ON d.id = c.doc_id "
        "WHERE c.text LIKE ? ORDER BY c.t_start LIMIT ?",
        (f"%{query}%", limit),
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def brain_ready_since(since_ts, limit=200):
    """Docs that became ready at/after a timestamp — feeds the digest."""
    con = connect()
    rows = con.execute(
        "SELECT item_id, title, source_name, summary, transcript, indexed_at "
        "FROM brain_docs WHERE status='ready' AND indexed_at >= ? "
        "ORDER BY indexed_at DESC LIMIT ?",
        (int(since_ts), limit),
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def brain_delete(item_id):
    con = connect()
    with con:
        con.execute("DELETE FROM brain_chunks WHERE item_id=?", (item_id,))
        cur = con.execute("DELETE FROM brain_docs WHERE item_id=?", (item_id,))
        n = cur.rowcount
    con.close()
    return n


# ---- the edition (daily paper) ----

def feed_vectors_missing(item_ids, model):
    """Subset of item_ids with no stored vector for this embed model. One query;
    the working set is capped upstream so the IN list stays small."""
    if not item_ids:
        return set()
    con = connect()
    marks = ",".join("?" * len(item_ids))
    rows = con.execute(
        f"SELECT item_id FROM feed_vectors WHERE item_id IN ({marks}) "
        "AND vector IS NOT NULL AND model=?",
        (*item_ids, model),
    ).fetchall()
    con.close()
    have = {r["item_id"] for r in rows}
    return set(item_ids) - have


def feed_vectors_save(rows):
    """rows = [{item_id, platform, title, snippet, url, source_id, source_name,
    thumbnail, score, comments, published_at, vector(bytes), model}]."""
    if not rows:
        return
    now = int(time.time())
    con = connect()
    with con:
        con.executemany(
            "INSERT OR REPLACE INTO feed_vectors "
            "(item_id, platform, title, snippet, url, source_id, source_name, "
            " thumbnail, score, comments, published_at, vector, model, embedded_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (r["item_id"], r["platform"], r.get("title"), r.get("snippet"),
                 r.get("url"), r.get("source_id"), r.get("source_name"),
                 r.get("thumbnail"), r.get("score"), r.get("comments"),
                 r.get("published_at"), r.get("vector"), r.get("model"), now)
                for r in rows
            ],
        )
    con.close()


def feed_vectors_get(item_ids, model):
    """item_id -> raw vector bytes, for the ids that have one under this model."""
    if not item_ids:
        return {}
    con = connect()
    marks = ",".join("?" * len(item_ids))
    rows = con.execute(
        f"SELECT item_id, vector FROM feed_vectors WHERE item_id IN ({marks}) "
        "AND vector IS NOT NULL AND model=?",
        (*item_ids, model),
    ).fetchall()
    con.close()
    return {r["item_id"]: r["vector"] for r in rows}


def feed_vectors_prune(max_age=14 * 86400):
    con = connect()
    with con:
        con.execute(
            "DELETE FROM feed_vectors WHERE embedded_at < ?",
            (int(time.time()) - max_age,),
        )
    con.close()


def edition_save(date, status, model, sources, build_ms, payload):
    """Persist one built paper (payload = the complete render-ready dict)."""
    con = connect()
    with con:
        con.execute(
            "INSERT INTO editions (date, status, model, sources, build_ms, payload, built_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(date) DO UPDATE SET status=excluded.status, "
            "model=excluded.model, sources=excluded.sources, "
            "build_ms=excluded.build_ms, payload=excluded.payload, "
            "built_at=excluded.built_at",
            (date, status, model, sources, build_ms, json.dumps(payload),
             int(time.time())),
        )
    con.close()


def edition_latest():
    """The newest paper's payload, or None. One row — the reader hot path."""
    con = connect()
    row = con.execute(
        "SELECT payload FROM editions ORDER BY date DESC LIMIT 1"
    ).fetchone()
    con.close()
    return json.loads(row["payload"]) if row else None


def edition_get(date):
    con = connect()
    row = con.execute(
        "SELECT payload FROM editions WHERE date=?", (date,)
    ).fetchone()
    con.close()
    return json.loads(row["payload"]) if row else None


def edition_list(limit=60):
    """Meta only — the archive drawer must never drag payloads across a query."""
    con = connect()
    rows = con.execute(
        "SELECT date, status, model, sources, build_ms, built_at "
        "FROM editions ORDER BY date DESC LIMIT ?",
        (limit,),
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def edition_prune(keep=90):
    con = connect()
    with con:
        con.execute(
            "DELETE FROM editions WHERE date NOT IN "
            "(SELECT date FROM editions ORDER BY date DESC LIMIT ?)",
            (keep,),
        )
    con.close()


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