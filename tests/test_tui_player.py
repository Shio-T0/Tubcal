"""The terminal's player with a stand-in mpv: what it loads, from where, what it tells
the server and in which order."""

import json
import threading
import time

import httpx
import pytest

from tui.api import Api
from tui.media import player as player_mod
from tui.media.player import Player


class FakeMpv:
    def __init__(self, on_event, **kw):
        self.on_event = on_event
        self.calls = []
        self.props = {"time-pos": 0.0, "pause": False}
        self.alive = False

    def ensure(self):
        self.alive = True

    def command(self, *args, timeout=5.0):
        self.calls.append(args)
        if args[0] == "get_property":
            return self.props.get(args[1])
        return None

    def get(self, prop, default=None):
        return self.props.get(prop, default)

    def set(self, prop, value):
        self.calls.append(("set", prop, value))
        self.props[prop] = value

    def message(self, *args):
        self.calls.append(("script-message", *args))

    def close(self, quit=False):
        self.alive = False


STREAMS = {"streams": [
    {"kind": "hls", "itag": "137", "quality": "1080p", "height": 1080, "adaptive": True},
    {"kind": "hls", "itag": "136", "quality": "720p", "height": 720, "adaptive": True},
    {"kind": "mp4", "itag": "18", "quality": "360p", "height": 360},
]}


@pytest.fixture
def world(monkeypatch):
    monkeypatch.setattr(player_mod, "Mpv", FakeMpv)
    log = []

    def handler(req: httpx.Request):
        path = req.url.path
        body = json.loads(req.content) if req.content else None
        log.append((req.method, path, body))
        data = None
        if path == "/api/youtube/stream/vid12345678":
            data = STREAMS
        elif path == "/api/youtube/video/vid12345678":
            data = {"chapters": [{"start": 0, "end": 60, "title": "Intro"}]}
        elif path == "/api/progress" and req.method == "GET":
            data = {"progress": {"yt:vid12345678": {"position": 100.0, "duration": 400.0}}}
        elif path.startswith("/api/anime/stream/"):
            data = {"streams": [{"kind": "hls", "itag": "auto", "quality": "auto"}],
                    "subtitles": [{"src": "/api/anime/sub?u=a&r=b", "lang": "en", "label": "English"},
                                  {"src": "/api/anime/sub?u=c&r=d", "lang": "de", "label": "German"}],
                    "skip": {"intro": {"start": 40, "end": 130}}}
        return httpx.Response(200, json={"ok": True, "data": data})

    api = Api("http://127.0.0.1:5000", transport=httpx.MockTransport(handler))
    msgs = []
    p = Player(api, notify=lambda t, l: msgs.append((l, t)), changed=lambda: None,
               settings={"playback_rate": 1.25, "player_volume": 0.5, "anime_auto_skip": True})
    p.load_progress()
    return p, log, msgs


VIDEO = {"id": "yt:vid12345678", "platform": "youtube", "title": "A video", "source": "A channel",
         "url": "https://www.youtube.com/watch?v=vid12345678", "extra": {"video_id": "vid12345678"}}


def wait_for(cond, t=3):
    end = time.time() + t
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


def test_a_video_plays_from_the_servers_master_with_its_resume_point(world):
    p, log, msgs = world
    p.play(VIDEO)
    assert wait_for(lambda: any(c[0] == "loadfile" for c in p.mpv.calls))
    load = next(c for c in p.mpv.calls if c[0] == "loadfile")
    assert load[1] == "http://127.0.0.1:5000/api/youtube/hls/vid12345678/137.m3u8"
    opts = load[4]
    assert opts["ytdl"] == "no" and opts["start"] == "98.00" and opts["force-media-title"] == "A video"
    assert ("set", "speed", 1.25) in p.mpv.calls and ("set", "volume", 50) in p.mpv.calls
    # history is posted before the file is loaded
    posts = [x for x in log if x[0] == "POST"]
    assert posts[0][1] == "/api/history" and posts[0][2]["item"]["id"] == VIDEO["id"]
    assert wait_for(lambda: any(c[:2] == ("script-message", "tubcal-chapters") for c in p.mpv.calls))
    assert not msgs


def test_a_height_cap_picks_a_lower_rung(world):
    p, log, _ = world
    p.config["video_max_height"] = 720
    p.play(VIDEO)
    assert wait_for(lambda: any(c[0] == "loadfile" for c in p.mpv.calls))
    assert next(c for c in p.mpv.calls if c[0] == "loadfile")[1].endswith("/136.m3u8")


def test_progress_is_posted_on_pause_and_at_the_end(world):
    p, log, _ = world
    p.play(VIDEO)
    assert wait_for(lambda: p.playing is not None)
    p._on_event({"event": "property-change", "name": "duration", "data": 400.0})
    p._on_event({"event": "property-change", "name": "time-pos", "data": 150.0})
    p._on_event({"event": "property-change", "name": "pause", "data": True})
    assert wait_for(lambda: any(x[1] == "/api/progress" and x[0] == "POST" for x in log))
    sent = next(x for x in log if x[1] == "/api/progress" and x[0] == "POST")[2]
    assert sent == {"item_id": "yt:vid12345678", "position": 150.0, "duration": 400.0}
    p._on_event({"event": "property-change", "name": "time-pos", "data": 399.6})
    p._on_event({"event": "end-file", "reason": "eof"})
    assert wait_for(lambda: p.progress["yt:vid12345678"]["position"] == 400.0)


def test_the_queue_follows_on(world):
    p, log, _ = world
    other = dict(VIDEO, id="yt:other", title="Next one")
    p.enqueue(other)
    assert ("script-message", "tubcal-has-next", "yes") not in p.mpv.calls  # mpv not started yet
    p.play(VIDEO)
    assert wait_for(lambda: p.playing is not None)
    p._on_event({"event": "end-file", "reason": "eof"})
    assert wait_for(lambda: p.now.title == "Next one")


def test_an_anime_episode_gets_subtitles_and_the_skip_cue(world):
    p, log, _ = world
    ep = {"id": "anime:1:8", "platform": "anime", "title": "Show · Episode 8",
          "extra": {"stream_key": "KEY", "anilist_id": 1, "episode": 8}}
    p.play(ep)
    assert wait_for(lambda: any(c[0] == "sub-add" for c in p.mpv.calls))
    load = next(c for c in p.mpv.calls if c[0] == "loadfile")
    assert load[1] == "http://127.0.0.1:5000/api/anime/hls/KEY/auto.m3u8"
    subs = [c for c in p.mpv.calls if c[0] == "sub-add"]
    assert subs[0][1].endswith("/api/anime/sub?u=a&r=b") and subs[0][2] == "select"
    assert subs[1][2] == "auto"
    skip = next(c for c in p.mpv.calls if c[:2] == ("script-message", "tubcal-skip"))
    assert json.loads(skip[2]) == {"intro": {"start": 40, "end": 130}, "auto": True}


def test_quality_reloads_at_the_same_place(world):
    p, log, _ = world
    p.play(VIDEO)
    assert wait_for(lambda: p.playing is not None)
    p.mpv.props.update({"time-pos": 212.5, "pause": True})
    p.mpv.calls.clear()
    p.set_quality(720)
    assert wait_for(lambda: any(c[0] == "loadfile" for c in p.mpv.calls))
    load = next(c for c in p.mpv.calls if c[0] == "loadfile")
    assert load[1].endswith("/136.m3u8") and load[4]["start"] == "212.50"
    assert wait_for(lambda: ("set", "pause", True) in p.mpv.calls)


def test_ytdl_mode_is_a_choice_and_keeps_no_cookies(world):
    p, log, _ = world
    p.config["youtube_player"] = "ytdl"
    p.play(VIDEO)
    assert wait_for(lambda: any(c[0] == "loadfile" for c in p.mpv.calls))
    load = next(c for c in p.mpv.calls if c[0] == "loadfile")
    assert load[1] == "https://www.youtube.com/watch?v=vid12345678"
    assert load[4]["ytdl"] == "yes"
    assert "no-cookies-from-browser=" in load[4]["ytdl-raw-options"]
    assert not any(x[1].startswith("/api/youtube/stream") for x in log)


def test_private_posts_nothing(world):
    p, log, _ = world
    p.api.private = True
    p.play(VIDEO)
    assert wait_for(lambda: p.playing is not None)
    p._on_event({"event": "property-change", "name": "duration", "data": 400.0})
    p._on_event({"event": "property-change", "name": "pause", "data": True})
    time.sleep(0.2)
    assert not [x for x in log if x[0] == "POST"]


def test_the_next_episode_follows_when_the_queue_is_empty(world):
    p, log, _ = world
    ep = {"id": "anime:1:8", "platform": "anime", "title": "Show — Episode 8",
          "extra": {"stream_key": "KEY", "anilist_id": 1, "episode": 8}}
    p.follow = lambda item: dict(ep, id="anime:1:9", title="Show — Episode 9") if item["id"] == "anime:1:8" else None
    p.play(ep)
    assert wait_for(lambda: p.playing is not None and p.playing.item["id"] == "anime:1:8")
    p._on_event({"event": "end-file", "reason": "eof"})
    assert wait_for(lambda: p.playing is not None and p.playing.item["id"] == "anime:1:9")
