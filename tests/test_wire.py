"""The Wire (Hacker News): which lists exist and how a search is asked for."""

from urllib.parse import parse_qs, urlparse

from server.sources import hackernews


def test_every_front_page_list_maps_to_firebase():
    assert hackernews.LISTS["ask"] == "askstories"
    assert set(hackernews.LISTS) == {"top", "best", "new", "ask", "show", "job"}


def test_search_url_relevance_by_default():
    u = urlparse(hackernews.search_url("rust async"))
    assert u.path.endswith("/search")
    q = parse_qs(u.query)
    assert q["query"] == ["rust async"] and q["tags"] == ["story"]
    assert "numericFilters" not in q


def test_search_url_newest_within_a_week():
    u = urlparse(hackernews.search_url("zig", sort="date", range_="week", now=1_000_000))
    assert u.path.endswith("/search_by_date")
    assert parse_qs(u.query)["numericFilters"] == [f"created_at_i>{1_000_000 - 7 * 86400}"]


def test_feed_rejects_an_unknown_list(client):
    assert client.get("/api/feed/hackernews?list=hot").status_code == 400


def test_search_passes_sort_and_range(client, monkeypatch):
    seen = {}

    def fake(q, sort, range_):
        seen.update(q=q, sort=sort, range_=range_)
        return {"items": [], "stale": False}

    monkeypatch.setattr(hackernews, "search", fake)
    assert client.get("/api/hackernews/search?q=llm&sort=date&range=day").status_code == 200
    assert seen == {"q": "llm", "sort": "date", "range_": "day"}
