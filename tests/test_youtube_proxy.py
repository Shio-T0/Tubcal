"""The Screening Room's segment proxy end to end: a googlevideo URL that stops
working mid-video is swapped for a re-resolved one (the relay's own retries and
resumes are in test_media_relay.py)."""

import base64

import pytest
import requests

from server import httpc
from server.api import youtube as yt_api


class FakeResp:
    def __init__(self, status=200, body=b"", headers=None, break_after=None):
        self.status_code = status
        self.headers = headers or {}
        self._body = body
        self._break_after = break_after
        self.closed = False

    def iter_content(self, chunk_size=65536):
        sent = 0
        while sent < len(self._body):
            if self._break_after is not None and sent >= self._break_after:
                raise requests.exceptions.ChunkedEncodingError("connection broken")
            chunk = self._body[sent:sent + 10]
            sent += len(chunk)
            yield chunk

    def close(self):
        self.closed = True


class FakeSession:
    """Answers GETs from a script: a list of responses or exceptions, in order."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def get(self, url, headers=None, **kw):
        self.calls.append((url, dict(headers or {})))
        nxt = self.script.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(httpc.time, "sleep", lambda s: None)


# ── the YouTube segment proxy end to end ─────────────────────────────────────

def _tok(url):
    return base64.urlsafe_b64encode(url.encode()).decode()


def test_segment_proxy_survives_a_dead_url(client, monkeypatch):
    stale = "https://rr1.googlevideo.com/videoplayback?itag=137&ip=1.1.1.1&sig=old"
    fresh = "https://rr2.googlevideo.com/videoplayback?itag=137&ip=2.2.2.2&sig=new"
    monkeypatch.setattr(yt_api, "_FRESH", {})
    monkeypatch.setattr(yt_api, "_refreshed_at", {})
    monkeypatch.setattr(yt_api.youtube, "video_streams", lambda vid: {
        "streams": [{"kind": "hls", "itag": "137", "adaptive": True, "url": fresh}],
        "audio": [{"url": "https://rr2.googlevideo.com/videoplayback?itag=140&sig=a"}],
    })
    sess = FakeSession([
        FakeResp(403),  # the old URL: minted for an IP we no longer have
        FakeResp(206, b"seg-bytes", {"Content-Range": "bytes 0-8/100", "Content-Type": "video/mp4"}),
        FakeResp(206, b"next-seg", {"Content-Range": "bytes 9-16/100", "Content-Type": "video/mp4"}),
    ])
    monkeypatch.setattr(httpc, "anon_session", sess)

    r = client.get(f"/api/youtube/hls/seg?u={_tok(stale)}&v=dQw4w9WgXcQ", headers={"Range": "bytes=0-8"})
    assert r.status_code == 206 and r.data == b"seg-bytes"
    assert sess.calls[1][0] == fresh and sess.calls[1][1]["Range"] == "bytes=0-8"

    # the next segment of the old URL goes straight to the fresh one
    r = client.get(f"/api/youtube/hls/seg?u={_tok(stale)}&v=dQw4w9WgXcQ", headers={"Range": "bytes=9-16"})
    assert r.data == b"next-seg"
    assert sess.calls[2][0] == fresh


def test_segment_proxy_still_refuses_other_hosts(client):
    r = client.get(f"/api/youtube/hls/seg?u={_tok('https://evil.example.com/x')}")
    assert r.status_code == 403


def test_fresh_url_matches_the_same_rendition(client, monkeypatch):
    # `client` points the cache at a throwaway DB: _fresh_url invalidates rows.
    monkeypatch.setattr(yt_api, "_FRESH", {})
    monkeypatch.setattr(yt_api, "_refreshed_at", {})
    monkeypatch.setattr(yt_api.youtube, "video_streams", lambda vid: {
        "streams": [{"url": "https://g.googlevideo.com/v?itag=18"}, {"url": "https://g.googlevideo.com/v?itag=137&n=2"}],
        "audio": [{"url": "https://g.googlevideo.com/v?itag=140&n=2"}],
    })
    assert yt_api._fresh_url("abc123def45", "https://g.googlevideo.com/v?itag=140&n=1").endswith("itag=140&n=2")
    assert yt_api._current_url("https://g.googlevideo.com/v?itag=140&n=1").endswith("n=2")
    assert yt_api._fresh_url("abc123def45", "https://g.googlevideo.com/v?itag=999") is None
