"""The server answers only this machine's own pages: no DNS rebinding, no
cross-site WebSocket (the editor's terminal is a shell), no cross-site writes."""

import pytest

from server import config, localguard

EVIL = "https://evil.example"


@pytest.fixture(autouse=True)
def _ports(monkeypatch):
    # whatever TUBCAL_PORT / TUBCAL_DEV_PORTS the shell running the tests has
    monkeypatch.setattr(config, "PORT", 5000)
    monkeypatch.setattr(config, "DEV_PORTS", {5173, 5174})


@pytest.mark.parametrize("host", [
    "127.0.0.1:5000", "localhost:5173", "LOCALHOST", "[::1]:5000", "::1", "127.8.9.10", "localhost.",
    "tubcal.localhost:5000",
])
def test_loopback_hosts_pass(host):
    assert localguard.is_loopback_host(host)


@pytest.mark.parametrize("host", [
    "evil.example:5000", "127.0.0.1.nip.io", "localhost.evil.example", "10.0.0.2:5000", "", "[fe80::1]",
    "0.0.0.0:5000", "[::1",
])
def test_other_hosts_fail(host):
    assert not localguard.is_loopback_host(host)


def test_allowed_hosts_adds_a_name(monkeypatch):
    monkeypatch.setattr(config, "ALLOWED_HOSTS", {"tubcal.lan"})
    assert localguard.is_loopback_host("tubcal.lan:5000")
    assert localguard.is_local_origin("http://tubcal.lan:5000")


@pytest.mark.parametrize("origin, ok", [
    ("http://127.0.0.1:5000", True),
    ("http://localhost:5173", True),   # the Vite dev server
    ("http://[::1]:5000", True),
    ("https://evil.example", False),
    ("null", False),                   # sandboxed frames, file://
    ("http://127.0.0.1.evil.example", False),
    ("ws://127.0.0.1:5000", False),
    ("file://", False),
    ("chrome-extension://abc", False),
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


def test_cross_site_frame_is_refused():
    # A navigation too, but into another site's frame rather than a tab of its own.
    assert localguard.refusal("/api/health", {
        "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe",
    })


def test_headerless_local_tools_pass():
    assert localguard.refusal("/api/health", {}) is None


def test_app_refuses_a_rebound_host(client):
    r = client.get("/api/health", headers={"Host": "attacker.example:5000"})
    assert r.status_code == 403 and r.get_json()["ok"] is False
    assert "TUBCAL_ALLOWED_HOSTS" in r.get_json()["error"]
    page = client.get("/", headers={"Host": "attacker.example"})
    assert page.status_code == 403 and page.mimetype == "text/plain"


def test_app_refuses_a_foreign_origin_on_writes(client):
    r = client.post("/api/saved", json={"item": {"id": "x", "platform": "web"}},
                    headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.get("/api/saved").get_json()["data"]["items"] == []


def test_app_refuses_other_sites_simple_writes(client):
    for headers in ({"Origin": EVIL}, {"Origin": "null"}):
        r = client.put("/api/settings", json={"reddit_sort": "new"}, headers=headers)
        assert r.status_code == 403 and r.get_json()["ok"] is False
    # A text/plain "simple" post, the kind a page elsewhere can send without asking.
    r = client.post("/api/saved", data='{"id": "x"}', content_type="text/plain", headers={"Origin": EVIL})
    assert r.status_code == 403
    assert client.get("/api/settings").get_json()["data"]["reddit_sort"] == "hot"


def test_app_takes_its_own_writes(client):
    for headers in ({"Origin": "http://127.0.0.1:5000"}, {"Origin": "http://localhost:5173"}, {}):
        r = client.put("/api/settings", json={"reddit_sort": "new"}, headers=headers)
        assert r.status_code == 200, headers


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


def test_app_lets_a_link_in_but_not_a_probe(client):
    img = {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "image"}
    assert client.get("/api/health", headers=img).status_code == 403
    link = {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document"}
    assert client.get("/api/health", headers=link).status_code == 200
    assert client.get("/api/health", headers={**link, "Sec-Fetch-Dest": "iframe"}).status_code == 403


def test_no_other_site_may_frame_tubcal(client):
    assert client.get("/").headers["Content-Security-Policy"] == "frame-ancestors 'self'"
    assert client.get("/api/health").headers["Content-Security-Policy"].endswith("; frame-ancestors 'self'")


def test_nothing_under_api_runs_as_a_page(client):
    # A link anywhere can open an /api/ address in a tab; it must be inert there.
    r = client.get("/api/health")
    assert r.headers["Content-Security-Policy"].startswith("default-src 'none'; sandbox")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert client.get("/api/no/such/thing").headers["Content-Security-Policy"].startswith("default-src 'none'")


def test_no_referrer_leaves_tubcal(client):
    for path in ("/", "/api/health"):
        assert client.get(path).headers["Referrer-Policy"] == "no-referrer"


@pytest.mark.parametrize("origin, ok", [
    ("http://localhost:8888", False),      # a notebook, another project's dev server
    ("http://127.0.0.1:8000", False),
    ("http://localhost", False),
    ("http://127.0.0.1:5000", True),
    ("http://localhost:5174", True),       # Vite, when 5173 is taken
])
def test_other_local_servers_pages_are_other_sites(origin, ok):
    assert localguard.is_local_origin(origin) is ok


def test_an_allowed_name_may_come_through_a_proxy_port(monkeypatch):
    monkeypatch.setattr(config, "ALLOWED_HOSTS", {"tubcal.lan"})
    assert localguard.is_local_origin("http://tubcal.lan")


def test_app_refuses_writes_from_another_local_server(client):
    r = client.put("/api/settings", json={"reddit_sort": "new"}, headers={"Origin": "http://localhost:8888"})
    assert r.status_code == 403


def test_the_phone_wants_its_key(client, monkeypatch):
    monkeypatch.setattr(config, "ACCESS_KEY", "s3cret-key")
    assert client.get("/api/health").status_code == 403          # another app on the phone
    assert client.get("/api/health", headers={"X-Tubcal-Key": "wrong"}).status_code == 403
    assert client.get("/api/health", headers={"X-Tubcal-Key": "s3cret-key"}).status_code == 200
    client.set_cookie("tubcal_key", "s3cret-key")
    assert client.get("/api/health").status_code == 200         # the app's WebView
    client.delete_cookie("tubcal_key")
    # the page itself is public; an OAuth provider's way back checks its own state
    assert client.get("/").status_code == 200
    r = client.get("/api/oauth/anilist/callback?state=x&code=y")
    assert r.status_code == 400 and "state" in r.get_json()["error"]


def test_no_key_no_check_on_the_desktop(client):
    assert config.ACCESS_KEY is None
    assert client.get("/api/health").status_code == 200
