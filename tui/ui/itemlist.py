"""A list of two-line rows under day headings, drawn line by line (Textual's Line API).

Only the visible lines are drawn, so a list of a few hundred items scrolls as fast as
one of ten. The room says what each row reads (`RowParts`); this widget lays it out:

    col 0  ▎ (selection, in the room's colour)
    col 1  the sign (• new, ◔ part-watched, ✓ watched, ● live…)
    col 3… the title, and the right-aligned figure (duration, time)
           the second line: dim meta, and a right-aligned mark (◆ saved, ≡1 queued)
    last   the pane divider, ┃ over the part of the list that is on screen

Selection is a band in `surface2` (this pane has the keys) or `surface` (it doesn't).
In VISUAL (`anchor` set) every row from the anchor to the cursor has the band and the
bar; the cursor's row alone is bold.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from rich.cells import cell_len
from rich.segment import Segment
from textual.geometry import Size
from textual.message import Message
from textual.strip import Strip
from textual.widget import Widget

from .. import fmt
from ..glyphs import Glyphs
from ..theme import Roles
from .paint import Span, style


@dataclass
class RowParts:
    sign: Span = (" ", "fg")
    title: list[Span] = field(default_factory=list)
    figure: list[Span] = field(default_factory=list)   # right of the title line
    meta: list[Span] = field(default_factory=list)     # second line
    mark: list[Span] = field(default_factory=list)     # right of the second line


@dataclass
class Head:
    label: str
    count: int | None = None


Row = Head | dict  # a heading, or an item


def _width(spans: list[Span]) -> int:
    return sum(cell_len(s) for s, _ in spans)


def _fit(spans: list[Span], width: int) -> list[Span]:
    """Cut a run of spans to `width` cells, the last one with an ellipsis."""
    out, used = [], 0
    for s, role in spans:
        w = cell_len(s)
        if used + w <= width:
            out.append((s, role))
            used += w
            continue
        room = width - used
        if room > 0:
            out.append((fmt.cut(s, room), role))
        break
    return out


class ItemList(Widget, can_focus=False):
    DEFAULT_CSS = "ItemList { height: 1fr; width: 1fr; }"

    class Moved(Message):
        def __init__(self, sender: "ItemList", item: dict | None):
            super().__init__()
            self.list = sender
            self.item = item

    def __init__(self, render_item: Callable[[dict], RowParts], *, roles: Roles, glyphs: Glyphs,
                 hue: str = "blue", divider: bool = True, empty: list[str] | None = None,
                 lines_per_item: int = 2, **kw):
        super().__init__(**kw)
        self.lpi = lines_per_item
        self.render_item = render_item
        self.roles = roles
        self.glyphs = glyphs
        self.hue = hue
        self.divider = divider
        self.rows: list[Row] = []
        self._lines: list[tuple[int, int]] = []    # (row index, sub-line); row -1 = blank
        self._first_line: dict[int, int] = {}      # row index → its first line
        self._items: list[int] = []                # row indexes that are items
        self.cursor = 0                            # index into _items
        self.top = 0                               # first visible line
        self.active = True                         # this pane has the keys
        self.empty = empty or ["Nothing here yet."]
        self.matches: list[int] = []
        self._match_rows: set[int] = set()
        self.anchor: int | None = None             # VISUAL: the item the range started at
        self._item_no: dict[int, int] = {}         # row index → index into _items

    # ── data ─────────────────────────────────────────────────────────────────

    def set_rows(self, rows: list[Row], *, keep: str | None = None) -> None:
        keep = keep or (self.selected or {}).get("id")
        self.rows = rows
        self._lines, self._first_line, self._items = [], {}, []
        for i, r in enumerate(rows):
            if isinstance(r, Head):
                if self._lines:
                    self._lines.append((-1, 0))
                self._first_line[i] = len(self._lines)
                self._lines.append((i, 0))
            else:
                self._first_line[i] = len(self._lines)
                self._items.append(i)
                self._lines += [(i, k) for k in range(self.lpi)]
        self.cursor = 0
        if keep:
            for n, ri in enumerate(self._items):
                if self.rows[ri].get("id") == keep:
                    self.cursor = n
                    break
        self.cursor = min(self.cursor, max(0, len(self._items) - 1))
        self._item_no = {ri: n for n, ri in enumerate(self._items)}
        self.anchor = None   # new rows: a range over the old ones means nothing
        self.virtual_size = Size(self.size.width, len(self._lines))
        self._keep_visible()
        self.refresh()
        self.post_message(self.Moved(self, self.selected))

    def repaint(self) -> None:
        self.refresh()

    @property
    def items(self) -> list[dict]:
        return [self.rows[i] for i in self._items]

    @property
    def selected(self) -> dict | None:
        if not self._items:
            return None
        return self.rows[self._items[self.cursor]]

    def visual_range(self) -> tuple[int, int] | None:
        """(first, last) item indexes of the VISUAL range, or None outside VISUAL."""
        if self.anchor is None or not self._items:
            return None
        a = min(self.anchor, len(self._items) - 1)
        return (min(a, self.cursor), max(a, self.cursor))

    def range_items(self) -> list[dict]:
        """The rows VISUAL covers, top to bottom; the selected row outside VISUAL."""
        rng = self.visual_range()
        if rng is None:
            return [self.selected] if self.selected is not None else []
        return [self.rows[self._items[n]] for n in range(rng[0], rng[1] + 1)]

    def swap_ends(self) -> None:
        """VISUAL's `o`: the cursor goes to the other end of the range."""
        if self.anchor is not None and self._items:
            self.anchor, cursor = self.cursor, min(self.anchor, len(self._items) - 1)
            self.go(cursor)
            self.refresh()

    @property
    def position(self) -> tuple[int, int]:
        return (self.cursor + 1 if self._items else 0, len(self._items))

    # ── movement ─────────────────────────────────────────────────────────────

    def move(self, n: int) -> None:
        if not self._items:
            return
        new = max(0, min(len(self._items) - 1, self.cursor + n))
        if new != self.cursor:
            self.cursor = new
            self._keep_visible()
            self.refresh()
            self.post_message(self.Moved(self, self.selected))

    def go(self, index: int) -> None:
        self.move(index - self.cursor)

    def page(self, fraction: float) -> None:
        rows = max(1, int(self.size.height * abs(fraction) / 2))
        self.move(rows if fraction > 0 else -rows)

    def place(self, where: str) -> None:
        """zz / zt / zb: put the selected row in the middle, top or bottom."""
        if not self._items:
            return
        line = self._first_line[self._items[self.cursor]]
        h = self.size.height
        self.top = {"center": line - h // 2 + 1, "top": line, "bottom": line - h + 2}[where]
        self.top = max(0, min(self.top, max(0, len(self._lines) - h)))
        self.refresh()

    def _keep_visible(self, margin: int = 4) -> None:
        if not self._items:
            self.top = 0
            return
        h = max(1, self.size.height)
        line = self._first_line[self._items[self.cursor]]
        # the heading above the first item of a group stays in view with it
        if self.cursor == 0:
            line = 0
        margin = min(margin, max(0, (h - 2) // 2))
        if line < self.top + margin:
            self.top = max(0, line - margin)
        elif line + self.lpi - 1 > self.top + h - 1 - margin:
            self.top = line + self.lpi - h + margin
        self.top = max(0, min(self.top, max(0, len(self._lines) - h)))

    def on_resize(self) -> None:
        self._keep_visible()

    # ── search (vim's /, n, N: jump, don't filter) ───────────────────────────

    def search(self, pattern: str, *, forward: bool = True, from_next: bool = True) -> bool:
        pat = pattern.lower()
        self.matches = [n for n, ri in enumerate(self._items)
                        if pat in (self.rows[ri].get("title") or "").lower()
                        or pat in (self.rows[ri].get("source") or "").lower()] if pat else []
        self._match_rows = {self._items[m] for m in self.matches}
        if not self.matches:
            self.refresh()
            return False
        if forward:
            nxt = next((m for m in self.matches if m > self.cursor or (not from_next and m == self.cursor)),
                       self.matches[0])
        else:
            nxt = next((m for m in reversed(self.matches) if m < self.cursor), self.matches[-1])
        self.go(nxt)
        self.refresh()
        return True

    # ── drawing ──────────────────────────────────────────────────────────────

    def render_line(self, y: int) -> Strip:
        width = self.size.width
        inner = width - (1 if self.divider else 0)
        line_no = self.top + y
        if not self._items and not any(isinstance(r, Head) for r in self.rows):
            segs = [Segment(" " * inner)]
            if 1 <= y <= len(self.empty):
                t = self.empty[y - 1]
                segs = [Segment("  "), Segment(fmt.cut(t, inner - 2), style(self.roles, "dim" if y == 1 else "faint"))]
            return self._finish(Strip(segs).adjust_cell_length(inner), y)
        if line_no >= len(self._lines):
            return self._finish(Strip([Segment(" " * inner)]), y)
        ri, sub = self._lines[line_no]
        if ri == -1:
            return self._finish(Strip([Segment(" " * inner)]), y)
        row = self.rows[ri]
        if isinstance(row, Head):
            return self._finish(self._head(row, inner), y)
        selected = bool(self._items) and self._items[self.cursor] == ri
        rng = self.visual_range()
        banded = selected or (rng is not None and rng[0] <= self._item_no.get(ri, -1) <= rng[1])
        surface = ("surface2" if self.active else "surface") if banded else None
        parts = self.render_item(row)
        return self._finish(self._item_line(parts, sub, inner, banded, surface, ri, bold=selected), y)

    def _head(self, head: Head, inner: int) -> Strip:
        label = f"  {head.label} "
        count = f" {head.count} " if head.count is not None else " "
        rule = self.glyphs.rule_h * max(0, inner - cell_len(label) - cell_len(count) - 2)
        return Strip([
            Segment(label, style(self.roles, "fg+bold")),
            Segment(rule, style(self.roles, "rule")),
            Segment(count, style(self.roles, "dim")),
            Segment("  "),
        ]).adjust_cell_length(inner)

    def _item_line(self, p: RowParts, sub: int, inner: int, selected: bool, surface: str | None,
                   ri: int, *, bold: bool = True) -> Strip:
        r = self.roles
        bar_role = f"mark:{self.hue}" if self.active else "faint"
        bar = Segment(self.glyphs.select if selected else " ",
                      style(r, bar_role, surface) if selected else style(r, "fg"))
        if sub == 0:
            sign_text, sign_role = p.sign
            left = [(fmt.pad(sign_text, 1), sign_role), (" ", "fg")]
            body = [(s, role + ("+bold" if selected and bold and "bold" not in role else "")) for s, role in p.title]
            right = p.figure
        else:
            left = [("  ", "fg")]
            body, right = p.meta, p.mark
        gutter = 2
        room = inner - 1 - _width(left) - gutter
        right_w = _width(right)
        body = _fit(body, max(0, room - (right_w + 2 if right_w else 0)))
        gap = max(0, room - _width(body) - right_w)
        underline = sub == 0 and ri in self._match_rows
        segs = [bar]
        for s, role in left:
            segs.append(Segment(s, style(r, role, surface)))
        for s, role in body:
            segs.append(Segment(s, style(r, role + ("+underline" if underline else ""), surface)))
        segs.append(Segment(" " * gap, style(r, "fg", surface)))
        for s, role in right:
            segs.append(Segment(s, style(r, role, surface)))
        segs.append(Segment(" " * gutter, style(r, "fg", surface)))
        return Strip(segs).adjust_cell_length(inner)

    def _finish(self, strip: Strip, y: int) -> Strip:
        if not self.divider:
            return strip
        total, h = len(self._lines), self.size.height
        ch = self.glyphs.rule_v
        if total > h and h > 0:
            start = int(self.top * h / total)
            end = max(start + 1, int((self.top + h) * h / total))
            if start <= y < end:
                ch = self.glyphs.rule_v_on
        return Strip(list(strip) + [Segment(ch, style(self.roles, "rule" if ch == self.glyphs.rule_v else "faint"))])

    # mouse: a click selects, the wheel moves
    def on_click(self, event) -> None:
        line = self.top + event.y
        if 0 <= line < len(self._lines):
            ri = self._lines[line][0]
            if ri in self._items:
                self.go(self._items.index(ri))

    def on_mouse_scroll_down(self, event) -> None:
        self.move(3)

    def on_mouse_scroll_up(self, event) -> None:
        self.move(-3)
