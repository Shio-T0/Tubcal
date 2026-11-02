"""Starting again in place (`ZR`, `:reload`): the new code, tui.toml and the terminal's
colours, back in the same room, with what's playing still playing.

The app writes what the next run needs (`write`) and exits; `__main__` then runs the
interpreter again in this same process (`again`, os.execv), so the pid stays, and mpv,
this process's child, stays with it: the next run takes it back (`Mpv.adopt`). The note
is read once and deleted (`take`). It lives beside mpv's sockets in the 0700 runtime
folder (0600), and its path travels in TUBCAL_HANDOFF, which the next run takes out of
its environment at once, so nothing it starts inherits it.
"""

from __future__ import annotations

import json
import os
import signal
import sys
from pathlib import Path

from .media.mpv import socket_dir

ENV = "TUBCAL_HANDOFF"
# where `python -m tui` finds the package, as the launcher runs it (`cd "$APP_DIR"`)
ROOT = Path(__file__).resolve().parents[1]


class Reload:
    """What `TubcalApp.run()` returns when it should start again."""

    def __init__(self, note: str, *, private: bool):
        self.note = note
        self.private = private


def _name() -> str:
    return f"handoff-{os.getpid()}.json"


def write(data: dict) -> str:
    path = socket_dir() / _name()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    return str(path)


def take() -> dict:
    """The note the last run left for this one, once; {} when this isn't a reload."""
    raw = os.environ.pop(ENV, None)
    if not raw:
        return {}
    path = Path(raw)
    if path.name != _name():          # only a note this very process wrote
        return {}
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        data = {}
    try:
        path.unlink()
    except OSError:
        pass
    return data if isinstance(data, dict) else {}


def again(reload: Reload) -> int:
    """Run the terminal interface again in this process. Returns only if it couldn't:
    then the mpv kept for it stops, and the note goes."""
    os.environ[ENV] = reload.note
    argv = [sys.executable, "-m", "tui", *(["--private"] if reload.private else [])]
    try:
        os.chdir(ROOT)
        os.execv(sys.executable, argv)
    except OSError as e:
        os.environ.pop(ENV, None)
        print(f"Tubcal couldn't start again ({e}). Run `tubcal tui`.", file=sys.stderr)
        try:
            data = json.loads(Path(reload.note).read_text())
            Path(reload.note).unlink()
        except (OSError, ValueError):
            data = {}
        for part in ("player", "radio"):
            pid = ((data.get(part) or {}).get("mpv") or {}).get("pid")
            if isinstance(pid, int):
                try:
                    os.kill(pid, signal.SIGTERM)
                except OSError:
                    pass
        return 1
    return 0
