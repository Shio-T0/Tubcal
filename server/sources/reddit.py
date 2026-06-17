"""Reddit source.

Reddit blocks unauthenticated access to its JSON API (403), but the Atom/RSS
feeds still work with a browser User-Agent. So:

- No-auth mode: listings + comments via RSS. No scores/comment counts,
  comments come back flat (no tree) — the UI degrades gracefully.
- OAuth mode (Settings → Connections): everything upgrades automatically to
  oauth.reddit.com JSON — scores, comment trees, icons, higher rate limits.
"""

import html as htmllib
import re
from urllib.parse import quote

import feedparser

from .. import cache, config, httpc

BASE = "https://www.reddit.com"
OAUTH_BASE = "https://oauth.reddit.com"
SUB_NAME_RE = re.compile(r"[a-z0-9][a-z0-9_]{1,20}", re.IGNORECASE)
POST_ID_RE = re.compile(r"/comments/([a-z0-9]+)")
TAG_RE = re.compile(r"<[^>]+>")


def _token_or_none():
    try:
        from ..api.oauth import get_valid_token
        return get_valid_token("reddit")
    except Exception:
        return None


def _clean_name(raw):
    name = raw.strip().lstrip("/")
    for prefix in ("https://", "http://", "www.", "old.", "reddit.com/"):
        if name.startswith(prefix):
            name = name[len(prefix):]
    name = name.strip("/").removeprefix("r/").split("/")[0].strip()
    if not SUB_NAME_RE.fullmatch(name):
        raise LookupError(f"'{raw}' doesn't look like a subreddit name")
    return name.lower()


def validate_subreddit(raw):
    name = _clean_name(raw)
    token = _token_or_none()
    if token:
        resp = httpc.get(
            f"{OAUTH_BASE}/r/{name}/about?raw_json=1",
            ua=config.REDDIT_UA,
            headers={"Authorization": f"Bearer {token}"},
        )
        data = resp.json().get("data") or {}
        display = data.get("display_name")
        if not display:
            raise LookupError(f"Subreddit r/{name} not found")
        icon = data.get("community_icon") or data.get("icon_img") or None
        if icon:
            icon = icon.split("?")[0]
        return {"name": display.lower(), "title": f"r/{display}", "icon": icon or None}

    try:
        rss = httpc.get(f"{BASE}/r/{name}/.rss?limit=3").text
    except Exception:
        raise LookupError(f"Subreddit r/{name} not found (or Reddit rate-limited us — try again in a minute)")
    parsed = feedparser.parse(rss)
    if parsed.get("bozo") and not parsed.entries and not parsed.feed.get("title"):
        raise LookupError(f"Subreddit r/{name} not found")
    return {"name": name, "title": f"r/{name}", "icon": None}


# ---- RSS (no-auth) helpers ----

_SC_BODY_RE = re.compile(r"<!--\s*SC_OFF\s*-->(.*?)<!--\s*SC_ON\s*-->", re.DOTALL)
_LINK_RE = re.compile(r'href="([^"]+)"\s*>\s*\[link\]')
_IMG_RE = re.compile(r'<img src="([^"]+)"')


def _entry_body_html(content_html):
    m = _SC_BODY_RE.search(content_html or "")
    return m.group(1).strip() if m else ""


def _text_preview(body_html, limit=280):
    text = htmllib.unescape(TAG_RE.sub(" ", body_html or ""))
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _normalize_rss_entry(e):
    permalink_url = e.get("link") or ""
    pm = POST_ID_RE.search(permalink_url)
    if not pm:
        return None
    post_id = pm.group(1)
    sub = ""
    tags = e.get("tags") or []
    if tags:
        sub = tags[0].get("term") or ""
    author = (e.get("author") or "").lstrip("/")
    content_html = ""
    if e.get("content"):
        content_html = e["content"][0].get("value") or ""
    body_html = _entry_body_html(content_html)

    thumb = None
    media = e.get("media_thumbnail") or []
    if media:
        thumb = media[0].get("url")
    if not thumb:
        im = _IMG_RE.search(content_html)
        if im:
            thumb = htmllib.unescape(im.group(1))

    link_url = None
    lm = _LINK_RE.search(content_html)
    if lm:
        link_url = htmllib.unescape(lm.group(1))
    is_self = not link_url or permalink_url.rstrip("/") in link_url

    published = 0
    if e.get("published_parsed") or e.get("updated_parsed"):
        import calendar
        published = int(calendar.timegm(e.get("published_parsed") or e["updated_parsed"]))

    permalink = permalink_url.removeprefix("https://www.reddit.com")
    return {
        "id": f"rd:{post_id}",
        "platform": "reddit",
        "title": e.get("title", ""),
        "url": permalink_url,
        "thumbnail": thumb,
        "author": author if author.startswith("u/") else (f"u/{author}" if author else "u/[deleted]"),
        "source": f"r/{sub}" if sub else "reddit",
        "published_at": published,
        "score": None,
        "comments_count": None,
        "extra": {
            "subreddit": sub,
            "post_id": post_id,
            "permalink": permalink,
            "selftext_preview": _text_preview(body_html) if is_self else "",
            "is_self": is_self,
            "post_hint": None,
            "preview_url": thumb,
            "link_url": None if is_self else link_url,
        },
    }


# ---- JSON (OAuth) helpers ----

def normalize_post(d):
    preview_url = None
    try:
        preview_url = d["preview"]["images"][0]["source"]["url"]
    except (KeyError, IndexError, TypeError):
        pass
    thumb = preview_url
    if not thumb and str(d.get("thumbnail", "")).startswith("http"):
        thumb = d["thumbnail"]
    selftext = (d.get("selftext") or "").strip()
    return {
        "id": f"rd:{d['id']}",
        "platform": "reddit",
        "title": d.get("title", ""),
        "url": "https://www.reddit.com" + (d.get("permalink") or ""),
        "thumbnail": thumb,
        "author": f"u/{d.get('author') or '[deleted]'}",
        "source": f"r/{d.get('subreddit', '')}",
        "published_at": int(d.get("created_utc") or 0),
        "score": d.get("score"),
        "comments_count": d.get("num_comments"),
        "extra": {
            "subreddit": d.get("subreddit"),
            "post_id": d["id"],
            "permalink": d.get("permalink"),
            "selftext_preview": selftext[:280],
            "is_self": bool(d.get("is_self")),
            "post_hint": d.get("post_hint"),
            "preview_url": preview_url,
            "link_url": None if d.get("is_self") else d.get("url"),
        },
    }


def _norm_json_comment(child, depth):
    if child.get("kind") != "t1":
        return None
    d = child["data"]
    children = []
    replies = d.get("replies")
    if isinstance(replies, dict):
        for ch in (replies.get("data") or {}).get("children") or []:
            c = _norm_json_comment(ch, depth + 1)
            if c:
                children.append(c)
    return {
        "id": d["id"],
        "author": d.get("author") or "[deleted]",
        "body_html": d.get("body_html") or "",
        "score": d.get("score"),
        "depth": depth,
        "created_at": int(d.get("created_utc") or 0),
        "children": children,
    }


# ---- public API ----

def get_feed(sub_names, sort="hot"):
    subs = "+".join(sorted(sub_names))
    token = _token_or_none()

    if token:
        key = f"reddit:listing:auth:{subs}:{sort}"

        def fetch():
            url = f"{OAUTH_BASE}/r/{subs}/{sort}?limit=50&raw_json=1"
            return httpc.get(url, ua=config.REDDIT_UA,
                             headers={"Authorization": f"Bearer {token}"}).json()

        data, stale = cache.cached(key, config.TTL_REDDIT_LISTING, fetch)
        children = (data.get("data") or {}).get("children") or []
        items = [normalize_post(c["data"]) for c in children if c.get("kind") == "t3"]
        return {"items": items, "stale": stale, "limited": False}

    key = f"reddit:listing:rss:{subs}:{sort}"
    sort_path = "" if sort == "hot" else f"{sort}/"
    suffix = "&t=week" if sort == "top" else ""

    def fetch():
        url = f"{BASE}/r/{subs}/{sort_path}.rss?limit=50{suffix}"
        return httpc.get(url).text

    rss, stale = cache.cached(key, config.TTL_REDDIT_LISTING, fetch)
    parsed = feedparser.parse(rss)
    items = [n for n in (_normalize_rss_entry(e) for e in parsed.entries) if n]
    return {"items": items, "stale": stale, "limited": True}


def search(query, sub=None):
    token = _token_or_none()
    qkey = query.lower().strip()

    if token:
        key = f"reddit:search:auth:{sub or 'all'}:{qkey}"

        def fetch():
            if sub:
                url = f"{OAUTH_BASE}/r/{sub}/search?q={quote(query)}&restrict_sr=on&limit=30&raw_json=1"
            else:
                url = f"{OAUTH_BASE}/search?q={quote(query)}&limit=30&raw_json=1"
            return httpc.get(url, ua=config.REDDIT_UA,
                             headers={"Authorization": f"Bearer {token}"}).json()

        data, stale = cache.cached(key, 300, fetch)
        children = (data.get("data") or {}).get("children") or []
        items = [normalize_post(c["data"]) for c in children if c.get("kind") == "t3"]
        return {"items": items, "stale": stale, "limited": False}

    key = f"reddit:search:rss:{sub or 'all'}:{qkey}"

    def fetch():
        if sub:
            url = f"{BASE}/r/{sub}/search.rss?q={quote(query)}&restrict_sr=on&limit=30"
        else:
            url = f"{BASE}/search.rss?q={quote(query)}&limit=30"
        return httpc.get(url).text

    rss, stale = cache.cached(key, 300, fetch)
    parsed = feedparser.parse(rss)
    items = [n for n in (_normalize_rss_entry(e) for e in parsed.entries) if n]
    return {"items": items, "stale": stale, "limited": True}


def get_post(sub, post_id):
    token = _token_or_none()

    if token:
        key = f"reddit:post:auth:{sub}:{post_id}"

        def fetch():
            url = f"{OAUTH_BASE}/r/{sub}/comments/{post_id}?raw_json=1&limit=80&depth=8"
            return httpc.get(url, ua=config.REDDIT_UA,
                             headers={"Authorization": f"Bearer {token}"}).json()

        data, stale = cache.cached(key, config.TTL_REDDIT_COMMENTS, fetch)
        post_data = data[0]["data"]["children"][0]["data"]
        comments = []
        for child in data[1]["data"]["children"]:
            c = _norm_json_comment(child, 0)
            if c:
                comments.append(c)
        return {
            "post": normalize_post(post_data),
            "selftext_html": post_data.get("selftext_html") or "",
            "comments": comments,
            "stale": stale,
            "limited": False,
        }

    key = f"reddit:post:rss:{sub}:{post_id}"

    def fetch():
        url = f"{BASE}/r/{sub}/comments/{post_id}/.rss?limit=80"
        return httpc.get(url).text

    rss, stale = cache.cached(key, config.TTL_REDDIT_COMMENTS, fetch)
    parsed = feedparser.parse(rss)

    post = None
    selftext_html = ""
    comments = []
    for e in parsed.entries:
        link = e.get("link") or ""
        content_html = e["content"][0].get("value") if e.get("content") else ""
        body_html = _entry_body_html(content_html)
        # Comment links have an extra id segment after the post slug.
        cm = re.search(rf"/comments/{post_id}/[^/]+/([a-z0-9]+)", link)
        if cm:
            import calendar
            created = 0
            if e.get("updated_parsed"):
                created = int(calendar.timegm(e["updated_parsed"]))
            comments.append({
                "id": cm.group(1),
                "author": (e.get("author") or "/u/[deleted]").lstrip("/").removeprefix("u/"),
                "body_html": body_html,
                "score": None,
                "depth": 0,
                "created_at": created,
                "children": [],
            })
        elif post is None:
            post = _normalize_rss_entry(e)
            selftext_html = body_html

    return {
        "post": post,
        "selftext_html": selftext_html,
        "comments": comments,
        "stale": stale,
        "limited": True,
    }


def get_account_feed(token, limit=50):
    """Authenticated home feed."""
    key = "reddit:account:home"

    def fetch():
        url = f"{OAUTH_BASE}/best?limit={limit}&raw_json=1"
        return httpc.get(url, ua=config.REDDIT_UA,
                         headers={"Authorization": f"Bearer {token}"}).json()

    data, stale = cache.cached(key, config.TTL_REDDIT_LISTING, fetch)
    children = (data.get("data") or {}).get("children") or []
    items = [normalize_post(c["data"]) for c in children if c.get("kind") == "t3"]
    return {"items": items, "stale": stale, "limited": False}
