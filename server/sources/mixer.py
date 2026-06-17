"""Deterministic weighted round-robin interleaving for the For You feed."""


def mix(feeds, weights):
    buckets = {k: list(v) for k, v in feeds.items() if v}
    for items in buckets.values():
        items.sort(key=lambda i: i.get("published_at") or 0, reverse=True)

    out = []
    while buckets:
        for platform in list(buckets):
            take = max(1, int(weights.get(platform, 1)))
            bucket = buckets.get(platform)
            for _ in range(take):
                if bucket:
                    out.append(bucket.pop(0))
            if not bucket:
                del buckets[platform]
    return out
