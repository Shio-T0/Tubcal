"""3D objects (Settings → Appearance, and the installer's `3d` option): a boolean
setting, stamped on <html> at serve time, that the installer's choice sets when it
changes (db.note_install)."""

from server import config, db

INDEX = '<!doctype html><html lang="en" data-theme="dark"><head></head><body></body></html>'


def test_objects_3d_defaults_off_and_only_takes_booleans(client):
    assert client.get("/api/settings").get_json()["data"]["objects_3d"] is False
    assert client.put("/api/settings", json={"objects_3d": "on"}).status_code == 400
    assert client.put("/api/settings", json={"objects_3d": 1}).status_code == 400
    r = client.put("/api/settings", json={"objects_3d": True})
    assert r.get_json()["data"]["objects_3d"] is True


def test_index_is_stamped_while_3d_is_on(client, tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text(INDEX)
    monkeypatch.setattr(config, "FRONTEND_DIST", dist)
    assert "data-3d" not in client.get("/").get_data(as_text=True)
    client.put("/api/settings", json={"objects_3d": True, "fast_mode": True})
    html = client.get("/").get_data(as_text=True)
    assert html.count("data-3d") == 1 and html.count("data-fast") == 1
    client.put("/api/settings", json={"objects_3d": False})
    assert "data-3d" not in client.get("/").get_data(as_text=True)


def test_the_installer_choice_applies_only_when_it_changes(client):
    # Started by hand (no launcher): nothing changes.
    assert db.note_install({"objects_3d": None}) == {}
    assert db.get_setting("objects_3d") is False

    # The installer said yes: on.
    assert db.note_install({"objects_3d": True}) == {"objects_3d": True}
    assert db.get_setting("objects_3d") is True

    # Switched off in Settings; the same install record on the next start leaves it.
    client.put("/api/settings", json={"objects_3d": False})
    assert db.note_install({"objects_3d": True}) == {}
    assert db.get_setting("objects_3d") is False

    # install.sh run again with a different answer: that answer wins.
    assert db.note_install({"objects_3d": False}) == {"objects_3d": False}
    assert db.note_install({"objects_3d": True}) == {"objects_3d": True}
    assert db.get_setting("objects_3d") is True

    # The record of what the installer said stays out of the settings API.
    assert "_install_seen" not in client.get("/api/settings").get_json()["data"]
