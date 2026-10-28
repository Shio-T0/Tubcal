"""The two lines that frame every room, and the which-key float.

Tabline:     ❯ Tubcal.   1 Social  2 Coding  3 Video  │  1 Screening Room  2 Anime ↗ …   ● 2 live
Statusline:  NORMAL  PRIV  Latest › Today   message …   ▶ 12:03/41:10 title  ≡ 2  󰐹 31:02 Show  󰽥 23m   3/240   21:47

The statusline is LazyVim's lualine layout: the mode block, a breadcrumb, a message
area (which replaces toasts: they'd collide with images), what's playing, the position,
and the clock block in the mode's colour. While you type a `:` command or a `/` search,
the line becomes the command line.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from rich.cells import cell_len
from rich.text import Text
from textual.widget import Widget
from textual.widgets import Static

from .. import fmt
from ..glyphs import Glyphs
from ..media.player import NowState
from ..rooms import ROOM_BY_ID, Registry
from ..theme import MODE_HUES, Roles
from .paint import style


def _block(roles: Roles, glyphs: Glyphs, label: str, hue: str) -> Text:
    """A lualine block: rounded ends in Nerd Font mode, square otherwise."""
    t = Text()
    st = roles.block(hue)
    if glyphs.block_l and roles.truecolor:
        edge = style(roles, f"mark:{hue}")
        t.append(glyphs.block_l, edge)
        t.append(f"{label}", st)
        t.append(glyphs.block_r, edge)
    else:
        t.append(f" {label} ", st)
    return t


class Tabline(Widget, can_focus=False):
    DEFAULT_CSS = "Tabline { height: 1; }"

    def __init__(self, roles: Roles, glyphs: Glyphs, **kw):
        super().__init__(**kw)
        self.roles, self.glyphs = roles, glyphs
        self.registry: Registry | None = None
        self.room_id = "youtube"
        self.live = 0
        self.server_down = False
        self.starting = ""
        self.built: set[str] = set()

    def render(self) -> Text:
        r = self.roles
        reg = self.registry
        if reg is None:
            t = self._mark()
            t.append(self.starting or "", style(r, "dim"))
            return t
        right = self._right()
        room = self.size.width - cell_len(right.plain) - 1
        # narrower and narrower until it fits: every channel and full room names, then
        # only this channel, then short room names
        for all_channels, short in ((True, False), (False, False), (False, True)):
            t = self._line(reg, all_channels, short)
            if cell_len(t.plain) <= room:
                break
        pad = self.size.width - cell_len(t.plain) - cell_len(right.plain)
        if pad > 1:
            t.append(" " * pad)
            t.append_text(right)
        return t

    def _mark(self) -> Text:
        r, g = self.roles, self.glyphs
        t = Text(no_wrap=True, overflow="crop")
        t.append(f" {g.prompt} ", style(r, "mark:green"))
        t.append("Tubcal", style(r, "fg+bold"))
        t.append(".", style(r, "mark:blue+bold"))
        t.append("   ")
        return t

    def _line(self, reg: Registry, all_channels: bool, short: bool) -> Text:
        r, g = self.roles, self.glyphs
        t = self._mark()
        cur_ch = reg.channel_of(self.room_id)
        for n, (cid, label, _rooms) in enumerate(reg.channels(), 1):
            on = cid == cur_ch
            if not on and not all_channels:
                continue
            t.append(f"{n} ", style(r, "faint" if not on else "dim"))
            t.append(label, style(r, "fg+bold" if on else "dim"))
            t.append("  ")
        if self.room_id == "home":
            t.append(f"{g.rule_v}  ", style(r, "rule"))
            t.append_text(_block(r, g, "Home", "blue"))
            return t
        rooms = reg.rooms_in(cur_ch) if cur_ch else []
        if self.room_id not in [x.id for x in rooms] and self.room_id in ROOM_BY_ID:
            rooms = rooms + [ROOM_BY_ID[self.room_id]]     # switched off, opened by name
        if rooms:
            t.append(f"{g.rule_v}  ", style(r, "rule"))
            for n, room in enumerate(rooms, 1):
                name = room.short if short else room.label
                web = "" if room.id in self.built else f" {g.web}"
                if room.id == self.room_id:
                    t.append_text(_block(r, g, f"{n} {name}", _hue_of(room.id)))
                else:
                    t.append(f"{n} ", style(r, "faint"))
                    t.append(name, style(r, "dim"))
                    if web:
                        t.append(web, style(r, "faint"))
                t.append("  " if short else "   ")
        return t

    def _right(self) -> Text:
        r, g = self.roles, self.glyphs
        right = Text()
        if self.server_down:
            right.append(f"{g.error} server down ", style(r, "hue:red"))
        elif self.live:
            right.append(f"{g.live} {self.live} live ", style(r, "hue:red"))
        return right


def _hue_of(room_id: str) -> str:
    from ..theme import ROOM_HUES
    return ROOM_HUES.get(room_id, "blue")


@dataclass
class Message:
    text: str
    level: str = "info"     # info | warn | error
    until: float = 0.0      # monotonic deadline; 0 = until the next key


class Statusline(Widget, can_focus=False):
    DEFAULT_CSS = "Statusline { height: 1; }"

    def __init__(self, roles: Roles, glyphs: Glyphs, **kw):
        super().__init__(**kw)
        self.roles, self.glyphs = roles, glyphs
        self.mode = "NORMAL"
        self.private = False
        self.crumbs: list[str] = []
        self.message: Message | None = None
        self.now = NowState()
        self.position = (0, 0)
        self.pending = ""
        self.prompt = ""          # ':' or '/' while typing
        self.buffer = ""
        self.cursor = 0
        self.stale = ""           # "cached 2h"
        self.search_info = ""
        self.radio = NowState()   # the bench radio
        self.radio_show = ""
        self.sleep = ""           # the sleep timer: "23m", "end"

    def say(self, text: str, level: str = "info") -> None:
        dur = {"info": 4, "warn": 8}.get(level, 0)
        self.message = Message(text, level, time.monotonic() + dur if dur else 0)
        self.refresh()

    def clear_message(self, *, key: bool = False) -> None:
        m = self.message
        if m and ((m.until and time.monotonic() >= m.until) or (key and m.until == 0)):
            self.message = None
            self.refresh()

    def render(self) -> Text:
        r, g = self.roles, self.glyphs
        width = self.size.width
        mode = self.mode
        hue = MODE_HUES.get(mode, "blue")
        t = Text(no_wrap=True, overflow="crop")
        t.append_text(_block(r, g, mode, hue))
        if self.prompt:
            t.append(" ")
            t.append(self.prompt, style(r, f"hue:{hue}+bold"))
            before, after = self.buffer[:self.cursor], self.buffer[self.cursor:]
            t.append(before)
            t.append(after[:1] or " ", style(r, "fg") + _reverse())
            t.append(after[1:])
            if self.search_info:
                info = Text(self.search_info, style(r, "dim"))
                pad = width - cell_len(t.plain) - cell_len(info.plain) - 1
                if pad > 0:
                    t.append(" " * pad)
                    t.append_text(info)
            return t
        if self.private:
            t.append(" ")
            priv = Text(f" {g.private}PRIV ", style(r, "fg+bold") + _reverse())
            t.append_text(priv)
        t.append(" ")
        crumb = " › ".join(c for c in self.crumbs if c)
        t.append(f" {crumb} ", style(r, "dim", "surface") if r.truecolor else style(r, "dim"))
        left_w = cell_len(t.plain)
        # the right side: playing │ queue │ pending keys │ position │ clock
        right = Text(no_wrap=True)
        if self.pending:
            right.append(f"{self.pending}  ", style(r, "hue:yellow"))
        if self.stale:
            right.append(f"{self.stale}  ", style(r, "faint"))
        clock = _block(r, g, fmt.clock(), hue)
        pos = f"{self.position[0]}/{self.position[1]}" if self.position[1] else ""
        tail = Text()
        if pos:
            tail.append(f" {pos} ", style(r, "dim", "surface") if r.truecolor else style(r, "dim"))
            tail.append(" ")
        tail.append_text(clock)
        # what's playing comes before a message: the time, then as much title as fits
        # in what a message would leave (a message gets at least 24 cells)
        extras = self._radio_and_sleep()
        room = width - left_w - cell_len(right.plain) - cell_len(tail.plain) - cell_len(extras.plain) - 2
        msg_min = min(24, len(self.message.text) + 2) if self.message else 0
        playing = self._playing(max(0, room - msg_min))
        right.append_text(playing)
        if playing.plain:
            right.append("  ")
        right.append_text(extras)
        msg_text = f"  {self.message.text}" if self.message else ""
        msg_role = {"error": "hue:red", "warn": "hue:yellow"}.get(self.message.level, "fg") if self.message else "fg"
        free = width - left_w - cell_len(right.plain) - cell_len(tail.plain)
        t.append(fmt.cut(msg_text, max(0, free - 1)), style(r, msg_role))
        pad = width - cell_len(t.plain) - cell_len(right.plain) - cell_len(tail.plain)
        t.append(" " * max(0, pad))
        t.append_text(right)
        t.append_text(tail)
        return t


    def _radio_and_sleep(self) -> Text:
        """󰐹 31:02 Show  󰽥 23m — the radio (while tuned) and the sleep timer (while set)."""
        r, g, n = self.roles, self.glyphs, self.radio
        t = Text(no_wrap=True)
        if n.active:
            t.append(g.radio or "radio ", style(r, "mark:cyan" if not n.paused else "dim"))
            if n.loading:
                t.append("tuning", style(r, "dim"))
            else:
                t.append(fmt.duration(n.pos) or "0:00", style(r, "fg" if not n.paused else "dim"))
                if n.paused:
                    t.append(f" {g.paused}", style(r, "dim"))
            if self.radio_show:
                t.append(" " + fmt.cut(fmt.clean(self.radio_show), 16), style(r, "dim"))
            t.append("  ")
        if self.sleep:
            t.append(g.sleep or "sleep ", style(r, "hue:magenta"))
            t.append(self.sleep, style(r, "hue:magenta"))
            t.append("  ")
        return t

    def _playing(self, room: int) -> Text:
        """▶ 12:03/41:10 720p  Title…  ≡ 2, fitted to `room` cells (title first to go)."""
        r, g, n = self.roles, self.glyphs, self.now
        head = Text(no_wrap=True)
        if n.loading and n.title:
            head.append(f"{g.playing} ", style(r, "faint"))
            head.append("loading", style(r, "dim"))
        elif n.active:
            mark = g.paused if n.paused else g.playing
            head.append(f"{mark} ", style(r, "mark:green" if not n.paused else "dim"))
            head.append(f"{fmt.duration(n.pos)}/{fmt.duration(n.dur) or '–'}", style(r, "fg"))
            if n.buffering:
                head.append(" buffering", style(r, "faint"))
            elif n.quality:
                head.append(f" {n.quality}", style(r, "faint"))
        else:
            return head
        queue = Text(f"  {g.queued} {n.queue}", style(r, "dim")) if n.queue else Text()
        left = room - cell_len(head.plain) - cell_len(queue.plain) - 2
        if n.title and left >= 8:
            head.append("  ")
            head.append(fmt.cut(fmt.clean(n.title), min(34, left)), style(r, "dim"))
        head.append_text(queue)
        return head


def _reverse():
    from rich.style import Style
    return Style(reverse=True)


class Winbar(Widget, can_focus=False):
    """A pane's own line: its views on the left (Tab / S-Tab), a filter on the right.

       Latest 120   Live 2   Continue 4   History        all channels · hiding watched
    """

    DEFAULT_CSS = "Winbar { height: 1; }"

    def __init__(self, roles: Roles, glyphs: Glyphs, **kw):
        super().__init__(**kw)
        self.roles, self.glyphs = roles, glyphs
        self.views: list[tuple[str, str, int | None]] = []   # (id, label, count)
        self.current = ""
        self.right = ""
        self.busy = False
        self.hue = "blue"

    def render(self) -> Text:
        r = self.roles
        t = Text(no_wrap=True, overflow="crop")
        t.append("  ")
        for vid, label, n in self.views:
            on = vid == self.current
            t.append(label, style(r, f"hue:{self.hue}+bold" if on else "dim"))
            if n:
                t.append(f" {n}", style(r, "dim" if on else "faint"))
            t.append("   ")
        if self.busy:
            t.append("⠿ ", style(r, "faint"))
        right = Text(self.right + "  ", style(r, "dim"))
        pad = self.size.width - cell_len(t.plain) - cell_len(right.plain)
        if pad > 0 and self.right:
            t.append(" " * pad)
            t.append_text(right)
        return t


class WhichKey(Static, can_focus=False):
    """The float listing what can follow a pending chord (bottom right, rounded)."""

    DEFAULT_CSS = """
    WhichKey {
        layer: float; position: absolute; width: auto; height: auto;
        padding: 0 1; border: round $tc-rule; display: none;
    }
    """

    def __init__(self, roles: Roles, **kw):
        super().__init__("", **kw)
        self.roles = roles

    def show_keys(self, title: str, keys: list[tuple[str, str]]) -> None:
        r = self.roles
        t = Text(no_wrap=True, overflow="ellipsis")
        t.append(f"{title}\n", style(r, "dim"))
        rows = keys[:12]
        kw = max((cell_len(k) for k, _ in rows), default=1)
        for i, (k, label) in enumerate(rows):
            t.append(k.replace("space", "␣").rjust(kw) + "  ", style(r, "hue:yellow+bold"))
            t.append(label, style(r, "hue:blue") if label.startswith("+") else style(r, "fg"))
            if i < len(rows) - 1:
                t.append("\n")
        if len(keys) > 12:
            t.append(f"\n… {len(keys) - 12} more", style(r, "faint"))
        self.update(t)
        # bottom right, just above the statusline
        lines = t.plain.split("\n")
        w = max(cell_len(ln) for ln in lines) + 4
        h = len(lines) + 2
        size = self.app.size
        self.styles.offset = (max(0, size.width - w - 1), max(1, size.height - h - 1))
        self.display = True
