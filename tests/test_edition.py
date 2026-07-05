"""The Edition — tests for the pure editorial core (no network, no LLM)."""

import time

import pytest

from server.brain import cluster


def _item(iid, platform="hackernews", url=None, extra=None, score=None,
          comments=None, published=None, thumbnail=None, source=None):
    return {
        "id": iid,
        "platform": platform,
        "title": f"Title {iid}",
        "url": url or f"https://example.com/{iid}",
        "thumbnail": thumbnail,
        "source": source or platform,
        "published_at": published if published is not None else int(time.time()),
        "score": score,
        "comments_count": comments,
        "extra": extra or {},
    }


# ---- canonical URLs ----

def test_canonical_url_strips_tracking_and_www():
    a = cluster.canonical_url("https://www.example.com/story/?utm_source=x&utm_medium=y")
    b = cluster.canonical_url("http://example.com/story")
    assert a == b == "example.com/story"


def test_canonical_url_keeps_meaningful_params():
    assert "id=42" in cluster.canonical_url("https://example.com/item?id=42&ref=rss")
    assert "ref" not in cluster.canonical_url("https://example.com/item?id=42&ref=rss")


def test_canonical_url_drops_fragment_and_trailing_slash():
    assert cluster.canonical_url("https://a.io/x/#section") == "a.io/x"


def test_youtube_id_shapes():
    for url in (
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/live/dQw4w9WgXcQ",
    ):
        assert cluster.youtube_id(url) == "dQw4w9WgXcQ", url
    assert cluster.youtube_id("https://example.com/watch?v=nope") is None
    assert cluster.youtube_id("") is None


# ---- hard-link merging (zero-ML path) ----

def test_cross_platform_hard_merge():
    """A YT video + a Reddit link-post to it + an HN story about the same page
    collapse into one story with no vectors at all."""
    yt = _item("yt:abc123", platform="youtube", thumbnail="t.jpg")
    rd = _item("rd:x1", platform="reddit",
               extra={"link_url": "https://youtu.be/abc123?si=track"})
    hn = _item("hn:1", url="https://blog.example.com/launch/")
    hn2 = _item("hn:2", url="https://www.blog.example.com/launch?utm_source=hn")

    out = cluster.cluster([yt, rd, hn, hn2])
    assert len(out) == 2
    sizes = sorted(len(c["items"]) for c in out)
    assert sizes == [2, 2]


def test_self_posts_stay_separate():
    a = _item("rd:a", platform="reddit", extra={"link_url": None})
    b = _item("rd:b", platform="reddit", extra={"link_url": None})
    ask = _item("hn:3", url="https://news.ycombinator.com/item?id=3")
    out = cluster.cluster([a, b, ask])
    assert len(out) == 3


# ---- vector clustering ----

np = pytest.importorskip("numpy")


def _unit(*xs):
    v = np.asarray(xs, dtype="float32")
    return v / np.linalg.norm(v)


def test_vector_merge_above_threshold():
    a = _item("hn:10", published=1000)
    b = _item("rd:11", platform="reddit", published=900)
    c = _item("hn:12", published=800)
    vectors = {
        "hn:10": _unit(1, 0.05, 0).tobytes(),
        "rd:11": _unit(1, 0.0, 0.05).tobytes(),   # ~same direction as hn:10
        "hn:12": _unit(0, 1, 0).tobytes(),        # orthogonal
    }
    out = cluster.cluster([a, b, c], vectors, threshold=0.62)
    assert len(out) == 2
    big = max(out, key=lambda cl: len(cl["items"]))
    assert {i["id"] for i in big["items"]} == {"hn:10", "rd:11"}


def test_vector_below_threshold_stays_apart():
    a = _item("hn:20")
    b = _item("hn:21")
    vectors = {"hn:20": _unit(1, 0, 0).tobytes(), "hn:21": _unit(0.5, 0.87, 0).tobytes()}
    out = cluster.cluster([a, b], vectors, threshold=0.9)
    assert len(out) == 2


def test_semantic_merge_cap_prevents_blob_clusters():
    """Even with identical vectors, no cluster grows past MAX_SEMANTIC_MERGE —
    the guard against centroid drift swallowing the whole feed (a real bug:
    the first live build blobbed 40 items into the lede)."""
    n = cluster.MAX_SEMANTIC_MERGE * 3
    items = [_item(f"hn:{i}", published=1000 - i) for i in range(n)]
    v = _unit(1, 0, 0).tobytes()
    vectors = {i["id"]: v for i in items}
    out = cluster.cluster(items, vectors, threshold=0.5)
    assert max(len(c["items"]) for c in out) <= cluster.MAX_SEMANTIC_MERGE
    assert sum(len(c["items"]) for c in out) == n


def test_hard_links_ignore_the_semantic_cap():
    """URL evidence always merges, even into a big cluster."""
    n = cluster.MAX_SEMANTIC_MERGE + 4
    items = [_item(f"rd:{i}", platform="reddit",
                   extra={"link_url": "https://example.com/one-story"},
                   published=1000 - i) for i in range(n)]
    out = cluster.cluster(items, vectors=None)
    assert len(out) == 1 and len(out[0]["items"]) == n


def test_item_without_vector_survives_as_own_cluster():
    a = _item("hn:30")
    b = _item("hn:31")
    out = cluster.cluster([a, b], {"hn:30": _unit(1, 0).tobytes()}, threshold=0.6)
    assert len(out) == 2


# ---- salience ----

def test_diversity_beats_single_platform_engagement():
    now = time.time()
    spread = [
        _item("hn:40", score=10, published=int(now)),
        _item("rd:41", platform="reddit", score=10, published=int(now)),
        _item("yt:42", platform="youtube", published=int(now)),
    ]
    loud = [_item(f"hn:5{i}", score=40, published=int(now)) for i in range(6)]
    assert cluster.salience(spread, now=now) > cluster.salience(loud, now=now) * 0.5
    # and with comparable engagement, diversity strictly wins
    quiet_spread = cluster.salience(spread, now=now)
    same_total_single = cluster.salience(
        [_item("hn:60", score=20, published=int(now))], now=now
    )
    assert quiet_spread > same_total_single


def test_recency_decay_orders_stories():
    now = time.time()
    fresh = [_item("hn:70", score=50, published=int(now - 600))]
    old = [_item("hn:71", score=50, published=int(now - 30 * 3600))]
    assert cluster.salience(fresh, now=now) > cluster.salience(old, now=now)


def test_affinity_boost_applies():
    now = time.time()
    items = [_item("yt:80", platform="youtube", published=int(now),
                   extra={"channel_id": "UC123"})]
    plain = cluster.salience(items, now=now)
    boosted = cluster.salience(items, subs_ids={"UC123"}, now=now)
    assert boosted == pytest.approx(plain * cluster.AFFINITY_BOOST)


# ---- layout ----

def test_layout_lede_needs_thumbnail_and_caps_hold():
    scored = [{"salience": 100 - i, "items": [_item(f"hn:9{i}")]} for i in range(25)]
    scored[2]["items"][0]["thumbnail"] = "t.jpg"  # only #3 has an image
    slots = cluster.layout(scored)
    assert slots["lede"]["items"][0]["id"] == "hn:92"
    assert len(slots["columns"]) == cluster.MAX_COLUMNS
    assert len(slots["briefs"]) == cluster.MAX_BRIEFS
    # the lede is not duplicated into the columns
    col_ids = {i["id"] for c in slots["columns"] for i in c["items"]}
    assert "hn:92" not in col_ids


def test_layout_no_thumbnails_still_has_lede():
    scored = [{"salience": 2, "items": [_item("hn:100")]},
              {"salience": 1, "items": [_item("hn:101")]}]
    slots = cluster.layout(scored)
    assert slots["lede"]["items"][0]["id"] == "hn:100"
    assert len(slots["columns"]) == 1


# ---- the synthesis validation gate (no LLM involved) ----

def test_validator_accepts_good_story():
    from server.brain import edition
    good = ('{"headline": "A launch lands well", "dek": "One line.", '
            '"body": "' + " ".join(["word"] * 60) + '", "cited": [1, 2]}')
    headline, dek, body, cited = edition._validate_synthesis(good, 3)
    assert headline and cited == [1, 2]


def test_validator_rejects_bad_stories():
    import json as _json

    from server.brain import edition
    body60 = " ".join(["word"] * 60)
    bad = [
        "not json at all",
        _json.dumps({"headline": "", "dek": "", "body": body60, "cited": [1]}),
        _json.dumps({"headline": "H", "dek": "", "body": "too short", "cited": [1]}),
        _json.dumps({"headline": "H", "dek": "", "body": body60, "cited": []}),
        _json.dumps({"headline": "H", "dek": "", "body": body60, "cited": [4]}),  # out of range
    ]
    for text in bad:
        with pytest.raises(Exception):
            edition._validate_synthesis(text, 3)


def test_template_story_stitches_and_marks_unsynthesized():
    from server.brain import edition
    items = [
        _item("hn:200", score=50),
        _item("rd:201", platform="reddit", score=10),
    ]
    items[0]["snippet"] = "First snippet."
    items[1]["snippet"] = "Second snippet."
    story = edition._template_story(items, 3.14159)
    assert story["headline"] == "Title hn:200"      # top engagement leads
    assert story["synthesized"] is False
    assert "First snippet." in story["body"]
    assert "the Wire" in story["dek"] and "the Dispatch" in story["dek"]
    assert "snippet" not in story["items"][0]        # scratch field stripped


# ---- API (throwaway DB via the client fixture) ----

def test_latest_404_before_first_build(client):
    r = client.get("/api/edition/latest")
    assert r.status_code == 404
    assert r.get_json()["error"] == "no edition yet"


def test_edition_roundtrip_and_archive_meta(client):
    from server import db
    payload = {"date": "2026-07-01", "issue": 1, "status": "wire", "model": None,
               "lede": None, "columns": [], "briefs": [], "sources": 5,
               "generated_at": 1, "build_ms": 12}
    db.edition_save("2026-07-01", "wire", None, 5, 12, payload)

    got = client.get("/api/edition/latest").get_json()["data"]
    assert got["date"] == "2026-07-01" and got["status"] == "wire"

    got = client.get("/api/edition/2026-07-01").get_json()["data"]
    assert got["issue"] == 1
    assert client.get("/api/edition/2026-07-02").status_code == 404
    assert client.get("/api/edition/not-a-date").status_code == 400

    metas = client.get("/api/edition/archive").get_json()["data"]["editions"]
    assert metas[0]["date"] == "2026-07-01"
    assert "payload" not in metas[0]  # archive never drags payloads


def test_rebuild_returns_immediately(client, monkeypatch):
    from server.brain import edition
    calls = []
    monkeypatch.setattr(edition, "build", lambda force=False: calls.append(1))
    r = client.post("/api/edition/rebuild")
    assert r.get_json()["data"]["building"] is True


def test_status_shape(client):
    data = client.get("/api/edition/status").get_json()["data"]
    assert data["building"] is False
    assert data["latest"] is None
    assert isinstance(data["hour"], int)


def test_feed_vectors_roundtrip(client):
    np = pytest.importorskip("numpy")
    from server import db
    v = np.asarray([1, 0, 0], dtype="float32").tobytes()
    db.feed_vectors_save([{"item_id": "hn:1", "platform": "hackernews",
                           "vector": v, "model": "m"}])
    assert db.feed_vectors_missing(["hn:1", "hn:2"], "m") == {"hn:2"}
    assert db.feed_vectors_missing(["hn:1"], "other-model") == {"hn:1"}
    got = db.feed_vectors_get(["hn:1"], "m")
    assert got["hn:1"] == v
