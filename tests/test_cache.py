"""cache.invalidate: a prefix is a literal prefix, not a LIKE pattern."""

from server import cache


def test_invalidate_treats_underscore_literally(client, monkeypatch):
    monkeypatch.setattr(cache, "_mem", {})
    for key in ("yt:info:ab_cd", "yt:info:abXcd", "yt:info:ab_cdef"):
        cache.cached(key, 60, lambda: {"k": 1})
    assert cache.invalidate("yt:info:ab_cd") == 2
    assert cache.peek("yt:info:abXcd") == {"k": 1}
    assert cache.peek("yt:info:ab_cd") is None


def test_invalidate_percent_is_literal(client, monkeypatch):
    monkeypatch.setattr(cache, "_mem", {})
    cache.cached("q:100%", 60, lambda: 1)
    cache.cached("q:1000", 60, lambda: 2)
    assert cache.invalidate("q:100%") == 1
    assert cache.peek("q:1000") == 2


def test_cached_serves_stale_when_the_fetch_fails(client, monkeypatch):
    monkeypatch.setattr(cache, "_mem", {})
    assert cache.cached("s:k", 0, lambda: "old") == ("old", False)

    def boom():
        raise RuntimeError("upstream down")

    assert cache.cached("s:k", 0, boom) == ("old", True)
