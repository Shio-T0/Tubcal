"""YouTube search: InnerTube parsing + the InnerTube→Invidious routing.

The network edge (`innertube._call`, `invidious.search`) is monkeypatched so
nothing here touches YouTube. What's worth pinning down is the routing: a real
no-results query must NOT fall through to Invidious (that fall-through was the
slow path that surfaced "All Invidious instances failed" for an ordinary miss),
while an unreadable response must.
"""

import pytest

from server import cache
from server.sources import innertube, invidious, youtube


def _video(video_id, title="A video", author="Someone", **kw):
    v = {
        "videoId": video_id,
        "title": {"runs": [{"text": title}]},
        "longBylineText": {
            "runs": [{
                "text": author,
                "navigationEndpoint": {"browseEndpoint": {"browseId": "UC" + "x" * 22}},
            }]
        },
        "publishedTimeText": {"simpleText": "3 days ago"},
        "lengthText": {"simpleText": "32:16"},
        "viewCountText": {"simpleText": "862,559 views"},
    }
    v.update(kw)
    return v


def _results_page(videos, token=None):
    """A minimally-shaped InnerTube search response."""
    contents = [{"videoRenderer": v} for v in videos]
    if token:
        contents.append({
            "continuationItemRenderer": {
                "continuationEndpoint": {"continuationCommand": {"token": token}}
            }
        })
    return {
        "contents": {
            "twoColumnSearchResultsRenderer": {
                "primaryContents": {
                    "sectionListRenderer": {
                        "contents": [{"itemSectionRenderer": {"contents": contents}}]
                    }
                }
            }
        }
    }


@pytest.fixture(autouse=True)
def _clean_cache(tmp_path, monkeypatch):
    from server import config, db

    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    db.init_db()
    cache.invalidate("yt:")
    yield
    cache.invalidate("yt:")


# ── parsing ──────────────────────────────────────────────────────────────────

def test_normalize_matches_shared_item_shape():
    item = innertube._normalize(_video("abc12345678"))
    assert item["id"] == "yt:abc12345678"
    assert item["platform"] == "youtube"
    assert item["title"] == "A video"
    assert item["author"] == "Someone"
    assert item["thumbnail"] == "https://i.ytimg.com/vi/abc12345678/hqdefault.jpg"
    assert item["extra"]["length_seconds"] == 32 * 60 + 16
    assert item["extra"]["view_count"] == 862559
    assert item["extra"]["channel_id"].startswith("UC")
    # Same keys the Invidious path produces — nothing downstream may tell them apart.
    assert set(item) == set(invidious._normalize({"videoId": "abc12345678"}))


def test_normalize_skips_item_without_video_id():
    assert innertube._normalize({"title": {"simpleText": "no id"}}) is None


@pytest.mark.parametrize("text,expected", [
    ("32:16", 32 * 60 + 16),
    ("1:02:03", 3723),
    ("59", 59),
    ("", None),
    ("LIVE", None),
])
def test_duration_parsing(text, expected):
    assert innertube._duration_secs(text) == expected


def test_live_item_has_no_fake_view_count():
    live = _video(
        "live1234567",
        viewCountText={"runs": [{"text": "3"}, {"text": " watching"}]},
        badges=[{"metadataBadgeRenderer": {"style": "BADGE_STYLE_TYPE_LIVE_NOW"}}],
    )
    live.pop("lengthText")
    item = innertube._normalize(live)
    assert item["extra"]["live_status"] == "is_live"
    assert item["extra"]["view_count"] is None
    assert item["extra"]["length_seconds"] is None


def test_published_is_relative_to_now():
    import time

    item = innertube._normalize(_video("abc12345678"))
    assert abs(item["published_at"] - (time.time() - 3 * 86400)) < 60
    # An unparseable/absent stamp is 0, not a crash.
    assert innertube._published_epoch("") == 0


def test_continuation_token_is_the_results_one():
    data = _results_page([_video("abc12345678")], token="TOKEN123")
    # A decoy token elsewhere in the tree (menus carry these) must not win.
    data["header"] = {"continuationCommand": {"token": "DECOY"}}
    assert innertube._next_token(data) == "TOKEN123"


# ── routing ──────────────────────────────────────────────────────────────────

def test_search_uses_innertube_and_paginates(monkeypatch):
    calls = []

    def fake_call(body):
        calls.append(body)
        if body.get("continuation"):
            return _results_page([_video("second00001")])
        return _results_page([_video("first000001")], token="TOKEN123")

    monkeypatch.setattr(innertube, "_call", fake_call)

    first = youtube.search("cats")
    assert [i["id"] for i in first["items"]] == ["yt:first000001"]
    assert first["has_more"] is True
    assert first["continuation"] == "TOKEN123"

    second = youtube.search("cats", page=2, continuation=first["continuation"])
    assert [i["id"] for i in second["items"]] == ["yt:second00001"]
    assert second["has_more"] is False
    assert calls[0]["query"] == "cats"
    assert calls[1]["continuation"] == "TOKEN123"


def test_empty_result_does_not_fall_back_to_invidious(monkeypatch):
    """The bug this guards: an ordinary no-match query walking every dead
    Invidious instance and reporting 'All Invidious instances failed'."""
    monkeypatch.setattr(innertube, "_call", lambda body: _results_page([]))

    def boom(*a, **kw):
        raise AssertionError("Invidious must not be consulted for a real miss")

    monkeypatch.setattr(invidious, "search", boom)

    result = youtube.search("zzzqqxk gibberish")
    assert result["items"] == []
    assert result["has_more"] is False


def test_unreadable_response_falls_back_to_invidious(monkeypatch):
    # No twoColumnSearchResultsRenderer → not a results page → fall back.
    monkeypatch.setattr(innertube, "_call", lambda body: {"error": {"code": 400}})
    monkeypatch.setattr(
        invidious, "search",
        lambda q, page=1: {"items": [{"id": "yt:inv00000001"}] * 20, "has_more": True},
    )
    result = youtube.search("cats")
    assert [i["id"] for i in result["items"]][:1] == ["yt:inv00000001"]
    assert result["has_more"] is True


def test_innertube_failure_falls_back_to_invidious(monkeypatch):
    def boom(body):
        raise RuntimeError("network down")

    monkeypatch.setattr(innertube, "_call", boom)
    monkeypatch.setattr(
        invidious, "search",
        lambda q, page=1: {"items": [{"id": "yt:inv00000001"}] * 20, "has_more": True},
    )
    assert youtube.search("cats")["items"][0]["id"] == "yt:inv00000001"


def test_blank_query_short_circuits(monkeypatch):
    monkeypatch.setattr(innertube, "_call", lambda body: pytest.fail("no request"))
    assert youtube.search("   ")["items"] == []


def test_endpoint_returns_items(client, monkeypatch):
    monkeypatch.setattr(
        innertube, "_call",
        lambda body: _results_page([_video("abc12345678")], token="TOKEN123"),
    )
    resp = client.get("/api/youtube/search?q=cats")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert body["data"]["items"][0]["id"] == "yt:abc12345678"
    assert body["data"]["continuation"] == "TOKEN123"


def test_search_carries_no_cookies(monkeypatch):
    """Search is an anonymous read. The shared httpc session's jar collects
    YouTube's visitor cookies from channel-page scrapes; sending those would let
    Google join queries to the rest of the app's traffic under one visitor id."""
    from server import httpc

    httpc.session.cookies.set("VISITOR_INFO1_LIVE", "abc123", domain=".youtube.com")
    httpc.session.cookies.set("YSC", "def456", domain=".youtube.com")

    captured = {}

    class FakeResp:
        request = None

        @staticmethod
        def raise_for_status():
            pass

        @staticmethod
        def json():
            return _results_page([_video("abc12345678")])

    def fake_post(url, headers=None, timeout=None, **kw):
        captured["session_used"] = "anon"
        captured["headers"] = headers or {}
        return FakeResp()

    # Only the cookie-blocking session may be used, and it must send no Cookie.
    monkeypatch.setattr(httpc.anon_session, "post", fake_post)
    monkeypatch.setattr(
        httpc.session, "post",
        lambda *a, **kw: pytest.fail("search must not use the cookie-bearing session"),
    )
    try:
        innertube.search("cats")
        assert captured["session_used"] == "anon"
        assert not any(k.lower() == "cookie" for k in captured["headers"])
        # And the jar's policy refuses both directions, so a Set-Cookie on the
        # response is never retained and never replayed on a later request.
        policy = httpc.anon_session.cookies.get_policy()
        assert policy.set_ok(None, None) is False
        assert policy.return_ok(None, None) is False
    finally:
        httpc.session.cookies.clear()


def test_directory_skips_unroutable_hosts(monkeypatch):
    monkeypatch.setattr(
        invidious.httpc, "get",
        lambda url, **kw: type("R", (), {
            "json": staticmethod(lambda: [
                ["inv.nadeko.ygg", {"type": "https"}],
                ["good.example.net", {"type": "https"}],
                ["onion.example.onion", {"type": "https"}],
                ["http.example.org", {"type": "http"}],
            ])
        })(),
    )
    assert invidious._discovered_instances() == ["https://good.example.net"]
