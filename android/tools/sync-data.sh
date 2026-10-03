#!/usr/bin/env bash
#
# Sync user data between the desktop Tubcal and the phone app — both directions.
#
#   tools/sync-data.sh [merge|pull|push] [path-to-desktop-tubcal.db]
#
#   merge   (default) Bidirectional UNION. After it runs both databases hold the
#           combined set of the portable user tables:
#             • subscriptions — merged by (platform, source_id)
#             • history       — merged by item_id; the more recently-watched row
#                               wins (resume position/duration follow it,
#                               watch_count = max of the two)
#             • saved         — merged by item_id (a set union)
#             • oauth         — merged by provider; the side holding a valid token
#                               with the later expiry wins, so connecting AniList
#                               (or Reddit) on ONE device logs you in on BOTH.
#             • the subtitle style (settings key subtitle_style) — whichever side
#                               changed it last wins, so subtitles look the same
#                               on both
#           cache, the other settings and the Archive (brain_*) are left untouched
#           on each side: cache is throwaway, settings/brain are device-specific
#           (model names, the localhost episode-source URL, on-device transcripts).
#
#   pull    Copy the WHOLE phone database over the desktop one (every table —
#           settings and Archive included). Phone wins. Destructive; backed up.
#
#   push    Copy the WHOLE desktop database over the phone one. Desktop wins.
#           Destructive; backed up.
#
# Requirements: the phone connected via adb (USB debugging) with the Tubcal app
# installed (debug build, so `run-as` reaches its private DB), sqlite3 on this PC,
# and the desktop server STOPPED (it holds a write lock on its database).
#
# Every run backs up both sides first: the desktop DB to <db>.bak-<stamp> and the
# phone DB to <device-db>.bak-<stamp> on the device.
set -euo pipefail

PKG="com.tubcal.app"
DEVICE_DB="files/data/tubcal.db"                  # relative to the app home (run-as)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PC_PORT="${TUBCAL_PORT:-5000}"

MODE="merge"
case "${1:-}" in
  merge|pull|push) MODE="$1"; shift ;;
  -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
  "" ) ;;                                          # no mode → default merge
  -* ) echo "Unknown option: $1" >&2; exit 1 ;;
  *  ) ;;                                          # a path was given as $1
esac
PC_DB="${1:-$SCRIPT_DIR/../../data/tubcal.db}"

# Tables carried by a `merge` and the column list + conflict key for each.
SYNC_TABLES=(subscriptions history saved oauth)

# ---- preflight ------------------------------------------------------------
command -v adb >/dev/null     || { echo "adb not found in PATH" >&2; exit 1; }
command -v sqlite3 >/dev/null || { echo "sqlite3 not found in PATH" >&2; exit 1; }

DEV_COUNT="$(adb get-state 2>/dev/null | grep -c device || true)"
[ "$DEV_COUNT" = "1" ] || { echo "Connect exactly one authorized device (adb devices: $(adb devices | tail -n +2))" >&2; exit 1; }

[ -f "$PC_DB" ] || { echo "Desktop DB not found: $PC_DB" >&2; exit 1; }

# The desktop server keeps a WAL write-lock on its DB; touching it underneath a
# live server risks losing writes or corrupting the file. Make the user stop it.
if ss -ltn 2>/dev/null | grep -q "127.0.0.1:$PC_PORT\b"; then
  echo "The desktop Tubcal server looks alive on 127.0.0.1:$PC_PORT." >&2
  echo "Stop it first (so its database is at rest), then re-run this." >&2
  exit 1
fi

# The phone DB only exists once the app has been opened at least once. (Pass each
# remote command as ONE quoted string — a nested `sh -c` loses quoting in transit.)
if [ -z "$(adb shell "run-as $PKG ls $DEVICE_DB 2>/dev/null")" ]; then
  echo "Phone DB not found ($PKG:$DEVICE_DB)." >&2
  echo "Open the Tubcal app on the phone once (so it creates its database), then retry." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PHONE_DB="$WORK/phone.db"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "Mode       : $MODE"
echo "Desktop DB : $PC_DB"
echo "Phone DB   : $PKG:$DEVICE_DB"
echo

# Fold any -wal/-shm into the main file so it's a single standalone DB to copy.
consolidate() { sqlite3 "$1" "PRAGMA journal_mode=DELETE;" >/dev/null; }

# ---- 1. quiesce the phone app + pull its DB (with WAL) ---------------------
echo "• Stopping the phone app and pulling its database…"
adb shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 1
adb exec-out run-as "$PKG" cat "$DEVICE_DB" > "$PHONE_DB"
adb exec-out run-as "$PKG" cat "$DEVICE_DB-wal" > "$PHONE_DB-wal" 2>/dev/null || true
adb exec-out run-as "$PKG" cat "$DEVICE_DB-shm" > "$PHONE_DB-shm" 2>/dev/null || true
[ -s "$PHONE_DB-wal" ] || rm -f "$PHONE_DB-wal"
[ -s "$PHONE_DB-shm" ] || rm -f "$PHONE_DB-shm"
consolidate "$PHONE_DB"

# ---- 2. back up both sides ------------------------------------------------
cp "$PC_DB" "$PC_DB.bak-$STAMP"
adb shell "run-as $PKG cp $DEVICE_DB $DEVICE_DB.bak-$STAMP" >/dev/null 2>&1 || true
echo "• Backups: $PC_DB.bak-$STAMP  +  $DEVICE_DB.bak-$STAMP (on device)"

counts() {
  local db="$1" label="$2"
  printf '  %-14s subs=%s  history=%s  saved=%s  oauth=%s\n' "$label" \
    "$(sqlite3 "$db" 'SELECT COUNT(*) FROM subscriptions' 2>/dev/null || echo '?')" \
    "$(sqlite3 "$db" 'SELECT COUNT(*) FROM history'       2>/dev/null || echo '?')" \
    "$(sqlite3 "$db" 'SELECT COUNT(*) FROM saved'         2>/dev/null || echo '?')" \
    "$(sqlite3 "$db" "SELECT COUNT(*) FROM oauth WHERE access_token IS NOT NULL" 2>/dev/null || echo '?')"
}
echo "• Before:"; counts "$PC_DB" "desktop"; counts "$PHONE_DB" "phone"

# ---- pull / push: whole-file one-way clone --------------------------------
if [ "$MODE" = "pull" ]; then
  echo "• Cloning the entire phone database over the desktop one…"
  cp "$PHONE_DB" "$PC_DB"
  rm -f "$PC_DB-wal" "$PC_DB-shm"
  echo "• After:"; counts "$PC_DB" "desktop"
  echo; echo "Done (pull). The desktop now mirrors the phone. Restart the desktop server."
  exit 0
fi
if [ "$MODE" = "push" ]; then
  echo "• Cloning the entire desktop database over the phone one…"
  cp "$PC_DB" "$WORK/out.db"
  [ -f "$PC_DB-wal" ] && cp "$PC_DB-wal" "$WORK/out.db-wal"
  [ -f "$PC_DB-shm" ] && cp "$PC_DB-shm" "$WORK/out.db-shm"
  consolidate "$WORK/out.db"
  adb push "$WORK/out.db" /data/local/tmp/tubcal_sync.db >/dev/null
  adb shell chmod 666 /data/local/tmp/tubcal_sync.db
  adb shell "run-as $PKG cp /data/local/tmp/tubcal_sync.db $DEVICE_DB"
  adb shell "run-as $PKG rm -f $DEVICE_DB-wal $DEVICE_DB-shm"
  adb shell rm -f /data/local/tmp/tubcal_sync.db
  echo; echo "Done (push). The phone now mirrors the desktop. Reopen the app."
  exit 0
fi

# ---- 3. merge phone -> desktop (desktop becomes the union) ----------------
echo "• Merging (phone ∪ desktop)…"
sqlite3 "$PC_DB" <<SQL
ATTACH '$PHONE_DB' AS ph;
BEGIN;

-- subscriptions: union by (platform, source_id)
INSERT OR IGNORE INTO subscriptions (platform, source_id, display_name, thumbnail, added_at)
  SELECT platform, source_id, display_name, thumbnail, added_at FROM ph.subscriptions;

-- saved: union by item_id (a set; keep whichever side already had it)
INSERT OR IGNORE INTO saved (platform, item_id, payload, saved_at)
  SELECT platform, item_id, payload, saved_at FROM ph.saved;

-- history: union by item_id, newest watch wins (resume + watch_count follow it)
INSERT INTO history (platform, item_id, title, source_id, source_name, thumbnail, url, watch_count, position, duration, watched_at)
  SELECT platform, item_id, title, source_id, source_name, thumbnail, url, watch_count, position, duration, watched_at
  FROM ph.history WHERE true
ON CONFLICT(item_id) DO UPDATE SET
  watch_count = MAX(history.watch_count, excluded.watch_count),
  title       = COALESCE(CASE WHEN excluded.watched_at >= history.watched_at THEN excluded.title       ELSE history.title       END, history.title,       excluded.title),
  source_id   = COALESCE(CASE WHEN excluded.watched_at >= history.watched_at THEN excluded.source_id   ELSE history.source_id   END, history.source_id,   excluded.source_id),
  source_name = COALESCE(CASE WHEN excluded.watched_at >= history.watched_at THEN excluded.source_name ELSE history.source_name END, history.source_name, excluded.source_name),
  thumbnail   = COALESCE(CASE WHEN excluded.watched_at >= history.watched_at THEN excluded.thumbnail   ELSE history.thumbnail   END, history.thumbnail,   excluded.thumbnail),
  url         = COALESCE(CASE WHEN excluded.watched_at >= history.watched_at THEN excluded.url         ELSE history.url         END, history.url,         excluded.url),
  position    = CASE WHEN excluded.watched_at >= history.watched_at THEN excluded.position ELSE history.position END,
  duration    = CASE WHEN excluded.watched_at >= history.watched_at THEN excluded.duration ELSE history.duration END,
  watched_at  = MAX(history.watched_at, excluded.watched_at);

-- oauth: union by provider; fill missing client creds, keep the valid token with
-- the later expiry (so a login on either device carries to the other).
INSERT INTO oauth (provider, client_id, client_secret, access_token, refresh_token, expires_at, scopes)
  SELECT provider, client_id, client_secret, access_token, refresh_token, expires_at, scopes
  FROM ph.oauth WHERE true
ON CONFLICT(provider) DO UPDATE SET
  client_id     = COALESCE(NULLIF(excluded.client_id, ''),     oauth.client_id),
  client_secret = COALESCE(NULLIF(excluded.client_secret, ''), oauth.client_secret),
  access_token  = CASE WHEN excluded.access_token IS NOT NULL AND (oauth.access_token IS NULL OR COALESCE(excluded.expires_at,0) > COALESCE(oauth.expires_at,0)) THEN excluded.access_token  ELSE oauth.access_token  END,
  refresh_token = CASE WHEN excluded.access_token IS NOT NULL AND (oauth.access_token IS NULL OR COALESCE(excluded.expires_at,0) > COALESCE(oauth.expires_at,0)) THEN excluded.refresh_token ELSE oauth.refresh_token END,
  expires_at    = CASE WHEN excluded.access_token IS NOT NULL AND (oauth.access_token IS NULL OR COALESCE(excluded.expires_at,0) > COALESCE(oauth.expires_at,0)) THEN excluded.expires_at    ELSE oauth.expires_at    END,
  scopes        = CASE WHEN excluded.access_token IS NOT NULL AND (oauth.access_token IS NULL OR COALESCE(excluded.expires_at,0) > COALESCE(oauth.expires_at,0)) THEN excluded.scopes        ELSE oauth.scopes        END;

-- the subtitle style: the side that changed it last wins (the server stamps
-- updated_at on every save). Other settings stay device-specific.
INSERT INTO settings (key, value)
  SELECT key, value FROM ph.settings WHERE key = 'subtitle_style'
ON CONFLICT(key) DO UPDATE SET value = CASE
  WHEN COALESCE(json_extract(excluded.value, '$.updated_at'), 0) > COALESCE(json_extract(settings.value, '$.updated_at'), 0)
  THEN excluded.value ELSE settings.value END;

COMMIT;
DETACH ph;
SQL

# ---- 4. mirror the union back into the phone copy -------------------------
# Desktop is now the full union — make the phone's synced tables match it exactly.
sqlite3 "$PHONE_DB" >/dev/null <<SQL
PRAGMA journal_mode=DELETE;
ATTACH '$PC_DB' AS pc;
BEGIN;
DELETE FROM subscriptions;
INSERT INTO subscriptions SELECT * FROM pc.subscriptions;
DELETE FROM history;
INSERT INTO history       SELECT * FROM pc.history;
DELETE FROM saved;
INSERT INTO saved         SELECT * FROM pc.saved;
DELETE FROM oauth;
INSERT INTO oauth         SELECT * FROM pc.oauth;
INSERT OR REPLACE INTO settings (key, value) SELECT key, value FROM pc.settings WHERE key = 'subtitle_style';
COMMIT;
DETACH pc;
SQL

# ---- 5. push the merged DB back to the phone ------------------------------
echo "• Writing the merged database back to the phone…"
adb push "$PHONE_DB" /data/local/tmp/tubcal_sync.db >/dev/null
adb shell chmod 666 /data/local/tmp/tubcal_sync.db
adb shell "run-as $PKG cp /data/local/tmp/tubcal_sync.db $DEVICE_DB"
adb shell "run-as $PKG rm -f $DEVICE_DB-wal $DEVICE_DB-shm"
adb shell rm -f /data/local/tmp/tubcal_sync.db

echo "• After:"; counts "$PC_DB" "desktop"; counts "$PHONE_DB" "phone(merged)"
echo
echo "Done. Both sides now share subscriptions, history, saved items and logins."
echo "Restart the desktop server and reopen the phone app to see the merged data."
