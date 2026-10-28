"""A column of units (stories in a paper), each a few lines, read one unit at a time.

The column is at most `measure` cells wide and centred in a wider pane, so prose never
runs edge to edge. The unit under the cursor gets a bar in the margin. Answers to
ItemList's calls (move, go, page, place, search, position, items, selected), so the
app's movement keys work on it unchanged.
"""

from __future__ import annotations

from typing import Callable

from rich.segment import Segment
from textual.geometry import Size
from textual.message import Message
from textual.strip import Strip
from textual.widget import Widget

from ..glyphs import Glyphs
from ..theme import Roles
from .paint import style

Line = list[tuple[str, str]]


class UnitView(Widget, can_focus=False):
    DEFAULT_CSS = "UnitView { height: 1fr; width: 1fr; }"

    class Moved(Message):
        def __init__(self, sender: "UnitView", unit: dict | None):
            super().__init__()
            self.view = sender
            self.unit = unit

    def __init__(self, render: Callable[[dict, int], list[Line]], *, roles: Roles, glyphs: Glyphs,
                 head: Callable[[int], list[Line]] | None = None, measure: int = 76, hue: str = "blue",
                 empty: list[str] | None = None, **kw):
        super().__init__(**kw)
        self.render_unit = render
        self.head = head
        self.roles, self.glyphs = roles, glyphs
        self.measure = measure
        self.hue = hue
        self.units: list[dict] = []
        self.cursor = 0
        self.top = 0
        self.active = True
        self.empty = empty or [""]
        self._lines: list[tuple[Line, int]] = []
        self._start: list[int] = []
        self._width = 0
        self.matches: list[int] = []

    def set_units(self, units: list[dict], *, keep: str | None = None) -> None:
        self.units = units
        self.cursor = 0
        if keep:
            self.cursor = next((i for i, u in enumerate(units) if u.get("id") == keep), 0)
        self.top = 0
        self._layout(force=True)
        self._keep_visible()
        self.post_message(self.Moved(self, self.selected))

    @property
    def column(self) -> int:
        return min(self.measure, max(20, self.size.width - 4))

    def _layout(self, force: bool = False) -> None:
        width = self.column
        if not force and width == self._width:
            return
        self._width = width
        lines: list[tuple[Line, int]] = []
        if self.head:
            for ln in self.head(width):
                lines.append((ln, -1))
        self._start = []
        for i, u in enumerate(self.units):
            self._start.append(len(lines))
            for ln in self.render_unit(u, width):
                lines.append((ln, i))
        self._lines = lines
        self.virtual_size = Size(self.size.width, len(lines))
        self.refresh()

    def repaint(self) -> None:
        self._layout(force=True)

    def on_resize(self) -> None:
        self._layout()
        self._keep_visible()

    @property
    def items(self) -> list[dict]:
        return self.units

    @property
    def selected(self) -> dict | None:
        return self.units[self.cursor] if self.units else None

    @property
    def position(self) -> tuple[int, int]:
        return (self.cursor + 1 if self.units else 0, len(self.units))

    def _end(self, i: int) -> int:
        return (self._start[i + 1] if i + 1 < len(self._start) else len(self._lines)) - 1

    def _keep_visible(self) -> None:
        if not self.units:
            return
        h = max(1, self.size.height)
        start, end = self._start[self.cursor], self._end(self.cursor)
        if self.cursor == 0:
            start = 0
        if start < self.top:
            self.top = start
        elif end >= self.top + h:
            self.top = start if end - start + 1 > h else end - h + 1
        self.top = max(0, min(self.top, max(0, len(self._lines) - h)))

    def move(self, n: int) -> None:
        if not self.units:
            return
        new = max(0, min(len(self.units) - 1, self.cursor + n))
        if new != self.cursor:
            self.cursor = new
            self._keep_visible()
            self.refresh()
            self.post_message(self.Moved(self, self.selected))

    def go(self, index: int) -> None:
        self.move(index - self.cursor)
        if index <= 0:
            self.top = 0
            self.refresh()

    def page(self, fraction: float) -> None:
        rows = max(1, int(self.size.height * abs(fraction) / 2))
        self.scroll_lines(rows if fraction > 0 else -rows)

    def scroll_lines(self, n: int) -> None:
        h = self.size.height
        self.top = max(0, min(self.top + n, max(0, len(self._lines) - h)))
        visible = [i for ln, i in self._lines[self.top:self.top + h] if i >= 0]
        if visible and self.cursor not in visible:
            self.cursor = visible[0] if n > 0 else visible[-1]
            self.post_message(self.Moved(self, self.selected))
        self.refresh()

    def place(self, where: str) -> None:
        if not self.units:
            return
        line = self._start[self.cursor]
        h = self.size.height
        self.top = {"center": line - h // 2 + 1, "top": line, "bottom": line - h + 2}[where]
        self.top = max(0, min(self.top, max(0, len(self._lines) - h)))
        self.refresh()

    def search(self, pattern: str, *, forward: bool = True, from_next: bool = True) -> bool:
        pat = pattern.lower()
        self.matches = [i for i, u in enumerate(self.units) if pat and pat in (u.get("_text") or "").lower()]
        if not self.matches:
            return False
        if forward:
            nxt = next((m for m in self.matches if m > self.cursor or (not from_next and m == self.cursor)),
                       self.matches[0])
        else:
            nxt = next((m for m in reversed(self.matches) if m < self.cursor), self.matches[-1])
        self.move(nxt - self.cursor)
        return True

    def render_line(self, y: int) -> Strip:
        width = self.size.width
        r, g = self.roles, self.glyphs
        n = self.top + y
        if not self._lines:
            text = self.empty[y - 1] if 1 <= y <= len(self.empty) else ""
            return Strip([Segment("  " + text, style(r, "dim" if y == 1 else "faint"))]).adjust_cell_length(width)
        if n >= len(self._lines):
            return Strip([Segment(" " * width)])
        spans, ui = self._lines[n]
        left = max(0, (width - self._width) // 2 - 2)
        bar = g.select if ui == self.cursor and ui >= 0 else " "
        segs = [Segment(" " * left), Segment(bar, style(r, f"mark:{self.hue}" if self.active else "faint")), Segment(" ")]
        for text, role in spans:
            segs.append(Segment(text, style(r, role)))
        return Strip(segs).adjust_cell_length(width)

    def on_mouse_scroll_down(self, event) -> None:
        self.scroll_lines(3)

    def on_mouse_scroll_up(self, event) -> None:
        self.scroll_lines(-3)
