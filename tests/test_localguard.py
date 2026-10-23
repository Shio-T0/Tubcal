"""The server answers only this machine's own pages: no DNS rebinding, no
cross-site WebSocket (the editor's terminal is a shell), no cross-site writes."""

import pytest

from server import localguard


@pytest.mark.parametrize("host", [
    "127.0.0.1:5000", "localhost:5173", "LOCALHOST", "[::1]:5000", "::1", "127.8.9.10", "localhost.",
])
def test_loopback_hosts_pass(host):
    assert localguard.is_loopback_host(host)


@pytest.mark.parametrize("host", [
    "evil.example:5000", "127.0.0.1.nip.io", "localhost.evil.example", "10.0.0.2:5000", "", "[fe80::1]",
])
def test_other_hosts_fail(host):
    assert not localguard.is_loopback_host(host)


@pytest.mark.parametrize("origin, ok", [
    ("http://127.0.0.1:5000", True),
    ("http://localhost:5173", True),   # the Vite dev server
    ("https://evil.example", False),
    ("null", False),                   # sandboxed frames, file://
    ("http://127.0.0.1.evil.example", False),
    ("ws://127.0.0.1:5000", False),
])
def test_origins(origin, ok):
    assert localguard.is_local_origin(origin) is ok


def test_navigation_back_from_oauth_is_allowed():
    # A provider redirects the browser here: cross-site, but a top-level navigation.
    assert localguard.refusal("/api/oauth/reddit/callback", {
        "Host": "127.0.0.1:5000", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate",
    }) is None


def test_cross_site_subresource_is_refused():
    assert localguard.refusal("/api/saved", {
        "Host": "127.0.0.1:5000", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors",
    })


def test_headerless_local_tools_pass():
    assert localguard.refusal("/api/health", {}) is None


def test_app_refuses_a_rebound_host(client):
    r = client.get("/api/health", headers={"Host": "attacker.example:5000"})
    assert r.status_code == 403 and r.get_json()["ok"] is False
    assert client.get("/", headers={"Host": "attacker.example"}).status_code == 403


def test_app_refuses_a_foreign_origin_on_writes(client):
    r = client.post("/api/saved", json={"item": {"id": "x", "platform": "web"}},
                    headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.get("/api/saved").get_json()["data"]["items"] == []


def test_app_refuses_a_foreign_websocket_handshake(client):
    # Refused before any view runs, so this holds whether or not flask-sock is here.
    r = client.get("/api/editor/pty", headers={
        "Origin": "https://evil.example", "Connection": "Upgrade", "Upgrade": "websocket",
        "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
    })
    assert r.status_code == 403


def test_app_serves_its_own_pages(client):
    assert client.get("/api/health", headers={"Origin": "http://127.0.0.1:5000"}).status_code == 200
    assert client.get("/api/health", headers={"Origin": "http://localhost:5173",
                                              "Sec-Fetch-Site": "same-origin"}).status_code == 200
