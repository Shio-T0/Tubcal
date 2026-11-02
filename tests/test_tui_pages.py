"""The terminal's pages (Settings, the keys, the commands, what's playing, what you
follow), which-key, `:set`, and the lists behind them: every `:` command is run by
the app, every global key has a section, every setting reads back what it writes."""

import inspect
import tomllib

from test_tui_app import FEED, make_app, ready, run, until  # noqa: F401  (make_app is a fixture)

from tui import commands, prefs
from tui import config as config_mod
from tui.keys import GLOBAL, Keys, section_of, written


# ── the lists ────────────────────────────────────────────────────────────────

def test_every_command_in_help_is_run_by_the_app():
    from tui.app import SEARCH_ROOMS, TubcalApp
    source = inspect.getsource(TubcalApp.run_command)
    for c in commands.COMMANDS:
        for name in (c.name, *c.aliases):
            assert f'"{name}"' in source or name in SEARCH_ROOMS, f":{name} is in :help but not run"


def test_tab_completes_names_before_aliases():
    assert commands.completions("fo") == ["following", "follow"]
    assert commands.completions("h")[:2] == ["hn", "help"]
    assert "map" in commands.names() and "q!" not in commands.names()
    assert commands.find(":map").name == "keys"


def test_every_global_key_has_a_section():
    assert {section_of(b.action) for b in GLOBAL} - {"Other"} == {section_of(b.action) for b in GLOBAL}


def test_keys_are_written_for_people():
    assert written(("space", "p", "z")) == "Space pz"
    assert written(("g", "g")) == "gg"
    assert written(("ctrl+d",)) == "C-d"
    assert written(("up",), ascii_only=True) == "Up"


def test_backspace_goes_back_up_a_chord():
    k = Keys()
    k.feed("space")
    k.feed("p")
    assert k.feed("backspace") == "pending" and k.pending == ("space",)
    assert k.feed("backspace") is None and k.pending == ()


def test_which_key_hints_say_how_big_a_group_is_and_whose_a_key_is():
    from tui.keys import Bind
    k = Keys()
    k.push([Bind(("space", "t", "w"), "toggle_watched", "hide watched videos")])
    k.feed("space")
    hints = {h.key: h for h in k.next_hints()}
    assert hints["p"].group and hints["p"].count == 7 and not hints["p"].own
    assert hints["t"].group and hints["t"].own          # only the room's keys are under it
    assert not hints["f"].own and hints["f"].label == "find anything"


def test_settings_read_what_is_typed():
    speed, quiet, sub = prefs.BY_NAME["speed"], prefs.BY_NAME["quiet"], prefs.BY_NAME["subtitles"]
    assert prefs.parse(speed, "1.25") == 1.25 and prefs.parse(speed, "2x") == 2 and prefs.parse(speed, "1×") == 1
    assert prefs.parse(prefs.BY_NAME["volume"], "50%") == 0.5
    assert prefs.parse(quiet, "off") is None and prefs.parse(quiet, "22-7") == (22, 7)
    assert prefs.parse(sub, "no") is False
    assert prefs.parse(prefs.BY_NAME["wire"], "top") == "top"
    try:
        prefs.parse(speed, "fast")
    except ValueError as e:
        assert "0.75×" in str(e)
    else:
        raise AssertionError("a speed that isn't one")
    assert prefs.step(speed, 2, 1) == 0.75 and prefs.step(speed, 1.1, 1) == 0.75   # off the list: the first
    assert prefs.label_of(quiet, [23, 7]) == "23–07" and prefs.label_of(quiet, [21, 6]) == "21–06"


def test_tui_toml_keeps_what_you_wrote(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    p = config_mod.path()
    p.parent.mkdir(parents=True)
    p.write_text('# mine\nimages = "off"   # no pictures\n\n[keys]\n"<C-n>" = "down"\n')
    assert config_mod.write_value("images", "kitty") is None
    assert config_mod.write_value("editor", 'nvim -u "x"') is None
    assert config_mod.write_value("mpris", False) is None
    text = p.read_text()
    assert text.startswith('# mine\nimages = "kitty"   # no pictures\neditor = ')
    data = tomllib.loads(text)
    assert data["editor"] == 'nvim -u "x"' and data["mpris"] is False and data["keys"] == {"<C-n>": "down"}


# ── the pages ────────────────────────────────────────────────────────────────

def test_the_player_shares_the_apps_settings(make_app):
    app = make_app()
    assert app.player.settings is app.settings and app.player.config is app.cfg


def test_which_key_shows_every_key_and_backspace_goes_back(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(120, 32)) as pilot:
            await ready(app, pilot)
            await pilot.press("g")
            await pilot.pause(0.4)
            wk = app.whichkey
            n = len(app.keys.next_hints())
            assert wk.display and wk.layout_rows * wk.layout_cols >= n > 12
            assert "go" in str(wk.border_title)
            await pilot.press("space")          # nothing after g: the chord ends
            await pilot.press("space", "p")
            await pilot.pause(0.4)
            assert "player" in str(wk.border_title)
            await pilot.press("backspace")      # back to Space, the box follows at once
            assert app.keys.pending == ("space",) and "leader" in str(wk.border_title)
            await pilot.press("?")              # every key, on this chord
            items = app.sheet.body.items
            assert app.page.id == "keys" and app.page.chord == ("space",) and items
            assert all(e.key[0][0].startswith("Space ") for e in items)
    run(go())


def test_the_keys_page_runs_a_key_and_filters(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press("?")
            body = app.sheet.body
            assert app.page.id == "keys" and body.section_of(body.selected) == "Here · Screening Room"
            text = body.text()
            assert "The Wire [keys.hackernews]" in text and "prev_top" in text     # another room's
            assert "Space f find anything" in text and "visual_save" in text
            await pilot.press("/", *"next view", "enter")
            assert [e.title[0][0] for e in body.items] == ["next view"]
            await pilot.press("enter")          # runs it: Tab in the Screening Room
            assert app.page is None and app.room.view == "live"
            await pilot.press("?", "/", *"zzzz")
            assert not body.items
            await pilot.press("escape")         # the line, then the filter
            assert app.page is not None and not body.filter and body.items
            await pilot.press("escape")
            assert app.page is None
    run(go())


def test_help_lists_every_command_and_puts_one_on_the_line(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press(":", *"help", "enter")
            text = app.sheet.body.text()
            for c in commands.COMMANDS:
                assert f":{c.name}" in text
            await pilot.press("q")
            await pilot.press(":", *"help follow", "enter")
            assert app.sheet.body.selected.id == "cmd:follow"
            assert "torvalds/linux" in app.sheet.body.text()
            await pilot.press("enter")
            assert app.mode == "COMMAND" and app.buffer == "follow " and app.page is None
            await pilot.press("escape")
            await pilot.press(":", *"fo")
            assert "following" in app.statusline.search_info and "follow" in app.statusline.search_info
            await pilot.press("l", "l", "o", "w", " ")
            assert app.statusline.search_info.startswith(":follow [@name")
    run(go())


def test_settings_change_the_servers_and_the_terminals(make_app, tmp_path):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 44)) as pilot:
            await ready(app, pilot)
            await pilot.press("space", ",")
            await until(pilot, lambda: "1 channel" in app.sheet.body.text())
            body = app.sheet.body
            body.go(next(i for i, e in enumerate(body.items) if e.id == "pref:speed"))
            await pilot.press("l")
            await until(pilot, lambda: app.api.get("/settings")["playback_rate"] == 1.25)
            await pilot.press("h", "h")
            await until(pilot, lambda: app.api.get("/settings")["playback_rate"] == 0.75)
            body.go(next(i for i, e in enumerate(body.items) if e.id == "pref:subtitles"))
            await pilot.press("enter")
            await until(pilot, lambda: app.api.get("/settings")["subtitle_style"]["show"] is False)
            body.go(next(i for i, e in enumerate(body.items) if e.id == "pref:spacing"))
            await pilot.press("enter")
            assert 'spacing = "compact"' in config_mod.path().read_text()
            assert "from the next start" in app.statusline.message.text
            body.go(next(i for i, e in enumerate(body.items) if e.id == "room:github"))
            await pilot.press("enter")
            await until(pilot, lambda: "github" in app.api.get("/settings")["active_rooms"])
            await until(pilot, lambda: ":room off github" in body.text())
            # forgetting takes a second Enter
            body.go(next(i for i, e in enumerate(body.items) if e.id == "data:marks"))
            app.state.data["wire_seen"] = {"1": 2}
            await pilot.press("enter")
            assert app.state.data.get("wire_seen") and "again" in body.text()
            await pilot.press("enter")
            assert not app.state.data.get("wire_seen")
    run(go())


def test_set_on_the_command_line(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press(":", *"set volume=50%", "enter")
            await until(pilot, lambda: app.api.get("/settings")["player_volume"] == 0.5)
            await pilot.press(":", *"set quiet=23-07", "enter")
            await until(pilot, lambda: app.api.get("/settings")["quiet_hours"] == [23, 7])
            await pilot.press(":", *"set nompris", "enter")
            assert "mpris = false" in config_mod.path().read_text() and app.cfg["mpris"] is False
            await pilot.press(":", *"set mpris!", "enter")
            assert app.cfg["mpris"] is True
            await pilot.press(":", *"set speed?", "enter")
            assert app.statusline.message.text.startswith(":set speed=1×")
            await pilot.press(":", *"set ytdl=on", "enter")
            assert app.cfg["youtube_player"] == "ytdl"
            await pilot.press(":", *"set speedy=2", "enter")
            assert "No setting called speedy" in app.statusline.message.text
            await pilot.press(":", *"set", "enter")
            assert app.page.id == "settings"
    run(go())


def test_the_playing_page_edits_the_queue(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press("a", "j", "a", "j", "a")
            assert [i["id"] for i in app.player.queue] == [f["id"] for f in FEED[:3]]
            await pilot.press("space", "q")
            body = app.sheet.body
            assert app.page.id == "playing" and body.selected.id.startswith("q:0:")
            await pilot.press("J")
            assert [i["id"] for i in app.player.queue] == [FEED[1]["id"], FEED[0]["id"], FEED[2]["id"]]
            assert body.selected.id == f"q:1:{FEED[0]['id']}"
            await pilot.press("d", "d")
            assert [i["id"] for i in app.player.queue] == [FEED[1]["id"], FEED[2]["id"]]
            assert app.player.now.queue == 2
            await pilot.press("u")
            assert [i["id"] for i in app.player.queue] == [FEED[1]["id"], FEED[0]["id"], FEED[2]["id"]]
            await pilot.press(":", *"sleep", "enter")      # the timer, on the same page
            assert body.selected.id == "sleep:now"
            await pilot.press("j", "j", "enter")            # 30 minutes
            assert app.sleep.label() in ("30m", "29m")
            await pilot.press("G", "enter")                 # off
            assert app.sleep.label() == ""
    run(go())


def test_the_following_page_unfollows_and_follows_again(make_app, monkeypatch):
    from server.sources import youtube
    monkeypatch.setattr(youtube, "resolve_channel", lambda raw: {"channel_id": "UC1", "title": "Channel 1",
                                                                  "thumbnail": None})

    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press(":", *"following", "enter")
            await until(pilot, lambda: "Channel 1" in app.sheet.body.text())
            subs = lambda: app.api.get("/subscriptions")["youtube"]   # noqa: E731
            await pilot.press("d", "d")
            await until(pilot, lambda: subs() == [])
            assert "Channel 1" not in app.sheet.body.text()
            await pilot.press("u")
            await until(pilot, lambda: [s["source_id"] for s in subs()] == ["UC1"])
            await pilot.press("a")
            assert app.mode == "COMMAND" and app.buffer == "follow "
    run(go())


def test_pages_stack_and_q_goes_back(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press("space", ",")
            body = app.sheet.body
            await until(pilot, lambda: "1 channel" in body.text())
            body.go(next(i for i, e in enumerate(body.items) if e.id == "follow:youtube"))
            await pilot.press("enter")
            assert app.page.id == "following" and [p.id for p in app.pages] == ["settings", "following"]
            await pilot.press("q")
            assert app.page.id == "settings" and body.selected.id == "follow:youtube"   # where it was
            await pilot.press("?")
            assert app.page.id == "keys" and app.page.here[0] == "Settings"
            await pilot.press("g", "y")                     # a room: every page closes
            assert app.page is None and not app.sheet.display and app.room_id == "youtube"
    run(go())
