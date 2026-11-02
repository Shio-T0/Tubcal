"""The terminal's mpv over its IPC socket, against a stand-in mpv that speaks the same
protocol: an event handler may ask mpv something, and gets its answer."""

import os
import stat
import sys
import threading
import time

import pytest

from tui.media.mpv import Mpv

# A stand-in mpv: opens the --input-ipc-server socket, says it's idle the moment a client
# connects (as mpv does when it reaches idle after the client is in), then answers
# every command with success. A client that lets go leaves it running for the next one
# (a reload); "quit" ends it.
FAKE_MPV = r'''
import json, os, socket, sys
path = next(a.split("=", 1)[1] for a in sys.argv if a.startswith("--input-ipc-server="))
srv = socket.socket(socket.AF_UNIX)
srv.bind(path)
srv.listen(1)
done = False
while not done:
    conn, _ = srv.accept()
    f = conn.makefile("rwb")
    f.write(b'{"event":"idle"}\n'); f.flush()
    for line in f:
        msg = json.loads(line)
        f.write((json.dumps({"request_id": msg.get("request_id"), "error": "success", "data": None}) + "\n").encode())
        f.flush()
        if msg.get("command", [None])[0] == "quit":
            done = True
            break
    conn.close()
os.unlink(path)
'''


@pytest.fixture
def fake_mpv(tmp_path, monkeypatch):
    exe = tmp_path / "mpv"
    exe.write_text(f"#!{sys.executable}\n{FAKE_MPV}")
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR)
    run = tmp_path / "run"
    run.mkdir(mode=0o700)
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(run))
    return str(exe)


def test_a_handler_can_ask_mpv_when_mpv_goes_idle(fake_mpv):
    """The player answers mpv's `idle` by setting force-window. Asked from the thread
    that reads mpv's answers, that waited 5 s for an answer only it could read, and
    the commands behind it timed out: "mpv didn't answer observe_property"."""
    seen, answered = [], threading.Event()
    box = {}

    def on_event(ev):
        seen.append(ev.get("event"))
        if ev.get("event") == "idle":
            box["mpv"].set("force-window", "no")      # as Player._on_event does
            answered.set()

    m = Mpv(on_event, binary=fake_mpv, mpris=False)
    box["mpv"] = m
    t = time.monotonic()
    try:
        m.ensure()
        m.set("pause", False)
        assert answered.wait(2), "the idle handler never got its answer"
        assert time.monotonic() - t < 2.5
    finally:
        m.close(quit=True)
    deadline = time.monotonic() + 2
    while "mpv-exit" not in seen and time.monotonic() < deadline:
        time.sleep(0.02)
    assert seen[0] == "idle" and seen[-1] == "mpv-exit"


def test_two_mpvs_can_pause_each_other_from_their_handlers(fake_mpv):
    """The video and the radio pause each other when one starts making sound; each
    does it from its own event handler, waiting on the other's answer."""
    done = []
    box = {}
    both_up = threading.Event()

    def handler(me, other):
        def on_event(ev):
            if ev.get("event") == "idle" and both_up.wait(3):
                box[other].set("pause", True)          # Player.on_audible → Radio.pause
                done.append(me)
        return on_event

    a = Mpv(handler("a", "b"), binary=fake_mpv, mpris=False, name="a")
    b = Mpv(handler("b", "a"), binary=fake_mpv, mpris=False, name="b")
    box.update(a=a, b=b)
    try:
        a.ensure()
        b.ensure()
        both_up.set()
        deadline = time.monotonic() + 2.5
        while len(done) < 2 and time.monotonic() < deadline:
            time.sleep(0.02)
        assert sorted(done) == ["a", "b"]
    finally:
        a.close(quit=True)
        b.close(quit=True)


def test_events_keep_their_order(fake_mpv):
    """One thread handles one mpv's events, so they arrive as mpv sent them."""
    seen = []
    m = Mpv(lambda ev: seen.append(ev.get("event")), binary=fake_mpv, mpris=False)
    m.ensure()
    m.close(quit=True)
    deadline = time.monotonic() + 2
    while "mpv-exit" not in seen and time.monotonic() < deadline:
        time.sleep(0.02)
    assert seen == ["idle", "mpv-exit"]


def test_a_kept_mpv_plays_on_and_is_taken_back(fake_mpv):
    """A reload: the old run lets go of mpv without stopping it, and the next run (this
    same process, after exec) takes it back on the same socket."""
    seen = []
    m = Mpv(lambda ev: seen.append(ev.get("event")), binary=fake_mpv, mpris=False)
    m.ensure()
    kept = m.keep()
    assert kept and kept["pid"] > 0 and kept["path"].endswith(f"mpv-{os.getpid()}.sock")
    assert not m.alive
    time.sleep(0.3)
    assert "mpv-exit" not in seen                 # it wasn't an exit: mpv plays on
    os.kill(kept["pid"], 0)                       # still running

    again = []
    m2 = Mpv(lambda ev: again.append(ev.get("event")), binary=fake_mpv, mpris=False)
    assert m2.adopt(kept)
    assert m2.alive
    m2.set("pause", True)                         # it answers
    m2.close(quit=True)
    assert not m2.alive
    assert not os.path.exists(kept["path"])
    try:
        os.kill(kept["pid"], 0)
        raise AssertionError("mpv still running after quit")
    except ProcessLookupError:
        pass                                      # it exited and was reaped


def test_adopt_takes_only_this_processs_own_mpv(fake_mpv, tmp_path):
    m = Mpv(lambda ev: None, binary=fake_mpv, mpris=False)
    m.ensure()
    kept = m.keep()
    try:
        other = Mpv(lambda ev: None, binary=fake_mpv, mpris=False, name="radio")
        assert not other.adopt(kept)                                   # another mpv's socket
        stranger = Mpv(lambda ev: None, binary=fake_mpv, mpris=False)
        assert not stranger.adopt({"pid": os.getppid(), "path": kept["path"]})   # not our child
        assert not stranger.adopt({"pid": "x"}) and not stranger.adopt(None)
    finally:
        mine = Mpv(lambda ev: None, binary=fake_mpv, mpris=False)
        assert mine.adopt(kept)
        mine.close(quit=True)
