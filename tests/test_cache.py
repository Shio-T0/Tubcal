"""cache.invalidate: a prefix is a literal prefix, not a LIKE pattern."""

from collections import OrderedDict

from server import cache


def test_invalidate_treats_underscore_literally(client, monkeypatch):
    monkeypatch.setattr(cache, "_mem", OrderedDict())
    for key in ("yt:info:ab_cd", "yt:info:abXcd", "yt:info:ab_cdef"):
        cache.cached(key, 60, lambda: {"k": 1})
    assert cache.invalidate("yt:info:ab_cd") == 2
    assert cache.peek("yt:info:abXcd") == {"k": 1}
    assert cache.peek("yt:info:ab_cd") is None


def test_invalidate_percent_is_literal(client, monkeypatch):
    monkeypatch.setattr(cache, "_mem", OrderedDict())
    cache.cached("q:100%", 60, lambda: 1)
    cache.cached("q:1000", 60, lambda: 2)
    assert cache.invalidate("q:100%") == 1
    assert cache.peek("q:1000") == 2


def test_cached_serves_stale_when_the_fetch_fails(client, monkeypatch):
    monkeypatch.setattr(cache, "_mem", OrderedDict())
    assert cache.cached("s:k", 0, lambda: "old") == ("old", False)

    def boom():
        raise RuntimeError("upstream down")

    assert cache.cached("s:k", 0, boom) == ("old", True)


def test_memory_layer_is_bounded_and_evicts_the_least_recent(client, monkeypatch):
    monkeypatch.setattr(cache, "_mem", OrderedDict())
    monkeypatch.setattr(cache.config, "CACHE_MEM_MAX", 3)
    for k in ("a", "b", "c"):
        cache.cached(f"lru:{k}", 60, lambda k=k: k)
    cache.peek("lru:a")                      # a is now the most recent
    cache.cached("lru:d", 60, lambda: "d")   # so b goes
    assert list(cache._mem) == ["lru:c", "lru:a", "lru:d"]
    # evicted from memory, not from the cache: SQLite still answers
    assert cache.cached("lru:b", 60, lambda: "refetched") == ("b", False)


def test_housekeeping_comes_due_by_wall_clock():
    from server import housekeeping

    assert not housekeeping.due(1000, 1000 + 3600, every=86400)
    assert housekeeping.due(1000, 1000 + 86400, every=86400)
    # a laptop that slept through the night: a monotonic sleep would miss this
    assert housekeeping.due(1000, 1000 + 3 * 86400, every=86400)


def test_cached_many_reads_and_writes_in_batches(client, monkeypatch):
    monkeypatch.setattr(cache, "_mem", OrderedDict())
    monkeypatch.setattr(cache, "_BATCH", 3)  # several IN (...) queries
    keys = [f"many:{i}" for i in range(8)]
    calls = []

    def fetch(missing):
        calls.append(list(missing))
        return {k: {"n": k} for k in missing if k != "many:5"}  # one comes back empty

    got = cache.cached_many(keys + ["many:0"], 60, fetch)  # a repeat is harmless
    assert calls == [keys + ["many:0"]] and "many:5" not in got and got["many:7"] == {"n": "many:7"}

    cache._mem.clear()  # cold: everything from SQLite, in batches
    connects = []
    real = cache.db.connect
    monkeypatch.setattr(cache.db, "connect", lambda: connects.append(1) or real())
    again = cache.cached_many(keys, 60, lambda missing: {k: {"n": "refetched"} for k in missing})
    assert again["many:3"] == {"n": "many:3"} and again["many:5"] == {"n": "refetched"}
    assert len(connects) == 2  # one read pass + one write for the single miss
    assert cache.peek_many(["many:1", "nope"]) == {"many:1": {"n": "many:1"}}
