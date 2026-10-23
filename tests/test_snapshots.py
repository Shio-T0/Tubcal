"""Daily snapshots of tubcal.db: consistent, private, rotated, restorable in
place, and never carrying the cache (it can all be fetched again)."""

import os
import sqlite3
import stat

from server import cache, db, snapshots


def _names():
    return [e["name"] for e in snapshots.list_snapshots()]


def test_a_snapshot_holds_your_data_but_not_the_cache(client):
    db.add_saved({"id": "web:a", "platform": "web", "title": "A keeper"})
    cache.cached("big:feed", 60, lambda: {"x": "y" * 1000})
    e = snapshots.take()
    path = snapshots.folder() / e["name"]
    con = sqlite3.connect(path)
    assert con.execute("SELECT COUNT(*) FROM saved").fetchone()[0] == 1
    assert con.execute("SELECT COUNT(*) FROM cache").fetchone()[0] == 0
    assert con.execute("PRAGMA journal_mode").fetchone()[0] == "delete"  # one file
    con.close()
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(snapshots.folder()).st_mode) == 0o700
    assert not list(snapshots.folder().glob("*.partial"))


def test_daily_copy_is_due_once_a_day_and_off_at_zero(client):
    assert snapshots.due()
    snapshots.daily()
    assert not snapshots.due()
    assert snapshots.daily() is None
    db.set_setting("snapshots_keep", 0)
    tomorrow = __import__("time").time() + 86400
    assert not snapshots.due(tomorrow)


def test_rotation_keeps_the_newest(client):
    db.set_setting("snapshots_keep", 2)
    d = snapshots.folder()
    d.mkdir(exist_ok=True)
    for i, day in enumerate(("2026-01-01", "2026-01-02", "2026-01-03")):
        p = d / f"tubcal-{day}.db"
        p.write_bytes(b"")
        os.utime(p, (1_000_000 + i, 1_000_000 + i))
    snapshots.rotate()
    assert sorted(_names()) == ["tubcal-2026-01-02.db", "tubcal-2026-01-03.db"]


def test_restore_puts_the_old_day_back_and_keeps_a_safety_copy(client):
    db.add_saved({"id": "web:old", "platform": "web", "title": "Before"})
    first = snapshots.take()
    db.add_saved({"id": "web:new", "platform": "web", "title": "After"})
    cache.cached("restore:k", 60, lambda: 1)

    safety = snapshots.restore(first["name"])

    ids = {it["id"] for it in db.list_saved()}
    assert ids == {"web:old"}
    assert safety["before_restore"] and safety["name"] in _names()
    assert cache.peek("restore:k") is None          # memory doesn't outlive the data
    con = db.connect()
    assert con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"  # live file stays WAL
    con.close()
    # and the safety copy has what was there
    con = sqlite3.connect(snapshots.folder() / safety["name"])
    assert {r[0] for r in con.execute("SELECT item_id FROM saved")} == {"web:old", "web:new"}
    con.close()


def test_restore_spares_its_own_source_from_rotation(client):
    db.set_setting("snapshots_keep", 1)
    only = snapshots.take()
    snapshots.restore(only["name"])  # the safety copy would otherwise rotate it out
    assert only["name"] in _names()


def test_restore_refuses_anything_but_a_snapshot_name(client):
    for bad in ("../tubcal.db", "/etc/passwd", "tubcal-2026-01-01.db/../../x", None):
        r = client.post("/api/data/restore", json={"name": bad})
        assert r.status_code == 400
    assert client.post("/api/data/restore", json={"name": "tubcal-2020-01-01.db"}).status_code == 404


def test_data_endpoints(client):
    db.add_saved({"id": "web:a", "platform": "web", "title": "A"})
    r = client.post("/api/data/snapshot")
    assert r.status_code == 200
    data = client.get("/api/data").get_json()["data"]
    assert data["counts"]["saved"] == 1 and data["keep"] == 7
    assert data["snapshots"][0]["name"] == r.get_json()["data"]["name"]
    assert client.put("/api/settings", json={"snapshots_keep": 31}).status_code == 400
    assert client.put("/api/settings", json={"snapshots_keep": 3}).status_code == 200
