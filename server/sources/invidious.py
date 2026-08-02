"""Invidious integration — the escape hatch RSS can't give us.

YouTube's RSS feeds only expose videos from channels you already know the id of,
so the app could never surface anything *outside* your orbit. Invidious is an
open YouTube front-end with a public JSON API (no key) that exposes trending,
popular, and search — which is exactly what powers the "random video" feature.

Public instances go up and down constantly, so we keep a fallback list, try them
in order, and cache whichever one answered last so we don't re-probe every call.
"""

import hashlib
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

import requests

from .. import cache, config, httpc

# Order = preference; _api_get tries each in turn until one answers (see the note
# there on why we don't pin a 'winning' instance). Most public instances now block
# their /api (401/403/"Endpoint disabled"). darkness.services serves nearly every
# endpoint (channels, videos, playlists, search, trending, pagination) but 404s
# single-video lookups; melmac fills that gap — hence the order. Directory-probed
# instances are appended as fallbacks in _instances().
_DEFAULT_INSTANCES = [
    "https://invidious.darkness.services",
    "https://iv.melmac.space",
    "https://invidious.privacydev.net",
    "https://invidious.nerdvpn.de",
    "https://yewtu.be",
]

_UNROUTABLE_TLDS = {"ygg", "i2p", "onion", "loki"}


def _discovered_instances():
    """Extra https candidates from the official directory, cached ~6h.

    The directory's own `api` flag is unreliable (many advertise it but 403),
    so we just harvest hostnames as additional fallbacks to probe — best-effort,
    never fatal.
    """
    def fetch():
        data = httpc.get("https://api.invidious.io/instances.json", timeout=12,
                         anonymous=True).json()
        out = []
        for name, info in data:
            if info.get("type") != "https":
                continue
            # Overlay-network hosts (.ygg / .i2p / .onion) are in the directory
            # but can never resolve from a normal connection — probing one costs
            # a DNS failure per call, on the fallback path, for nothing.
            if name.rsplit(".", 1)[-1].lower() in _UNROUTABLE_TLDS:
                continue
            out.append(f"https://{name}")
        return out

    try:
        items, _ = cache.cached("yt:inv:directory", 6 * 3600, fetch)
        return items
    except Exception:
        return []


def _instances():
    configured = getattr(config, "INVIDIOUS_INSTANCES", None)
    if configured:
        return configured
    base = list(_DEFAULT_INSTANCES)
    for inst in _discovered_instances():
        if inst not in base:
            base.append(inst)
    return base


# ── per-family instance health ───────────────────────────────────────────────
# _api_get probes instances in order, and public ones go up and down constantly:
# a cold probe through a dead leader adds whole seconds to *every* call — and
# opening a channel fires several (videos + playlists + search). So we remember,
# per endpoint *family* (the first path segment: channels / search / trending /
# videos / …), which instance last answered and try it first, and we briefly
# bench an instance that just failed *for that family*.
#
# Health is tracked per-family on purpose. The live instances are complementary —
# darkness.services serves channels/videos/playlists/search/trending and
# pagination but 404s single-video lookups, while melmac serves single-video
# (recommendations) but 500s on channel pagination. A *global* winner or loser
# would therefore break the other family; per-family memory keeps each endpoint
# pinned to whatever instance actually serves it, while never pinning across
# families.
_HEALTH_TTL = 300          # trust a remembered-good instance for a family this long
_COOLDOWN_SECS = 120       # bench an instance for a family this long after it fails
_REQUEST_TIMEOUT = 12
_health_lock = threading.Lock()
_healthy = {}              # family -> (base, ts)
_benched = {}              # (family, base) -> until_ts


def _family(path):
    """The endpoint family = the first path segment (channels / search / …)."""
    return (path.lstrip("/").split("/", 1)[0].split("?", 1)[0]) or "_"


def _ordered_instances(family):
    """Instances to try for a family: the last-good one first, then the rest in
    preference order, with any currently-benched (recently-failed-here) ones moved
    to the back so they remain a fallback but never delay a healthy instance."""
    now = time.time()
    with _health_lock:
        good = _healthy.get(family)
        good_base = good[0] if good and now - good[1] < _HEALTH_TTL else None
        benched = {b for (f, b), until in _benched.items() if f == family and until > now}
    live, cold = [], []
    for b in _instances():
        (cold if b in benched else live).append(b)
    order = live + cold
    if good_base and good_base in order:
        order.remove(good_base)
        order.insert(0, good_base)
    return order


def _mark(family, base, ok):
    now = time.time()
    with _health_lock:
        if ok:
            _healthy[family] = (base, now)
            _benched.pop((family, base), None)
        else:
            _benched[(family, base)] = now + _COOLDOWN_SECS


def _api_get(path):
    """GET an Invidious /api/v1 path, trying instances until one works.

    Order is health-aware (see the note above): the instance that last served
    this endpoint family is tried first, recently-failed ones last.
    """
    family = _family(path)
    last_err = None
    for base in _ordered_instances(family):
        url = f"{base}/api/v1{path}"
        try:
            resp = httpc.get(url, timeout=_REQUEST_TIMEOUT, anonymous=True)
            data = resp.json()
            # Invidious answers HTTP 200 with {"error": ...} when its backend
            # ("companion") can't serve an endpoint — treat that as a miss so we
            # fall through to an instance that actually works for this path.
            if isinstance(data, dict) and data.get("error"):
                raise ValueError(data["error"])
            _mark(family, base, True)
            return data
        except (requests.RequestException, ValueError, httpc.RateLimited) as e:
            # A rate-limit is just another reason this instance can't serve us
            # right now — bench it and fall through to the next one, rather than
            # aborting the whole fallback loop (which killed search/pagination the
            # moment our leader instance 429'd).
            last_err = e
            _mark(family, base, False)
            continue
    raise RuntimeError(f"All Invidious instances failed ({last_err})")


def _thumb(video_id, thumbnails):
    # Prefer YouTube's own CDN (always up) over the instance's proxied thumbs.
    if video_id:
        return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    if thumbnails:
        return thumbnails[-1].get("url")
    return None


def _parse_published(value):
    """`published` comes back as an epoch int from trending/popular/search but as
    an ISO-8601 string from recommendedVideos — normalize both to epoch seconds."""
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if text.isdigit():
        return int(text)
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp())
    except (ValueError, OverflowError):
        return 0


def _normalize(v):
    video_id = v.get("videoId")
    if not video_id:
        return None
    return {
        "id": f"yt:{video_id}",
        "platform": "youtube",
        "title": v.get("title", ""),
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "thumbnail": _thumb(video_id, v.get("videoThumbnails")),
        "author": v.get("author", ""),
        "source": v.get("author", ""),
        "published_at": _parse_published(v.get("published")),
        "score": v.get("viewCount"),
        "comments_count": None,
        "extra": {
            "video_id": video_id,
            "channel_id": v.get("authorId"),
            "description": (v.get("description") or "")[:300],
            "length_seconds": v.get("lengthSeconds"),
            "view_count": v.get("viewCount"),
        },
    }


def _normalize_list(raw):
    items = []
    for v in raw or []:
        # /search returns mixed types; keep only videos.
        if isinstance(v, dict) and v.get("type") not in (None, "video"):
            continue
        n = _normalize(v)
        if n:
            items.append(n)
    return items


def trending(region="US"):
    region = (region or "US").upper()[:2]

    def fetch():
        return _normalize_list(_api_get(f"/trending?region={region}"))

    items, stale = cache.cached(f"yt:inv:trending:{region}", config.TTL_YT_DISCOVER, fetch)
    return {"items": items, "stale": stale}


def popular():
    def fetch():
        return _normalize_list(_api_get("/popular"))

    items, stale = cache.cached("yt:inv:popular", config.TTL_YT_DISCOVER, fetch)
    return {"items": items, "stale": stale}


def search(query, page=1):
    """One page of YouTube-wide video search via Invidious — the *fallback* path;
    `youtube.search` calls InnerTube first. `page` is 1-based;
    Invidious returns a fresh slice of results per page (no continuation token),
    so `has_more` is simply whether this page came back non-empty."""
    q = (query or "").strip()
    if not q:
        return {"items": [], "page": page, "has_more": False}
    page = max(1, int(page or 1))

    def fetch():
        return _normalize_list(_api_get(f"/search?q={quote(q)}&type=video&page={page}"))

    items, stale = cache.cached(f"yt:inv:search:{q.lower()}:{page}", config.TTL_YT_RSS, fetch)
    # Invidious pages run ~20 results; a full-length page means there's very
    # likely another. An empty page is the end.
    has_more = len(items) >= 15
    # The thin-results fuzzy top-up lives in `youtube.search`, which owns the
    # routing between this and InnerTube — it applies to both paths.
    return {"items": items, "page": page, "has_more": has_more, "stale": stale}


def recommended(video_id):
    """YouTube's own 'up next' graph for one video, via Invidious — the seed of
    the history-based recommender. Returns [] on any failure (best-effort)."""
    if not video_id:
        return []

    def fetch():
        # No ?fields= filter — some instances drop recommendedVideos when asked
        # to project fields, so we fetch the full object and pick it out.
        data = _api_get(f"/videos/{video_id}")
        return _normalize_list(data.get("recommendedVideos"))

    try:
        items, _ = cache.cached(f"yt:inv:rec:{video_id}", config.TTL_YT_DISCOVER, fetch)
        return items
    except Exception:
        return []


def recommendations(seeds, exclude_ids=(), limit=40):
    """Aggregate recommendations across several watched videos.

    `seeds` is an iterable of (video_id, weight). A candidate recommended by
    multiple seeds — or by a heavily-watched one — floats up; its position in
    each seed's list also matters (YouTube ranks 'up next' by relevance).
    """
    seeds = [(vid, w) for vid, w in seeds if vid]
    if not seeds:
        return []
    exclude = set(exclude_ids)

    # Keep the fan-out modest: these all hit the same public instances, and a
    # wide burst is what gets us rate-limited (see config.HOST_INTERVALS).
    with ThreadPoolExecutor(max_workers=3) as ex:
        rec_lists = list(ex.map(lambda s: (s[1], recommended(s[0])), seeds))

    scored = {}  # id -> [score, item]
    for weight, recs in rec_lists:
        for rank, item in enumerate(recs):
            if item["id"] in exclude:
                continue
            contrib = max(0.2, float(weight)) * (1.0 / (1.0 + rank * 0.15))
            if item["id"] in scored:
                scored[item["id"]][0] += contrib
            else:
                item = {**item, "extra": {**item["extra"], "discovery": "recommended"}}
                scored[item["id"]] = [contrib, item]

    ordered = [it for _, it in sorted(scored.values(), key=lambda x: x[0], reverse=True)]
    return ordered[:limit]


_SORTS = {"newest", "oldest", "popular"}


def channel_videos(channel_id, sort_by="newest", continuation=None):
    """All of a channel's uploads, sorted by newest/oldest/popular, paginated via
    a continuation token (Invidious — YouTube RSS only exposes the latest ~15)."""
    sort_by = sort_by if sort_by in _SORTS else "newest"
    path = f"/channels/{channel_id}/videos?sort_by={sort_by}"
    if continuation:
        path += f"&continuation={quote(continuation)}"

    def fetch():
        data = _api_get(path)
        items = _normalize_list(data.get("videos"))
        # A first page with zero videos for a real channel means the instance
        # glitched — raise so cache.cached doesn't pin the emptiness for the full
        # TTL (this exact stale-empty caused 'popular' to show only the RSS subset).
        if not items and not continuation:
            raise RuntimeError("empty channel video page")
        return {"items": items, "continuation": data.get("continuation")}

    key = f"yt:inv:chvids:{channel_id}:{sort_by}:{continuation or ''}"
    payload, stale = cache.cached(key, config.TTL_YT_RSS, fetch)
    return {**payload, "stale": stale}


def channel_search(channel_id, query):
    """Search within a single channel's whole catalogue (not just loaded pages)."""
    q = (query or "").strip()
    if not q:
        return {"items": []}

    def fetch():
        data = _api_get(f"/channels/{channel_id}/search?q={quote(q)}")
        # This endpoint returns a bare list of mixed results.
        items = _normalize_list(data)
        # A flaky instance can answer HTTP 200 with an empty list. Caching that
        # would pin a false "no results" for the whole TTL (see channel_videos).
        # If the raw response was empty too, treat it as a miss and raise so the
        # next search re-fetches instead of serving the empty hole. A genuinely
        # empty search (raw list had non-video results) is still cached.
        if not items and not data:
            raise RuntimeError("empty channel search result")
        return items

    items, stale = cache.cached(
        f"yt:inv:chsearch:{channel_id}:{q.lower()}", config.TTL_YT_RSS, fetch
    )
    return {"items": items, "stale": stale}


_QUALITY_ORDER = {"1080p": 4, "720p": 3, "480p": 2, "360p": 1, "240p": 0, "144p": -1}


def video_streams(video_id):
    """Resolve directly-playable muxed (audio+video) stream URLs for a video.

    Returns mp4 `formatStreams` whose URLs point straight at YouTube's CDN
    (googlevideo) — *not* the instance proxy. The proxied (`local=true`) variant
    is dead on the instances that still serve metadata, but the direct URLs play
    fine from the browser (googlevideo answers with `ipbypass=yes` despite the
    instance's IP being baked in) and stream from Google's CDN, so playback is
    fast and supports range requests for seeking. Only muxed formats work in a
    bare <video> element — adaptive formats would need MSE/DASH wiring.

    The URLs carry an `expire` (~6h), so we cache the resolved set only briefly.
    Raises if no instance yields a muxed stream.
    """
    def fetch():
        last_err = None
        for base in _instances():
            try:
                resp = httpc.get(f"{base}/api/v1/videos/{video_id}", timeout=15, anonymous=True)
                data = resp.json()
                if isinstance(data, dict) and data.get("error"):
                    raise ValueError(data["error"])
            except (requests.RequestException, ValueError) as e:
                last_err = e
                continue
            streams = []
            for f in data.get("formatStreams") or []:
                url = f.get("url")
                mime = f.get("type") or ""
                # Only muxed mp4 plays in a plain <video>; skip webm/audio-only.
                if not url or "video/mp4" not in mime:
                    continue
                label = f.get("qualityLabel") or f.get("quality") or ""
                streams.append({
                    "url": url,
                    "quality": label,
                    "itag": f.get("itag"),
                    "kind": "mp4",
                    "type": mime.split(";")[0].strip(),
                })
            if streams:
                streams.sort(key=lambda s: _QUALITY_ORDER.get(s["quality"], -2), reverse=True)
                return {
                    "video_id": video_id,
                    "title": data.get("title", ""),
                    "duration": data.get("lengthSeconds"),
                    "streams": streams,
                }
        raise RuntimeError(f"No playable stream for {video_id} ({last_err})")

    payload, _ = cache.cached(f"yt:inv:streams:{video_id}", 1800, fetch)
    return payload


def _normalize_playlist_meta(p):
    plid = p.get("playlistId")
    if not plid:
        return None
    thumb = p.get("playlistThumbnail")
    vids = p.get("videos") or []
    if not thumb and vids:
        vid = vids[0].get("videoId")
        if vid:
            thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    return {
        "playlist_id": plid,
        "title": p.get("title", ""),
        "video_count": p.get("videoCount"),
        "thumbnail": thumb,
        "author": p.get("author", ""),
    }


def channel_playlists(channel_id):
    def fetch():
        data = _api_get(f"/channels/{channel_id}/playlists")
        out = []
        for p in data.get("playlists", []):
            meta = _normalize_playlist_meta(p)
            if meta:
                out.append(meta)
        return out

    items, stale = cache.cached(
        f"yt:inv:chpls:{channel_id}", config.TTL_YT_RSS, fetch
    )
    return {"items": items, "stale": stale}


def playlist(plid):
    """A playlist's videos via Invidious. May return [] items on instances whose
    'companion' can't fetch playlist contents — callers should RSS-fall-back."""
    def fetch():
        data = _api_get(f"/playlists/{plid}")
        return {
            "title": data.get("title", ""),
            "author": data.get("author", ""),
            "video_count": data.get("videoCount"),
            "items": _normalize_list(data.get("videos")),
        }

    payload, _ = cache.cached(f"yt:inv:pl:{plid}", config.TTL_YT_RSS, fetch)
    return payload


def _norm_comment(c, depth):
    """One Invidious comment → the CommentThread shape. A comment that has replies
    carries reply_count + reply_token (a continuation) so the UI can lazily expand
    its nested thread via comment_replies()."""
    replies = c.get("replies") or {}
    return {
        "id": c.get("commentId") or c.get("id") or "",
        "author": c.get("author", ""),
        "author_thumb": (c.get("authorThumbnails") or [{}])[-1].get("url"),
        "body_html": c.get("contentHtml") or "",
        "score": c.get("likeCount"),
        "created_at": _parse_published(c.get("published")),
        "is_pinned": bool(c.get("isPinned")),
        "depth": depth,
        "children": [],
        "reply_count": replies.get("replyCount") or 0,
        "reply_token": replies.get("continuation"),
    }


def comments(video_id):
    """Top-level comments for a video, normalized to the CommentThread shape.
    Nested replies load on demand: each comment with replies carries a reply_count
    and a reply_token the panel expands via comment_replies()."""
    def fetch():
        data = _api_get(f"/comments/{video_id}?sort_by=top")
        out = [_norm_comment(c, 0) for c in (data.get("comments") or [])]
        for i, c in enumerate(out):
            if not c["id"]:
                c["id"] = f"c{i}"
        return {"comments": out, "disabled": False}

    payload, _ = cache.cached(f"yt:inv:comments:{video_id}", config.TTL_HN_COMMENTS, fetch)
    return payload


def comment_replies(video_id, continuation, depth=1):
    """One page of replies beneath a comment (or a deeper reply), via that node's
    continuation token. Returns {comments, continuation}; `continuation` is the
    token for the next page of replies at this level (None when exhausted). Reply
    nodes that themselves have replies carry their own reply_token for deeper
    nesting."""
    def fetch():
        data = _api_get(f"/comments/{video_id}?continuation={quote(continuation, safe='')}")
        out = [_norm_comment(c, depth) for c in (data.get("comments") or [])]
        for i, c in enumerate(out):
            if not c["id"]:
                c["id"] = f"r{depth}-{i}"
        return {"comments": out, "continuation": data.get("continuation")}

    key = "yt:inv:replies:" + hashlib.sha1(f"{video_id}:{continuation}".encode()).hexdigest()[:16]
    payload, _ = cache.cached(key, config.TTL_HN_COMMENTS, fetch)
    return payload


def channel_live_upcoming(channel_id):
    """Candidate live/scheduled streams for one channel (its Streams tab).

    Best-effort: returns [] on any failure so one dead channel/instance never
    breaks the whole 'Live & Upcoming' rail.

    IMPORTANT: Invidious' own `isUpcoming` flag is unreliable — for some channels
    it marks *every* past stream as upcoming (with premiereTimestamp 0). So we do
    NOT trust it: a finished stream always has a real `lengthSeconds`, while a
    live or genuinely-upcoming one has none yet. We gate on that, then let yt-dlp
    confirm the true status + scheduled time downstream (see
    youtube.get_live_and_upcoming). Each item carries a *provisional*
    extra.live_status and extra.scheduled_at."""
    def fetch():
        out = []
        try:
            data = _api_get(f"/channels/{channel_id}/streams")
        except Exception:
            return out
        for v in data.get("videos") or []:
            if isinstance(v, dict) and v.get("type") not in (None, "video"):
                continue
            live = bool(v.get("liveNow"))
            length = v.get("lengthSeconds") or 0
            # Finished stream → has a duration → not a candidate.
            if not live and length:
                continue
            n = _normalize(v)
            if not n:
                continue
            n["extra"]["live_status"] = "is_live" if live else "is_upcoming"
            n["extra"]["scheduled_at"] = v.get("premiereTimestamp") or 0
            out.append(n)
        return out

    try:
        items, _ = cache.cached(f"yt:inv:live:{channel_id}", 180, fetch)
        return items
    except Exception:
        return []


def random_pool(region="US", limit=40):
    """Combined, shuffled trending+popular — the raw 'random videos' pool.

    Best-effort: if one source's instances are down we still return the other.
    """
    pool = {}
    for getter in (lambda: trending(region), popular):
        try:
            for item in getter()["items"]:
                pool[item["id"]] = item
        except Exception:
            continue
    items = list(pool.values())
    random.shuffle(items)
    return {"items": items[:limit]}
