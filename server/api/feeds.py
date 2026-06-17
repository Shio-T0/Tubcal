from flask import Blueprint, request

from . import err, ok
from .. import cache, config, db
from ..sources import hackernews, invidious, mixer, reddit, youtube

feeds_bp = Blueprint("feeds", __name__, url_prefix="/api")


@feeds_bp.get("/health")
def health():
    return ok({"status": "ok", "version": "0.1.0"})


@feeds_bp.get("/feed/hackernews")
def feed_hackernews():
    list_name = request.args.get("list", "top")
    if list_name not in ("top", "best", "new"):
        return err("list must be top, best, or new")
    try:
        page = max(0, int(request.args.get("page", 0)))
    except ValueError:
        return err("invalid page")
    try:
        return ok(hackernews.get_feed(list_name, page))
    except Exception as e:
        return err(f"Hacker News fetch failed: {e}", 502)


@feeds_bp.get("/hackernews/search")
def hackernews_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    try:
        return ok(hackernews.search(q))
    except Exception as e:
        return err(f"Search failed: {e}", 502)


@feeds_bp.get("/hackernews/item/<int:hn_id>")
def hackernews_item(hn_id):
    try:
        return ok(hackernews.get_item(hn_id))
    except Exception as e:
        return err(f"Could not load thread: {e}", 502)


@feeds_bp.get("/feed/reddit")
def feed_reddit():
    sort = request.args.get("sort", "hot")
    if sort not in ("hot", "new", "top"):
        return err("sort must be hot, new, or top")
    if request.args.get("source") == "account":
        from .oauth import get_valid_token
        try:
            token = get_valid_token("reddit")
        except LookupError as e:
            return err(str(e), 401)
        try:
            return ok(reddit.get_account_feed(token))
        except Exception as e:
            return err(f"Reddit account feed failed: {e}", 502)
    subs_param = (request.args.get("subs") or "").strip()
    if subs_param:
        names = [n.strip().lower() for n in subs_param.split(",") if n.strip()]
    else:
        names = [s["source_id"] for s in db.list_subscriptions("reddit")]
    if not names:
        return ok({"items": [], "stale": False})
    try:
        return ok(reddit.get_feed(names, sort))
    except Exception as e:
        return err(f"Reddit fetch failed: {e}", 502)


@feeds_bp.get("/reddit/search")
def reddit_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    sub = (request.args.get("sub") or "").strip() or None
    try:
        return ok(reddit.search(q, sub))
    except Exception as e:
        return err(f"Search failed: {e}", 502)


@feeds_bp.get("/reddit/post/<sub>/<post_id>")
def reddit_post(sub, post_id):
    try:
        return ok(reddit.get_post(sub, post_id))
    except Exception as e:
        return err(f"Could not load post: {e}", 502)


@feeds_bp.get("/feed/youtube")
def feed_youtube():
    if request.args.get("source") == "account":
        from .oauth import get_valid_token
        try:
            token = get_valid_token("google")
        except LookupError as e:
            return err(str(e), 401)
        try:
            channel_ids = youtube.get_account_channel_ids(token)
            return ok(youtube.get_feed(channel_ids))
        except Exception as e:
            return err(f"YouTube account feed failed: {e}", 502)
    subs = db.list_subscriptions("youtube")
    if not subs:
        return ok({"items": [], "stale": False})
    try:
        return ok(youtube.get_feed([s["source_id"] for s in subs]))
    except Exception as e:
        return err(f"YouTube fetch failed: {e}", 502)


@feeds_bp.get("/feed/youtube/channel/<channel_id>")
def feed_youtube_channel(channel_id):
    try:
        return ok(youtube.get_channel_feed(channel_id))
    except Exception as e:
        return err(f"Channel fetch failed: {e}", 502)


@feeds_bp.get("/youtube/channel/<channel_id>/videos")
def youtube_channel_videos(channel_id):
    sort = (request.args.get("sort") or "newest").strip()
    if sort not in ("newest", "oldest", "popular"):
        return err("sort must be newest, oldest, or popular")
    continuation = (request.args.get("continuation") or "").strip() or None
    try:
        return ok(youtube.get_channel_videos(channel_id, sort, continuation))
    except Exception as e:
        return err(f"Channel videos fetch failed: {e}", 502)


@feeds_bp.get("/youtube/channel/<channel_id>/playlists")
def youtube_channel_playlists(channel_id):
    try:
        return ok(youtube.get_channel_playlists(channel_id))
    except Exception as e:
        return err(f"Channel playlists fetch failed: {e}", 502)


@feeds_bp.get("/youtube/channel/<channel_id>/search")
def youtube_channel_search(channel_id):
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    try:
        return ok(youtube.search_channel(channel_id, q))
    except Exception as e:
        return err(f"Channel search failed: {e}", 502)


@feeds_bp.get("/youtube/playlist/<playlist_id>")
def youtube_playlist(playlist_id):
    try:
        return ok(youtube.get_playlist(playlist_id))
    except Exception as e:
        return err(f"Playlist fetch failed: {e}", 502)


def _discover_payload(region):
    subs = db.list_subscriptions("youtube")
    history = db.get_history("youtube")
    return youtube.get_discover([s["source_id"] for s in subs], history, region=region)


@feeds_bp.get("/youtube/discover")
def youtube_discover():
    region = (request.args.get("region") or "US").strip()
    # Stale-while-revalidate: the page gets the last shelf instantly and a fresh
    # one is computed in the background, instead of blocking on Invidious calls.
    try:
        data, _ = cache.cached_swr(
            f"yt:discover:{region}", config.TTL_YT_DISCOVER, lambda: _discover_payload(region)
        )
        return ok(data)
    except Exception as e:
        return err(f"Discover failed: {e}", 502)


@feeds_bp.get("/youtube/trending")
def youtube_trending():
    """Genuinely random videos from outside your subscriptions (via Invidious)."""
    region = (request.args.get("region") or "US").strip()
    try:
        return ok(invidious.random_pool(region))
    except Exception as e:
        return err(f"Trending fetch failed: {e}", 502)


@feeds_bp.get("/youtube/search")
def youtube_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    try:
        return ok(invidious.search(q))
    except Exception as e:
        return err(f"Search failed: {e}", 502)


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
    db.add_history(
        item["platform"],
        item["id"],
        item.get("title"),
        (item.get("extra") or {}).get("channel_id") or (item.get("extra") or {}).get("subreddit"),
        item.get("source"),
        item.get("thumbnail"),
        item.get("url"),
    )
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
    db.set_progress(item_id, position, duration)
    return ok({"saved": True})


def _history_row_to_item(r):
    """Rebuild a normalized feed item from a stored history/watch row so the
    Continue-watching shelf can render it with the normal VideoTile."""
    vid = r["item_id"][3:] if r["item_id"].startswith("yt:") else None
    return {
        "id": r["item_id"],
        "platform": r["platform"],
        "title": r["title"],
        "url": r["url"],
        "thumbnail": r["thumbnail"]
        or (f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else None),
        "source": r["source_name"],
        "published_at": None,
        "extra": {"video_id": vid, "channel_id": r["source_id"]},
    }


@feeds_bp.get("/youtube/continue")
def youtube_continue():
    rows = db.get_continue_watching()
    return ok({"items": [_history_row_to_item(r) for r in rows]})


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
    db.add_saved(item)
    return ok({"saved": True})


@feeds_bp.delete("/saved/<path:item_id>")
def saved_remove(item_id):
    return ok({"removed": db.remove_saved(item_id)})


@feeds_bp.get("/search/all")
def search_all():
    """Unified search across all three rooms for the command palette."""
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    results = {"youtube": [], "reddit": [], "hackernews": []}
    try:
        results["youtube"] = invidious.search(q).get("items", [])[:8]
    except Exception:
        pass
    try:
        results["reddit"] = reddit.search(q).get("items", [])[:8]
    except Exception:
        pass
    try:
        results["hackernews"] = hackernews.search(q).get("items", [])[:8]
    except Exception:
        pass
    return ok(results)


@feeds_bp.get("/feed/foryou")
def feed_foryou():
    weights = db.get_setting("foryou_weights") or {"youtube": 2, "reddit": 2, "hackernews": 1}
    feeds = {}
    errors = []

    try:
        feeds["hackernews"] = hackernews.get_feed("top", 0)["items"]
    except Exception as e:
        errors.append(f"hackernews: {e}")

    yt_subs = db.list_subscriptions("youtube")
    if yt_subs:
        try:
            feeds["youtube"] = youtube.get_feed([s["source_id"] for s in yt_subs])["items"]
        except Exception as e:
            errors.append(f"youtube: {e}")

    rd_subs = db.list_subscriptions("reddit")
    if rd_subs:
        sort = db.get_setting("reddit_sort") or "hot"
        try:
            feeds["reddit"] = reddit.get_feed([s["source_id"] for s in rd_subs], sort)["items"]
        except Exception as e:
            errors.append(f"reddit: {e}")

    items = mixer.mix(feeds, weights)[:90]
    return ok({"items": items, "errors": errors, "stale": False})


@feeds_bp.post("/refresh")
def refresh():
    scope = request.args.get("scope", "")
    prefixes = {"": "", "all": "", "reddit": "reddit:", "youtube": "yt:", "hackernews": "hn:"}
    if scope not in prefixes:
        return err("invalid scope")
    return ok({"cleared": cache.invalidate(prefixes[scope])})
