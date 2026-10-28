"""Writing in your own editor: a note on something saved, a question for the Archive,
a comment on GitHub.

The text goes into a temporary file (0600, in the same 0700 folder under
$XDG_RUNTIME_DIR as mpv's socket), the editor takes the terminal while the interface
steps aside (`App.suspend()`), and what you wrote comes back. A file you didn't change
means nothing is sent; the file is deleted either way.

Some drafts carry context under a scissors line, as `git commit -v` does: everything
from that line down is left out of what's sent.

The editor is `editor` in tui.toml, else $VISUAL, else nvim, else $EDITOR, else vi.
nvim runs so that nothing of the draft stays behind: no swap file (-n), no shada
(-i NONE), no undo file, the clipboard not synced (LazyVim sets `unnamedplus`, which
would put a yank into the clipboard manager's history; it sets it again on VeryLazy),
and persistence.nvim told not to save the session.
"""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import tempfile
from pathlib import Path

SCISSORS = "------------------------ >8 ------------------------"
SCISSORS_HINT = "Everything from the line above down is left out."

NVIM_FLAGS = [
    "-n", "-i", "NONE",
    "-c", "setlocal noundofile",
    "-c", "set clipboard=",
    "-c", "autocmd User VeryLazy ++once set clipboard=",
    "-c", 'lua pcall(function() require("persistence").stop() end)',
]


def resolve(configured: str = "") -> list[str] | None:
    """The editor's argv, or None when there is none on PATH."""
    for cand in (configured, os.environ.get("VISUAL"), "nvim", os.environ.get("EDITOR"), "vi"):
        if not cand:
            continue
        try:
            argv = shlex.split(cand)
        except ValueError:
            continue
        if argv and shutil.which(argv[0]):
            return argv
    return None


def command(argv: list[str], path: str, *, private: bool = True, line: int = 0) -> list[str]:
    """The full command line for one file. `private` adds nvim's leave-no-trace flags
    (a draft); without it (a file of yours, from the Composing Room) nvim runs as usual."""
    out = list(argv)
    if private and Path(argv[0]).name in ("nvim", "vim", "vi"):
        out += NVIM_FLAGS if Path(argv[0]).name == "nvim" else ["-n", "-i", "NONE", "-c", "setlocal noundofile"]
    if line:
        out.append(f"+{line}")
    out.append(path)
    return out


def drafts_dir() -> Path:
    from .media.mpv import socket_dir
    return socket_dir()


def with_context(initial: str, context: list[str] | None) -> str:
    if not context:
        return initial
    head = initial.rstrip("\n") + "\n" if initial else "\n"
    return head + "\n" + SCISSORS + "\n" + SCISSORS_HINT + "\n\n" + "\n".join(context) + "\n"


def without_context(text: str) -> str:
    lines = text.split("\n")
    if SCISSORS in lines:
        lines = lines[: lines.index(SCISSORS)]
    return "\n".join(lines).strip()


def run_editor(app, cmd: list[str]) -> int:
    """Run the editor with the terminal handed over (tests replace this)."""
    with app.suspend():
        return subprocess.run(cmd).returncode


def compose(app, initial: str = "", *, context: list[str] | None = None, suffix: str = ".md") -> str | None:
    """What you wrote, or None when you changed nothing (or no editor could run).
    An emptied draft comes back as "" (a note taken away)."""
    argv = resolve(app.cfg.get("editor") or "")
    if argv is None:
        app.say("No editor found: set `editor` in ~/.config/tubcal/tui.toml, or $VISUAL.", "error")
        return None
    text = with_context(initial, context)
    fd, path = tempfile.mkstemp(prefix="draft-", suffix=suffix, dir=drafts_dir())
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(text)
        try:
            run_editor(app, command(argv, path))
        except Exception as e:  # the editor couldn't start, or this terminal can't hand over
            app.say(f"The editor didn't run: {e}", "error")
            return None
        finally:
            app.after_suspend()
        try:
            after = Path(path).read_text()
        except OSError:
            return None
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    if after == text:
        return None
    return without_context(after)


def open_file(app, path: str, *, line: int = 0) -> bool:
    """Your own file in your own editor, as you'd open it (Composing Room)."""
    argv = resolve(app.cfg.get("editor") or "")
    if argv is None:
        app.say("No editor found: set `editor` in ~/.config/tubcal/tui.toml, or $VISUAL.", "error")
        return False
    try:
        run_editor(app, command(argv, path, private=False, line=line))
    except Exception as e:
        app.say(f"The editor didn't run: {e}", "error")
        return False
    finally:
        app.after_suspend()
    return True
