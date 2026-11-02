"""~/.config/tubcal/tui.toml — what only the terminal needs. Everything shared with the
browser and the phone (playback rate, volume, subtitles, auto-skip, rooms switched on)
stays in the server's settings.

    icons = "auto"            # auto | nerd | unicode | ascii
    spacing = "comfy"         # comfy (room between things) | compact (as much as fits)
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
import re
import tempfile
import tomllib
from pathlib import Path

DEFAULTS = {
    "icons": "auto",
    "spacing": "comfy",
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


def literal(value) -> str:
    """A value as TOML writes it (the scalars tui.toml's settings take)."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    text = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{text}"'


def _value_end(line: str, start: int) -> int:
    """Where the value that begins at `start` ends (before a trailing comment)."""
    if line[start:start + 1] in ('"', "'"):
        quote, i = line[start], start + 1
        while i < len(line):
            if line[i] == "\\" and quote == '"':
                i += 2
                continue
            if line[i] == quote:
                return i + 1
            i += 1
        return len(line)
    hash_at = line.find("#", start)
    return len(line.rstrip()) if hash_at == -1 else len(line[:hash_at].rstrip())


def write_value(key: str, value) -> str | None:
    """Set one top-level setting in tui.toml, keeping everything else as you wrote it
    (comments, order, your [keys]). None, or what went wrong (nothing is written then)."""
    p = path()
    try:
        text = p.read_text() if p.exists() else ""
    except OSError as e:
        return f"{p} couldn't be read ({e})"
    lines = text.splitlines(keepends=True)
    new = f"{key} = {literal(value)}"
    pat = re.compile(rf"^\s*{re.escape(key)}\s*=\s*")
    first_table = next((i for i, ln in enumerate(lines) if ln.lstrip().startswith("[")), len(lines))
    for i in range(first_table):
        m = pat.match(lines[i])
        if m:
            end = _value_end(lines[i], m.end())
            rest = lines[i][end:].rstrip("\n")
            lines[i] = new + rest + "\n"
            break
    else:
        at = first_table
        while at > 0 and not lines[at - 1].strip():   # after the last setting, before the blank lines
            at -= 1
        if at and not lines[at - 1].endswith("\n"):
            lines[at - 1] += "\n"
        lines.insert(at, new + "\n")
    out = "".join(lines)
    try:
        tomllib.loads(out)
    except tomllib.TOMLDecodeError as e:
        return f"{p} wouldn't read back with that ({e}); nothing was written"
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".tui-", suffix=".toml", dir=p.parent)
        with os.fdopen(fd, "w") as f:
            f.write(out)
        if p.exists():
            os.chmod(tmp, p.stat().st_mode & 0o777)
        os.replace(tmp, p)
    except OSError as e:
        return f"{p} couldn't be written ({e})"
    return None
