"""YouTube's own InnerTube API — search without a key and without a middleman.

Invidious was the only way the app could see *outside* your subscriptions, but
the public instances have collapsed: they now answer search with 401/403/429
almost everywhere (the whole "signal lost — All Invidious instances failed"
class of error), and even a healthy one costs a probe through several dead ones
first.

InnerTube is the JSON API youtube.com's own web player talks to. A single
unauthenticated POST with the WEB client context returns a full page of results
in well under a second — no API key, no third party, no rate-limit budget shared
with every other user of a public instance. That makes it both the fix and the
fast path; Invidious stays behind it as a fallback (see `youtube.search`).

Pagination is by continuation token rather than page number: each response
carries exactly one `continuationItemRenderer` holding the token for the next
slice.
"""

import hashlib
import re
import time

from .. import cache, config, httpc

_ENDPOINT = "https://www.youtube.com/youtubei/v1/search"

# The web client's own identity. InnerTube rejects a request with no client
# context; the version only has to be plausible, not current.
_CLIENT_NAME = "WEB"
_CLIENT_VERSION = "2.20240401.00.00"

# Base64 protobuf for "filter: type=video" — the same value the site sends when
# you tick the Video filter. Without it, results interleave channels, playlists
# and shelves we'd only throw away.
_PARAMS_VIDEO = "EgIQAQ=="


def _context():
    return {
        "client": {
            "clientName": _CLIENT_NAME,
            "clientVersion": _CLIENT_VERSION,
            "hl": "en",
            "gl": "US",
        }
    }


def _call(body):
    resp = httpc.post(
        _ENDPOINT,
        json=body,
        timeout=15,
        # Search is an anonymous read and must stay that way: the shared session's
        # jar picks up YouTube's visitor cookies from channel-page scrapes, and
        # sending those would let Google join your queries to everything else the
        # app fetches. No cookies out, none stored.
        anonymous=True,
        headers={
            "Content-Type": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": "https://www.youtube.com",
            "Referer": "https://www.youtube.com/",
            "X-Youtube-Client-Name": "1",
            "X-Youtube-Client-Version": _CLIENT_VERSION,
        },
    )
    return resp.json()


def _find_all(node, key, out):
    """Collect every value stored under `key` anywhere in the response tree.

    InnerTube nests results differently depending on which shelves YouTube
    decides to inject (ads, "people also watched", chips), so walking for the
    renderer by name is far more durable than following a fixed path.
    """
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key:
                out.append(v)
            else:
                _find_all(v, key, out)
    elif isinstance(node, list):
        for v in node:
            _find_all(v, key, out)
    return out


def _text(node):
    """InnerTube text comes as either {simpleText} or {runs:[{text}, …]}."""
    if not isinstance(node, dict):
        return ""
    if "simpleText" in node:
        return node["simpleText"] or ""
    return "".join(r.get("text", "") for r in node.get("runs") or [])


_REL_UNITS = {
    "second": 1,
    "minute": 60,
    "hour": 3600,
    "day": 86400,
    "week": 604800,
    "month": 2629800,     # average month
    "year": 31557600,     # average year
}
_REL_RE = re.compile(r"(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago")


def _published_epoch(text):
    """"3 days ago" / "Streamed 2 years ago" → approximate epoch seconds.

    InnerTube only ever gives a relative string here; the exact timestamp would
    cost a per-video request. Every consumer of `published_at` in the app sorts
    or renders it as "x ago", so the approximation is lossless in practice.
    """
    m = _REL_RE.search(text or "")
    if not m:
        return 0
    return int(time.time() - int(m.group(1)) * _REL_UNITS[m.group(2)])


def _duration_secs(text):
    """"32:16" / "1:02:03" → seconds. Live items have no length text."""
    parts = (text or "").strip().split(":")
    if not parts or not all(p.isdigit() for p in parts):
        return None
    secs = 0
    for p in parts:
        secs = secs * 60 + int(p)
    return secs


def _view_count(node):
    """"862,559 views" → 862559. Live items read "3 watching" — not a view
    count, so those come back as None rather than a misleading number."""
    text = _text(node)
    if not text or "watching" in text:
        return None
    digits = re.sub(r"[^\d]", "", text.split("view")[0])
    return int(digits) if digits else None


def _normalize(v):
    """One `videoRenderer` → the app's shared item shape (identical to the one
    `invidious._normalize` produces, so nothing downstream can tell them apart)."""
    video_id = v.get("videoId")
    if not video_id:
        return None

    byline = v.get("longBylineText") or v.get("ownerText") or {}
    channel_id = None
    for run in byline.get("runs") or []:
        browse = (run.get("navigationEndpoint") or {}).get("browseEndpoint") or {}
        if browse.get("browseId"):
            channel_id = browse["browseId"]
            break

    is_live = any(
        (b.get("metadataBadgeRenderer") or {}).get("style") == "BADGE_STYLE_TYPE_LIVE_NOW"
        for b in v.get("badges") or []
    )

    description = ""
    for snip in v.get("detailedMetadataSnippets") or []:
        description = _text(snip.get("snippetText"))
        if description:
            break

    author = _text(byline)
    views = _view_count(v.get("viewCountText"))
    item = {
        "id": f"yt:{video_id}",
        "platform": "youtube",
        "title": _text(v.get("title")),
        "url": f"https://www.youtube.com/watch?v={video_id}",
        # YouTube's own CDN, same as the Invidious path — never the search
        # response's signed thumbnail URLs, which expire.
        "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "author": author,
        "source": author,
        "published_at": _published_epoch(_text(v.get("publishedTimeText"))),
        "score": views,
        "comments_count": None,
        "extra": {
            "video_id": video_id,
            "channel_id": channel_id,
            "description": description[:300],
            "length_seconds": _duration_secs(_text(v.get("lengthText"))),
            "view_count": views,
        },
    }
    if is_live:
        item["extra"]["live_status"] = "is_live"
    return item


def _next_token(data):
    """The one continuation token that means "next page of results"."""
    for cir in _find_all(data, "continuationItemRenderer", []):
        token = (
            ((cir.get("continuationEndpoint") or {}).get("continuationCommand") or {})
            .get("token")
        )
        if token:
            return token
    return None


def _is_results_page(data, continuation):
    """Did YouTube actually hand us a search-results page?

    This is the difference between "your query has no matches" and "we got
    served something we can't read" (a consent wall, an experiment, an error
    envelope). Both produce zero videos, but only the second should fall back to
    Invidious — a real no-results query must not go on to grind through every
    dead public instance just to report the same emptiness slowly.
    """
    if continuation:
        # A continuation response is an append action; when results run out it
        # legitimately appends nothing.
        return bool(_find_all(data, "appendContinuationItemsAction", []))
    return bool(_find_all(data, "twoColumnSearchResultsRenderer", []))


def _fetch(query, continuation):
    if continuation:
        data = _call({"context": _context(), "continuation": continuation})
    else:
        data = _call({"context": _context(), "query": query, "params": _PARAMS_VIDEO})

    items = []
    for v in _find_all(data, "videoRenderer", []):
        n = _normalize(v)
        if n:
            items.append(n)
    if not items and not _is_results_page(data, continuation):
        raise RuntimeError("unreadable InnerTube search response")
    return {"items": items, "continuation": _next_token(data)}


def search(query, continuation=None):
    """One page of YouTube-wide video search.

    Returns `{items, continuation, has_more}`; pass the returned `continuation`
    back to get the next page. Raises on failure so callers can fall back.
    """
    q = (query or "").strip()
    if not q:
        return {"items": [], "continuation": None, "has_more": False}

    if continuation:
        key = "yt:it:search:cont:" + hashlib.sha1(continuation.encode()).hexdigest()[:16]
    else:
        key = f"yt:it:search:{q.lower()}"

    def fetch():
        payload = _fetch(q, continuation)
        # An empty page is cached only briefly: it's a real "no matches" as far
        # as we can tell, but not worth pinning for a quarter-hour if it wasn't.
        ttl = config.TTL_YT_SEARCH if payload["items"] else config.TTL_YT_SEARCH_EMPTY
        return payload, ttl

    payload = cache.cached_dynamic(key, fetch)
    return {
        "items": payload["items"],
        "continuation": payload.get("continuation"),
        "has_more": bool(payload.get("continuation")),
        "stale": False,
    }
