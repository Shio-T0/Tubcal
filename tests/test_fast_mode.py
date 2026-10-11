"""Fast mode (Settings → Appearance): a boolean setting, stamped on <html> at serve
time so the very first paint has no animations either."""

from server import config

INDEX = '<!doctype html><html lang="en" data-theme="dark"><head></head><body></body></html>'


def _dist(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text(INDEX)
    monkeypatch.setattr(config, "FRONTEND_DIST", dist)


def test_fast_mode_defaults_off_and_only_takes_booleans(client):
    assert client.get("/api/settings").get_json()["data"]["fast_mode"] is False
    r = client.put("/api/settings", json={"fast_mode": "yes"})
    assert r.status_code == 400
    r = client.put("/api/settings", json={"fast_mode": 1})
    assert r.status_code == 400
    r = client.put("/api/settings", json={"fast_mode": True})
    assert r.get_json()["data"]["fast_mode"] is True


def test_index_is_stamped_only_while_fast_mode_is_on(client, tmp_path, monkeypatch):
    _dist(tmp_path, monkeypatch)
    assert "data-fast" not in client.get("/").get_data(as_text=True)

    client.put("/api/settings", json={"fast_mode": True})
    html = client.get("/edition").get_data(as_text=True)
    assert '<html data-fast="" lang="en"' in html
    assert html.count("data-fast") == 1

    client.put("/api/settings", json={"fast_mode": False})
    assert "data-fast" not in client.get("/").get_data(as_text=True)
