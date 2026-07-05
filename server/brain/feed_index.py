"""The Edition's feed indexer: harvest the items the rooms already fetch and
keep an embedding per item in feed_vectors.

Harvesting goes through the same source functions the rooms use — all TTL/SWR
cached, so when the rooms have been open recently this touches nothing but
SQLite, and when they haven't, the fetch primes the user's morning anyway.
Embedding is ONE batched Ollama call per build, for new items only.
"""

import time

from .. import config, db
from . import llm


def _snippet(item):
    extra = item.get("extra") or {}
    text = extra.get("selftext_preview") or extra.get("description") or ""
    return text[:config.EDITION_SNIPPET].strip()


def collect_items():
    """Normalized items from every followed source, deduped, windowed to
    EDITION_WINDOW_H, snippeted, newest-first, capped."""
    from ..sources import hackernews, reddit, youtube

    raw = []
    try:
        raw += hackernews.get_feed("top", 0)["items"]
    except Exception:
        pass

    yt_subs = db.list_subscriptions("youtube")
    if yt_subs:
        try:
            raw += youtube.get_feed([s["source_id"] for s in yt_subs])["items"]
        except Exception:
            pass

    rd_subs = db.list_subscriptions("reddit")
    if rd_subs:
        sort = db.get_setting("reddit_sort") or "hot"
        try:
            raw += reddit.get_feed([s["source_id"] for s in rd_subs], sort)["items"]
        except Exception:
            pass

    cutoff = time.time() - config.EDITION_WINDOW_H * 3600
    seen, items = set(), []
    for it in raw:
        iid = it.get("id")
        if not iid or iid in seen:
            continue
        if not it.get("published_at") or it["published_at"] < cutoff:
            continue
        seen.add(iid)
        it = dict(it)
        it["snippet"] = _snippet(it)
        items.append(it)

    items.sort(key=lambda i: i["published_at"], reverse=True)
    return items[:400]


def index_new(items, model):
    """Embed items that don't have a vector under `model` yet — one batched
    /api/embed call — normalize to unit length, and persist. Returns count."""
    import numpy as np

    missing = db.feed_vectors_missing([i["id"] for i in items], model)
    todo = [i for i in items if i["id"] in missing]
    if not todo:
        return 0

    texts = [f"search_document: {i.get('title') or ''}\n{i.get('snippet') or ''}"
             for i in todo]
    vecs = np.asarray(llm.embed(texts, model), dtype="float32")
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    vecs = vecs / norms

    rows = []
    for it, v in zip(todo, vecs):
        extra = it.get("extra") or {}
        rows.append({
            "item_id": it["id"],
            "platform": it.get("platform"),
            "title": it.get("title"),
            "snippet": it.get("snippet"),
            "url": it.get("url"),
            "source_id": extra.get("channel_id") or extra.get("subreddit"),
            "source_name": it.get("source"),
            "thumbnail": it.get("thumbnail"),
            "score": it.get("score"),
            "comments": it.get("comments_count"),
            "published_at": it.get("published_at"),
            "vector": v.tobytes(),
            "model": model,
        })
    db.feed_vectors_save(rows)
    return len(rows)


def vectors_for(items, model):
    """item_id -> raw unit-vector bytes for every item that has one."""
    return db.feed_vectors_get([i["id"] for i in items], model)
