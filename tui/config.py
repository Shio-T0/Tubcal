"""~/.config/tubcal/tui.toml — what only the terminal needs. Everything shared with the
browser and the phone (playback rate, volume, subtitles, auto-skip, rooms switched on)
stays in the server's settings.

    icons = "auto"            # auto | nerd | unicode | ascii
    images = "auto"           # auto | kitty | sixel | halfcell | off
    youtube_player = "server" # server | ytdl (mpv's own yt-dlp: 4K, VP9, captions)
    video_max_height = 0      # 0 = the best there is
    mpv_args = []             # extra mpv options, e.g. ["--geometry=50%"]
    mpris = true              # the system MPRIS script (media keys)
    browser = ""              # for `o`; else $BROWSER, else the one Tubcal's link handler kept
    editor = ""               # for writing posts; else $VISUAL, nvim, $EDITOR

    [keys]                    # your own keys, in vim's notation; "" unbinds one
    "<C-n>" = "down"
    "<leader>ff" = "find"
    [keys.youtube]            # a room's own keys, by its id (`:map` in the room lists them);
    "w" = "toggle_watched"    # also [keys.saved] for the drawer and [keys.visual]
"""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

DEFAULTS = {
    "icons": "auto",
    "images": "auto",
    "youtube_player": "server",
    "video_max_height": 0,
    "mpv_args": [],
    "mpris": True,
    "browser": "",
    "editor": "",
    "keys": {},
}


def path() -> Path:
    base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return base / "tubcal" / "tui.toml"


def load() -> tuple[dict, str | None]:
    """(config, problem). A broken file never stops the app: defaults + a message."""
    cfg = dict(DEFAULTS)
    p = path()
    if not p.exists():
        return cfg, None
    try:
        data = tomllib.loads(p.read_text())
    except (OSError, tomllib.TOMLDecodeError) as e:
        return cfg, f"{p} couldn't be read ({e}); using the defaults."
    for k, v in data.items():
        if k in DEFAULTS and type(v) is type(DEFAULTS[k]):
            cfg[k] = v
    return cfg, None
