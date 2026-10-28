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
