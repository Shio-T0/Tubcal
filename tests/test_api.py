"""Smoke tests for the local API contract (no network — sources are not hit)."""


def test_health(client):
    body = client.get("/api/health").get_json()
    assert body["ok"] is True
    assert body["data"]["status"] == "ok"


def test_progress_round_trip(client):
    r = client.post("/api/progress", json={"item_id": "yt:abc", "position": 42, "duration": 100})
    assert r.get_json()["ok"] is True
    prog = client.get("/api/progress").get_json()["data"]["progress"]
    assert prog["yt:abc"]["position"] == 42
    assert prog["yt:abc"]["duration"] == 100


def test_progress_requires_item_id(client):
    assert client.post("/api/progress", json={"position": 1}).status_code == 400


def test_saved_round_trip(client):
    item = {"id": "yt:vid", "platform": "youtube", "title": "Example"}
    assert client.post("/api/saved", json={"item": item}).get_json()["ok"] is True

    items = client.get("/api/saved").get_json()["data"]["items"]
    assert any(i["id"] == "yt:vid" for i in items)

    assert client.delete("/api/saved/yt:vid").get_json()["ok"] is True
    items = client.get("/api/saved").get_json()["data"]["items"]
    assert not any(i["id"] == "yt:vid" for i in items)


def test_continue_watching(client):
    client.post("/api/history", json={"item": {"id": "yt:half", "platform": "youtube", "title": "Half"}})
    client.post("/api/progress", json={"item_id": "yt:half", "position": 30, "duration": 100})
    items = client.get("/api/youtube/continue").get_json()["data"]["items"]
    assert any(i["id"] == "yt:half" for i in items)


def test_finished_video_not_in_continue(client):
    client.post("/api/history", json={"item": {"id": "yt:done", "platform": "youtube", "title": "Done"}})
    client.post("/api/progress", json={"item_id": "yt:done", "position": 99, "duration": 100})
    items = client.get("/api/youtube/continue").get_json()["data"]["items"]
    assert not any(i["id"] == "yt:done" for i in items)


def test_mark_watched_clears_continue(client):
    client.post("/api/history", json={"item": {"id": "yt:m", "platform": "youtube", "title": "M"}})
    client.post("/api/progress", json={"item_id": "yt:m", "position": 30, "duration": 100})
    client.post("/api/history/mark", json={"item": {"id": "yt:m", "platform": "youtube"}, "watched": True})
    items = client.get("/api/youtube/continue").get_json()["data"]["items"]
    assert not any(i["id"] == "yt:m" for i in items)


def test_search_requires_q(client):
    assert client.get("/api/search/all").status_code == 400


def test_settings_active_rooms_validation(client):
    """Settings validate active_rooms: can't exceed max, must be valid ids."""
    # Set max to 3 and try to set 4 rooms
    client.put("/api/settings", json={"max_active_rooms": 3})
    r = client.put("/api/settings", json={"active_rooms": ["youtube", "reddit", "hackernews", "frontpage"]})
    assert r.status_code == 400
    assert "exceeds" in r.get_json()["error"]

    # Unknown room id
    r = client.put("/api/settings", json={"active_rooms": ["youtube", "nonexistent"]})
    assert r.status_code == 400
    assert "unknown room id" in r.get_json()["error"]

    # Duplicates
    r = client.put("/api/settings", json={"active_rooms": ["youtube", "youtube"]})
    assert r.status_code == 400
    assert "duplicates" in r.get_json()["error"]

    # Valid update
    r = client.put("/api/settings", json={"active_rooms": ["youtube", "reddit"]})
    assert r.status_code == 200
    assert r.get_json()["data"]["active_rooms"] == ["youtube", "reddit"]

    # Max must be 1-12
    r = client.put("/api/settings", json={"max_active_rooms": 0})
    assert r.status_code == 400
    r = client.put("/api/settings", json={"max_active_rooms": 13})
    assert r.status_code == 400
    r = client.put("/api/settings", json={"max_active_rooms": 6})
    assert r.status_code == 200

    # Reset
    client.put("/api/settings", json={"active_rooms": ["youtube", "reddit", "hackernews", "frontpage", "archive", "anime"], "max_active_rooms": 6})


def test_fuzzy_filter_exact_match():
    """fuzzy_filter returns exact matches correctly."""
    from server.sources.fuzzy import fuzzy_filter

    items = [
        {"id": "1", "title": "OpenAI Launches GPT-5"},
        {"id": "2", "title": "Python 3.13 Released"},
        {"id": "3", "title": "Rust Tutorial for Beginners"},
    ]
    hits = fuzzy_filter(items, "GPT-5", threshold=60)
    assert len(hits) >= 1
    assert hits[0][0]["id"] == "1"


def test_fuzzy_filter_near_miss():
    """fuzzy_filter catches near-miss/typo queries."""
    from server.sources.fuzzy import fuzzy_filter

    items = [
        {"id": "1", "title": "OpenAI Launches GPT-5"},
        {"id": "2", "title": "The Future of AI Research"},
    ]
    # "gpt5 launch" should fuzzy-match "OpenAI Launches GPT-5"
    hits = fuzzy_filter(items, "gpt5 launch", threshold=60)
    assert len(hits) >= 1
    assert hits[0][0]["id"] == "1"


def test_fuzzy_filter_no_match():
    """fuzzy_filter returns empty for truly unrelated queries."""
    from server.sources.fuzzy import fuzzy_filter

    items = [
        {"id": "1", "title": "OpenAI Launches GPT-5"},
        {"id": "2", "title": "Python 3.13 Released"},
    ]
    hits = fuzzy_filter(items, "zzzzzzzzzzzzzzzzz", threshold=60)
    assert len(hits) == 0


def test_subscriptions_accepts_github(client):
    """The subscriptions table now accepts 'github' platform."""
    from server import db
    row = db.add_subscription("github", "test/repo", "test/repo", None)
    assert row is not None
    assert row["platform"] == "github"
    assert row["source_id"] == "test/repo"
    # Clean up
    db.delete_subscription(row["id"])