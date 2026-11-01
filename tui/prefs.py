"""The settings the terminal can change: one list, read by the Settings page and by
`:set`. Some are the server's (shared with the web and the phone: playback speed,
subtitles, the Anime's sub or dub…), the rest are this terminal's own, in tui.toml.

Each has a short name for `:set` (vim's way: `:set speed=1.25`, `:set subtitles`,
`:set nosubtitles`, `:set subtitles!`, `:set speed?`), a kind (switch, choice or
text) and, for a choice, its options as (value, label).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from . import config as config_mod
from .api import ApiError

if TYPE_CHECKING:
    from .app import TubcalApp


@dataclass(frozen=True)
class Pref:
    name: str                  # :set <name>
    label: str
    hint: str
    section: str
    where: str                 # "server" | "terminal"
    key: str                   # the server's setting, or tui.toml's
    kind: str                  # "switch" | "choice" | "text"
    options: tuple = ()        # (value, label) for a choice
    sub: str = ""              # a field of the server's subtitle_style
    restart: bool = False      # read when the terminal starts
    module: str = ""           # only with this room installed
    default: Any = None


SECTIONS = {
    "Playback": "shared with the web and the phone",
    "The Anime": "shared with the web and the phone",
    "Where rooms open": "shared with the web and the phone",
    "This terminal": "tui.toml",
}

PREFS = [
    Pref("speed", "Speed", "How fast videos play, everywhere", "Playback", "server", "playback_rate", "choice",
         ((0.75, "0.75×"), (1, "1×"), (1.25, "1.25×"), (1.5, "1.5×"), (1.75, "1.75×"), (2, "2×")), default=1),
    Pref("volume", "Volume", "Where a video starts", "Playback", "server", "player_volume", "choice",
         ((0.25, "25%"), (0.5, "50%"), (0.75, "75%"), (1, "100%")), default=1),
    Pref("subtitles", "Subtitles", "Shown when a video or an episode has them", "Playback", "server",
         "subtitle_style", "switch", sub="show", default=True),
    Pref("sublang", "Subtitle language", "The one picked first: en, ja, de… (empty: English)", "Playback",
         "server", "subtitle_style", "text", sub="lang", default=""),
    Pref("livealerts", "Live alerts", "A desktop note 10 minutes before a channel you follow goes live",
         "Playback", "server", "notify_live", "switch", module="youtube", default=True),
    Pref("quiet", "Quiet hours", "Live alerts keep quiet then", "Playback", "server", "quiet_hours", "choice",
         ((None, "off"), ((22, 7), "22–07"), ((23, 7), "23–07"), ((0, 8), "00–08")), module="youtube"),
    Pref("audio", "Sub or dub", "What an episode starts in; `a` on a show changes it for that show",
         "The Anime", "server", "anime_sub_pref", "choice", (("sub", "sub"), ("dub", "dub")), module="anime",
         default="sub"),
    Pref("skip", "Skip openings", "The player jumps an episode's opening by itself", "The Anime", "server",
         "anime_auto_skip", "switch", module="anime", default=False),
    Pref("sync", "AniList sync", "An episode watched past 80% moves your AniList progress on", "The Anime",
         "server", "anime_autosync", "switch", module="anime", default=True),
    Pref("wire", "The Wire", "The list it opens on", "Where rooms open", "server", "hn_list", "choice",
         tuple((v, v) for v in ("top", "best", "new", "ask", "show", "job")), module="hackernews", default="top"),
    Pref("dispatch", "The Dispatch", "How it sorts", "Where rooms open", "server", "reddit_sort", "choice",
         tuple((v, v) for v in ("hot", "new", "top")), module="reddit", default="hot"),
    Pref("spacing", "Spacing", "Room between things, or as much as fits", "This terminal", "terminal", "spacing",
         "choice", (("comfy", "comfy"), ("compact", "compact")), restart=True, default="comfy"),
    Pref("icons", "Icons", "Nerd Font icons, plain Unicode, or ASCII only", "This terminal", "terminal", "icons",
         "choice", tuple((v, v) for v in ("auto", "nerd", "unicode", "ascii")), restart=True, default="auto"),
    Pref("images", "Pictures", "How thumbnails are drawn: auto picks what this terminal speaks", "This terminal",
         "terminal", "images", "choice", tuple((v, v) for v in ("auto", "kitty", "sixel", "halfcell", "off")),
         restart=True, default="auto"),
    Pref("player", "YouTube plays through", "The Tubcal server, or mpv's own yt-dlp (4K, VP9, captions)",
         "This terminal", "terminal", "youtube_player", "choice", (("server", "the server"), ("ytdl", "yt-dlp")),
         module="youtube", default="server"),
    Pref("maxheight", "Highest quality", "The tallest picture a video starts at", "This terminal", "terminal",
         "video_max_height", "choice", ((0, "best"), (2160, "2160p"), (1440, "1440p"), (1080, "1080p"),
                                        (720, "720p"), (480, "480p")), module="youtube", default=0),
    Pref("mpris", "Media keys", "mpv answers the system's media keys (MPRIS)", "This terminal", "terminal", "mpris",
         "switch", restart=True, default=True),
    Pref("browser", "Browser", "What `o` opens links in (empty: $BROWSER)", "This terminal", "terminal", "browser",
         "text", default=""),
    Pref("editor", "Editor", "Where you write notes, questions and comments (empty: $VISUAL, nvim)",
         "This terminal", "terminal", "editor", "text", default=""),
]

BY_NAME = {p.name: p for p in PREFS}
ON = {"on", "yes", "true", "1", ""}
OFF = {"off", "no", "false", "0"}


def shown(app: TubcalApp) -> list[Pref]:
    reg = app.registry
    return [p for p in PREFS if not p.module or reg is None or reg.has(p.module)]


def _same(a, b) -> bool:
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return list(a) == list(b)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return float(a) == float(b)
    return a == b


def value(app: TubcalApp, p: Pref):
    if p.where == "terminal":
        return app.cfg.get(p.key, p.default)
    v = app.settings.get(p.key)
    if p.sub:
        v = (v or {}).get(p.sub)
    return p.default if v is None else v


def option_index(p: Pref, v) -> int:
    """Where `v` is among the choices, or -1 (a value set some other way)."""
    return next((i for i, (o, _) in enumerate(p.options) if _same(o, v)), -1)


def label_of(p: Pref, v) -> str:
    if p.kind == "switch":
        return "on" if v else "off"
    if p.kind == "text":
        return str(v) if v else "not set"
    i = option_index(p, v)
    if i >= 0:
        return p.options[i][1]
    if isinstance(v, (list, tuple)) and len(v) == 2:
        return f"{v[0]:02d}–{v[1]:02d}"
    return str(v)


def parse(p: Pref, text: str):
    """What was typed after `=`, as this setting's value; raises ValueError."""
    t = text.strip()
    if p.kind == "switch":
        if t.lower() in ON:
            return True
        if t.lower() in OFF:
            return False
        raise ValueError(f"`{p.name}` is on or off")
    if p.kind == "text":
        return t
    low = t.lower()
    for o, label in p.options:
        if low in (label.lower(), str(o).lower()) or (o is None and low in OFF | {"none"}):
            return o
    try:
        n = float(low.rstrip("×x%p"))
    except ValueError:
        n = None
    for o, label in p.options:
        if n is not None and isinstance(o, (int, float)) and not isinstance(o, bool):
            if n == float(o) or (label.endswith("%") and n / 100 == float(o)):
                return o
    hours = low.replace("–", "-").split("-")
    if any(isinstance(o, tuple) for o, _ in p.options) and len(hours) == 2 and all(h.isdigit() for h in hours):
        a, b = int(hours[0]), int(hours[1])
        if 0 <= a <= 23 and 0 <= b <= 23 and a != b:
            return (a, b)
    choices = ", ".join(label for _, label in p.options)
    raise ValueError(f"`{p.name}` takes {choices}")


def step(p: Pref, v, n: int):
    """The choice `n` along from `v` (wrapping), or the switch flipped."""
    if p.kind == "switch":
        return (not v) if n else v
    if p.kind != "choice" or not p.options:
        return v
    i = option_index(p, v)
    if i < 0:   # set some other way: the first (or last) choice
        return p.options[0 if n > 0 else -1][0]
    return p.options[(i + n) % len(p.options)][0]


def put(app: TubcalApp, p: Pref, v, *, done=None) -> None:
    """Keep `v`: the server's at once in what the terminal holds (then sent; put back if
    the server refuses), tui.toml's in the file. `done(problem)` is told after, on the
    app's thread."""
    if p.where == "terminal":
        problem = config_mod.write_value(p.key, v)
        if problem is None:
            app.cfg[p.key] = v
        if done:
            done(problem)
        return
    old = app.settings.get(p.key)
    if p.sub:
        body = {p.key: {p.sub: v}}
        app.settings[p.key] = {**(old or {}), p.sub: v}
    else:
        wire = list(v) if isinstance(v, tuple) else v
        body = {p.key: wire}
        app.settings[p.key] = wire

    def work():
        try:
            got = app.api.put("/settings", body) or {}
            problem = None
        except ApiError as e:
            got, problem = None, str(e)

        def back():
            if got:
                app.settings.update(got)
            elif problem:
                app.settings[p.key] = old
            if done:
                done(problem)
        app.call_from_thread(back)
    app.run_worker(work, thread=True, group=f"pref-{p.key}")


def said(p: Pref, v) -> str:
    when = " from the next start" if p.restart else ""
    return f"{p.label}: {label_of(p, v)}{when}."
