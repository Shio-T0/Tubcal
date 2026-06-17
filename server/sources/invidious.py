"""Invidious integration — the escape hatch RSS can't give us.

YouTube's RSS feeds only expose videos from channels you already know the id of,
so the app could never surface anything *outside* your orbit. Invidious is an
open YouTube front-end with a public JSON API (no key) that exposes trending,
popular, and search — which is exactly what powers the "random video" feature.

Public instances go up and down constantly, so we keep a fallback list, try them
in order, and cache whichever one answered last so we don't re-probe every call.
"""

import random
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

def _discovered_instances():
    """Extra https candidates from the official directory, cached ~6h.

    The directory's own `api` flag is unreliable (many advertise it but 403),
    so we just harvest hostnames as additional fallbacks to probe — best-effort,
    never fatal.
    """
    def fetch():
        data = httpc.get("https://api.invidious.io/instances.json", timeout=12).json()
        out = []
        for name, info in data:
            if info.get("type") == "https":
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


def _api_get(path):
    """GET an Invidious /api/v1 path, trying instances in order until one works.

    We deliberately DON'T cache a 'winning' instance: the live instances are
    complementary — darkness.services serves channels/videos/playlists/search/
    trending and pagination but 404s single-video lookups, while melmac serves
    single-video (recommendations) but 500s on channel pagination. Pinning either
    one as the global favourite breaks the other family of endpoints, so we just
    always try the default order (which puts the most capable instance first).
    """
    last_err = None
    for base in _instances():
        url = f"{base}/api/v1{path}"
        try:
            resp = httpc.get(url, timeout=12)
            data = resp.json()
            # Invidious answers HTTP 200 with {"error": ...} when its backend
            # ("companion") can't serve an endpoint — treat that as a miss so we
            # fall through to an instance that actually works for this path.
            if isinstance(data, dict) and data.get("error"):
                raise ValueError(data["error"])
            return data
        except (requests.RequestException, ValueError) as e:
            last_err = e
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


def search(query):
    q = (query or "").strip()
    if not q:
        return {"items": []}

    def fetch():
        return _normalize_list(_api_get(f"/search?q={quote(q)}&type=video"))

    items, stale = cache.cached(f"yt:inv:search:{q.lower()}", config.TTL_YT_RSS, fetch)
    return {"items": items, "stale": stale}


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

    with ThreadPoolExecutor(max_workers=6) as ex:
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
        return _normalize_list(data)

    items, stale = cache.cached(
        f"yt:inv:chsearch:{channel_id}:{q.lower()}", config.TTL_YT_RSS, fetch
    )
    return {"items": items, "stale": stale}


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
