"""`httpc.public_session`: fetches whose address a third party chose (the anime
proxies follow a source's playlists) reach public addresses only, checked as each
connection opens, and carry no cookies."""

import base64
import http.server
import socket
import threading
from pathlib import Path

import pytest
import requests

from server import httpc

ROOT = Path(__file__).resolve().parents[1]


class Upstream:
    """A local HTTP server that records what reached it."""

    def __init__(self, routes):
        self.routes, self.hits = routes, []
        up = self

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                up.hits.append({"path": self.path, "host": self.headers.get("Host"),
                                "cookie": self.headers.get("Cookie")})
                status, headers, body = up.routes.get(self.path, (404, {}, b""))
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


@pytest.fixture
def upstream():
    servers = []

    def make(routes):
        servers.append(Upstream(routes))
        return servers[-1]
    yield make
    for s in servers:
        s.close()


@pytest.fixture
def names(monkeypatch):
    """Fake lookups, and 127.0.0.1 counted as public, so a local server can stand in
    for a host on the internet. 127.0.0.2 stays inside."""
    table, lookups = {}, []

    def resolve(host, port):
        lookups.append(host)
        if host not in table:
            raise socket.gaierror(f"no such name {host}")
        return [(socket.AF_INET, a) for a in table[host]]
    monkeypatch.setattr(httpc, "_resolve", resolve)
    monkeypatch.setattr(httpc, "public", lambda a: a == "127.0.0.1" or a.startswith("93."))
    return table, lookups


def test_the_connection_goes_to_the_checked_address_and_keeps_the_name(upstream, names):
    table, _ = names
    up = upstream({"/a.ts": (200, {}, b"segment")})
    table["cdn.example"] = ["127.0.0.1"]
    r = httpc.public_session.get(f"http://cdn.example:{up.port}/a.ts", timeout=5)
    assert r.content == b"segment"
    assert up.hits[0]["host"] == f"cdn.example:{up.port}"


def test_a_name_that_points_inside_is_refused_before_anything_is_sent(upstream, names):
    table, _ = names
    up = upstream({"/secret": (200, {}, b"router admin")})
    table["inside.example"] = ["127.0.0.2"]
    with pytest.raises(requests.ConnectionError) as e:
        httpc.public_session.get(f"http://inside.example:{up.port}/secret", timeout=5)
    assert httpc.refused(e.value)
    assert up.hits == []


def test_one_inside_address_among_public_ones_is_enough_to_refuse(names):
    table, _ = names
    table["mixed.example"] = ["93.184.215.14", "127.0.0.2"]
    with pytest.raises(requests.ConnectionError) as e:
        httpc.public_session.get("http://mixed.example/x", timeout=5)
    assert httpc.refused(e.value)


def test_the_real_check_refuses_loopback(upstream):
    up = upstream({"/": (200, {}, b"hello")})
    with pytest.raises(requests.ConnectionError) as e:
        httpc.public_session.get(f"http://127.0.0.1:{up.port}/", timeout=5)
    assert httpc.refused(e.value)
    assert up.hits == []


def test_a_redirect_into_the_network_is_refused(upstream, names):
    table, _ = names
    inside = upstream({"/secret": (200, {}, b"router admin")})
    table["cdn.example"] = ["127.0.0.1"]
    table["inside.example"] = ["127.0.0.2"]
    out = upstream({"/a.ts": (302, {"Location": f"http://inside.example:{inside.port}/secret"}, b"")})
    with pytest.raises(requests.ConnectionError) as e:
        httpc.public_session.get(f"http://cdn.example:{out.port}/a.ts", timeout=5)
    assert httpc.refused(e.value)
    assert inside.hits == []


def test_no_cookies_are_kept_or_sent(upstream, names):
    table, _ = names
    up = upstream({"/a": (200, {"Set-Cookie": "id=tracker; Path=/"}, b"1"), "/b": (200, {}, b"2")})
    table["cdn.example"] = ["127.0.0.1"]
    httpc.public_session.get(f"http://cdn.example:{up.port}/a", timeout=5)
    httpc.public_session.get(f"http://cdn.example:{up.port}/b", timeout=5)
    assert [h["cookie"] for h in up.hits] == [None, None]


def test_stream_get_doesnt_retry_a_refusal(names):
    table, lookups = names
    table["inside.example"] = ["127.0.0.2"]
    with pytest.raises(requests.ConnectionError) as e:
        httpc.stream_get("http://inside.example/x", public_only=True, attempts=4)
    assert httpc.refused(e.value)
    assert lookups == ["inside.example"]


def test_an_ordinary_failure_isnt_a_refusal(names):
    with pytest.raises(requests.ConnectionError) as e:
        httpc.public_session.get("http://nowhere.example/x", timeout=5)
    assert not httpc.refused(e.value)


# ── the anime proxies ─────────────────────────────────────────────────────────

anime = pytest.mark.skipif(not (ROOT / "server/api/anime.py").exists(), reason="no Anime here")


def b64(s):
    return base64.urlsafe_b64encode(s.encode()).decode()


@anime
@pytest.mark.parametrize("path", ["/api/anime/hls/seg", "/api/anime/hls/pl", "/api/anime/sub"])
def test_a_playlist_cant_point_the_anime_proxy_inside(client, upstream, path):
    up = upstream({"/admin": (200, {}, b"#EXTM3U\n")})
    r = client.get(path, query_string={"u": b64(f"http://127.0.0.1:{up.port}/admin"),
                                       "r": b64("https://zokoanime.video/")})
    assert r.status_code == 403
    assert "your own network" in r.get_json()["error"]
    assert up.hits == []


@anime
def test_the_anime_proxy_relays_a_public_segment(client, upstream, names):
    table, _ = names
    up = upstream({"/seg_0.ts.jpg": (200, {"Content-Type": "video/mp2t"}, b"G" * 188)})
    table["hls1.example"] = ["127.0.0.1"]
    r = client.get("/api/anime/hls/seg", query_string={"u": b64(f"http://hls1.example:{up.port}/seg_0.ts.jpg"),
                                                        "r": b64("https://zokoanime.video/")})
    assert r.status_code == 200 and r.data == b"G" * 188
    assert up.hits[0]["host"] == f"hls1.example:{up.port}" and up.hits[0]["cookie"] is None


@anime
def test_a_rewritten_playlist_keeps_pointing_through_the_proxy(client, upstream, names):
    table, _ = names
    up = upstream({"/1080/index.m3u8": (200, {}, b"#EXTM3U\n#EXTINF:10,\nseg_0.ts\n")})
    table["hls.example"] = ["127.0.0.1"]
    r = client.get("/api/anime/hls/pl", query_string={"u": b64(f"http://hls.example:{up.port}/1080/index.m3u8")})
    assert r.status_code == 200
    seg = [ln for ln in r.data.decode().splitlines() if ln.startswith("/api/anime/hls/seg")]
    assert len(seg) == 1
