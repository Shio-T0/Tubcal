"""The core API every module shares: health, watch history and progress,
saved items, the palette's search across rooms, the For You mix, and cache
refresh. Each room's own routes live in its module's blueprint."""

import importlib
import logging
import re
import threading

from flask import Blueprint, current_app, request

from . import err, ok
from .. import cache, config, db, modules
from ..sources import mixer

feeds_bp = Blueprint("feeds", __name__, url_prefix="/api")


@feeds_bp.get("/health")
def health():
    return ok({"status": "ok", "version": "0.1.0", "modules": modules.installed()})


def _source(module_id):
    """The source adapter of a room that's installed, else None. Imported here,
    not at the top, so a left-out module's missing file is never imported."""
    if not modules.has(module_id):
        return None
    return importlib.import_module(f"server.sources.{module_id}")


@feeds_bp.get("/history")
def get_history():
    return ok({"items": db.get_history(request.args.get("platform"))})


@feeds_bp.delete("/history")
def clear_history():
    platform = (request.args.get("platform") or "").strip()
    item_id = (request.args.get("item_id") or "").strip()
    con = db.connect()
    with con:
        if item_id:
            cur = con.execute("DELETE FROM history WHERE item_id=?", (item_id,))
        elif platform:
            cur = con.execute("DELETE FROM history WHERE platform=?", (platform,))
        else:
            cur = con.execute("DELETE FROM history")
        n = cur.rowcount
    con.close()
    return ok({"cleared": n})


@feeds_bp.post("/history")
def post_history():
    body = request.get_json(force=True, silent=True) or {}
    item = body.get("item") or {}
    if not item.get("id") or not item.get("platform"):
        return err("item with id and platform required")
    try:
        db.add_history(
            item["platform"],
            item["id"],
            item.get("title"),
            (item.get("extra") or {}).get("channel_id") or (item.get("extra") or {}).get("subreddit"),
            item.get("source"),
            item.get("thumbnail"),
            item.get("url"),
        )
    except Exception as e:
        current_app.logger.exception("Failed to add history")
        return err(f"Failed to record history: {e}", 500)
    return ok({"recorded": True})


@feeds_bp.get("/progress")
def get_progress():
    return ok({"progress": db.get_progress_map()})


@feeds_bp.post("/progress")
def post_progress():
    body = request.get_json(force=True, silent=True) or {}
    item_id = (body.get("item_id") or "").strip()
    if not item_id:
        return err("item_id required")
    try:
        position = max(0.0, float(body.get("position") or 0))
        duration = max(0.0, float(body.get("duration") or 0))
    except (TypeError, ValueError):
        return err("position and duration must be numbers")
    try:
        db.set_progress(item_id, position, duration)
    except Exception as e:
        current_app.logger.exception("Failed to set progress")
        return err(f"Failed to save progress: {e}", 500)
    _maybe_mark_anime(item_id, position, duration)
    return ok({"saved": True})


# Auto-mark anime episodes watched on AniList once played past the threshold. The
# anime player reports progress under item ids shaped `anime:<anilist_id>:<episode>`
# (see EpisodeList in the frontend), so we piggyback on the same progress POSTs —
# no separate call from the client.
_log = logging.getLogger(__name__)
_ANIME_ID_RE = re.compile(r"^anime:(\d+):(\d+(?:\.\d+)?)$")
_anime_marked = set()          # (anilist_id, episode) already handled this run
_anime_mark_lock = threading.Lock()


def _mark_anime_async(anilist_id, episode):
    from .oauth import get_valid_token  # lazy: avoid an api-package import cycle
    from ..sources import anilist
    try:
        token = get_valid_token("anilist")
    except Exception:
        token = None
    if not token:
        return
    try:
        anilist.mark_episode_watched(token, anilist_id, episode)
    except Exception:
        _log.exception("AniList auto-mark failed for anime:%s ep %s", anilist_id, episode)


def _maybe_mark_anime(item_id, position, duration):
    threshold = config.ANIME_WATCHED_PERCENT
    if threshold <= 0 or duration <= 0 or not modules.has("anime"):
        return
    m = _ANIME_ID_RE.match(item_id)
    if not m or (position / duration) * 100 < threshold:
        return
    key = (int(m.group(1)), int(float(m.group(2))))
    with _anime_mark_lock:
        if key in _anime_marked:
            return
        _anime_marked.add(key)  # optimistic: mark once per episode per run
    threading.Thread(target=_mark_anime_async, args=key, daemon=True).start()


@feeds_bp.post("/history/mark")
def history_mark():
    """Manually mark a video watched (fills its progress bar, removes it from
    Continue watching) or unwatched (clears progress)."""
    body = request.get_json(force=True, silent=True) or {}
    item = body.get("item") or {}
    watched = bool(body.get("watched"))
    item_id = item.get("id")
    if not item_id:
        return err("item with id required")
    try:
        if watched:
            db.add_history(
                item.get("platform") or "youtube",
                item_id,
                item.get("title"),
                (item.get("extra") or {}).get("channel_id"),
                item.get("source"),
                item.get("thumbnail"),
                item.get("url"),
            )
            db.set_progress(item_id, 1.0, 1.0)  # ratio 1.0 → shows as finished
        else:
            db.set_progress(item_id, 0.0, 0.0)  # drops out of progress map + shelf
    except Exception as e:
        current_app.logger.exception("Failed to mark history")
        return err(f"Failed to mark watched: {e}", 500)
    return ok({"marked": watched})


# ---- saved (watch later / bookmarks) ----

@feeds_bp.get("/saved")
def saved_list():
    return ok({"items": db.list_saved(request.args.get("platform"))})


@feeds_bp.post("/saved")
def saved_add():
    body = request.get_json(force=True, silent=True) or {}
    item = body.get("item") or {}
    if not item.get("id") or not item.get("platform"):
        return err("item with id and platform required")
    try:
        db.add_saved(item)
    except Exception as e:
        current_app.logger.exception("Failed to add saved item")
        return err(f"Failed to save item: {e}", 500)
    return ok({"saved": True})


SAVED_NOTE_MAX = 2000


@feeds_bp.patch("/saved/<path:item_id>")
def saved_update(item_id):
    """Write a note on a kept entry, or mark it done / not done."""
    body = request.get_json(force=True, silent=True) or {}
    note = body.get("note")
    done = body.get("done")
    if note is None and done is None:
        return err("note or done required")
    if note is not None and not isinstance(note, str):
        return err("note must be text")
    if done is not None and not isinstance(done, bool):
        return err("done must be true or false")
    item = db.update_saved(item_id, note=None if note is None else note.strip()[:SAVED_NOTE_MAX], done=done)
    if item is None:
        return err("not saved", 404)
    return ok(item)


@feeds_bp.delete("/saved/<path:item_id>")
def saved_remove(item_id):
    try:
        removed = db.remove_saved(item_id)
    except Exception as e:
        current_app.logger.exception("Failed to remove saved item")
        return err(f"Failed to unsave item: {e}", 500)
    return ok({"removed": removed})


@feeds_bp.get("/search/all")
def search_all():
    """Unified search across the installed rooms, for the command palette."""
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    results = {"youtube": [], "reddit": [], "hackernews": [], "github": []}
    for room in results:
        src = _source(room)
        if src is None:
            continue
        try:
            results[room] = src.search(q).get("items", [])[:8]
        except Exception:
            pass
    return ok(results)


@feeds_bp.get("/feed/foryou")
def feed_foryou():
    weights = db.get_setting("foryou_weights") or {"youtube": 2, "reddit": 2, "hackernews": 1}
    active_rooms = set(db.get_setting("active_rooms") or ["frontpage", "youtube", "reddit", "hackernews", "archive", "anime"])
    feeds = {}
    errors = []

    def take(room, fetch):
        src = _source(room) if room in active_rooms else None
        if src is None:
            return
        try:
            feeds[room] = fetch(src)
        except Exception as e:
            errors.append(f"{room}: {e}")

    take("hackernews", lambda hn: hn.get_feed("top", 0)["items"])
    yt_subs = db.list_subscriptions("youtube")
    if yt_subs:
        take("youtube", lambda yt: yt.get_feed([s["source_id"] for s in yt_subs])["items"])
    rd_subs = db.list_subscriptions("reddit")
    if rd_subs:
        sort = db.get_setting("reddit_sort") or "hot"
        take("reddit", lambda rd: rd.get_feed([s["source_id"] for s in rd_subs], sort)["items"])
    if db.list_subscriptions("github"):
        take("github", lambda gh: gh.get_feed()["items"])

    items = mixer.mix(feeds, weights)[:90]
    return ok({"items": items, "errors": errors, "stale": False})


@feeds_bp.post("/refresh")
def refresh():
    scope = request.args.get("scope", "")
    prefixes = {"": "", "all": "", "reddit": "reddit:", "youtube": "yt:", "hackernews": "hn:", "github": "github:"}
    if scope not in prefixes:
        return err("invalid scope")
    return ok({"cleared": cache.invalidate(prefixes[scope])})
