"""The Edition's editorial core: canonical-URL hard-linking, greedy centroid
clustering, salience scoring, and page layout.

Pure functions, no I/O, numpy imported lazily — deliberately the most testable
code in the repo. Vectors arriving here are already unit-normalized, so cosine
similarity is a plain dot product.
"""

import math
import time
from urllib.parse import parse_qsl, urlencode, urlparse

# Tunables (see docs/edition-plan.md §3.3). Threshold itself lives in config.
W_DIVERSITY = 0.8       # each extra platform in a cluster multiplies interest
AFFINITY_BOOST = 1.25   # story touches a source you follow / have watched
DECAY_HOURS = 18.0      # e-folding time of a story's freshness
MAX_COLUMNS = 5
MAX_BRIEFS = 14
MAX_SEMANTIC_MERGE = 8  # a cluster this big stops attracting *semantic* joins —
                        # guards against centroid drift toward "mean tech news"
                        # (hard URL links are evidence and stay unlimited)


# ---- canonical URLs: the hard-link pass (works with zero ML) ----

_TRACKING_PARAMS = {"ref", "ref_src", "si", "feature", "fbclid", "gclid", "igshid", "s", "t"}
_YT_HOSTS = {"youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"}


def canonical_url(url):
    """Normalize a URL for identity comparison: drop scheme/www/fragment,
    strip tracking params, trim trailing slash. '' for empty input."""
    if not url:
        return ""
    try:
        p = urlparse(url.strip())
    except ValueError:
        return url.strip().lower()
    host = (p.hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    keep = [
        (k, v)
        for k, v in parse_qsl(p.query, keep_blank_values=True)
        if not k.lower().startswith("utm_") and k.lower() not in _TRACKING_PARAMS
    ]
    query = f"?{urlencode(keep)}" if keep else ""
    return f"{host}{p.path.rstrip('/')}{query}"


def youtube_id(url):
    """Video id from any YouTube URL shape, or None."""
    if not url:
        return None
    try:
        p = urlparse(url.strip())
    except ValueError:
        return None
    host = (p.hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    if host == "youtu.be":
        vid = p.path.lstrip("/").split("/")[0]
        return vid or None
    if host in _YT_HOSTS:
        params = dict(parse_qsl(p.query))
        if params.get("v"):
            return params["v"]
        parts = [s for s in p.path.split("/") if s]
        if len(parts) >= 2 and parts[0] in ("shorts", "live", "embed"):
            return parts[1]
    return None


def canonical_key(item):
    """The identity under which items hard-merge into one story. A Reddit
    link-post to a video, the video itself, and an HN story pointing at the
    same page all share a key; self-posts fall back to their own item id."""
    iid = item.get("id") or ""
    if iid.startswith("yt:"):
        return iid

    extra = item.get("extra") or {}
    platform = item.get("platform")
    if platform == "reddit":
        target = extra.get("link_url") or ""
    elif platform == "hackernews":
        url = item.get("url") or ""
        target = "" if "news.ycombinator.com" in url else url
    else:
        target = item.get("url") or ""

    vid = youtube_id(target)
    if vid:
        return f"yt:{vid}"
    cu = canonical_url(target)
    return f"url:{cu}" if cu else f"item:{iid}"


# ---- clustering ----

def _unpack_matrix(items, vectors):
    """(kept-items, (n,d) float32 matrix) for items that have a vector; the
    rest are returned separately. `vectors` maps item_id -> bytes | ndarray."""
    import numpy as np

    with_vec, arrs, without = [], [], []
    for it in items:
        v = vectors.get(it.get("id")) if vectors else None
        if v is None:
            without.append(it)
            continue
        arr = np.frombuffer(v, dtype="float32") if isinstance(v, (bytes, bytearray)) else np.asarray(v, dtype="float32")
        with_vec.append(it)
        arrs.append(arr)
    if not arrs:
        return [], None, without
    return with_vec, np.vstack(arrs), without


def cluster(items, vectors=None, threshold=0.62):
    """Group feed items into stories. Two passes:
      1. hard-link merge by canonical_key (always runs — no ML needed);
      2. if vectors are given, greedy agglomerative merge of the seed groups
         against running unit centroids (one dot product per candidate).
    Returns [{"items": [...]}] — nothing else leaks out of this module."""
    seeds = {}
    order = []
    for it in items:
        key = canonical_key(it)
        if key not in seeds:
            seeds[key] = []
            order.append(key)
        seeds[key].append(it)

    groups = [seeds[k] for k in order]
    if not vectors:
        return [{"items": g} for g in groups]

    import numpy as np

    # Newest-first so the freshest telling of a story anchors its cluster.
    groups.sort(key=lambda g: max((i.get("published_at") or 0) for i in g), reverse=True)

    clusters = []       # [{"items": [...]}]
    centroids = []      # unit vectors, parallel to `clusters`
    counts = []         # member-with-vector counts, for incremental means

    for g in groups:
        kept, mat, _ = _unpack_matrix(g, vectors)
        if mat is None:
            clusters.append({"items": g})
            centroids.append(None)
            counts.append(0)
            continue
        gvec = mat.mean(axis=0)
        norm = float(np.linalg.norm(gvec)) or 1.0
        gvec = gvec / norm

        best, best_sim = -1, threshold
        for ci, cv in enumerate(centroids):
            if cv is None or len(clusters[ci]["items"]) >= MAX_SEMANTIC_MERGE:
                continue
            sim = float(cv.dot(gvec))
            if sim >= best_sim:
                best, best_sim = ci, sim

        if best >= 0:
            clusters[best]["items"].extend(g)
            n = counts[best]
            merged = centroids[best] * n + gvec * len(kept)
            norm = float(np.linalg.norm(merged)) or 1.0
            centroids[best] = merged / norm
            counts[best] = n + len(kept)
        else:
            clusters.append({"items": g})
            centroids.append(gvec)
            counts.append(len(kept))

    return [{"items": c["items"]} for c in clusters]


# ---- salience: what makes it an editor ----

def salience(cluster_items, subs_ids=(), history_source_ids=(), now=None):
    """How much this story deserves the front page. Cross-platform diversity
    dominates; engagement is log-damped; freshness decays; sources you follow
    get a nudge."""
    now = now or time.time()
    platforms = {i.get("platform") for i in cluster_items if i.get("platform")}
    engagement = sum(
        (i.get("score") or 0) + 0.5 * (i.get("comments_count") or 0)
        for i in cluster_items
    )
    newest = max((i.get("published_at") or 0) for i in cluster_items)
    age_h = max(0.0, (now - newest) / 3600.0) if newest else DECAY_HOURS * 2

    followed = set(subs_ids) | set(history_source_ids)
    affinity = False
    for i in cluster_items:
        extra = i.get("extra") or {}
        candidates = {extra.get("channel_id"), extra.get("subreddit"), i.get("source")}
        if followed & {c for c in candidates if c}:
            affinity = True
            break

    diversity = 1.0 + W_DIVERSITY * (len(platforms) - 1)
    interest = 1.0 + math.log1p(engagement)
    freshness = math.exp(-age_h / DECAY_HOURS)
    return diversity * interest * freshness * (AFFINITY_BOOST if affinity else 1.0)


# ---- layout: lede / columns / briefs ----

def layout(scored):
    """`scored` = [{"salience": float, "items": [...]}] sorted best-first.
    The lede must carry a thumbnail (it anchors the page visually); everything
    past the briefs is left out — editing is also what you omit."""
    lede = None
    rest = []
    for c in scored:
        if lede is None and any(i.get("thumbnail") for i in c["items"]):
            lede = c
        else:
            rest.append(c)
    if lede is None and rest:
        lede = rest.pop(0)
    return {
        "lede": lede,
        "columns": rest[:MAX_COLUMNS],
        "briefs": rest[MAX_COLUMNS:MAX_COLUMNS + MAX_BRIEFS],
    }
