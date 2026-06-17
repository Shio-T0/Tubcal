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
