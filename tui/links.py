"""Links that leave the terminal: copied, or opened in a browser.

Tracking parameters (`si`, `pp`, `feature`, `utm_*`…) are removed first. A link opens in
the browser from the config, else $BROWSER, else the browser Tubcal's YouTube link
handler took over from (links.json) — never through xdg-open, which on a desktop where
that handler is on would send a YouTube link straight back into Tubcal.
"""

from __future__ import annotations

import json
import os
import shlex
import shutil
import subprocess
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

TRACKING = {"si", "pp", "feature", "fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "ref_src", "ref_url"}


def clean(url: str) -> str:
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    if parts.scheme not in ("http", "https"):
        return url
    q = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
         if k.lower() not in TRACKING and not k.lower().startswith("utm_")]
    return urlunsplit(parts._replace(query=urlencode(q)))


def at_time(url: str, seconds: int) -> str:
    """A YouTube link that starts at `seconds`."""
    url = clean(url)
    if seconds <= 0:
        return url
    parts = urlsplit(url)
    q = [(k, v) for k, v in parse_qsl(parts.query) if k != "t"] + [("t", f"{seconds}s")]
    return urlunsplit(parts._replace(query=urlencode(q)))


def _desktop_exec(desktop_file: str) -> list[str] | None:
    try:
        text = Path(desktop_file).read_text()
    except OSError:
        return None
    in_entry = False
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("["):
            in_entry = line == "[Desktop Entry]"
        elif in_entry and line.startswith("Exec="):
            try:
                words = shlex.split(line[5:])
            except ValueError:
                return None
            return [w for w in words if not (w.startswith("%") and len(w) == 2)]
    return None


def browser_command(configured: str = "") -> list[str] | None:
    if configured:
        return shlex.split(configured)
    if os.environ.get("BROWSER"):
        return shlex.split(os.environ["BROWSER"].split(":")[0])
    links = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share") / "tubcal/links/links.json"
    try:
        info = json.loads(links.read_text())
        cmd = _desktop_exec((info.get("browser") or {}).get("path") or "")
        if cmd:
            return cmd
    except (OSError, ValueError):
        pass
    for name in ("firefox", "chromium", "google-chrome-stable", "librewolf", "brave"):
        if shutil.which(name):
            return [name]
    return ["xdg-open"] if shutil.which("xdg-open") else None


def open_url(url: str, configured: str = "") -> str | None:
    """Open `url` in the browser. Returns a problem sentence, or None."""
    cmd = browser_command(configured)
    if not cmd:
        return "No browser found; set `browser` in ~/.config/tubcal/tui.toml."
    try:
        subprocess.Popen([*cmd, url], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError as e:
        return f"The browser didn't start ({e})."
    return None


def copy(text: str) -> bool:
    """To the clipboard with xclip / wl-copy. False = the caller uses OSC 52."""
    for cmd in (["wl-copy"] if os.environ.get("WAYLAND_DISPLAY") else []) + \
               (["xclip", "-selection", "clipboard"] if os.environ.get("DISPLAY") else []):
        if shutil.which(cmd[0]):
            try:
                subprocess.run(cmd, input=text.encode(), timeout=2, check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return True
            except (OSError, subprocess.SubprocessError):
                continue
    return False
