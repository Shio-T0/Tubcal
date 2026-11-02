"""What keeps strangers' bytes, names and links from becoming Tubcal's own: the
media relay's content types, the skin's name on the page, credentials kept out of
/api/settings, links a feed or a saved entry may carry, and the commands that are
handed a channel's or a link's words."""

import base64

import pytest
import requests

from server import db
from server.api import relay as relay_mod


class _Upstream:
    def __init__(self, ctype, body=b"<script>alert(1)</script>", status=200):
        self.status_code = status
        self.headers = requests.structures.CaseInsensitiveDict({"Content-Type": ctype} if ctype else {})
        self._body = body

    def iter_content(self, chunk_size=65536):
        yield self._body

    def close(self):
        pass


@pytest.mark.parametrize("upstream, default, served", [
    ("text/html; charset=utf-8", "text/vtt", "text/vtt"),            # a "subtitle" that is a page
    ("application/xhtml+xml", "video/mp2t", "video/mp2t"),
    ("image/svg+xml", "video/mp2t", "video/mp2t"),                   # pictures that run scripts
    ("application/javascript", "video/mp2t", "video/mp2t"),
    (None, "video/mp4", "video/mp4"),
    ("video/mp2t", "video/mp2t", "video/mp2t"),
    ("text/vtt; charset=utf-8", "text/vtt", "text/vtt; charset=utf-8"),
    ("image/jpeg", "video/mp2t", "image/jpeg"),                      # segments some CDNs dress as pictures
    ("application/vnd.apple.mpegurl", "video/mp2t", "application/vnd.apple.mpegurl"),
])
def test_the_relay_serves_media_types_only(app, upstream, default, served):
    with app.test_request_context("/api/anime/sub"):
        resp = relay_mod.relay(_Upstream(upstream), default_ct=default)
    assert resp.headers["Content-Type"] == served
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert "sandbox" in resp.headers["Content-Security-Policy"]


def test_a_proxied_page_opened_in_a_tab_is_inert(client, monkeypatch):
    # The chain this closes: a link on any site opens /api/anime/sub?u=<their page>.
    from server import httpc

    monkeypatch.setattr(httpc, "stream_get", lambda *a, **k: _Upstream("text/html"))
    u = base64.urlsafe_b64encode(b"https://evil.example/page").decode()
    r = client.get(f"/api/anime/sub?u={u}", headers={
        "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document"})
    if r.status_code == 404:
        pytest.skip("this copy has no Anime")
    assert r.mimetype == "text/vtt"
    assert r.headers["Content-Security-Policy"].startswith("default-src 'none'; sandbox")


@pytest.fixture
def app(client):
    return client.application


def test_the_skin_name_is_a_name(client):
    bad = '"><script>alert(1)</script>'
    r = client.put("/api/settings", json={"theme": bad})
    assert r.status_code == 400
    assert client.put("/api/settings", json={"theme": "bench"}).status_code == 200


def test_a_bad_skin_already_stored_never_reaches_the_page(client, tmp_path, monkeypatch):
    from server import config

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text('<html data-theme="dark"><head></head><body></body></html>')
    monkeypatch.setattr(config, "FRONTEND_DIST", dist)
    db.set_setting("theme", 'x"><script>alert(1)</script>')
    page = client.get("/").get_data(as_text=True)
    assert "<script>alert(1)" not in page and 'data-theme="dark"' in page
    db.set_setting("theme", "bench")
    assert 'data-theme="bench"' in client.get("/").get_data(as_text=True)


def test_a_kept_token_stays_out_of_settings(client):
    db.set_setting("github_token", "ghp_secret")
    assert "github_token" not in client.get("/api/settings").get_json()["data"]
    assert db.get_setting("github_token") == "ghp_secret"


@pytest.mark.parametrize("link, kept", [
    ("https://example.com/a", True),
    ("/anime/21", True),
    ("//evil.example/x", False),
    ("/\\evil.example/x", False),
    ("javascript:alert(1)", False),
    ("data:text/html,x", False),
])
def test_a_saved_entry_keeps_only_harmless_links(client, link, kept):
    client.post("/api/saved", json={"item": {"id": "x", "platform": "web", "url": link}})
    items = client.get("/api/saved").get_json()["data"]["items"]
    assert (items[0].get("url") == link) is kept


def test_a_feed_can_only_link_to_the_web():
    from server.sources import dev

    feed = dev.parse_feed("""<?xml version="1.0"?><rss><channel><title>t</title>
      <item><title>bad</title><link>javascript:alert(1)</link>
        <enclosure url="file:///etc/passwd" type="audio/mpeg"/></item>
      <item><title>ok</title><link>https://example.com/e</link>
        <enclosure url="https://cdn.example/e.mp3" type="audio/mpeg"/></item>
    </channel></rss>""")
    bad, good = feed["entries"]
    assert bad["url"] is None and bad["audio"] is None
    assert good["url"] == "https://example.com/e" and good["audio"] == "https://cdn.example/e.mp3"


def test_a_link_with_quotes_stays_one_argument_to_browser(monkeypatch):
    from server import youtube_links

    monkeypatch.setenv("BROWSER", "chromium %s")
    monkeypatch.setattr(youtube_links.shutil, "which", lambda name: "/usr/bin/" + name)
    url = "https://example.com/' --gpu-launcher='sh -c evil"
    assert youtube_links._browser_argv({}, url) == ["chromium", url]


def test_a_channel_name_is_never_an_option_or_markup(monkeypatch):
    from server import notifier

    seen = []
    monkeypatch.setattr(notifier.shutil, "which", lambda name: "/usr/bin/notify-send")
    monkeypatch.setattr(notifier.subprocess, "run", lambda argv, **kw: seen.append(argv))
    notifier._notify({"source": "-u critical", "title": '<a href="https://x">go</a>'})
    argv = seen[0]
    assert argv[argv.index("--") + 2].startswith("-u critical")
    assert "<a" not in argv[-1] and "&lt;a" in argv[-1]
