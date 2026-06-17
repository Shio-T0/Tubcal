from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote, urlparse

from .. import cache, config, httpc

FIREBASE = "https://hacker-news.firebaseio.com/v0"
ALGOLIA = "https://hn.algolia.com/api/v1"
PAGE_SIZE = 30


def _domain(url):
    if not url:
        return None
    host = urlparse(url).hostname or ""
    return host.removeprefix("www.") or None


def normalize(item):
    if not item or item.get("deleted") or item.get("dead"):
        return None
    hn_url = f"https://news.ycombinator.com/item?id={item['id']}"
    return {
        "id": f"hn:{item['id']}",
        "platform": "hackernews",
        "title": item.get("title", ""),
        "url": item.get("url") or hn_url,
        "thumbnail": None,
        "author": item.get("by"),
        "source": "Hacker News",
        "published_at": item.get("time"),
        "score": item.get("score"),
        "comments_count": item.get("descendants", 0),
        "extra": {"hn_id": item["id"], "domain": _domain(item.get("url")), "type": item.get("type")},
    }


def _fetch_item(hn_id):
    def fetch():
        return httpc.get(f"{FIREBASE}/item/{hn_id}.json").json()

    payload, _ = cache.cached(f"hn:item:{hn_id}", config.TTL_HN_ITEM, fetch)
    return payload


def get_feed(list_name="top", page=0):
    def fetch_ids():
        return httpc.get(f"{FIREBASE}/{list_name}stories.json").json()

    ids, stale = cache.cached(f"hn:list:{list_name}", config.TTL_HN_LIST, fetch_ids)
    start = page * PAGE_SIZE
    chunk = ids[start : start + PAGE_SIZE]
    with ThreadPoolExecutor(max_workers=12) as ex:
        raw = list(ex.map(_fetch_item, chunk))
    items = [n for n in (normalize(i) for i in raw) if n]
    return {"items": items, "has_more": start + PAGE_SIZE < len(ids), "stale": stale}


def search(query):
    def fetch():
        url = f"{ALGOLIA}/search?query={quote(query)}&tags=story&hitsPerPage=30"
        return httpc.get(url).json()

    data, stale = cache.cached(f"hn:search:{query.lower()}", 300, fetch)
    items = []
    for hit in data.get("hits", []):
        hn_id = hit.get("objectID")
        if not hn_id or not hit.get("title"):
            continue
        items.append({
            "id": f"hn:{hn_id}",
            "platform": "hackernews",
            "title": hit["title"],
            "url": hit.get("url") or f"https://news.ycombinator.com/item?id={hn_id}",
            "thumbnail": None,
            "author": hit.get("author"),
            "source": "Hacker News",
            "published_at": hit.get("created_at_i"),
            "score": hit.get("points"),
            "comments_count": hit.get("num_comments") or 0,
            "extra": {"hn_id": int(hn_id), "domain": _domain(hit.get("url")), "type": "story"},
        })
    return {"items": items, "stale": stale}


def _norm_comment(node, depth):
    if not node or node.get("type") not in (None, "comment"):
        return None
    children = []
    for ch in node.get("children", []):
        c = _norm_comment(ch, depth + 1)
        if c:
            children.append(c)
    if not node.get("text") and not children:
        return None
    return {
        "id": node["id"],
        "author": node.get("author") or "[deleted]",
        "body_html": node.get("text") or "",
        "score": node.get("points"),
        "depth": depth,
        "created_at": node.get("created_at_i"),
        "children": children,
    }


def get_item(hn_id):
    def fetch():
        return httpc.get(f"{ALGOLIA}/items/{hn_id}").json()

    data, stale = cache.cached(f"hn:thread:{hn_id}", config.TTL_HN_COMMENTS, fetch)

    comments = []
    for ch in data.get("children", []):
        c = _norm_comment(ch, 0)
        if c:
            comments.append(c)

    def count(nodes):
        return sum(1 + count(n["children"]) for n in nodes)

    story = {
        "id": f"hn:{data['id']}",
        "platform": "hackernews",
        "title": data.get("title", ""),
        "url": data.get("url") or f"https://news.ycombinator.com/item?id={data['id']}",
        "thumbnail": None,
        "author": data.get("author"),
        "source": "Hacker News",
        "published_at": data.get("created_at_i"),
        "score": data.get("points"),
        "comments_count": count(comments),
        "extra": {"hn_id": data["id"], "domain": _domain(data.get("url")), "type": "story"},
    }
    return {"story": story, "comments": comments, "stale": stale}
