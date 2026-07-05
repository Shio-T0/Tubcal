import calendar
import json
import random
import re
import shutil
import subprocess
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

# A full SOCS consent token (vs the bare SOCS=CAI) — empirically YouTube serves
# twice as many playlist continuation pages with it (200 vs 100 items) before it
# cuts off logged-out pagination. Used only for the yt-dlp playlist fetch.
_CONSENT_COOKIE_FULL = "SOCS=CAISNggQEitib3FfaWRlbnRpdHlmcm9udGVuZF8yMDI0MDEwOQ"


def _handle_from_input(raw):
    handle = raw.strip().lstrip("/")
    for prefix in ("https://", "http://", "www.", "m.", "youtube.com/"):
        if handle.startswith(prefix):
            handle = handle[len(prefix):]
    handle = handle.strip("/").lstrip("@")
    handle = handle.split("/")[0].split("?")[0]
    return handle


def fetch_channel_avatar(channel_id):
    """Scrape a channel's avatar (og:image) from its page. Key-free; returns
    None on any failure. Used when we resolve by raw channel id / URL, where the
    RSS feed carries no avatar — that's why those subs fell back to a letter."""
    try:
        html = httpc.get(
            f"https://www.youtube.com/channel/{channel_id}",
            headers={"Accept-Language": "en-US,en;q=0.9", "Cookie": _CONSENT_COOKIE},
        ).text
    except Exception:
        return None
    m = re.search(r'property="og:image" content="([^"]+)"', html)
    return m.group(1) if m else None


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
    # The id / URL path never scraped the page, so it had no avatar; also covers
    # the rare case the handle page didn't expose og:image.
    if not thumbnail:
        thumbnail = fetch_channel_avatar(channel_id)
    return {"channel_id": channel_id, "title": title, "thumbnail": thumbnail}


def channel_about(channel_id):
    """Channel name + avatar for a raw channel id, for the channel page header
    when the user isn't subscribed (a subscription row carries the thumbnail; a
    cold visit has none, which is why the avatar fell back to a letter). Cached;
    RSS gives the canonical title, og:image scrape gives the avatar."""
    def fetch():
        title = channel_id
        try:
            rss = httpc.get(RSS_URL.format(channel_id)).text
            title = feedparser.parse(rss).feed.get("title") or channel_id
        except Exception:
            pass
        return {
            "channel_id": channel_id,
            "title": title,
            "thumbnail": fetch_channel_avatar(channel_id),
        }

    payload, _ = cache.cached(f"yt:about:{channel_id}", config.TTL_YT_RSS, fetch)
    return payload


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


def _collect_streams(data, is_live):
    """Pick the muxed (audio+video) renditions playable in our player.

      - "mp4"  progressive https mp4 — a plain <video src> (only itag 18 / 360p);
      - "hls"  m3u8 renditions up to 1080p — needs hls.js + segment proxying.
    We keep progressive 360p as the floor and HLS only above it, so the quality
    list has no duplicate 360p and tops out at the best HLS rendition. For a live
    broadcast YouTube only exposes HLS, so we keep every muxed m3u8 rung.

    Multi-audio handling: when a video ships dubbed audio tracks, YouTube exposes
    one muxed rendition per language at every height (e.g. 96-0 … 96-22), tagging
    the creator's real track with format_note "(original)". Picking blindly would
    surface — and default to — a dubbed track, so on such videos we keep only the
    original-language renditions. (Progressive itag 18 always carries the original
    audio, so it's exempt.)
    """
    formats = data.get("formats", [])
    multi_audio = any(
        "original" in (f.get("format_note") or "").lower() for f in formats
    )
    streams = []
    for f in formats:
        if f.get("vcodec") in (None, "none") or f.get("acodec") in (None, "none"):
            continue
        if not f.get("url"):
            continue
        proto = f.get("protocol") or ""
        h = f.get("height") or 0
        note = (f.get("format_note") or "").lower()
        if proto.startswith("m3u8") and (h > 360 or is_live):
            if multi_audio and "original" not in note:
                continue  # a dubbed track — skip it, keep only the original
            kind = "hls"
        elif proto.startswith("http") and f.get("ext") == "mp4":
            kind = "mp4"
        else:
            continue
        streams.append({
            "url": f["url"],
            "quality": f"{h}p" if h else (f.get("format_note") or ""),
            "itag": str(f.get("format_id")),
            "kind": kind,
            "type": "video/mp4",
            "height": h,
        })
    streams.sort(key=lambda s: s["height"], reverse=True)
    for s in streams:
        s.pop("height", None)
    return streams


def _ytdlp_info(video_id):
    """Resolve everything about one video with a single yt-dlp call: playable
    muxed streams *and* the metadata the player panel needs (description, view
    count, live/upcoming status + scheduled start).

    Uses the *system* yt-dlp binary on purpose: it's updated via the package
    manager, which matters because YouTube extraction breaks often and a pinned
    dependency would rot. yt-dlp also descrambles YouTube's signature/`n`
    parameter, so its stream URLs actually serve (Invidious' raw URLs 403).
    """
    exe = shutil.which("yt-dlp")
    if not exe:
        raise RuntimeError("yt-dlp not installed")
    url = f"https://www.youtube.com/watch?v={video_id}"
    # --ignore-no-formats-error: a scheduled premiere/stream has no formats yet and
    # yt-dlp would otherwise abort ("Premieres in N hours") with no JSON — we still
    # want its metadata (live_status=is_upcoming + release_timestamp).
    proc = subprocess.run(
        [exe, "-J", "--no-warnings", "--no-playlist", "--ignore-no-formats-error", url],
        capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        raise RuntimeError(f"yt-dlp failed: {(proc.stderr or '').strip()[:200]}")
    data = json.loads(proc.stdout)

    # live_status ∈ {is_live, is_upcoming, was_live, post_live, not_live, None}
    live_status = data.get("live_status")
    is_live = live_status == "is_live"
    streams = _collect_streams(data, is_live)
    # A finished/normal video with no stream is a real failure; an upcoming one
    # legitimately has none yet, so don't treat that as an error.
    if not streams and live_status != "is_upcoming":
        raise RuntimeError("no playable muxed stream")
    return {
        "video_id": video_id,
        "title": data.get("title", ""),
        "description": data.get("description") or "",
        "author": data.get("uploader") or data.get("channel") or "",
        "channel_id": data.get("channel_id"),
        "duration": data.get("duration"),
        "view_count": data.get("view_count") or data.get("concurrent_view_count"),
        "like_count": data.get("like_count"),
        "live_status": live_status,
        "scheduled_at": data.get("release_timestamp"),
        "streams": streams,
    }


def video_info(video_id):
    """Full metadata + playable streams for one video.

    yt-dlp first (reliable), Invidious as a last resort. Cached since the
    googlevideo stream URLs carry a short-lived `expire`.

    The fetch returns (payload, ttl): a clean yt-dlp resolve is cached 30 min,
    but the Invidious fallback — whose raw URLs often 403 in the browser, showing
    up as an intermittent "unsupported format" — is cached only ~90 s so a
    transient yt-dlp hiccup can't lock in a broken stream for the full window."""
    from . import invidious

    def fetch():
        try:
            return _ytdlp_info(video_id), 1800
        except Exception:
            inv = invidious.video_streams(video_id)  # streams + title + duration
            return {
                "video_id": video_id,
                "title": inv.get("title", ""),
                "description": "",
                "author": "",
                "channel_id": None,
                "duration": inv.get("duration"),
                "view_count": None,
                "like_count": None,
                "live_status": None,
                "scheduled_at": None,
                "streams": inv.get("streams") or [],
                "degraded": True,
            }, 90

    return cache.cached_dynamic(f"yt:info:{video_id}", fetch)


def video_streams(video_id):
    """Playable stream URLs for one video (a slice of video_info)."""
    info = video_info(video_id)
    return {
        "video_id": info["video_id"],
        "title": info.get("title", ""),
        "duration": info.get("duration"),
        "streams": info.get("streams") or [],
    }


def video_comments(video_id):
    """Top-level comments for a video (Invidious). Best-effort: empty on failure."""
    from . import invidious

    try:
        return invidious.comments(video_id)
    except Exception:
        return {"comments": [], "disabled": False}


def video_comment_replies(video_id, continuation, depth=1):
    """Nested replies under a comment, via its continuation token. Best-effort."""
    from . import invidious

    try:
        return invidious.comment_replies(video_id, continuation, depth)
    except Exception:
        return {"comments": [], "continuation": None}


def _ytdlp_flat_tab(channel_id, tab, limit=12):
    """Video ids on one of a channel's tabs that have NO duration — i.e. live or
    upcoming (a finished video always carries a duration in the flat listing).
    Best-effort: [] on any failure."""
    exe = shutil.which("yt-dlp")
    if not exe:
        return []
    url = f"https://www.youtube.com/channel/{channel_id}{tab}"
    try:
        proc = subprocess.run(
            [exe, "-J", "--flat-playlist", "--no-warnings", "--playlist-end", str(limit), url],
            capture_output=True, text=True, timeout=60,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return []
        data = json.loads(proc.stdout)
    except Exception:
        return []
    return [
        e["id"]
        for e in (data.get("entries") or [])
        if e.get("id") and not e.get("duration")
    ]


def _channel_candidates(channel_id):
    """Candidate live/upcoming video ids for a channel: flat-playlist its Videos
    and Streams tabs (premieres land in Videos, scheduled streams in Streams),
    keeping the duration-less entries, plus anything Invidious flags. Cached."""
    from . import invidious

    def fetch():
        ids = set()
        for tab in ("/videos", "/streams"):
            ids.update(_ytdlp_flat_tab(channel_id, tab))
        try:
            for item in invidious.channel_live_upcoming(channel_id):
                ids.add(item["extra"]["video_id"])
        except Exception:
            pass
        return list(ids)

    try:
        ids, _ = cache.cached(f"yt:cand:{channel_id}", 300, fetch)
        return ids
    except Exception:
        return []


def _info_to_live_item(info):
    """A feed item built straight from yt-dlp video_info (no Invidious needed)."""
    vid = info["video_id"]
    author = info.get("author", "")
    return {
        "id": f"yt:{vid}",
        "platform": "youtube",
        "title": info.get("title", ""),
        "url": f"https://www.youtube.com/watch?v={vid}",
        "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        "author": author,
        "source": author,
        "published_at": 0,
        "score": info.get("view_count"),
        "comments_count": None,
        "extra": {
            "video_id": vid,
            "channel_id": info.get("channel_id"),
            "description": "",
            "live_status": info.get("live_status"),
            "scheduled_at": info.get("scheduled_at") or 0,
        },
    }


def get_live_and_upcoming(channel_ids):
    """Across the given channels, the streams that are live now or scheduled.

    Two stages: cheaply discover candidate video ids per channel (duration-less
    flat-playlist entries on the Videos/Streams tabs, plus Invidious), then yt-dlp
    authoritatively confirms each one's status + real scheduled start. Anything
    that turns out finished (was_live/post_live/not_live) is dropped. Live
    broadcasts first, then upcoming sorted by soonest start.
    """
    if not channel_ids:
        return {"items": [], "stale": False}
    with ThreadPoolExecutor(max_workers=6) as ex:
        cand_lists = list(ex.map(_channel_candidates, channel_ids))

    vids, seen = [], set()
    for lst in cand_lists:
        for v in lst:
            if v not in seen:
                seen.add(v)
                vids.append(v)
    vids = vids[:24]  # bound the number of yt-dlp confirm calls

    def confirm(vid):
        try:
            info = video_info(vid)
        except Exception:
            return None
        if info.get("live_status") not in ("is_live", "is_upcoming"):
            return None
        return _info_to_live_item(info)

    items = []
    if vids:
        with ThreadPoolExecutor(max_workers=4) as ex:
            for r in ex.map(confirm, vids):
                if r:
                    items.append(r)

    def sort_key(i):
        if i["extra"].get("live_status") == "is_live":
            return (0, 0)
        return (1, i["extra"].get("scheduled_at") or 9_000_000_000)

    items.sort(key=sort_key)
    return {"items": items, "stale": False}


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


def _video_author(video_id):
    """Resolve one video's uploader (name + channel id) via YouTube's key-free
    oEmbed endpoint. Flat-playlist entries carry no channel info at all, so a
    mixed playlist's cards would otherwise show no creator. Cached per video id
    (channels rarely rename), best-effort → {author, channel_id} with blanks on
    failure."""
    def fetch():
        url = (
            "https://www.youtube.com/oembed?format=json&url="
            + quote(f"https://www.youtube.com/watch?v={video_id}", safe="")
        )
        data = httpc.get(url).json()
        channel_id = None
        m = re.search(r"/channel/(UC[A-Za-z0-9_-]{22})", data.get("author_url") or "")
        if m:
            channel_id = m.group(1)
        return {"author": data.get("author_name") or "", "channel_id": channel_id}

    try:
        payload, _ = cache.cached(f"yt:oembed:{video_id}", config.TTL_YT_RSS, fetch)
        return payload
    except Exception:
        return {"author": "", "channel_id": None}


def _enrich_authors(items):
    """Fill in blank authors on a list of feed items (in place) via oEmbed,
    fetched in parallel. Items that already have an author are left untouched."""
    missing = [it for it in items if not it.get("author")]
    if not missing:
        return items
    with ThreadPoolExecutor(max_workers=8) as ex:
        metas = list(ex.map(lambda it: _video_author(it["extra"]["video_id"]), missing))
    for it, meta in zip(missing, metas):
        author = meta.get("author") or ""
        it["author"] = author
        it["source"] = author
        if meta.get("channel_id") and not it["extra"].get("channel_id"):
            it["extra"]["channel_id"] = meta["channel_id"]
    return items


def _flat_entry_to_item(e):
    """Normalize a yt-dlp --flat-playlist entry into our feed-item shape."""
    vid = e.get("id")
    author = e.get("channel") or e.get("uploader") or ""
    return {
        "id": f"yt:{vid}",
        "platform": "youtube",
        "title": e.get("title") or "",
        "url": f"https://www.youtube.com/watch?v={vid}",
        "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        "author": author,
        "source": author,
        "published_at": 0,  # flat playlist entries carry no publish date
        "score": e.get("view_count"),
        "comments_count": None,
        "extra": {
            "video_id": vid,
            "channel_id": e.get("channel_id"),
            "description": "",
            "length_seconds": e.get("duration"),
        },
    }


def _ytdlp_playlist(plid):
    """Full playlist contents via yt-dlp (flat = metadata only, fast).

    This is the only source that returns the *whole* playlist — Invidious'
    companion serves 0 videos and the playlist RSS only exposes the newest ~15.
    Logged-out YouTube caps continuation pages (~200 items), which the full
    consent token maximizes; we report the true total separately so the UI can
    say "showing N of M"."""
    exe = shutil.which("yt-dlp")
    if not exe:
        raise RuntimeError("yt-dlp not installed")
    url = f"https://www.youtube.com/playlist?list={plid}"
    proc = subprocess.run(
        [exe, "-J", "--flat-playlist", "--no-warnings",
         "--add-header", f"Cookie:{_CONSENT_COOKIE_FULL}", url],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp playlist failed: {(proc.stderr or '').strip()[:200]}")
    data = json.loads(proc.stdout)
    items = [_flat_entry_to_item(e) for e in (data.get("entries") or []) if e.get("id")]
    if not items:
        raise RuntimeError("yt-dlp returned no playlist entries")
    # Flat entries carry no uploader, so fill each card's creator via oEmbed.
    _enrich_authors(items)
    return {
        "title": data.get("title", ""),
        "author": data.get("uploader") or data.get("channel") or "",
        "video_count": data.get("playlist_count") or len(items),
        "items": items,
    }


def get_playlist(plid):
    """A playlist's videos. yt-dlp gives the full list (up to YouTube's logged-out
    cap); Invidious then playlist RSS (~15) are fallbacks if yt-dlp is unavailable."""
    def fetch():
        try:
            return _ytdlp_playlist(plid)
        except Exception:
            pass
        from . import invidious
        try:
            pl = invidious.playlist(plid)
            if pl.get("items"):
                return {"title": pl.get("title", ""), "author": pl.get("author", ""),
                        "video_count": pl.get("video_count"), "items": pl["items"]}
        except Exception:
            pass
        rss_title, items = _playlist_items_rss(plid)
        return {"title": rss_title, "author": "", "video_count": len(items), "items": items}

    payload, stale = cache.cached(f"yt:pl:{plid}", config.TTL_YT_RSS, fetch)
    return {**payload, "stale": stale}


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
