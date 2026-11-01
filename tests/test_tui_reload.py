"""Reloading the terminal (`ZR`, `:reload`): the note one run leaves the next, running
again in place, and what's playing carrying on through it."""

import json
import os
import stat
import sys

import httpx
import pytest

from tui import reload
from tui.api import Api
from tui.media import player as player_mod
from tui.media import sleep as sleep_mod
from tui.media.player import NowState, Player, Playing


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    run = tmp_path / "run"
    run.mkdir(mode=0o700)
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(run))
    monkeypatch.delenv(reload.ENV, raising=False)
    return run


# ── the note ─────────────────────────────────────────────────────────────────

def test_the_note_is_private_read_once_and_gone(runtime, monkeypatch):
    path = reload.write({"room": "anime", "private": True})
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert os.path.dirname(path) == str(runtime / "tubcal")
    monkeypatch.setenv(reload.ENV, path)
    assert reload.take() == {"room": "anime", "private": True}
    assert reload.ENV not in os.environ            # nothing started later inherits it
    assert not os.path.exists(path)
    assert reload.take() == {}                     # once


def test_a_note_that_isnt_this_processs_is_ignored(runtime, monkeypatch):
    other = runtime / "tubcal" / "handoff-1.json"
    other.parent.mkdir(mode=0o700, exist_ok=True)
    other.write_text(json.dumps({"room": "wire"}))
    monkeypatch.setenv(reload.ENV, str(other))
    assert reload.take() == {}
    assert other.exists()                          # and left alone


def test_again_runs_the_interface_in_this_process(runtime, monkeypatch):
    seen = {}

    def fake_exec(exe, argv):
        seen.update(exe=exe, argv=argv, env=os.environ.get(reload.ENV), cwd=os.getcwd())
        raise SystemExit(0)

    monkeypatch.setattr(os, "execv", fake_exec)
    here = os.getcwd()
    try:
        with pytest.raises(SystemExit):
            reload.again(reload.Reload("/run/note.json", private=True))
    finally:
        os.chdir(here)
    assert seen["exe"] == sys.executable
    assert seen["argv"] == [sys.executable, "-m", "tui", "--private"]
    assert seen["env"] == "/run/note.json"
    assert seen["cwd"] == str(reload.ROOT)        # where `python -m tui` finds it, as the launcher runs it


def test_when_it_cant_run_again_the_kept_mpv_stops(runtime, monkeypatch, capsys):
    killed = []
    monkeypatch.setattr(os, "execv", lambda *a: (_ for _ in ()).throw(OSError("no python")))
    monkeypatch.setattr(os, "kill", lambda pid, sig: killed.append(pid))
    note = reload.write({"player": {"mpv": {"pid": 4242, "path": "x"}}, "radio": None})
    here = os.getcwd()
    try:
        assert reload.again(reload.Reload(note, private=False)) == 1
    finally:
        os.chdir(here)
    assert killed == [4242] and not os.path.exists(note)
    assert "tubcal tui" in capsys.readouterr().err


# ── what's playing ───────────────────────────────────────────────────────────

class KeptMpv:
    """A stand-in that can be let go of and taken back, as a reload does."""

    def __init__(self, on_event, **kw):
        self.on_event = on_event
        self.alive = False
        self.calls = []
        self.kept = None

    def ensure(self):
        self.alive = True

    def command(self, *args, timeout=5.0):
        self.calls.append(args)

    def set(self, prop, value):
        self.calls.append(("set", prop, value))

    def get(self, prop, default=None):
        return default

    def message(self, *args):
        self.calls.append(("script-message", *args))

    def keep(self):
        if not self.alive:
            return None
        self.alive = False
        return {"pid": 99, "path": "/run/tubcal/mpv-1.sock"}

    def adopt(self, kept):
        self.kept = kept
        self.alive = bool(kept)
        return self.alive

    def close(self, quit=False):
        self.alive = False


ITEM = {"id": "yt:vid12345678", "platform": "youtube", "title": "A video", "extra": {"video_id": "vid12345678"}}
NEXT = {"id": "yt:nextvideo00", "platform": "youtube", "title": "Next one", "extra": {"video_id": "nextvideo00"}}


@pytest.fixture
def make_player(monkeypatch):
    monkeypatch.setattr(player_mod, "Mpv", KeptMpv)
    log = []

    def handler(req: httpx.Request):
        log.append((req.method, req.url.path, json.loads(req.content) if req.content else None))
        return httpx.Response(200, json={"ok": True, "data": None})

    def make():
        api = Api("http://127.0.0.1:5000", transport=httpx.MockTransport(handler))
        return Player(api, notify=lambda t, l: None, changed=lambda: None)
    return make, log


def test_a_video_plays_on_through_a_reload(make_player):
    make, log = make_player
    old = make()
    old.mpv.ensure()
    old.playing = Playing(item=ITEM, url="http://127.0.0.1:5000/api/youtube/hls/vid12345678/137.m3u8",
                          itag="137", heights=[1080, 720], quality="1080p")
    old.queue = [NEXT]
    old.now = NowState(title="A video", pos=120.0, dur=400.0, active=True)

    note = old.hand_over()
    # where you are is on the server before the restart (no thread left behind)
    assert ("POST", "/api/progress", {"item_id": "yt:vid12345678", "position": 120.0, "duration": 400.0}) in log
    assert note["mpv"] == {"pid": 99, "path": "/run/tubcal/mpv-1.sock"} and note["queue"] == [NEXT]
    json.dumps(note)                                  # it has to go through a file

    new = make()
    assert new.take_over(json.loads(json.dumps(note)))
    assert new.mpv.kept == note["mpv"]
    assert new.playing.item == ITEM and new.playing.itag == "137" and new.playing.heights == [1080, 720]
    assert new.queue == [NEXT] and new.now.queue == 1 and new.now.active and new.now.title == "A video"
    assert ("script-message", "tubcal-has-next", "yes") in new.mpv.calls


def test_with_nothing_playing_mpv_stops_and_nothing_is_handed_over(make_player):
    make, _ = make_player
    p = make()
    p.mpv.ensure()
    assert p.hand_over() is None and not p.mpv.alive
    assert make().take_over(None) is False


def test_when_mpv_went_away_the_next_run_plays_nothing(make_player, monkeypatch):
    make, _ = make_player
    p = make()
    monkeypatch.setattr(p.mpv, "adopt", lambda kept: False)
    assert not p.take_over({"item": ITEM, "mpv": {"pid": 1, "path": "x"}})
    assert p.playing is None and not p.now.active


def test_the_sleep_timer_carries_on_and_a_fade_gives_the_volume_back():
    class M:
        alive = True

        def __init__(self):
            self.props = {"volume": 70}

        def set(self, k, v):
            self.props[k] = v

    m = M()
    t = sleep_mod.SleepTimer(lambda: [m], notify=lambda s, l: None, changed=lambda: None)
    t.set_seconds(600)
    note = t.hand_over()
    assert note["mode"] == "time" and 590 < note["left"] <= 600

    fading = sleep_mod.SleepTimer(lambda: [m], notify=lambda s, l: None, changed=lambda: None)
    fading.set_seconds(5)
    fading._loud = [(m, 70.0)]
    m.props["volume"] = 20                         # half-way down
    fading.hand_over()
    assert m.props["volume"] == 70.0               # back, for the next run to fade again

    new = sleep_mod.SleepTimer(lambda: [m], notify=lambda s, l: None, changed=lambda: None)
    new.take_over(json.loads(json.dumps(note)))
    assert new.mode == "time" and 580 < new.left() <= 600
    end = sleep_mod.SleepTimer(lambda: [m], notify=lambda s, l: None, changed=lambda: None)
    end.take_over({"mode": "end"})
    assert end.label() == "end"
