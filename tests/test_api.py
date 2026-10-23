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
    r = client.put("/api/settings", json={"active_rooms": ["youtube", "reddit", "hackernews", "edition"]})
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
    client.put("/api/settings", json={"active_rooms": ["youtube", "reddit", "hackernews", "edition", "archive", "editor"], "max_active_rooms": 6})


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

def test_saved_note_and_done(client):
    item = {"id": "anime:21", "platform": "anime", "title": "One Piece", "extra": {"kind": "anime"}}
    client.post("/api/saved", json={"item": item})

    r = client.patch("/api/saved/anime:21", json={"note": "  start at Water 7  "}).get_json()
    assert r["ok"] is True and r["data"]["note"] == "start at Water 7"
    r = client.patch("/api/saved/anime:21", json={"done": True}).get_json()
    assert r["data"]["done_at"] > 0 and r["data"]["note"] == "start at Water 7"

    kept = client.get("/api/saved").get_json()["data"]["items"][0]
    assert kept["note"] == "start at Water 7" and kept["done_at"] > 0
    r = client.patch("/api/saved/anime:21", json={"done": False}).get_json()
    assert r["data"]["done_at"] is None

    assert client.patch("/api/saved/anime:21", json={}).status_code == 400
    assert client.patch("/api/saved/anime:21", json={"done": "yes"}).status_code == 400
    assert client.patch("/api/saved/nothing:here", json={"done": True}).status_code == 404


def test_saved_undo_keeps_the_first_date(client):
    item = {"id": "file:a.py", "platform": "editor", "title": "a.py", "saved_at": 1_000_000}
    client.post("/api/saved", json={"item": item})
    assert client.get("/api/saved").get_json()["data"]["items"][0]["saved_at"] == 1_000_000
    # a date from the future is not believed
    client.post("/api/saved", json={"item": {**item, "id": "file:b.py", "saved_at": 10**12}})
    dates = {i["id"]: i["saved_at"] for i in client.get("/api/saved").get_json()["data"]["items"]}
    assert dates["file:b.py"] < 10**12


def test_retired_rooms_are_dropped_from_saved_settings(client):
    """The Front Page and The Anime stopped being hub rooms; a DB that still lists
    them must come back clean, or they'd count against max_active_rooms."""
    from server import db

    db.set_setting("active_rooms", ["edition", "frontpage", "youtube", "anime", "editor"])
    db.init_db()
    assert db.get_setting("active_rooms") == ["edition", "youtube", "editor"]
    r = client.put("/api/settings", json={"active_rooms": ["edition", "anime"]})
    assert r.status_code == 400 and "unknown room id: anime" in r.get_json()["error"]


def test_quiet_hours_setting_and_window(client):
    from server import notifier

    assert client.put("/api/settings", json={"quiet_hours": [23, 8]}).status_code == 200
    assert client.get("/api/settings").get_json()["data"]["quiet_hours"] == [23, 8]
    assert client.put("/api/settings", json={"quiet_hours": None}).status_code == 200
    for bad in ([5, 5], [24, 1], [1], "23-8", [True, 2]):
        assert client.put("/api/settings", json={"quiet_hours": bad}).status_code == 400
    # wraps past midnight
    assert [h for h in range(24) if notifier.in_quiet_hours([23, 8], h)] == [0, 1, 2, 3, 4, 5, 6, 7, 23]
    assert [h for h in range(24) if notifier.in_quiet_hours([1, 4], h)] == [1, 2, 3]
    assert not notifier.in_quiet_hours(None, 3)


def test_saved_import_round_trip_keeps_what_is_here(client):
    client.post("/api/saved", json={"item": {"id": "web:here", "platform": "web", "title": "Mine", "note": "keep me"}})
    export = {"app": "Tubcal", "items": [
        {"id": "web:here", "platform": "web", "title": "Theirs", "note": "not this"},
        {"id": "yt:abc", "platform": "youtube", "title": "Rainy day", "url": "https://youtube.com/watch?v=abc",
         "saved_at": 1_700_000_000, "note": "  for later  ", "done_at": 1_700_000_100},
        {"id": "page:/dev", "platform": "page", "title": "The Workbench", "url": "/dev"},
        {"id": "x:evil", "platform": "web", "title": "click", "url": "javascript:alert(1)", "thumbnail": "data:text/html,x"},
        {"id": "yt:abc", "platform": "youtube", "title": "dupe"},
        {"platform": "web"}, "nonsense",
    ]}
    r = client.post("/api/saved/import", json=export).get_json()["data"]
    assert r == {"added": 3, "already": 1, "skipped": 3}
    items = {it["id"]: it for it in client.get("/api/saved").get_json()["data"]["items"]}
    assert items["web:here"]["title"] == "Mine" and items["web:here"]["note"] == "keep me"
    assert items["yt:abc"]["saved_at"] == 1_700_000_000 and items["yt:abc"]["note"] == "for later"
    assert items["yt:abc"]["done_at"] == 1_700_000_100 and items["page:/dev"]["url"] == "/dev"
    assert "url" not in items["x:evil"] and "thumbnail" not in items["x:evil"]
    assert client.post("/api/saved/import", json={"items": "no"}).status_code == 400
    assert client.post("/api/saved/import", json=[{"id": "web:bare", "platform": "web"}]).get_json()["data"]["added"] == 1


def test_saving_keeps_only_safe_links_and_real_dates(client):
    client.post("/api/saved", json={"item": {"id": "pod:1", "platform": "web", "title": "Ep",
                                             "url": "javascript:alert(1)", "thumbnail": "https://x/y.jpg"}})
    client.post("/api/saved/import", json=[{"id": "web:b", "platform": "web", "done_at": True, "saved_at": True}])
    items = {it["id"]: it for it in client.get("/api/saved").get_json()["data"]["items"]}
    assert "url" not in items["pod:1"] and items["pod:1"]["thumbnail"] == "https://x/y.jpg"
    assert "done_at" not in items["web:b"] and items["web:b"]["saved_at"] > 1_700_000_000
