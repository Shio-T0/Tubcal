"""Local fuzzy-match layer that sits on top of existing exact API search.

Uses rapidfuzz to score items against a query, filtering below a threshold and
returning the top matches. Designed to be called as a fallback when a platform's
own search returns few or no results — it runs against the most recently cached
feed items for that source, so a near-miss query still surfaces relevant results
without hitting the API again.
"""

try:
    from rapidfuzz import fuzz
except Exception:  # pragma: no cover - rapidfuzz is a native dep absent on some
    fuzz = None     # runtimes (e.g. the Android/Chaquopy build); fall back to no-op.


def fuzzy_filter(items, query, key="title", threshold=60, limit=30):
    """Score each item's `key` field against `query` using rapidfuzz's WRatio,
    filter below `threshold`, sort descending by score, return top `limit`.

    WRatio handles partial and out-of-order word matches well — for example
    "gpt5 launch" against "OpenAI Launches GPT-5" scores highly because it
    accounts for token sorting and partial alignment.

    Args:
        items: List of dicts (normalized feed items with {id, title, ...}).
        query: The user's search string.
        key: The field to match against (default 'title').
        threshold: Minimum score (0-100) to include a result.
        limit: Maximum number of results to return.

    Returns:
        List of (item, score) tuples sorted descending by score.
    """
    if not items or not query or fuzz is None:
        return []

    q = query.strip().lower()
    scored = []
    for item in items:
        text = str(item.get(key) or "")
        if not text:
            continue
        score = fuzz.WRatio(q, text.lower())
        if score >= threshold:
            scored.append((item, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:limit]