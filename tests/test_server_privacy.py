"""Two things the server keeps to itself: what you asked for (the access log) and who
you are to YouTube (yt-dlp never loads cookies, whatever its own config says)."""

import ast
import logging
from pathlib import Path

import pytest

import main

ROOT = Path(__file__).resolve().parents[1]


def record(line, code):
    return logging.LogRecord("werkzeug", logging.INFO, "", 0, '"%s" %s %s', (line, code, "-"), None)


def test_requests_that_worked_are_not_logged():
    f = main._QuietAccessLog()
    assert not f.filter(record("GET /api/youtube/search?q=what+i+searched HTTP/1.1", "200"))
    assert not f.filter(record("GET /api/youtube/hls/seg?u=aHR0cHM6Ly9yc&v=x HTTP/1.1", "206"))


def test_failures_are_logged_without_their_query():
    f = main._QuietAccessLog()
    r = record("GET /api/youtube/search?q=what+i+searched HTTP/1.1", "502")
    assert f.filter(r)
    assert r.getMessage() == '"GET /api/youtube/search HTTP/1.1" 502 -'


def test_the_filter_sees_werkzeugs_own_lines(monkeypatch):
    # Werkzeug puts the address and date into the format string; a filter that only
    # knew the bare '"%s" %s %s' let every line through, query strings and all.
    from werkzeug.serving import WSGIRequestHandler

    seen = []

    class Keep(logging.Handler):
        def emit(self, r):
            seen.append(r.getMessage())

    log = logging.getLogger("werkzeug")
    quiet, keep = main._QuietAccessLog(), Keep()
    log.addFilter(quiet)
    log.addHandler(keep)
    monkeypatch.setattr(log, "level", logging.INFO)
    handler = WSGIRequestHandler.__new__(WSGIRequestHandler)
    handler.client_address = ("127.0.0.1", 40000)
    handler.requestline = "GET /api/youtube/search?q=what+i+searched HTTP/1.1"
    handler.request_version = "HTTP/1.1"
    handler.command = "GET"
    handler.path = "/api/youtube/search?q=what+i+searched"
    try:
        handler.log_request(200)
        handler.log_request(502)
    finally:
        log.removeFilter(quiet)
        log.removeHandler(keep)
    assert len(seen) == 1 and "502" in seen[0]
    assert "what+i+searched" not in seen[0] and "/api/youtube/search" in seen[0]


def test_other_lines_pass():
    f = main._QuietAccessLog()
    r = logging.LogRecord("werkzeug", logging.INFO, "", 0, " * Running on %s", ("http://127.0.0.1:5000",), None)
    assert f.filter(r)


@pytest.mark.skipif(not (ROOT / "server/sources/youtube.py").exists(), reason="no Screening Room here")
def test_every_yt_dlp_call_is_anonymous():
    src = (ROOT / "server/sources/youtube.py").read_text()
    calls = []
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.List) and node.elts and isinstance(node.elts[0], ast.Name) and node.elts[0].id == "exe":
            calls.append(node)
    assert calls, "found no yt-dlp command lines"
    for node in calls:
        starred = [e.value.id for e in node.elts if isinstance(e, ast.Starred) and isinstance(e.value, ast.Name)]
        assert "YTDLP_ANON" in starred, f"line {node.lineno}: yt-dlp without YTDLP_ANON"
