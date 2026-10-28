"""Ask the terminal what it can do, before Textual takes over its input.

One burst of queries, answered in one read: the foreground/background (OSC 10/11),
the 16 colours (OSC 4), kitty graphics (`\\e_G…a=q`) and the device attributes (DA1,
which every terminal answers, so its reply marks the end). Once Textual runs, its
input thread would swallow the replies, so this happens first, in raw mode, with a
short timeout. st also has its colours in X resources, which can be read at any time
without touching the terminal (`xrdb_palette`), so a rice switch can be followed later.
"""

from __future__ import annotations

import fcntl
import os
import re
import select
import shutil
import struct
import subprocess
import sys
import termios
import time
import tty
from dataclasses import dataclass

from .theme import Palette, parse_hex

_OSC_REPLY = re.compile(rb"\x1b\](10|11|4;(\d+));(rgb:[0-9a-fA-F/]+)")
_KITTY_OK = re.compile(rb"\x1b_Gi=31;OK")
_DA1 = re.compile(rb"\x1b\[\?([\d;]*)c")

# Terminals that draw 24-bit colour even when COLORTERM isn't set (st doesn't set it).
_TRUECOLOR_TERMS = ("st-", "alacritty", "xterm-kitty", "foot", "wezterm", "xterm-ghostty", "tmux-direct")


@dataclass
class TermInfo:
    palette: Palette | None
    kitty: bool = False
    sixel: bool = False
    cell_px: tuple[int, int] = (0, 0)  # width, height of one cell in pixels
    term: str = ""
    answered: bool = False  # the terminal replied at all
    took_ms: int = 0

    @property
    def image_backend(self) -> str:
        if self.kitty:
            return "kitty"
        if self.sixel:
            return "sixel"
        return "halfcell"


def cell_size(fd: int) -> tuple[int, int]:
    try:
        rows, cols, xp, yp = struct.unpack("HHHH", fcntl.ioctl(fd, termios.TIOCGWINSZ, b"\0" * 8))
    except OSError:
        return (0, 0)
    if not (rows and cols and xp and yp):
        return (0, 0)
    return (xp // cols, yp // rows)


def _parse(buf: bytes) -> tuple[dict, bool, bool]:
    colours: dict[str, tuple[int, int, int]] = {}
    for key, idx, val in _OSC_REPLY.findall(buf):
        rgb = parse_hex(val.decode())
        if rgb is None:
            continue
        name = key.decode()
        colours["fg" if name == "10" else "bg" if name == "11" else f"c{int(idx)}"] = rgb
    da = _DA1.search(buf)
    sixel = bool(da and "4" in da.group(1).decode().split(";"))
    return colours, bool(_KITTY_OK.search(buf)), sixel



def palette_from(colours: dict) -> Palette | None:
    if "fg" not in colours or "bg" not in colours:
        return None
    if not all(f"c{i}" in colours for i in range(16)):
        # some terminals only report the first 8; repeat them as the bright ones
        if all(f"c{i}" in colours for i in range(8)):
            for i in range(8):
                colours.setdefault(f"c{i + 8}", colours[f"c{i}"])
        else:
            return None
    return Palette(fg=colours["fg"], bg=colours["bg"], ansi=[colours[f"c{i}"] for i in range(16)])


def probe(timeout: float = 0.4) -> TermInfo:
    """Query the controlling terminal. Never raises: anything odd → a TermInfo saying so."""
    term = os.environ.get("TERM", "")
    try:
        fd = os.open("/dev/tty", os.O_RDWR | os.O_NOCTTY)
    except OSError:
        return TermInfo(palette=None, term=term)
    t0 = time.monotonic()
    old = None
    buf = b""
    try:
        old = termios.tcgetattr(fd)
        tty.setraw(fd)
        q = "\x1b]10;?\x1b\\\x1b]11;?\x1b\\" + "".join(f"\x1b]4;{i};?\x1b\\" for i in range(16))
        q += "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\" + "\x1b[c"
        os.write(fd, q.encode())
        while time.monotonic() - t0 < timeout:
            r, _, _ = select.select([fd], [], [], 0.03)
            if r:
                buf += os.read(fd, 8192)
                if _DA1.search(buf):
                    break
    except (OSError, termios.error):
        pass
    finally:
        if old is not None:
            try:
                termios.tcsetattr(fd, termios.TCSADRAIN, old)
            except termios.error:
                pass
    px = cell_size(fd)
    os.close(fd)
    colours, kitty, sixel = _parse(buf)
    info = TermInfo(
        palette=palette_from(colours), kitty=kitty, sixel=sixel, cell_px=px, term=term,
        answered=bool(buf), took_ms=round((time.monotonic() - t0) * 1000),
    )
    if info.palette is None and term.startswith("st"):
        info.palette = xrdb_palette()
    return info


def xrdb_palette() -> Palette | None:
    """st's colours from X resources (`*background`, `*color0`…; `st.` wins over `*`)."""
    if not os.environ.get("DISPLAY") or not shutil.which("xrdb"):
        return None
    try:
        out = subprocess.run(["xrdb", "-query"], capture_output=True, text=True, timeout=1.5).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    found: dict[str, tuple[int, tuple[int, int, int]]] = {}
    for line in out.splitlines():
        key, _, val = line.partition(":")
        key = key.strip()
        rank = 2 if key.startswith("st.") else 1 if key.startswith("*") else 0
        if not rank:
            continue
        name = key.split(".", 1)[-1].lstrip("*")
        rgb = parse_hex(val)
        if rgb is None:
            continue
        slot = {"foreground": "fg", "background": "bg"}.get(name)
        if slot is None and name.startswith("color") and name[5:].isdigit() and int(name[5:]) < 16:
            slot = f"c{int(name[5:])}"
        if slot and rank >= found.get(slot, (0, None))[0]:
            found[slot] = (rank, rgb)
    p = palette_from({k: v for k, (_, v) in found.items()})
    if p:
        p.source = "xrdb"
    return p


def prepare_env(info: TermInfo) -> None:
    """Declare truecolor when the terminal draws it. Rich/Textual otherwise fall back to
    256 colours under st, which also breaks kitty images: their placeholder cells carry
    the image id in a 24-bit foreground colour."""
    if os.environ.get("NO_COLOR"):
        return
    if os.environ.get("COLORTERM") in ("truecolor", "24bit"):
        return
    if info.kitty or info.term.startswith(_TRUECOLOR_TERMS) or info.term.endswith("-direct"):
        os.environ["COLORTERM"] = "truecolor"


def interactive() -> bool:
    return sys.stdin.isatty() and sys.stdout.isatty()


def seed_textual_image(info: TermInfo) -> None:
    """Hand textual-image what we already asked, so it doesn't ask the terminal again
    (it would have to before Textual starts anyway), then load its widgets now."""
    try:
        from textual_image import _terminal as ti
        w, h = info.cell_px if all(info.cell_px) else (10, 20)
        setattr(ti.probe_terminal, "_result",
                ti.TerminalCapabilities(ti.CellSize(w, h), sixel=info.sixel, tgp=info.kitty))
        import textual_image.widget  # noqa: F401
    except Exception:
        pass
