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
from ..keys import GROUPS, shown
from ..media.player import NowState
from ..rooms import ROOM_BY_ID, Registry
from ..theme import CHANNEL_HUES, MODE_HUES, ROOM_HUES, Roles
from .paint import comfy, style


def _breathe(widget: Widget, *, below: int = 0, above: int = 0) -> None:
    """Comfy spacing: a blank line under (or over) a one-line bar."""
    if comfy():
        widget.styles.height = 1 + below
        widget.styles.padding = (0, 0, below, 0)
        widget.styles.margin = (above, 0, 0, 0)


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
        _breathe(self, below=1)

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
            hue = CHANNEL_HUES.get(cid, "blue")
            t.append(f"{n} ", style(r, f"hue:{hue}" if on else "faint"))
            t.append(label, style(r, f"hue:{hue}+bold" if on else "dim"))
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
                    t.append(name, style(r, f"hue:{_hue_of(room.id)}"))
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
        self.hue = "blue"         # the room's: the breadcrumb sits on its tint
        _breathe(self, above=1)

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
        parts = [c for c in self.crumbs if c]
        on = f"wash:{self.hue}" if r.truecolor else None
        t.append(" ", style(r, "fg", on))
        for i, c in enumerate(parts):
            if i:
                t.append(" › ", style(r, f"hue:{self.hue}", on))
            t.append(c, style(r, "fg" if i == len(parts) - 1 else "dim", on))
        t.append(" ", style(r, "fg", on))
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
        _breathe(self, below=1)

    def render(self) -> Text:
        r = self.roles
        t = Text(no_wrap=True, overflow="crop")
        t.append(" ")
        for vid, label, n in self.views:
            on = vid == self.current
            # the view you're on is a chip in the room's tint
            chip = f"wash2:{self.hue}" if on and r.truecolor else None
            t.append(" ", style(r, "fg", chip))
            t.append(label, style(r, f"hue:{self.hue}+bold" if on else "dim", chip))
            if n:
                t.append(f" {n}", style(r, f"hue:{self.hue}" if on else "faint", chip))
            t.append(" ", style(r, "fg", chip))
            t.append("  ")
        if self.busy:
            t.append("⠿ ", style(r, "faint"))
        right = Text(self.right + "  ", style(r, "dim"))
        pad = self.size.width - cell_len(t.plain) - cell_len(right.plain)
        if pad > 0 and self.right:
            t.append(" " * pad)
            t.append_text(right)
        return t


class WhichKey(Static, can_focus=False):
    """What can follow a pending chord: every key, in columns across the bottom, the
    chord so far in the top edge.

    ╭ Space › p  player · Screening Room ─────────────────────────────────────────╮
    │  h → back 10 s        n → next in the queue   q → quality                    │
    │  l → forward 10 s     p → pause / play        s → stop                       │
    ╰───────────────────────────────────────────── Bksp back  Esc close  ? every key ╯

    Keys of the room (or page) you're in take its colour, everywhere's are yellow; a
    group shows how many keys it holds. Columns fill top to bottom, as which-key.nvim's.
    """

    DEFAULT_CSS = """
    WhichKey {
        layer: float; position: absolute; width: auto; height: auto;
        padding: 0 1; border: round $tc-rule; display: none; background: $tc-surface;
        border-title-align: left; border-subtitle-align: right;
    }
    """
    GAP = 4

    def __init__(self, roles: Roles, glyphs: Glyphs | None = None, **kw):
        super().__init__("", **kw)
        self.roles = roles
        self.glyphs = glyphs or Glyphs("unicode")
        self.layout_rows = 0     # what the last show drew (tests read them)
        self.layout_cols = 0

    def show_keys(self, pending: tuple[str, ...], hints: list, *, here: str = "", hue: str = "blue") -> None:
        r, g = self.roles, self.glyphs
        size = self.app.size
        plain = g.kind == "ascii"
        width = max(24, size.width - 2)
        inner = width - 4                       # the border and the padding
        keys = [shown(h.key, plain) for h in hints]
        kw = max((cell_len(k) for k in keys), default=1)
        arrow = f" {g.arrow} "

        def label_w(h) -> int:
            return cell_len(h.label) + (2 + len(str(h.count)) if h.group else 0)
        lw = min(30, max((label_w(h) for h in hints), default=8))
        n = len(hints)
        max_rows = max(2, size.height // 2 - 3)
        while True:
            colw = kw + cell_len(arrow) + lw
            cols = max(1, min(n, (inner + self.GAP) // (colw + self.GAP)))
            rows = -(-n // cols)
            if rows <= max_rows or lw <= 12:
                break
            lw -= 2
        rows = min(rows, max_rows)
        shown_n = min(n, rows * cols)
        t = Text(no_wrap=True, overflow="crop")
        for row in range(rows):
            for col in range(cols):
                i = col * rows + row
                if i >= shown_n:
                    break
                h = hints[i]
                if col:
                    t.append(" " * self.GAP)
                t.append(keys[i].rjust(kw), style(r, f"hue:{hue}+bold" if h.own else "hue:yellow+bold"))
                t.append(arrow, style(r, "faint"))
                if h.group:
                    count = f" {h.count}"
                    name = fmt.cut(f"+{h.label}", lw - cell_len(count))
                    t.append(name, style(r, "hue:blue+bold"))
                    t.append(count, style(r, "faint"))
                    used = cell_len(name) + cell_len(count)
                else:
                    name = fmt.cut(h.label, lw)
                    t.append(name, style(r, "fg"))
                    used = cell_len(name)
                if col < cols - 1:
                    t.append(" " * (lw - used))
            if row < rows - 1:
                t.append("\n")
        self.update(t)
        self.layout_rows, self.layout_cols = rows, cols
        # the chord so far, and where you are
        title = Text()
        for i, k in enumerate(pending):
            if i:
                title.append(" › ", style(r, "faint"))
            title.append(shown(k, plain), style(r, "hue:yellow+bold"))
        group = GROUPS.get(tuple(pending))
        if group:
            title.append(f"  {group}", style(r, "hue:blue+bold"))
        if here and any(h.own for h in hints):
            title.append(" · ", style(r, "faint"))
            title.append(here, style(r, f"hue:{hue}"))
        self.border_title = title
        foot = Text()
        if shown_n < n:
            foot.append(f" {n - shown_n} more: ? ", style(r, "hue:yellow"))
        for i, (key, what) in enumerate((("Bksp", "back"), ("Esc", "close"), ("?", "every key"))):
            foot.append(f"{'  ' if i else ''}{key}", style(r, "hue:yellow"))
            foot.append(f" {what}", style(r, "dim"))
        self.border_subtitle = foot
        self.styles.width = width
        h = rows + 2
        self.styles.offset = (1, max(1, size.height - h - 1))
        self.display = True
