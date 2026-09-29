import base64
import hashlib
import logging
import re
import threading
from urllib.parse import urljoin, urlparse

from flask import Blueprint, Response, current_app, request, stream_with_context

from . import err, ok
from .. import cache, config, db, httpc
from ..sources import anilist, fmp4, github, hackernews, invidious, mixer, reddit, youtube

feeds_bp = Blueprint("feeds", __name__, url_prefix="/api")


@feeds_bp.get("/health")
def health():
    return ok({"status": "ok", "version": "0.1.0"})


@feeds_bp.get("/feed/hackernews")
def feed_hackernews():
    list_name = request.args.get("list", "top")
    if list_name not in hackernews.LISTS:
        return err("list must be one of " + ", ".join(hackernews.LISTS))
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
        return ok(hackernews.search(q, request.args.get("sort") or "relevance", request.args.get("range")))
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


@feeds_bp.get("/youtube/channel/<channel_id>/about")
def youtube_channel_about(channel_id):
    try:
        return ok(youtube.channel_about(channel_id))
    except Exception as e:
        return err(f"Channel info fetch failed: {e}", 502)


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


@feeds_bp.get("/youtube/stream/<video_id>")
def youtube_stream(video_id):
    try:
        data = youtube.video_streams(video_id)
    except Exception as e:
        return err(f"Stream resolve failed: {e}", 502)
    # The client only needs the quality ladder; the audio track is resolved
    # server-side when it builds an adaptive HLS master, so don't ship those URLs.
    return ok({k: v for k, v in data.items() if k != "audio"})


# Headers worth relaying from the upstream CDN response to the browser.
_STREAM_PASS_HEADERS = ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges")


def _fwd_headers():
    h = {"User-Agent": config.BROWSER_UA}
    if request.headers.get("Range"):
        h["Range"] = request.headers["Range"]
    return h


def _relay(upstream, default_ct="application/octet-stream"):
    """Stream an already-opened upstream response back to the browser, relaying
    the headers a media element / hls.js cares about."""
    def generate():
        try:
            for chunk in upstream.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    headers = {k: upstream.headers[k] for k in _STREAM_PASS_HEADERS if k in upstream.headers}
    headers.setdefault("Accept-Ranges", "bytes")
    return Response(
        stream_with_context(generate()),
        status=upstream.status_code,
        headers=headers,
        content_type=upstream.headers.get("Content-Type", default_ct),
    )


def _find_stream(video_id, itag, kind=None):
    data = youtube.video_streams(video_id)
    streams = data.get("streams") or []
    if kind:
        streams = [s for s in streams if s.get("kind") == kind]
    return next((s for s in streams if str(s.get("itag")) == str(itag)), None) or (
        streams[0] if streams else None
    )


@feeds_bp.get("/youtube/stream/<video_id>/data")
def youtube_stream_data(video_id):
    """Proxy the progressive mp4 bytes through Flask.

    The direct googlevideo URLs play under curl but a browser <video> element
    refuses them (cross-origin redirect / IP-context quirks). Streaming them via
    localhost makes playback same-origin — no CORS, no redirect surprises — and
    keeps the browser from ever talking to googlevideo directly. Range requests
    are forwarded so seeking works.
    """
    itag = request.args.get("itag")

    # A cached stream URL can rot before its TTL (googlevideo 4xx's expired/
    # consumed URLs); on any client/server error drop the cache and re-resolve a
    # fresh one once — otherwise the browser sees a non-media error body and
    # reports it as an unsupported source.
    upstream = None
    for attempt in range(2):
        try:
            target = _find_stream(video_id, itag)
        except Exception as e:
            return err(f"Stream resolve failed: {e}", 502)
        if not target:
            return err("No playable stream", 502)
        upstream = httpc.anon_session.get(
            target["url"], headers=_fwd_headers(), stream=True, timeout=20, allow_redirects=True,
        )
        if upstream.status_code < 400 or attempt == 1:
            break
        upstream.close()
        cache.invalidate(youtube.info_key(video_id))
        cache.invalidate(f"yt:inv:streams:{video_id}")

    return _relay(upstream, default_ct="video/mp4")


def _seg_proxy_url(abs_url):
    token = base64.urlsafe_b64encode(abs_url.encode()).decode()
    return f"/api/youtube/hls/seg?u={token}"


_URI_ATTR_RE = re.compile(r'URI="([^"]+)"')


def _rewrite_hls(text, base_url):
    """Rewrite an HLS media playlist so every segment (and any KEY/MAP init URI)
    is fetched back through our same-origin segment proxy — hls.js pulls these
    via XHR, which would otherwise be CORS-blocked against googlevideo."""
    out = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            out.append(line)
        elif stripped.startswith("#"):
            # EXT-X-KEY / EXT-X-MAP carry a URI="..." pointing at binary data.
            out.append(_URI_ATTR_RE.sub(
                lambda m: f'URI="{_seg_proxy_url(urljoin(base_url, m.group(1)))}"', stripped
            ))
        else:
            out.append(_seg_proxy_url(urljoin(base_url, stripped)))
    return "\n".join(out) + "\n"


def _hls_response(text):
    return Response(text, content_type="application/vnd.apple.mpegurl")


def _index_fmp4(url):
    """Fetch just the head of a fragmented-mp4 rendition and parse its `sidx` into
    (init_end, segments). A 256 KiB prefix comfortably covers ftyp+moov+sidx for
    YouTube's fragmented-mode files. Cached (keyed by URL) since the byte layout is
    fixed for the life of the stream URL."""
    key = "yt:fmp4:" + hashlib.sha1(url.encode()).hexdigest()[:16]

    def fetch():
        resp = httpc.get(
            url, headers={"Range": "bytes=0-262143"}, timeout=20, allow_redirects=True,
            anonymous=True,
        )
        init_end, segs = fmp4.parse_sidx(resp.content)
        return init_end, segs

    return cache.cached(key, 1800, fetch)[0]


def _adaptive_master(video_id, itag, video):
    """A synthetic HLS master pairing one adaptive avc1 video rendition with the
    original audio, so hls.js muxes them in the browser (no ffmpeg, direct from
    googlevideo). The two media playlists are served by the endpoints below."""
    data = youtube.video_streams(video_id)
    audio = data.get("audio") or []
    if not audio:
        return err("No audio track for adaptive stream", 502)
    master = fmp4.master_playlist(
        f"/api/youtube/hls/{video_id}/{itag}/v.m3u8",
        f"/api/youtube/hls/{video_id}/{itag}/a.m3u8",
        vcodec=video.get("vcodec") or "",
        acodec=audio[0].get("acodec") or "",
        width=video.get("width"),
        height=video.get("height"),
        bandwidth=video.get("bandwidth") or audio[0].get("bandwidth") or 0,
    )
    return _hls_response(master)


def _adaptive_media(video_id, itag, track):
    """A byte-range HLS media playlist for the video ('v') or audio ('a') half of
    an adaptive stream. Every segment addresses the one googlevideo URL through
    the shared segment proxy, which forwards hls.js's per-fragment Range header."""
    if track == "v":
        src = _find_stream(video_id, itag, kind="hls")
        url = src.get("url") if src and src.get("adaptive") else None
    else:
        audio = (youtube.video_streams(video_id).get("audio") or [None])
        url = audio[0]["url"] if audio[0] else None
    if not url:
        return err("No adaptive stream", 404)
    try:
        init_end, segments = _index_fmp4(url)
    except Exception as e:
        return err(f"Segment index failed: {e}", 502)
    return _hls_response(fmp4.media_playlist(_seg_proxy_url(url), init_end, segments))


@feeds_bp.get("/youtube/hls/<video_id>/<itag>/v.m3u8")
def youtube_hls_adaptive_video(video_id, itag):
    return _adaptive_media(video_id, itag, "v")


@feeds_bp.get("/youtube/hls/<video_id>/<itag>/a.m3u8")
def youtube_hls_adaptive_audio(video_id, itag):
    return _adaptive_media(video_id, itag, "a")


@feeds_bp.get("/youtube/hls/<video_id>/<itag>.m3u8")
def youtube_hls_playlist(video_id, itag):
    """Serve the HLS master/playlist for one rendition.

    Adaptive renditions (YouTube's higher qualities, which ship only as DASH) get
    a synthesized master over their fragmented-mp4 video + the original audio. The
    live/native case fetches and rewrites YouTube's own muxed media playlist.

    Like the progressive path, a cached manifest URL can expire; if the fetch
    fails or comes back as anything but a real playlist (an expired URL returns
    an error page, which hls.js then rejects as a malformed manifest → looks like
    an unsupported video), drop the cache and re-resolve a fresh URL once."""
    last_err = None
    for attempt in range(2):
        try:
            target = _find_stream(video_id, itag, kind="hls")
        except Exception as e:
            return err(f"Stream resolve failed: {e}", 502)
        if not target:
            return err("No HLS stream", 404)
        if target.get("adaptive"):
            return _adaptive_master(video_id, itag, target)
        try:
            resp = httpc.anon_session.get(
                target["url"], headers={"User-Agent": config.BROWSER_UA}, timeout=20
            )
            if resp.status_code == 200 and resp.text.lstrip().startswith("#EXTM3U"):
                return Response(
                    _rewrite_hls(resp.text, target["url"]),
                    content_type="application/vnd.apple.mpegurl",
                )
            last_err = f"HTTP {resp.status_code}"
        except Exception as e:
            last_err = str(e)
        if attempt == 0:
            cache.invalidate(youtube.info_key(video_id))
            cache.invalidate(f"yt:inv:streams:{video_id}")
    return err(f"HLS playlist fetch failed: {last_err or 'bad manifest'}", 502)


@feeds_bp.get("/youtube/hls/seg")
def youtube_hls_segment():
    """Proxy a single HLS segment (or key/init) by its base64url-encoded URL."""
    token = request.args.get("u")
    if not token:
        return err("u required")
    try:
        url = base64.urlsafe_b64decode(token.encode()).decode()
    except Exception:
        return err("bad token")
    if "googlevideo.com" not in (urlparse(url).hostname or ""):  # only proxy YouTube CDN
        return err("forbidden host", 403)
    upstream = httpc.anon_session.get(
        url, headers=_fwd_headers(), stream=True, timeout=20, allow_redirects=True,
    )
    return _relay(upstream, default_ct="video/mp2t")


@feeds_bp.get("/youtube/playlist/<playlist_id>")
def youtube_playlist(playlist_id):
    try:
        return ok(youtube.get_playlist(playlist_id))
    except Exception as e:
        return err(f"Playlist fetch failed: {e}", 502)


@feeds_bp.get("/youtube/video/<video_id>")
def youtube_video_info(video_id):
    """Metadata for the player's info panel — title, description, view count,
    and live/upcoming status. Stream URLs are deliberately stripped (they're
    served only through the proxy endpoints)."""
    try:
        info = youtube.video_info(video_id)
    except Exception as e:
        return err(f"Video info failed: {e}", 502)
    meta = {k: v for k, v in info.items() if k not in ("streams", "audio")}
    meta["has_streams"] = bool(info.get("streams"))
    return ok(meta)


@feeds_bp.get("/youtube/comments/<video_id>")
def youtube_comments(video_id):
    sort = (request.args.get("sort") or "top").strip()
    if sort not in ("top", "new"):
        return err("sort must be top or new")
    continuation = (request.args.get("continuation") or "").strip() or None
    try:
        return ok(youtube.video_comments(video_id, sort, continuation))
    except Exception as e:
        return err(f"Comments fetch failed: {e}", 502)


@feeds_bp.get("/youtube/comments/<video_id>/replies")
def youtube_comment_replies(video_id):
    token = request.args.get("token", "")
    if not token:
        return err("missing reply token")
    depth = request.args.get("depth", type=int) or 1
    try:
        return ok(youtube.video_comment_replies(video_id, token, depth))
    except Exception as e:
        return err(f"Replies fetch failed: {e}", 502)


@feeds_bp.get("/youtube/live")
def youtube_live():
    """Live + scheduled streams across your subscribed channels."""
    ids = sorted(s["source_id"] for s in db.list_subscriptions("youtube"))
    if not ids:
        return ok({"items": [], "stale": False})
    # SWR-cached: confirming candidates via yt-dlp is slow, so serve the last
    # result instantly and refresh in the background.
    key = "yt:live:" + ",".join(ids)
    try:
        data, stale = cache.cached_swr(key, 120, lambda: youtube.get_live_and_upcoming(ids))
        return ok({**data, "stale": stale})
    except Exception as e:
        return err(f"Live fetch failed: {e}", 502)


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
        page = int(request.args.get("page") or 1)
    except ValueError:
        page = 1
    continuation = (request.args.get("continuation") or "").strip() or None
    try:
        return ok(youtube.search(q, page=page, continuation=continuation))
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
    if threshold <= 0 or duration <= 0:
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
    """Unified search across all rooms for the command palette."""
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    results = {"youtube": [], "reddit": [], "hackernews": [], "github": []}
    try:
        results["youtube"] = youtube.search(q).get("items", [])[:8]
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
    try:
        results["github"] = github.search(q).get("items", [])[:8]
    except Exception:
        pass
    return ok(results)


@feeds_bp.get("/feed/github")
def feed_github():
    list_name = request.args.get("list", "activity")
    try:
        page = max(0, int(request.args.get("page", 0)))
    except ValueError:
        return err("invalid page")
    try:
        return ok(github.get_feed(list_name, page))
    except Exception as e:
        return err(f"GitHub fetch failed: {e}", 502)


@feeds_bp.get("/github/search")
def github_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    try:
        return ok(github.search(q))
    except Exception as e:
        return err(f"Search failed: {e}", 502)


@feeds_bp.get("/github/trending")
def github_trending():
    period = (request.args.get("period") or "daily").strip().lower()
    if period not in ("daily", "weekly", "monthly"):
        return err("period must be one of daily|weekly|monthly")
    language = (request.args.get("language") or "").strip() or None
    try:
        page = max(0, int(request.args.get("page", 0)))
    except ValueError:
        return err("invalid page")
    try:
        return ok(github.trending(period, language, page))
    except Exception as e:
        return err(f"Trending fetch failed: {e}", 502)


@feeds_bp.get("/github/item/<path:full_name>")
def github_item(full_name):
    try:
        return ok(github.get_item(full_name))
    except Exception as e:
        return err(f"Could not load repo: {e}", 502)


@feeds_bp.get("/feed/foryou")
def feed_foryou():
    weights = db.get_setting("foryou_weights") or {"youtube": 2, "reddit": 2, "hackernews": 1}
    active_rooms = set(db.get_setting("active_rooms") or ["frontpage", "youtube", "reddit", "hackernews", "archive", "anime"])
    feeds = {}
    errors = []

    if "hackernews" in active_rooms:
        try:
            feeds["hackernews"] = hackernews.get_feed("top", 0)["items"]
        except Exception as e:
            errors.append(f"hackernews: {e}")

    yt_subs = db.list_subscriptions("youtube")
    if yt_subs and "youtube" in active_rooms:
        try:
            feeds["youtube"] = youtube.get_feed([s["source_id"] for s in yt_subs])["items"]
        except Exception as e:
            errors.append(f"youtube: {e}")

    rd_subs = db.list_subscriptions("reddit")
    if rd_subs and "reddit" in active_rooms:
        sort = db.get_setting("reddit_sort") or "hot"
        try:
            feeds["reddit"] = reddit.get_feed([s["source_id"] for s in rd_subs], sort)["items"]
        except Exception as e:
            errors.append(f"reddit: {e}")

    gh_subs = db.list_subscriptions("github")
    if gh_subs and "github" in active_rooms:
        try:
            feeds["github"] = github.get_feed()["items"]
        except Exception as e:
            errors.append(f"github: {e}")

    items = mixer.mix(feeds, weights)[:90]
    return ok({"items": items, "errors": errors, "stale": False})


@feeds_bp.post("/refresh")
def refresh():
    scope = request.args.get("scope", "")
    prefixes = {"": "", "all": "", "reddit": "reddit:", "youtube": "yt:", "hackernews": "hn:", "github": "github:"}
    if scope not in prefixes:
        return err("invalid scope")
    return ok({"cleared": cache.invalidate(prefixes[scope])})
