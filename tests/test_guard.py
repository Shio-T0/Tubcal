"""Only Tubcal's own pages may talk to Tubcal (server/guard.py): another site's
writes, sockets and probes are refused, and so is a rebound domain."""

import pytest

from server import config, guard

EVIL = "https://evil.example"
SOCKET = {"Upgrade": "websocket", "Connection": "Upgrade",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13"}


@pytest.mark.parametrize("host", ["127.0.0.1:5000", "localhost", "LOCALHOST:5173", "[::1]:5000",
                                  "127.0.0.2:5000", "tubcal.localhost:5000"])
def test_loopback_hosts_are_ours(host):
    assert guard.host_allowed(host)


@pytest.mark.parametrize("host", ["evil.example", "evil.example:5000", "0.0.0.0:5000",
                                  "192.168.1.10:5000", "localhost.evil.example", "", "[::1"])
def test_other_hosts_are_not(host):
    assert not guard.host_allowed(host)


def test_allowed_hosts_adds_a_name(monkeypatch):
    monkeypatch.setattr(config, "ALLOWED_HOSTS", {"tubcal.lan"})
    assert guard.host_allowed("tubcal.lan:5000")
    assert guard.origin_allowed("http://tubcal.lan:5000")


@pytest.mark.parametrize("origin,ok", [
    ("http://127.0.0.1:5000", True), ("http://localhost:5173", True), ("http://[::1]:5000", True),
    (EVIL, False), ("http://127.0.0.1.evil.example", False), ("null", False),
    ("file://", False), ("chrome-extension://abc", False),
])
def test_origins(origin, ok):
    assert guard.origin_allowed(origin) is ok


def test_rebound_domain_gets_no_answer(client):
    r = client.get("/api/health", headers={"Host": "evil.example:5000"})
    assert r.status_code == 403
    assert "TUBCAL_ALLOWED_HOSTS" in r.get_json()["error"]
    page = client.get("/", headers={"Host": "evil.example:5000"})
    assert page.status_code == 403 and page.mimetype == "text/plain"


def test_another_sites_write_is_refused(client):
    for headers in ({"Origin": EVIL}, {"Origin": "null"}):
        r = client.put("/api/settings", json={"reddit_sort": "new"}, headers=headers)
        assert r.status_code == 403
        assert r.get_json()["ok"] is False
    # A text/plain "simple" post, the kind a page elsewhere can send without asking.
    r = client.post("/api/saved", data='{"id": "x"}', content_type="text/plain", headers={"Origin": EVIL})
    assert r.status_code == 403
    assert client.get("/api/settings").get_json()["data"]["reddit_sort"] == "hot"


def test_tubcals_own_writes_go_through(client):
    for headers in ({"Origin": "http://127.0.0.1:5000"}, {"Origin": "http://localhost:5173"}, {}):
        r = client.put("/api/settings", json={"reddit_sort": "new"}, headers=headers)
        assert r.status_code == 200, headers


def test_another_sites_socket_is_refused(client):
    # The editor's terminal is a WebSocket, which CORS doesn't cover.
    r = client.get("/api/editor/pty", headers={**SOCKET, "Origin": EVIL})
    assert r.status_code == 403


def test_cross_site_probe_is_refused_but_navigation_is_not(client):
    img = {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image"}
    assert client.get("/api/health", headers=img).status_code == 403
    link = {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document"}
    assert client.get("/api/health", headers=link).status_code == 200
    framed = {**link, "Sec-Fetch-Dest": "iframe"}
    assert client.get("/api/health", headers=framed).status_code == 403
    own = {"Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty"}
    assert client.get("/api/health", headers=own).status_code == 200


def test_no_other_site_may_frame_tubcal(client):
    for path in ("/", "/api/health"):
        assert client.get(path).headers["Content-Security-Policy"] == "frame-ancestors 'self'"
