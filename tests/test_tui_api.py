"""The terminal's API client against the real Flask app (conftest's throwaway DB),
through httpx's WSGI transport: no network, and the same envelope the browser sees."""

import httpx
import pytest

from server import config
from tui.api import Api, ApiError, LoopbackOnly, seg


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    from server import create_app, db

    db.init_db()
    app = create_app()
    app.config.update(TESTING=True)
    a = Api("http://127.0.0.1:5000", transport=httpx.WSGITransport(app=app))
    yield a
    a.close()


def test_only_this_machine():
    t = LoopbackOnly(httpx.MockTransport(lambda r: httpx.Response(200, json={"ok": True, "data": 1})))
    c = httpx.Client(transport=t)
    assert c.get("http://127.0.0.1:5000/api/health").json()["data"] == 1
    assert c.get("http://localhost:5000/x").status_code == 200
    with pytest.raises(ApiError):
        c.get("https://i.ytimg.com/vi/x/hqdefault.jpg")


def test_health_lists_modules(api):
    h = api.health()
    assert h["status"] == "ok" and "youtube" in h["modules"]


def test_an_error_is_the_servers_sentence(api):
    with pytest.raises(ApiError) as e:
        api.get("/no/such/thing")
    assert e.value.status == 404


def test_saved_round_trip_with_awkward_ids(api):
    item = {"id": "github:issue:o/r#12", "platform": "github", "title": "An issue", "url": "https://github.com/o/r/issues/12"}
    api.post("/saved", {"item": item})
    assert any(i["id"] == item["id"] for i in api.get("/saved")["items"])
    api.delete(f"/saved/{seg(item['id'])}")
    assert not api.get("/saved")["items"]


def test_history_then_progress_files_it_under_its_platform(api):
    item = {"id": "yt:abcdefghijk", "platform": "youtube", "title": "A video", "source": "A channel",
            "url": "https://www.youtube.com/watch?v=abcdefghijk", "extra": {"video_id": "abcdefghijk"}}
    api.record_open(item)
    api.record_progress(item["id"], 61.0, 300.0)
    assert api.get("/progress")["progress"][item["id"]] == {"position": 61.0, "duration": 300.0}
    rows = api.get("/history", platform="youtube")["items"]
    assert [r["item_id"] for r in rows] == [item["id"]]


def test_a_private_session_records_nothing(api):
    api.private = True
    api.record_open({"id": "yt:abcdefghijk", "platform": "youtube", "title": "A video"})
    api.record_progress("yt:abcdefghijk", 61.0, 300.0)
    assert api.get("/progress")["progress"] == {}
    assert api.get("/history")["items"] == []


def test_json_bodies_on_every_write():
    """GitHub's endpoints answer 415 to a write without a JSON body."""
    seen = []

    def handler(request):
        seen.append((request.method, request.headers.get("content-type")))
        return httpx.Response(200, json={"ok": True, "data": None})

    a = Api("http://127.0.0.1:5000", transport=httpx.MockTransport(handler))
    a.put("/github/repo/o/r/star")
    a.delete("/github/repo/o/r/star")
    assert all(ct == "application/json" for _, ct in seen)
