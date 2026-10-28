"""`/api/img`: pictures from the platforms' image hosts, or from any public address
(podcast covers), checked to be pictures."""

import http.server
import threading

import pytest

from server import httpc
from server.api import img as img_api

JPEG = b"\xff\xd8\xff\xe0" + b"\0" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64


class Resp:
    def __init__(self, status=200, body=b"", location=None):
        self.status_code = status
        self.body = body
        self.headers = {"Location": location} if location else {}
        self.closed = False

    def iter_content(self, n):
        for i in range(0, len(self.body), n):
            yield self.body[i:i + n]

    def close(self):
        self.closed = True


@pytest.fixture
def upstream(monkeypatch):
    script, calls = {}, []

    def get(url, headers=None, **kw):
        calls.append((url, dict(headers or {}), kw))
        r = script.get(url)
        if r is None:
            raise AssertionError(f"unexpected fetch of {url}")
        return r
    monkeypatch.setattr(httpc.anon_session, "get", get)
    return script, calls


def test_a_thumbnail_comes_through(client, upstream):
    script, calls = upstream
    script["https://i.ytimg.com/vi/abc/hqdefault.jpg"] = Resp(body=JPEG)
    r = client.get("/api/img", query_string={"u": "https://i.ytimg.com/vi/abc/hqdefault.jpg"})
    assert r.status_code == 200 and r.data == JPEG
    assert r.mimetype == "image/jpeg"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert "sandbox" in r.headers["Content-Security-Policy"]
    url, headers, kw = calls[0]
    assert "Referer" not in headers and "Cookie" not in headers
    assert kw["allow_redirects"] is False


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:5000/api/settings",
    "https://user:pw@i.ytimg.com/x.jpg",
    "https://i.ytimg.com:8443/x.jpg",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "",
])
def test_anything_else_is_refused(client, upstream, url):
    r = client.get("/api/img", query_string={"u": url})
    assert r.status_code == 403


@pytest.fixture
def pinned(monkeypatch):
    """Names resolve as the test says; a pinned fetch records the addresses it was given."""
    names, calls = {}, []

    def resolve(host, port):
        if host not in names:
            raise OSError("no such name")
        return names[host]

    def pinned_get(url, addrs):
        calls.append((url, addrs))
        return Resp(body=JPEG)
    monkeypatch.setattr(img_api, "resolve", resolve)
    monkeypatch.setattr(img_api, "pinned_get", pinned_get)
    return names, calls


def test_a_podcast_cover_comes_from_its_own_public_host(client, upstream, pinned):
    names, calls = pinned
    names["cdn-podcast.example.fm"] = ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"]
    r = client.get("/api/img", query_string={"u": "https://cdn-podcast.example.fm/art.jpg"})
    assert r.status_code == 200 and r.data == JPEG
    assert calls == [("https://cdn-podcast.example.fm/art.jpg", names["cdn-podcast.example.fm"])]


@pytest.mark.parametrize("addrs", [
    ["127.0.0.1"], ["10.0.0.5"], ["192.168.1.20"], ["172.16.3.4"], ["100.64.0.1"], ["169.254.169.254"],
    ["::1"], ["fe80::1"], ["fd00::1"], ["::ffff:127.0.0.1"], ["0.0.0.0"], ["224.0.0.1"],
    ["93.184.215.14", "192.168.1.2"],     # one inside is enough to refuse
])
def test_a_name_that_points_inside_is_refused(client, upstream, pinned, addrs):
    names, calls = pinned
    names["art.example.org"] = addrs
    r = client.get("/api/img", query_string={"u": "https://art.example.org/x.jpg"})
    assert r.status_code == 403 and calls == []


def test_a_name_that_doesnt_resolve_is_refused(client, upstream, pinned):
    assert client.get("/api/img", query_string={"u": "https://nowhere.invalid/x.jpg"}).status_code == 403


def test_a_platform_redirect_into_the_network_is_refused(client, upstream, pinned):
    script, _ = upstream
    names, calls = pinned
    names["router.example"] = ["192.168.1.1"]
    script["https://i.ytimg.com/r.jpg"] = Resp(302, location="https://router.example/admin.jpg")
    assert client.get("/api/img", query_string={"u": "https://i.ytimg.com/r.jpg"}).status_code == 403
    names["cdn.example"] = ["93.184.215.14"]
    script["https://i.ytimg.com/s.jpg"] = Resp(302, location="https://cdn.example/s.jpg")
    assert client.get("/api/img", query_string={"u": "https://i.ytimg.com/s.jpg"}).data == JPEG


def test_the_pinned_fetch_goes_to_the_checked_address_and_keeps_the_name():
    """No second lookup: the request reaches the address given, with the name as Host."""
    seen = {}

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            seen["host"], seen["path"] = self.headers.get("Host"), self.path
            self.send_response(200)
            self.send_header("Content-Length", str(len(PNG)))
            self.end_headers()
            self.wfile.write(PNG)

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.handle_request, daemon=True).start()
    port = srv.server_address[1]
    try:
        resp = img_api.pinned_get(f"http://pictures.invalid:{port}/a/b.png?x=1", ["127.0.0.1"])
        body = b"".join(resp.iter_content(1024))
        resp.close()
    finally:
        srv.server_close()
    assert body == PNG
    assert seen == {"host": f"pictures.invalid:{port}", "path": "/a/b.png?x=1"}


@pytest.mark.parametrize("addr, ok", [
    ("93.184.215.14", True), ("2606:4700::6810:84e5", True), ("127.0.0.53", False), ("::ffff:10.1.2.3", False),
    ("fe80::1%eth0", False), ("not an address", False),
])
def test_public(addr, ok):
    assert img_api.public(addr) is ok


def test_hosts_match_by_dot_suffix():
    assert img_api.allowed("https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg")
    assert img_api.allowed("https://avatars.githubusercontent.com/u/1?v=4")
    assert img_api.allowed("https://anilist.co/x.png")
    assert not img_api.allowed("https://anilist.co.example/x.png")
    assert not img_api.allowed("https://ytimg.com.evil.example/x.jpg")
    assert not img_api.allowed("https://notytimg.com/x.jpg")


def test_a_lookalike_host_isnt_a_platform_and_is_checked_like_any_other(client, upstream, pinned):
    names, calls = pinned
    names["ytimg.com.evil.example"] = ["10.9.8.7"]
    assert client.get("/api/img", query_string={"u": "https://ytimg.com.evil.example/x.jpg"}).status_code == 403


def test_a_redirect_is_checked_like_the_first_address(client, upstream):
    script, _ = upstream
    script["https://i.ytimg.com/a.jpg"] = Resp(302, location="https://i.ytimg.com/b.jpg")
    script["https://i.ytimg.com/b.jpg"] = Resp(body=PNG)
    assert client.get("/api/img", query_string={"u": "https://i.ytimg.com/a.jpg"}).data == PNG
    script["https://i.ytimg.com/c.jpg"] = Resp(302, location="http://192.168.1.1/admin")
    assert client.get("/api/img", query_string={"u": "https://i.ytimg.com/c.jpg"}).status_code == 403


def test_redirects_end(client, upstream):
    script, _ = upstream
    for i in range(6):
        script[f"https://i.ytimg.com/{i}.jpg"] = Resp(302, location=f"https://i.ytimg.com/{i + 1}.jpg")
    assert client.get("/api/img", query_string={"u": "https://i.ytimg.com/0.jpg"}).status_code == 502


@pytest.mark.parametrize("body", [
    b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
    b"<!doctype html><script>fetch('/api/editor/pty')</script>",
    b"",
])
def test_only_pictures_by_their_first_bytes(client, upstream, body):
    script, _ = upstream
    script["https://i.ytimg.com/x.jpg"] = Resp(body=body)
    assert client.get("/api/img", query_string={"u": "https://i.ytimg.com/x.jpg"}).status_code == 502


def test_a_huge_body_is_cut_off(client, upstream, monkeypatch):
    script, _ = upstream
    monkeypatch.setattr(img_api, "MAX_BYTES", 1000)
    script["https://i.ytimg.com/x.jpg"] = Resp(body=JPEG + b"\0" * 5000)
    assert client.get("/api/img", query_string={"u": "https://i.ytimg.com/x.jpg"}).status_code == 502


def test_a_page_navigating_here_is_refused(client, upstream):
    r = client.get("/api/img", query_string={"u": "https://i.ytimg.com/x.jpg"},
                   headers={"Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "document"})
    assert r.status_code == 403


@pytest.mark.parametrize("head, kind", [
    (JPEG, "image/jpeg"), (PNG, "image/png"), (b"GIF89a....", "image/gif"),
    (b"RIFF\0\0\0\0WEBPVP8 ", "image/webp"), (b"\0\0\0\x20ftypavif", "image/avif"),
    (b"<svg", None), (b"\0\0\0\x20ftypmp42", None),
])
def test_sniff(head, kind):
    assert img_api.sniff(head) == kind
