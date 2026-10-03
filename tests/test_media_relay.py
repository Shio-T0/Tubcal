"""Media relay resilience: retries, swapping in a re-resolved URL when the CDN
refuses the old one, and resuming a body whose connection breaks mid-way — the
things that otherwise stop a video partway through."""

import base64

import pytest
import requests

from server import httpc
from server.api import feeds
from server.api.relay import body_span, resumable_chunks


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


def test_stream_get_retries_connection_errors(monkeypatch):
    sess = FakeSession([requests.ConnectionError("reset"), requests.Timeout("slow"), FakeResp(200, b"ok")])
    monkeypatch.setattr(httpc, "anon_session", sess)
    r = httpc.stream_get("https://x.googlevideo.com/a", anonymous=True)
    assert r.status_code == 200 and len(sess.calls) == 3


def test_stream_get_retries_server_errors_then_returns_last(monkeypatch):
    sess = FakeSession([FakeResp(503), FakeResp(502), FakeResp(503), FakeResp(503)])
    monkeypatch.setattr(httpc, "anon_session", sess)
    r = httpc.stream_get("https://x/a", anonymous=True, attempts=4)
    assert r.status_code == 503 and len(sess.calls) == 4


def test_stream_get_swaps_in_a_refreshed_url_on_refusal(monkeypatch):
    sess = FakeSession([FakeResp(403), FakeResp(206, b"bytes")])
    monkeypatch.setattr(httpc, "anon_session", sess)
    asked = []
    r = httpc.stream_get(
        "https://old/a", anonymous=True, headers={"Range": "bytes=10-20"},
        refresh=lambda stale: asked.append(stale) or "https://new/a",
    )
    assert r.status_code == 206
    assert asked == ["https://old/a"]
    assert sess.calls[1][0] == "https://new/a"
    assert sess.calls[1][1]["Range"] == "bytes=10-20"  # the same bytes, from the new URL


def test_stream_get_refusal_without_a_replacement_is_returned(monkeypatch):
    sess = FakeSession([FakeResp(403)])
    monkeypatch.setattr(httpc, "anon_session", sess)
    assert httpc.stream_get("https://old/a", anonymous=True, refresh=lambda s: None).status_code == 403


def test_stream_get_raises_when_nothing_answers(monkeypatch):
    sess = FakeSession([requests.ConnectionError("down")] * 3)
    monkeypatch.setattr(httpc, "anon_session", sess)
    with pytest.raises(requests.ConnectionError):
        httpc.stream_get("https://x/a", anonymous=True, attempts=3)


def test_body_span():
    assert body_span(FakeResp(206, headers={"Content-Range": "bytes 100-199/1000"})) == (100, 199)
    assert body_span(FakeResp(200)) == (0, None)
    assert body_span(FakeResp(403)) is None


def test_a_body_broken_midway_is_resumed_from_the_exact_byte():
    full = bytes(range(100))
    first = FakeResp(206, full, {"Content-Range": "bytes 500-599/9000"}, break_after=40)
    asked = []

    def reopen(rng):
        asked.append(rng)
        return FakeResp(206, full[40:], {"Content-Range": "bytes 540-599/9000"})

    out = b"".join(resumable_chunks(first, reopen))
    assert out == full
    assert asked == ["bytes=540-599"]
    assert first.closed


def test_a_full_200_body_resumes_open_ended():
    full = b"x" * 55
    first = FakeResp(200, full, break_after=30)
    asked = []

    def reopen(rng):
        asked.append(rng)
        return FakeResp(206, full[30:], {"Content-Range": "bytes 30-54/55"})

    assert b"".join(resumable_chunks(first, reopen)) == full
    assert asked == ["bytes=30-"]


def test_resume_gives_up_when_the_remainder_isnt_served():
    first = FakeResp(206, b"y" * 50, {"Content-Range": "bytes 0-49/50"}, break_after=20)
    with pytest.raises(requests.RequestException):
        b"".join(resumable_chunks(first, lambda rng: FakeResp(200, b"whole file again")))


def test_without_reopen_a_break_still_surfaces():
    first = FakeResp(206, b"z" * 30, {"Content-Range": "bytes 0-29/30"}, break_after=10)
    with pytest.raises(requests.RequestException):
        b"".join(resumable_chunks(first))


# ── the YouTube segment proxy end to end ─────────────────────────────────────

def _tok(url):
    return base64.urlsafe_b64encode(url.encode()).decode()


def test_segment_proxy_survives_a_dead_url(client, monkeypatch):
    stale = "https://rr1.googlevideo.com/videoplayback?itag=137&ip=1.1.1.1&sig=old"
    fresh = "https://rr2.googlevideo.com/videoplayback?itag=137&ip=2.2.2.2&sig=new"
    monkeypatch.setattr(feeds, "_FRESH", {})
    monkeypatch.setattr(feeds, "_refreshed_at", {})
    monkeypatch.setattr(feeds.youtube, "video_streams", lambda vid: {
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


def test_fresh_url_matches_the_same_rendition(monkeypatch):
    monkeypatch.setattr(feeds, "_FRESH", {})
    monkeypatch.setattr(feeds, "_refreshed_at", {})
    monkeypatch.setattr(feeds.youtube, "video_streams", lambda vid: {
        "streams": [{"url": "https://g.googlevideo.com/v?itag=18"}, {"url": "https://g.googlevideo.com/v?itag=137&n=2"}],
        "audio": [{"url": "https://g.googlevideo.com/v?itag=140&n=2"}],
    })
    assert feeds._fresh_url("abc123def45", "https://g.googlevideo.com/v?itag=140&n=1").endswith("itag=140&n=2")
    assert feeds._current_url("https://g.googlevideo.com/v?itag=140&n=1").endswith("n=2")
    assert feeds._fresh_url("abc123def45", "https://g.googlevideo.com/v?itag=999") is None
