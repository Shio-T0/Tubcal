"""The terminal's extras: writing in your own editor, the sleep timer, the bench radio and
what the state file keeps."""

import os
import stat
import time

import pytest

from tui import editor
from tui.media import sleep as sleep_mod
from tui.media.radio import Radio, episode_of, podcast_item
from tui.state import State


# ── writing in your editor ───────────────────────────────────────────────────

def test_the_editor_is_the_config_then_visual_then_nvim(monkeypatch):
    have = {"nvim", "hx"}
    monkeypatch.setattr(editor.shutil, "which", lambda b: f"/usr/bin/{b}" if b in have else None)
    monkeypatch.setenv("VISUAL", "hx --vsplit")
    monkeypatch.setenv("EDITOR", "geany")          # not installed: never chosen
    assert editor.resolve("") == ["hx", "--vsplit"]
    assert editor.resolve("nvim -u NONE") == ["nvim", "-u", "NONE"]
    monkeypatch.delenv("VISUAL")
    assert editor.resolve("") == ["nvim"]
    have.clear()
    assert editor.resolve("") is None


def test_nvim_leaves_no_trace_of_a_draft_but_opens_your_files_as_usual():
    cmd = editor.command(["nvim"], "/run/user/1000/tubcal/draft-x.md")
    assert cmd[:3] == ["nvim", "-n", "-i"] and cmd[-1] == "/run/user/1000/tubcal/draft-x.md"
    joined = " ".join(cmd)
    for flag in ("setlocal noundofile", "set clipboard=", "VeryLazy ++once set clipboard=", 'require("persistence").stop()'):
        assert flag in joined
    assert sum(1 for c in cmd if c == "-c") <= 10      # nvim's own limit
    assert editor.command(["nvim"], "/home/me/src/main.rs", private=False, line=12) == \
        ["nvim", "+12", "/home/me/src/main.rs"]
    assert editor.command(["hx"], "/tmp/d.md") == ["hx", "/tmp/d.md"]


def test_the_scissors_line_keeps_the_context_out():
    text = editor.with_context("my note", ["About: a video", "> quoted"])
    assert text.startswith("my note\n\n" + editor.SCISSORS)
    assert editor.without_context(text) == "my note"
    assert editor.without_context("  plain text  \n") == "plain text"
    assert editor.without_context("written\n" + editor.SCISSORS + "\nwritten under it\n") == "written"


class FakeApp:
    def __init__(self, tmp):
        self.cfg = {"editor": "nvim"}
        self.said, self.resumed = [], 0
        self.tmp = tmp

    def say(self, text, level="info"):
        self.said.append((text, level))

    def after_suspend(self):
        self.resumed += 1


@pytest.fixture
def drafts(tmp_path, monkeypatch):
    monkeypatch.setattr(editor, "drafts_dir", lambda: tmp_path)
    monkeypatch.setattr(editor.shutil, "which", lambda b: f"/usr/bin/{b}")
    return tmp_path


def test_compose_returns_what_you_wrote_and_deletes_the_draft(drafts, monkeypatch):
    seen = {}

    def run(app, cmd):
        path = cmd[-1]
        seen["mode"] = stat.S_IMODE(os.stat(path).st_mode)
        seen["before"] = text = open(path).read()
        # a line added under the note, and one under the scissors (left out)
        with open(path, "w") as f:
            f.write(text.replace("first line\n", "first line\nand a second line\n", 1) + "a stray line\n")
        return 0
    monkeypatch.setattr(editor, "run_editor", run)
    app = FakeApp(drafts)
    out = editor.compose(app, "first line", context=["Your note on: X"])
    assert out == "first line\nand a second line"
    assert seen["mode"] == 0o600 and "Your note on: X" in seen["before"]
    assert list(drafts.iterdir()) == [] and app.resumed == 1


def test_an_unchanged_draft_sends_nothing(drafts, monkeypatch):
    monkeypatch.setattr(editor, "run_editor", lambda app, cmd: 0)
    app = FakeApp(drafts)
    assert editor.compose(app, "keep me") is None
    assert list(drafts.iterdir()) == []


def test_an_emptied_draft_is_an_empty_text(drafts, monkeypatch):
    def run(app, cmd):
        open(cmd[-1], "w").close()
        return 0
    monkeypatch.setattr(editor, "run_editor", run)
    assert editor.compose(FakeApp(drafts), "an old note") == ""


def test_an_editor_that_cant_run_says_so(drafts, monkeypatch):
    def run(app, cmd):
        raise OSError("no terminal to hand over")
    monkeypatch.setattr(editor, "run_editor", run)
    app = FakeApp(drafts)
    assert editor.compose(app, "x") is None
    assert "didn't run" in app.said[-1][0] and list(drafts.iterdir()) == []


# ── the sleep timer ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("words, value", [
    ("30", 1800), ("30m", 1800), ("1h", 3600), ("1h30", 5400), ("1:30", 5400), ("90s", 90), ("1m30", 90),
    ("end", "end"), ("off", "off"), ("", None), ("soon", None), ("1x", None),
])
def test_sleep_words(words, value):
    assert sleep_mod.parse(words) == value


class FakeMpv:
    def __init__(self, playing=True, volume=80):
        self.alive = True
        self.props = {"pause": not playing, "idle-active": False, "volume": volume}
        self.volumes = []

    def get(self, prop, default=None):
        return self.props.get(prop, default)

    def set(self, prop, value):
        self.props[prop] = value
        if prop == "volume":
            self.volumes.append(value)


def test_the_fade_ends_silent_on_time_and_puts_the_volume_back(monkeypatch):
    monkeypatch.setattr(sleep_mod, "FADE", 0.6)
    monkeypatch.setattr(sleep_mod, "STEP", 0.05)
    video, radio = FakeMpv(playing=True, volume=80), FakeMpv(playing=False, volume=50)
    said = []
    t = sleep_mod.SleepTimer(lambda: [video, radio], notify=lambda s, lvl: said.append(s), changed=lambda: None)
    t.set_seconds(0.5)          # a second at least
    assert t.label() in ("0:01", "0:00")
    for _ in range(60):         # the app ticks every second; faster here
        t.tick()
        time.sleep(0.05)
        if not t.on:
            break
    assert not t.on and video.props["pause"] and radio.props["pause"]
    assert min(video.volumes) < 40 and video.props["volume"] == 80   # faded, then put back
    assert radio.volumes == []                                       # it was silent: left alone
    assert "Good night" in said[-1]


def test_cancelling_during_the_fade_keeps_playing(monkeypatch):
    monkeypatch.setattr(sleep_mod, "FADE", 1.0)
    monkeypatch.setattr(sleep_mod, "STEP", 0.05)
    m = FakeMpv(volume=70)
    t = sleep_mod.SleepTimer(lambda: [m], notify=lambda s, lvl: None, changed=lambda: None)
    t.set_seconds(1)
    t.tick()
    time.sleep(0.2)
    assert m.volumes and m.volumes[-1] < 70
    t.cancel()
    time.sleep(0.2)
    assert not m.props["pause"] and m.props["volume"] == 70


def test_end_of_this_one_stops_once_and_pauses_the_rest():
    other = FakeMpv(playing=True)
    t = sleep_mod.SleepTimer(lambda: [other], notify=lambda s, lvl: None, changed=lambda: None)
    assert t.ended() is False
    t.set_end()
    assert t.label() == "end"
    assert t.ended() is True and not t.on
    time.sleep(0.1)
    assert other.props["pause"]
    assert t.ended() is False


# ── the radio ────────────────────────────────────────────────────────────────

EP = {"id": "dev:pod:python:https://x.fm/1.mp3", "title": "Episode 1", "show": "A Show", "show_art": None,
      "audio": "https://x.fm/1.mp3", "duration": 3000, "url": "https://x.fm/1", "published_at": 100}


def test_a_saved_episode_and_back():
    item = podcast_item(EP, "python")
    assert item["id"] == "podcast:" + EP["id"] and item["extra"]["kind"] == "podcast"
    ep = episode_of(item)
    assert {k: ep[k] for k in ("id", "title", "show", "audio", "duration", "lang")} == \
        {"id": EP["id"], "title": "Episode 1", "show": "A Show", "audio": EP["audio"], "duration": 3000, "lang": "python"}


def radio(tmp_path, private=False):
    st = State(private=private, file=tmp_path / "tui.json")
    said = []
    r = Radio(st, notify=lambda s, lvl: said.append((s, lvl)), changed=lambda: None)
    return r, st, said


def test_the_radio_keeps_your_place_and_forgets_a_finished_one(tmp_path):
    r, st, _ = radio(tmp_path)
    r.episode = EP
    r.now.pos, r.now.dur = 1234.5, 3000
    r._keep_place()
    assert st.data["radio"] == [[EP["id"], 1234]] and r.place_of(EP["id"]) == 1234
    assert r.left(EP) == pytest.approx(3000 - 1234.5)
    assert State(file=tmp_path / "tui.json").data["radio"] == [[EP["id"], 1234]]   # survives a restart
    r.now.pos = 2990            # the last 30 s: heard
    r._keep_place()
    assert st.data["radio"] == []


def test_the_radio_keeps_forty_places(tmp_path):
    r, st, _ = radio(tmp_path)
    for n in range(45):
        r.episode = dict(EP, id=f"ep{n}")
        r.now.pos, r.now.dur = 100, 3000
        r._keep_place()
    assert len(st.data["radio"]) == 40 and st.data["radio"][0][0] == "ep44"


def test_a_private_session_keeps_no_places(tmp_path):
    r, st, _ = radio(tmp_path, private=True)
    r.episode = EP
    r.now.pos, r.now.dur = 500, 3000
    r._keep_place()
    assert st.data["radio"] == [] and not (tmp_path / "tui.json").exists()


def test_only_web_addresses_play(tmp_path):
    r, _, said = radio(tmp_path)
    r.tune(dict(EP, audio="file:///etc/passwd"))
    assert r.episode is None and said[-1][1] == "warn"


def test_the_radio_and_a_video_take_turns(tmp_path):
    from tui.media.player import Player
    r, _, _ = radio(tmp_path)
    p = Player(api=None, notify=lambda s, lvl: None, changed=lambda: None)
    paused = []
    p.on_audible = lambda: paused.append("radio")
    r.on_audible = lambda: paused.append("video")
    p.playing = object()
    p.now.paused = True
    p._on_event({"event": "property-change", "name": "pause", "data": False})   # unpaused in mpv's window
    r.episode = EP
    r.now.paused = True
    r._on_event({"event": "property-change", "name": "pause", "data": False})   # the media keys
    assert paused == ["radio", "video"]


def test_the_sleep_timer_holds_the_queue_at_the_end(tmp_path):
    from tui.media.player import Player, Playing
    p = Player(api=None, notify=lambda s, lvl: None, changed=lambda: None)
    p.queue = [{"id": "yt:next"}]
    p.playing = Playing(item={"id": "yt:now"}, url="u")
    p._post_progress = lambda final=False: None
    started = []
    p.play = lambda item, start=None: started.append(item)
    p.on_end = lambda: True
    p._on_event({"event": "end-file", "reason": "eof"})
    assert started == [] and p.playing is None and len(p.queue) == 1
    p.playing = Playing(item={"id": "yt:now"}, url="u")
    p.on_end = lambda: False
    p._on_event({"event": "end-file", "reason": "eof"})
    assert started == [{"id": "yt:next"}]


# ── the state file ───────────────────────────────────────────────────────────

def test_read_marks_survive_a_restart_and_history_clear_forgets_them(tmp_path):
    f = tmp_path / "tui.json"
    st = State(file=f)
    st.data["wire_seen"]["123"] = [1, 4]
    st.data["edition_read"]["2026-10-27"] = ["hn:1"]
    st.save()
    again = State(file=f)
    assert again.data["wire_seen"] == {"123": [1, 4]} and again.data["edition_read"]["2026-10-27"] == ["hn:1"]
    again.forget_marks()
    third = State(file=f)
    assert third.data["wire_seen"] == {} and third.data["edition_read"] == {} and third.data["radio"] == []


def test_a_value_of_the_wrong_shape_keeps_the_default(tmp_path):
    f = tmp_path / "tui.json"
    f.write_text('{"radio": {"not": "a list"}, "room": "anime", "wire_seen": []}')
    st = State(file=f)
    assert st.data["radio"] == [] and st.data["wire_seen"] == {} and st.data["room"] == "anime"


# ── GitHub's contribution calendar ───────────────────────────────────────────

def cal_days(end, n, count):
    import datetime as dt
    return [{"date": (end - dt.timedelta(days=i)).isoformat(), "count": count(i), "level": min(4, count(i))}
            for i in range(n)]


def test_calendar_weeks_start_on_sunday_and_stop_at_the_last_day():
    import datetime as dt
    from tui.rooms.github.calendar import weeks_of
    end = dt.date(2026, 10, 28)   # a Wednesday
    cols = weeks_of(cal_days(end, 40, lambda i: 1), 3)
    assert [len(c) for c in cols] == [7, 7, 7]
    assert cols[0][0]["date"] == "2026-10-11" and dt.date.fromisoformat(cols[0][0]["date"]).weekday() == 6
    assert cols[-1][3]["date"] == "2026-10-28" and cols[-1][4:] == [None, None, None]
    # a day the data doesn't have is a day with nothing
    sparse = [d for d in cal_days(end, 40, lambda i: 1) if d["date"] != "2026-10-20"]
    assert weeks_of(sparse, 2)[0][2] == {"date": "2026-10-20", "count": 0, "level": 0}
    assert weeks_of([], 3) == []


def test_calendar_streak_forgives_a_today_without_contributions():
    import datetime as dt
    from tui.rooms.github.calendar import streak
    end = dt.date(2026, 10, 28)
    assert streak(cal_days(end, 30, lambda i: 1 if i < 6 else 0)) == 6
    assert streak(cal_days(end, 30, lambda i: 0 if i == 0 else 1 if i < 4 else 0)) == 3
    assert streak(cal_days(end, 30, lambda i: 0 if i < 2 else 1)) == 0


def test_calendar_lines_read_without_colour():
    import datetime as dt
    from tui.rooms.github.calendar import lines
    out = lines({"total": 1204, "days": cal_days(dt.date(2026, 10, 28), 365, lambda i: i % 5)},
                "me", 40, "·░▒▓█", "·")
    text = ["".join(s for s, _ in ln) for ln in out]
    assert text[0] == "me · 1,204 contributions in the last year · 4 days in a row"   # today isn't over
    assert len(out) == 9 and text[3].startswith("Mon ") and text[5].startswith("Wed ")
    assert max(len(t.rstrip()) for t in text[2:]) <= 40
    assert set("".join(text[2:])) <= set("·░▒▓█ MonWedFri")
    assert all(role == "faint" for s, role in out[2][1:] if s.startswith("·"))   # none: faint, not a colour
    assert "Oct" in text[1] and "Sep" in text[1]
