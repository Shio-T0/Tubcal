"""The Screening Room's API (modules.ini: youtube): feeds, channels, search,
comments, and the stream resolver + same-origin media proxies the player uses."""

import base64
import hashlib
import re
import threading
import time
from urllib.parse import parse_qs, urljoin, urlparse

from flask import Blueprint, Response, request

from . import err, ok
from .relay import relay
from .. import cache, config, db, httpc
from ..sources import fmp4, invidious, youtube

youtube_bp = Blueprint("youtube", __name__, url_prefix="/api")


@youtube_bp.get("/feed/youtube")
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


@youtube_bp.get("/feed/youtube/channel/<channel_id>")
def feed_youtube_channel(channel_id):
    try:
        return ok(youtube.get_channel_feed(channel_id))
    except Exception as e:
        return err(f"Channel fetch failed: {e}", 502)


@youtube_bp.get("/youtube/channel/<channel_id>/about")
def youtube_channel_about(channel_id):
    try:
        return ok(youtube.channel_about(channel_id))
    except Exception as e:
        return err(f"Channel info fetch failed: {e}", 502)


@youtube_bp.get("/youtube/channel/<channel_id>/videos")
def youtube_channel_videos(channel_id):
    sort = (request.args.get("sort") or "newest").strip()
    if sort not in ("newest", "oldest", "popular"):
        return err("sort must be newest, oldest, or popular")
    continuation = (request.args.get("continuation") or "").strip() or None
    try:
        return ok(youtube.get_channel_videos(channel_id, sort, continuation))
    except Exception as e:
        return err(f"Channel videos fetch failed: {e}", 502)


@youtube_bp.get("/youtube/channel/<channel_id>/playlists")
def youtube_channel_playlists(channel_id):
    try:
        return ok(youtube.get_channel_playlists(channel_id))
    except Exception as e:
        return err(f"Channel playlists fetch failed: {e}", 502)


@youtube_bp.get("/youtube/channel/<channel_id>/search")
def youtube_channel_search(channel_id):
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    try:
        return ok(youtube.search_channel(channel_id, q))
    except Exception as e:
        return err(f"Channel search failed: {e}", 502)


@youtube_bp.get("/youtube/stream/<video_id>")
def youtube_stream(video_id):
    try:
        data = youtube.video_streams(video_id)
    except Exception as e:
        return err(f"Stream resolve failed: {e}", 502)
    # The client only needs the quality ladder; the audio track is resolved
    # server-side when it builds an adaptive HLS master, so don't ship those URLs.
    return ok({k: v for k, v in data.items() if k != "audio"})


def _fwd_headers():
    h = {"User-Agent": config.BROWSER_UA}
    if request.headers.get("Range"):
        h["Range"] = request.headers["Range"]
    return h


# ── keeping a playing video's googlevideo URLs alive ──────────────────────────
#
# A playlist is built once when a video opens, and every segment in it addresses
# one googlevideo URL. That URL can stop working mid-video: it expires, and it is
# minted for this machine's public IP — a phone moving between Wi-Fi and mobile
# data, or IPv6 rotating its temporary address, gets every later segment refused.
# When that happens the segment proxy re-resolves the video, finds the same
# rendition (same itag = same file, so byte ranges still line up) and carries on
# from the fresh URL; the swap is remembered so the rest of the video's segments
# go straight there.

_FRESH = {}  # stale googlevideo URL -> a working URL for the same file
_FRESH_MAX = 256
_refresh_locks = {}
_refreshed_at = {}
_refresh_registry = threading.Lock()


def _itag_of(url):
    return (parse_qs(urlparse(url).query).get("itag") or [None])[0]


def _current_url(url):
    """The newest known-good URL standing in for `url` (follows chained swaps)."""
    seen = 0
    while url in _FRESH and seen < 8:
        url = _FRESH[url]
        seen += 1
    return url


def _fresh_url(video_id, stale):
    """A re-resolved googlevideo URL for the same rendition as `stale`, or None.
    One re-resolve per video per ~20 s however many segments ask at once."""
    itag = _itag_of(stale)
    if not video_id or not itag:
        return None
    with _refresh_registry:
        lock = _refresh_locks.setdefault(video_id, threading.Lock())
    with lock:
        if time.time() - _refreshed_at.get(video_id, 0) > 20:
            cache.invalidate(youtube.info_key(video_id))
            cache.invalidate(f"yt:inv:streams:{video_id}")
            _refreshed_at[video_id] = time.time()
        try:
            data = youtube.video_streams(video_id)
        except Exception:
            return None
    for s in (data.get("streams") or []) + (data.get("audio") or []):
        u = s.get("url")
        if u and u != stale and _itag_of(u) == itag:
            if len(_FRESH) >= _FRESH_MAX:
                _FRESH.pop(next(iter(_FRESH)))
            _FRESH[stale] = u
            return u
    return None


def _open_media(url, video_id, headers):
    """Open googlevideo bytes for the player: retries transient failures, swaps in
    a re-resolved URL when the old one is refused, and returns (upstream, reopen)
    — `reopen(range)` resumes the body if the connection breaks mid-way."""
    refresh = (lambda stale: _fresh_url(video_id, stale)) if video_id else None
    upstream = httpc.stream_get(_current_url(url), headers=headers, anonymous=True, refresh=refresh)

    def reopen(rng):
        return httpc.stream_get(
            _current_url(url), headers={**headers, "Range": rng}, anonymous=True, refresh=refresh,
        )

    return upstream, reopen


def _find_stream(video_id, itag, kind=None):
    data = youtube.video_streams(video_id)
    streams = data.get("streams") or []
    if kind:
        streams = [s for s in streams if s.get("kind") == kind]
    return next((s for s in streams if str(s.get("itag")) == str(itag)), None) or (
        streams[0] if streams else None
    )


@youtube_bp.get("/youtube/stream/<video_id>/data")
def youtube_stream_data(video_id):
    """Proxy the progressive mp4 bytes through Flask.

    The direct googlevideo URLs play under curl but a browser <video> element
    refuses them (cross-origin redirect / IP-context quirks). Streaming them via
    localhost makes playback same-origin — no CORS, no redirect surprises — and
    keeps the browser from ever talking to googlevideo directly. Range requests
    are forwarded so seeking works.
    """
    itag = request.args.get("itag")
    try:
        target = _find_stream(video_id, itag)
    except Exception as e:
        return err(f"Stream resolve failed: {e}", 502)
    if not target:
        return err("No playable stream", 502)
    # A cached stream URL can rot before its TTL (googlevideo 4xx's expired or
    # other-IP URLs); _open_media swaps in a re-resolved one rather than handing the
    # browser a non-media error body it would report as an unsupported source.
    try:
        upstream, reopen = _open_media(target["url"], video_id, _fwd_headers())
    except Exception as e:
        return err(f"Stream fetch failed: {e}", 502)
    return relay(upstream, reopen=reopen, default_ct="video/mp4")


def _seg_proxy_url(abs_url, video_id=None):
    """The same-origin proxy URL for one googlevideo resource. With `video_id`, the
    proxy can re-resolve the video if this URL stops working mid-playback."""
    token = base64.urlsafe_b64encode(abs_url.encode()).decode()
    return f"/api/youtube/hls/seg?u={token}" + (f"&v={video_id}" if video_id else "")


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
        )  # raises on a refused (expired / other-IP) URL
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
        # the cached URL may already be dead (expired, or for an old IP): re-resolve once
        fresh = _fresh_url(video_id, url)
        if not fresh:
            return err(f"Segment index failed: {e}", 502)
        url = fresh
        try:
            init_end, segments = _index_fmp4(url)
        except Exception as e2:
            return err(f"Segment index failed: {e2}", 502)
    return _hls_response(fmp4.media_playlist(_seg_proxy_url(url, video_id), init_end, segments))


@youtube_bp.get("/youtube/hls/<video_id>/<itag>/v.m3u8")
def youtube_hls_adaptive_video(video_id, itag):
    return _adaptive_media(video_id, itag, "v")


@youtube_bp.get("/youtube/hls/<video_id>/<itag>/a.m3u8")
def youtube_hls_adaptive_audio(video_id, itag):
    return _adaptive_media(video_id, itag, "a")


@youtube_bp.get("/youtube/hls/<video_id>/<itag>.m3u8")
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


@youtube_bp.get("/youtube/hls/seg")
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
    video_id = request.args.get("v")
    if video_id and not re.fullmatch(r"[\w-]{6,20}", video_id):
        return err("bad video id")
    try:
        upstream, reopen = _open_media(url, video_id, _fwd_headers())
    except Exception as e:
        return err(f"Segment fetch failed: {e}", 502)
    return relay(upstream, reopen=reopen, default_ct="video/mp2t")


@youtube_bp.get("/youtube/playlist/<playlist_id>")
def youtube_playlist(playlist_id):
    try:
        return ok(youtube.get_playlist(playlist_id))
    except Exception as e:
        return err(f"Playlist fetch failed: {e}", 502)


@youtube_bp.get("/youtube/video/<video_id>")
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


@youtube_bp.get("/youtube/comments/<video_id>")
def youtube_comments(video_id):
    sort = (request.args.get("sort") or "top").strip()
    if sort not in ("top", "new"):
        return err("sort must be top or new")
    continuation = (request.args.get("continuation") or "").strip() or None
    try:
        return ok(youtube.video_comments(video_id, sort, continuation))
    except Exception as e:
        return err(f"Comments fetch failed: {e}", 502)


@youtube_bp.get("/youtube/comments/<video_id>/replies")
def youtube_comment_replies(video_id):
    token = request.args.get("token", "")
    if not token:
        return err("missing reply token")
    depth = request.args.get("depth", type=int) or 1
    try:
        return ok(youtube.video_comment_replies(video_id, token, depth))
    except Exception as e:
        return err(f"Replies fetch failed: {e}", 502)


@youtube_bp.get("/youtube/live")
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


@youtube_bp.get("/youtube/discover")
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


@youtube_bp.get("/youtube/trending")
def youtube_trending():
    """Genuinely random videos from outside your subscriptions (via Invidious)."""
    region = (request.args.get("region") or "US").strip()
    try:
        return ok(invidious.random_pool(region))
    except Exception as e:
        return err(f"Trending fetch failed: {e}", 502)


@youtube_bp.get("/youtube/search")
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
        # when you last had it open — the home screen orders its "pick up" row by
        # this against AniList's last-touched stamp on your anime
        "extra": {"video_id": vid, "channel_id": r["source_id"], "watched_at": r.get("watched_at")},
    }


@youtube_bp.get("/youtube/continue")
def youtube_continue():
    rows = db.get_continue_watching()
    return ok({"items": [_history_row_to_item(r) for r in rows]})
