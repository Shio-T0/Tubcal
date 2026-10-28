"""What the terminal interface looks like, kept as pictures: each screen is drawn
headless with a fixed palette (Everforest, Macchiato, the light rice aline, and no
palette at all) on a frozen clock, and compared with `tests/snapshots/tui/`.

Each snapshot is two files: `<name>.svg` (open it in a browser: the colours) and
`<name>.txt` (the characters, which `git diff` can show). When a screen changes on
purpose, look at the `.actual.svg` the failure leaves, then take it with
`TUBCAL_SNAPSHOTS=update uv run pytest tests/test_tui_snapshots.py`.
"""

import asyncio
import io
import os
import time
from pathlib import Path

import httpx
import pytest
from rich.console import Console
from rich.terminal_theme import DEFAULT_TERMINAL_THEME, TerminalTheme

from server import config
from tui.terminal import TermInfo
from tui.theme import Palette, parse_hex

SNAPS = Path(__file__).parent / "snapshots" / "tui"
FROZEN = 1793188800  # Wednesday 28 October 2026, 12:00 UTC


def pal(fg, bg, colors):
    c = [parse_hex(x) for x in colors.split()]
    return Palette(fg=parse_hex(fg), bg=parse_hex(bg), ansi=c + c)


PALETTES = {
    "everforest": pal("#d3c6aa", "#2d353b", "#475258 #e67e80 #a7c080 #dbbc7f #7fbbb3 #d699b6 #83c092 #d3c6aa"),
    "macchiato": pal("#cad3f5", "#24273a", "#494d64 #ed8796 #a6da95 #eed49f #8aadf4 #f5bde6 #8bd5ca #b8c0e0"),
    "aline": pal("#575279", "#faf4ed", "#f2e9e1 #b4637a #286983 #ea9d34 #56949f #907aa9 #d7827e #575279"),
    "ansi": None,
}

TITLES = ["The kiln, from the inside", "進撃の巨人 — 最終章の音楽", "Fixing a 1970s tape deck",
          "Live: the night bus home", "Why rivers meander", "A week of cast-iron bread",
          "Rebuilding the bench vice", "Notes on a quiet keyboard", "Small engines, cold mornings",
          "Interview: the lighthouse keeper", "How tides are forecast", "Planing by hand",
          "The lathe that came back", "One room, four seasons"]
FEED = [
    {"id": f"yt:video{n:05d}xx", "platform": "youtube", "title": TITLES[n - 1], "source": f"Channel {n % 3}",
     "url": f"https://www.youtube.com/watch?v=video{n:05d}xx", "thumbnail": "", "published_at": FROZEN - n * 20000,
     "duration": 300 + n * 97, "views": 1200 * n,
     "extra": {"video_id": f"video{n:05d}xx", "channel_id": f"UC{n % 3}", "description": "About it, in a sentence."}}
    for n in range(1, 15)
]
LIVE = [dict(FEED[3], id="yt:livelive01x", published_at=FROZEN - 1800,
             extra=dict(FEED[3]["extra"], video_id="livelive01x", live=True, live_status="live"))]

HN = [
    {"id": f"hn:{1000 + n}", "platform": "hackernews", "title": t, "url": f"https://example.org/{n}",
     "author": f"user{n}", "score": 400 // n, "comments_count": 40 // n, "published_at": FROZEN - n * 3600,
     "source": "Hacker News", "thumbnail": None,
     "extra": {"hn_id": 1000 + n, "domain": "example.org", "type": "story"}}
    for n, t in enumerate(["A tiny database that fits in a URL", "Ask HN: What do you keep on paper?",
                           "The history of the semicolon", "Show HN: A synth made of relays",
                           "Lead in old pewter", "Why trains whistle twice"], start=1)
]


def hn_item(hn_id):
    story = next(s for s in HN if s["extra"]["hn_id"] == hn_id)
    return {"story": dict(story, text_html=None), "stale": False, "comments": [
        {"id": 1, "author": "ann", "body_html": "I tried this on a <i>very</i> long URL and it held up."
                                                "<p>&gt; fits in a URL<p>Up to a point.", "score": None,
         "depth": 0, "created_at": FROZEN - 1200, "children": [
             {"id": 2, "author": story["author"], "body_html": "About two kilobytes before browsers complain.",
              "score": None, "depth": 1, "created_at": FROZEN - 900, "children": []}]},
        {"id": 3, "author": "bo", "body_html": "The <code>base64</code> step is the clever part.", "score": None,
         "depth": 0, "created_at": FROZEN - 300, "children": []}]}


@pytest.fixture
def frozen(monkeypatch):
    """The clock at FROZEN in UTC, still ticking so that waits end."""
    old_tz = os.environ.get("TZ")
    os.environ["TZ"] = "UTC"
    time.tzset()
    start, mono = FROZEN, time.monotonic
    m0 = mono()
    monkeypatch.setattr(time, "time", lambda: start + (mono() - m0))
    yield
    if old_tz is None:
        os.environ.pop("TZ", None)
    else:
        os.environ["TZ"] = old_tz
    time.tzset()


@pytest.fixture
def make_app(tmp_path, monkeypatch, frozen):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    for var in ("XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"):
        monkeypatch.setenv(var, str(tmp_path / var.lower()))
    monkeypatch.delenv("NO_COLOR", raising=False)
    cfg = tmp_path / "xdg_config_home" / "tubcal"
    cfg.mkdir(parents=True)
    (cfg / "tui.toml").write_text('images = "off"\n')
    from server import create_app, db
    from server.sources import hackernews, youtube

    db.init_db()
    for n in range(3):
        db.add_subscription("youtube", f"UC{n}", f"Channel {n}", None)
    monkeypatch.setattr(youtube, "get_feed", lambda ids: {"items": FEED, "stale": False})
    monkeypatch.setattr(youtube, "get_live_and_upcoming", lambda ids: LIVE)
    monkeypatch.setattr(hackernews, "get_feed", lambda name, page: {"items": HN, "has_more": False, "stale": False})
    monkeypatch.setattr(hackernews, "get_item", hn_item)
    db.set_progress(FEED[1]["id"], 400, 1000)
    db.add_saved(FEED[2])
    flask_app = create_app()

    def make(palette, **kw):
        from tui.app import TubcalApp
        info = TermInfo(palette=PALETTES[palette], cell_px=(8, 18), term="st-256color", answered=True)
        kw.setdefault("start_room", "youtube")
        return TubcalApp(info, transport=httpx.WSGITransport(app=flask_app), base="http://127.0.0.1:5000", **kw)
    return make


def terminal_theme(palette):
    """The terminal's own colours for the picture: the interface draws on the
    terminal's default background and foreground, which Rich would otherwise paint
    from its own dark theme (a light rice would come out light on light)."""
    p = PALETTES[palette]
    if p is None:
        return DEFAULT_TERMINAL_THEME
    return TerminalTheme(p.bg, p.fg, p.ansi[:8], p.ansi[8:16])


def capture(app, palette):
    """The screen as SVG (in the palette's terminal) and as plain text."""
    width, height = app.size
    console = Console(width=width, height=height, file=io.StringIO(), force_terminal=True,
                      color_system="truecolor", record=True, legacy_windows=False, safe_box=False)
    console.print(app.screen._compositor.render_update(full=True, screen_stack=app._background_screens))
    svg = console.export_svg(title="Tubcal", theme=terminal_theme(palette), clear=False)
    text = "\n".join(line.rstrip() for line in console.export_text().splitlines()) + "\n"
    return svg, text


def compare(name, svg, text):
    want_svg, want_txt = SNAPS / f"{name}.svg", SNAPS / f"{name}.txt"
    got = SNAPS / f"{name}.actual.svg"
    if os.environ.get("TUBCAL_SNAPSHOTS") == "update":
        SNAPS.mkdir(parents=True, exist_ok=True)
        want_svg.write_text(svg)
        want_txt.write_text(text)
        got.unlink(missing_ok=True)
        return
    if not want_svg.exists():
        SNAPS.mkdir(parents=True, exist_ok=True)
        got.write_text(svg)
        pytest.fail(f"no snapshot {name} yet: look at {got}, then run with TUBCAL_SNAPSHOTS=update")
    if want_txt.read_text() != text:
        got.write_text(svg)
        import difflib
        diff = "\n".join(difflib.unified_diff(want_txt.read_text().splitlines(), text.splitlines(),
                                              "snapshot", "now", lineterm=""))
        pytest.fail(f"{name}: the characters changed (picture: {got})\n{diff}")
    if want_svg.read_text() != svg:
        got.write_text(svg)
        pytest.fail(f"{name}: the colours changed: compare {want_svg} with {got}")
    got.unlink(missing_ok=True)


async def until(pilot, ok, what):
    for _ in range(120):
        await pilot.pause(0.05)
        if ok():
            await pilot.pause(0.1)
            return
    raise AssertionError(f"never: {what}")


def screening(palette, make_app, keys=(), size=(140, 34)):
    async def go():
        app = make_app(palette)
        async with app.run_test(size=size) as pilot:
            await until(pilot, lambda: app.ready and app.room is not None and app.room.list.items, "a feed")
            await pilot.press("j", "j")
            for k in keys:
                await pilot.press(k)
            await pilot.pause(0.45)   # which-key comes up after 300 ms
            return capture(app, palette)
    return asyncio.run(go())


@pytest.mark.parametrize("palette", list(PALETTES))
def test_the_screening_room(make_app, palette):
    compare(f"screening-{palette}", *screening(palette, make_app))


def test_which_key_over_a_room(make_app):
    compare("whichkey-macchiato", *screening("macchiato", make_app, keys=("space",)))


@pytest.mark.parametrize("palette", ["everforest", "ansi"])
def test_a_visual_range(make_app, palette):
    compare(f"visual-{palette}", *screening(palette, make_app, keys=("V", "j", "j")))


def test_a_narrow_terminal_shows_one_pane(make_app):
    compare("screening-narrow-everforest", *screening("everforest", make_app, size=(80, 24)))


@pytest.mark.parametrize("palette", ["everforest", "aline", "ansi"])
def test_the_wire_reading_a_thread(make_app, palette):
    async def go():
        app = make_app(palette, start_room="hackernews")
        async with app.run_test(size=(140, 34)) as pilot:
            await until(pilot, lambda: app.ready and app.room is not None and app.room.board.items, "the board")
            await pilot.press("enter")
            await until(pilot, lambda: app.room.reader.items, "the thread")
            await pilot.press("j")
            return capture(app, palette)
    compare(f"wire-{palette}", *asyncio.run(go()))

