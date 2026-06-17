import calendar
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

import feedparser
import requests

from .. import cache, config, httpc

RSS_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={}"
PLAYLIST_RSS_URL = "https://www.youtube.com/feeds/videos.xml?playlist_id={}"
CHANNEL_ID_RE = re.compile(r"UC[A-Za-z0-9_-]{22}")

# Order matters: the page embeds "channelId" for *related* channels too, so the
# canonical/og:url links (which always point at this channel) come first.
_EXTRACT_PATTERNS = (
    r'rel="canonical" href="https://www\.youtube\.com/channel/(UC[A-Za-z0-9_-]{22})"',
    r'property="og:url" content="https://www\.youtube\.com/channel/(UC[A-Za-z0-9_-]{22})"',
    r'"externalId":"(UC[A-Za-z0-9_-]{22})"',
    r'"channelId":"(UC[A-Za-z0-9_-]{22})"',
)

# Bypass the EU consent interstitial (302 → consent.youtube.com) — SOCS=CAI is
# the "reject all" cookie; without it channel pages never render.
_CONSENT_COOKIE = "SOCS=CAI; CONSENT=YES+"


def _handle_from_input(raw):
    handle = raw.strip().lstrip("/")
    for prefix in ("https://", "http://", "www.", "m.", "youtube.com/"):
        if handle.startswith(prefix):
            handle = handle[len(prefix):]
    handle = handle.strip("/").lstrip("@")
    handle = handle.split("/")[0].split("?")[0]
    return handle


def resolve_channel(raw):
    """Resolve a handle, channel URL, or raw UC... id to {channel_id, title, thumbnail}."""
    raw = raw.strip()
    channel_id = None
    thumbnail = None

    if CHANNEL_ID_RE.fullmatch(raw):
        channel_id = raw
    else:
        m = re.search(r"/channel/(UC[A-Za-z0-9_-]{22})", raw)
        if m:
            channel_id = m.group(1)

    if channel_id is None:
        handle = _handle_from_input(raw)
        if not handle:
            raise LookupError("Could not parse that channel input")
        url = f"https://www.youtube.com/@{quote(handle)}"
        try:
            html = httpc.get(url, headers={
                "Accept-Language": "en-US,en;q=0.9",
                "Cookie": _CONSENT_COOKIE,
            }).text
        except requests.HTTPError:
            raise LookupError(f"Channel @{handle} not found on YouTube")
        for pattern in _EXTRACT_PATTERNS:
            m = re.search(pattern, html)
            if m:
                channel_id = m.group(1)
                break
        if channel_id is None:
            raise LookupError(f"Could not extract a channel id for @{handle}")
        tm = re.search(r'property="og:image" content="([^"]+)"', html)
        if tm:
            thumbnail = tm.group(1)

    # Validate against the RSS feed — its title is the canonical channel name.
    try:
        rss = httpc.get(RSS_URL.format(channel_id)).text
    except requests.HTTPError:
        raise LookupError(f"Channel {channel_id} has no public video feed")
    parsed = feedparser.parse(rss)
    title = parsed.feed.get("title") or channel_id
    return {"channel_id": channel_id, "title": title, "thumbnail": thumbnail}


def _channel_items(channel_id):
    def fetch():
        rss = httpc.get(RSS_URL.format(channel_id)).text
        parsed = feedparser.parse(rss)
        channel_title = parsed.feed.get("title", "")
        items = []
        for e in parsed.entries:
            video_id = getattr(e, "yt_videoid", None)
            if not video_id:
                continue
            published = 0
            if getattr(e, "published_parsed", None):
                published = int(calendar.timegm(e.published_parsed))
            items.append({
                "id": f"yt:{video_id}",
                "platform": "youtube",
                "title": e.get("title", ""),
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                "author": channel_title,
                "source": channel_title,
                "published_at": published,
                "score": None,
                "comments_count": None,
                "extra": {
                    "video_id": video_id,
                    "channel_id": channel_id,
                    "description": (e.get("summary") or "")[:300],
                },
            })
        return items

    try:
        payload, _ = cache.cached(f"yt:rss:{channel_id}", config.TTL_YT_RSS, fetch)
        return payload
    except Exception:
        return []


def get_feed(channel_ids):
    if not channel_ids:
        return {"items": [], "stale": False}
    with ThreadPoolExecutor(max_workers=6) as ex:
        lists = list(ex.map(_channel_items, channel_ids))
    items = [item for lst in lists for item in lst]
    items.sort(key=lambda i: i["published_at"], reverse=True)
    return {"items": items[:120], "stale": False}


def get_channel_feed(channel_id):
    """Latest items for a single channel (RSS, ~15 newest)."""
    return {"items": _channel_items(channel_id), "stale": False}


def get_channel_videos(channel_id, sort="newest", continuation=None):
    """All of a channel's videos with a user-chosen sort, paginated. Invidious is
    the only key-free source for this; RSS (newest ~15) is the fallback."""
    from . import invidious

    try:
        result = invidious.channel_videos(channel_id, sort, continuation)
        if result["items"] or continuation:
            return result
    except Exception:
        pass
    # Fallback: RSS gives only the newest handful and no real sort.
    items = _channel_items(channel_id)
    if sort == "oldest":
        items = list(reversed(items))
    return {"items": items, "continuation": None, "stale": True}


def get_channel_playlists(channel_id):
    from . import invidious

    try:
        return invidious.channel_playlists(channel_id)
    except Exception:
        return {"items": [], "stale": False}


def search_channel(channel_id, query):
    """Search a channel's entire catalogue (Invidious). Falls back to filtering
    the RSS window if Invidious is unavailable."""
    from . import invidious

    try:
        result = invidious.channel_search(channel_id, query)
        if result["items"]:
            return result
    except Exception:
        pass
    q = (query or "").strip().lower()
    items = [i for i in _channel_items(channel_id) if q in i["title"].lower()]
    return {"items": items, "stale": True}


def _playlist_items_rss(plid):
    rss = httpc.get(PLAYLIST_RSS_URL.format(plid)).text
    parsed = feedparser.parse(rss)
    title = parsed.feed.get("title", "")
    items = []
    for e in parsed.entries:
        video_id = getattr(e, "yt_videoid", None)
        if not video_id:
            continue
        published = 0
        if getattr(e, "published_parsed", None):
            published = int(calendar.timegm(e.published_parsed))
        author = ""
        if getattr(e, "author", None):
            author = e.author
        items.append({
            "id": f"yt:{video_id}",
            "platform": "youtube",
            "title": e.get("title", ""),
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "author": author,
            "source": author,
            "published_at": published,
            "score": None,
            "comments_count": None,
            "extra": {"video_id": video_id, "channel_id": None, "description": ""},
        })
    return title, items


def get_playlist(plid):
    """A playlist's videos. Prefer Invidious (full list); fall back to playlist
    RSS (newest ~15) when the instance's companion can't serve playlist contents."""
    from . import invidious

    title, author, count = "", "", None
    try:
        pl = invidious.playlist(plid)
        title, author, count = pl.get("title", ""), pl.get("author", ""), pl.get("video_count")
        if pl.get("items"):
            return {"title": title, "author": author, "video_count": count,
                    "items": pl["items"], "stale": False}
    except Exception:
        pass

    def fetch():
        rss_title, items = _playlist_items_rss(plid)
        return {"title": rss_title, "items": items}

    payload, stale = cache.cached(f"yt:plrss:{plid}", config.TTL_YT_RSS, fetch)
    return {
        "title": title or payload["title"],
        "author": author,
        "video_count": count,
        "items": payload["items"],
        "stale": stale,
    }


def get_discover(sub_channel_ids, history_rows, limit=40, region="US"):
    """Private 'picked for you' recommender, ranked by what you've actually watched.

    Primary signal: for your most-recently-watched videos we pull YouTube's own
    'up next' recommendations (via Invidious) and aggregate them — a video that
    several of your watches point at, or that a heavily-rewatched one points at,
    ranks highest. Filled out with fresh unwatched videos from your subscribed/
    watched channels ('orbit'), and finally a little random trending so a brand-
    new install with no history still has something to show.
    """
    from . import invidious

    weights = {}
    watched_ids = set()
    seeds = []  # (video_id, watch_count) — most recent first (history_rows order)
    for row in history_rows:
        watched_ids.add(row["item_id"])
        if row.get("source_id"):
            weights[row["source_id"]] = weights.get(row["source_id"], 0) + row.get("watch_count", 1)
        iid = row["item_id"]
        if iid.startswith("yt:"):
            seeds.append((iid[3:], row.get("watch_count", 1)))

    # 1. History-based recommendations from Invidious (the real "algorithm").
    recommended_items = []
    if seeds:
        try:
            recommended_items = invidious.recommendations(
                seeds[:8], exclude_ids=watched_ids, limit=limit
            )
        except Exception:
            recommended_items = []

    # 2. Orbit: unwatched videos from channels you follow / have watched.
    channel_ids = sorted(set(sub_channel_ids) | set(weights))
    now = time.time()
    orbit_items = []
    if channel_ids:
        feed = get_feed(channel_ids)
        orbit_items = [i for i in feed["items"] if i["id"] not in watched_ids]

        def score(item):
            w = 1.0 + 2.0 * weights.get(item["extra"]["channel_id"], 0)
            age_days = max(0.0, (now - (item["published_at"] or 0)) / 86400)
            recency = 1.0 / (1.0 + age_days / 14)
            return w * recency * random.uniform(0.35, 1.0)

        orbit_items.sort(key=score, reverse=True)

    # 3. Random trending — cold-start / variety fill only.
    try:
        random_items = invidious.random_pool(region, limit=limit)["items"]
    except Exception:
        random_items = []

    # Blend: recommendations lead, then orbit, then random fills any remainder.
    out, seen = [], set(watched_ids)

    def take(pool, n):
        nonlocal out
        for item in pool:
            if n <= 0 or len(out) >= limit:
                break
            if item["id"] in seen:
                continue
            seen.add(item["id"])
            out.append(item)
            n -= 1

    if recommended_items:
        take(recommended_items, max(1, int(limit * 0.6)))
        take(orbit_items, max(1, int(limit * 0.3)))
    else:
        # No history yet: orbit-first, otherwise it's all discovery.
        take(orbit_items, limit if sub_channel_ids else int(limit * 0.4))
    take(random_items, limit)          # fill the rest
    take(recommended_items, limit)     # top up if pools were thin
    take(orbit_items, limit)

    return {"items": out}


def get_account_channel_ids(token):
    """Channel ids of the authenticated user's YouTube subscriptions (Phase 6)."""
    def fetch():
        ids = []
        page_token = ""
        for _ in range(4):  # up to 200 subscriptions
            url = (
                "https://www.googleapis.com/youtube/v3/subscriptions"
                f"?part=snippet&mine=true&maxResults=50&pageToken={page_token}"
            )
            data = httpc.get(url, headers={"Authorization": f"Bearer {token}"}).json()
            for item in data.get("items", []):
                cid = item["snippet"]["resourceId"].get("channelId")
                if cid:
                    ids.append(cid)
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return ids

    ids, _ = cache.cached("yt:account:subs", config.TTL_YT_ACCOUNT_SUBS, fetch)
    return ids
