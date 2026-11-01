"""A page over the room: Settings, the keys, the commands, what's playing, what you
follow, checkhealth… (`tui/pages/` says what is on each).

    Settings  Accounts, playback, rooms, and this terminal's own
    ⏎ change   h l step   Tab next section   / filter   q close

    Accounts          │  Accounts ─────────────────────────────────────── 3
    Following         │▎ AniList                                ● connected
    Rooms             │▎ Your list, sync and the social pages   :unlink anilist
    …

`Sheet` is the frame: a head (the title, and the page's keys or the filter), an index
of the sections on the left when there's room, and the body. The body moves as a list
does (j k gg G, counts, Ctrl-d…, Tab to the next section; it has ItemList's methods,
so the app moves it with the same code) and `/` filters it as you type: what matches
stays, under its heading.

Rows are `Section`s, `Entry`s (a key column, a title with a figure on its right, a
dim second line with a mark on its right, and `more`, shown under it while it's
selected) and `Note`s (a paragraph, wrapped).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from rich.cells import cell_len
from rich.segment import Segment
from rich.text import Text
from textual.containers import Horizontal, Vertical
from textual.geometry import Size
from textual.strip import Strip
from textual.widget import Widget
from textual.widgets import Static

from .. import fmt
from ..glyphs import Glyphs
from ..theme import Roles
from .itemlist import _fit, _width
from .paint import Span, comfy, style


@dataclass
class Section:
    label: str
    note: str = ""
    hue: str | None = None        # None: the page's


@dataclass
class Entry:
    id: str
    title: list[Span] = field(default_factory=list)
    key: list[Span] = field(default_factory=list)      # the left column
    figure: list[Span] = field(default_factory=list)   # right of the title
    meta: list[Span] = field(default_factory=list)     # the second line
    mark: list[Span] = field(default_factory=list)     # right of the second line
    more: list[list[Span]] = field(default_factory=list)   # under it, while it's selected
    find: str = ""                                     # more words the filter matches
    act: Callable[[], Any] | None = None               # Enter
    data: Any = None


@dataclass
class Note:
    spans: list[Span]
    indent: int = 2


Row = Section | Entry | Note


def ticks(text: str, role: str = "dim", code: str = "hue:yellow") -> list[Span]:
    """`backticked` words in another colour (commands and keys inside a sentence)."""
    out: list[Span] = []
    for i, part in enumerate(text.split("`")):
        if part:
            out.append((part, code if i % 2 else role))
    return out


def _plain(spans: list[Span]) -> str:
    return "".join(s for s, _ in spans)


def _words(row: Row) -> str:
    if isinstance(row, Section):
        return f"{row.label} {row.note}".strip()
    if isinstance(row, Note):
        return _plain(row.spans)
    parts = [row.key, row.title, row.figure, row.meta, row.mark, *row.more]
    return " ".join(_plain(p) for p in parts) + " " + row.find


class SheetBody(Widget, can_focus=False):
    DEFAULT_CSS = "SheetBody { height: 1fr; width: 1fr; }"

    def __init__(self, roles: Roles, glyphs: Glyphs, **kw):
        super().__init__(**kw)
        self.roles, self.glyphs = roles, glyphs
        self.hue = "blue"
        self.all: list[Row] = []
        self.rows: list[Row] = []          # what shows (all of it, or what the filter kept)
        self.filter = ""
        self.matches: list[int] = []       # while filtering: every entry shown
        self._entries: list[int] = []      # row indexes of the entries
        self.cursor = 0                    # index into _entries
        self.top = 0
        self.active = True
        self.one_key_column = False        # one width for every section's keys (else each its own)
        self.empty = "Nothing here."
        self._lines: list[tuple] = []
        self._first: dict[int, int] = {}
        self._laid_for = -1
        self.on_moved: Callable[[], None] | None = None

    # ── data ─────────────────────────────────────────────────────────────────

    def set_rows(self, rows: list[Row], *, keep: str | None = None) -> None:
        keep = keep or getattr(self.selected, "id", None)
        self.all = rows
        self._apply_filter(keep)

    def _apply_filter(self, keep: str | None = None) -> None:
        pat = self.filter.lower()
        if not pat:
            self.rows = list(self.all)
        else:
            out: list[Row] = []
            head: Section | None = None
            head_hit, head_shown = False, False
            for r in self.all:
                if isinstance(r, Section):
                    head, head_hit, head_shown = r, pat in r.label.lower(), False
                    continue
                if head_hit or pat in _words(r).lower():
                    if head is not None and not head_shown:
                        out.append(head)
                        head_shown = True
                    out.append(r)
            self.rows = out
        self._entries = [i for i, r in enumerate(self.rows) if isinstance(r, Entry)]
        self.matches = list(range(len(self._entries))) if pat else []
        self.cursor = 0
        if keep:
            self.cursor = next((n for n, ri in enumerate(self._entries) if self.rows[ri].id == keep), 0)
        self._relayout()

    @property
    def items(self) -> list[Entry]:
        return [self.rows[i] for i in self._entries]

    @property
    def selected(self) -> Entry | None:
        return self.rows[self._entries[self.cursor]] if self._entries else None

    @property
    def position(self) -> tuple[int, int]:
        return (self.cursor + 1 if self._entries else 0, len(self._entries))

    def section_of(self, entry: Entry | None) -> str:
        if entry is None:
            return ""
        label = ""
        for r in self.rows:
            if isinstance(r, Section):
                label = r.label
            elif r is entry:
                return label
        return label

    def sections(self) -> list[tuple[str, int]]:
        """(label, entries under it), in order."""
        out: list[list] = []
        for r in self.rows:
            if isinstance(r, Section):
                out.append([r.label, 0])
            elif isinstance(r, Entry) and out:
                out[-1][1] += 1
        return [(a, b) for a, b in out]

    def text(self) -> str:
        """Everything on the page as plain text, shown or not (tests read it)."""
        out = []
        for r in self.all:
            if isinstance(r, Entry):
                more = " ".join(_plain(m) for m in r.more)
                out.append(" ".join(x for x in (_plain(r.key), _plain(r.title), _plain(r.figure),
                                                 _plain(r.meta), _plain(r.mark), more) if x))
            else:
                out.append(_words(r))
        return "\n".join(out)

    # ── movement (ItemList's) ────────────────────────────────────────────────

    def move(self, n: int) -> None:
        if not self._entries:
            return
        new = max(0, min(len(self._entries) - 1, self.cursor + n))
        if new != self.cursor:
            self.cursor = new
            self._relayout()

    def go(self, index: int) -> None:
        self.move(index - self.cursor)

    def page(self, fraction: float) -> None:
        rows = max(1, int(self.size.height * abs(fraction) / (3 if comfy() else 2)))
        self.move(rows if fraction > 0 else -rows)

    def place(self, where: str) -> None:
        if not self._entries:
            return
        line, h = self._first[self._entries[self.cursor]], self.size.height
        self.top = {"center": line - h // 2 + 1, "top": line, "bottom": line - h + 2}[where]
        self.top = max(0, min(self.top, max(0, len(self._lines) - h)))
        self.refresh()

    def next_section(self, step: int) -> None:
        """Tab / S-Tab: the first entry of the next (or this, then the previous) section."""
        if not self._entries:
            return
        starts = []
        last_head = -1
        for n, ri in enumerate(self._entries):
            head = max((i for i in range(ri) if isinstance(self.rows[i], Section)), default=-1)
            if head != last_head:
                starts.append(n)
                last_head = head
        if step > 0:
            nxt = next((s for s in starts if s > self.cursor), starts[0])
        else:
            nxt = next((s for s in reversed(starts) if s < self.cursor), starts[-1])
        self.go(nxt)

    def search(self, pattern: str, *, forward: bool = True, from_next: bool = True) -> bool:
        """`/` filters: the same pattern again (n, N) steps through what it kept."""
        pat = pattern.strip()
        if pat and pat.lower() == self.filter.lower() and from_next:
            if self._entries:
                self.go((self.cursor + (1 if forward else -1)) % len(self._entries))
            return bool(self._entries)
        self.filter = pat
        self._apply_filter(getattr(self.selected, "id", None))
        return bool(self._entries) or not pat

    # ── layout ───────────────────────────────────────────────────────────────

    def on_resize(self) -> None:
        self._relayout()

    def _relayout(self) -> None:
        self._layout(max(10, self.size.width - 1))
        self._keep_visible()
        self.virtual_size = Size(self.size.width, len(self._lines))
        self.refresh()
        if self.on_moved:
            self.on_moved()

    def _layout(self, width: int) -> None:
        lines: list[tuple] = []
        first: dict[int, int] = {}
        sel = self._entries[self.cursor] if self._entries else -1
        kw: dict[int, int] = {}
        group: list[int] = []

        def close_group():
            w = max((_width(self.rows[i].key) for i in group), default=0)
            for i in group:
                kw[i] = min(w, 30)
            group.clear()
        for i, r in enumerate(self.rows):
            if isinstance(r, Section) and not self.one_key_column:
                close_group()
            elif isinstance(r, Entry):
                group.append(i)
        close_group()
        self._kw = kw
        for i, r in enumerate(self.rows):
            first[i] = len(lines)
            if isinstance(r, Section):
                if lines:
                    lines.append(("blank",))
                lines.append(("head", i))
                if comfy():
                    lines.append(("blank",))
            elif isinstance(r, Note):
                inner = max(10, width - r.indent - 3)
                for ln in self._wrap(r.spans, inner):
                    lines.append(("note", i, ln))
                if comfy():
                    lines.append(("blank",))
            else:
                lines.append(("entry", i, 0))
                two = bool(r.meta or r.mark)
                if two:
                    lines.append(("entry", i, 1))
                if i == sel and r.more:   # only the selected entry opens: on its band
                    indent = 2 + (kw[i] + 2 if kw[i] else 0)
                    band = f"wash2:{self.hue}" if self.active else "surface"
                    for m in r.more:
                        for ln in self._wrap(m, max(10, width - indent - 4), band):
                            lines.append(("more", i, ln))
                if two and comfy():
                    lines.append(("blank",))
        while lines and lines[-1] == ("blank",):
            lines.pop()
        self._lines, self._first = lines, first

    def _wrap(self, spans: list[Span], width: int, surface: str | None = None) -> list[Text]:
        t = Text()
        for s, role in spans:
            t.append(s, style(self.roles, role, surface))
        try:
            console = self.app.console
        except Exception:   # not mounted yet
            return [t]
        return list(t.wrap(console, width)) or [Text("")]

    def _keep_visible(self, margin: int = 3) -> None:
        if not self._entries:
            self.top = 0
            return
        h = max(1, self.size.height)
        ri = self._entries[self.cursor]
        start = self._first.get(ri, 0)
        # the entry and its own lines (the second line, `more`)
        end = start
        while end + 1 < len(self._lines) and self._lines[end + 1][0] in ("entry", "more") and \
                self._lines[end + 1][1] == ri:
            end += 1
        if self.cursor == 0:
            start = 0
        margin = min(margin, max(0, (h - 2) // 2))
        if start < self.top + margin:
            self.top = max(0, start - margin)
        elif end > self.top + h - 1 - margin:
            self.top = end - h + 1 + margin
        self.top = max(0, min(self.top, max(0, len(self._lines) - h)))

    # ── drawing ──────────────────────────────────────────────────────────────

    def render_line(self, y: int) -> Strip:
        width = self.size.width
        inner = width - 1
        n = self.top + y
        if not self._lines:
            segs = [Segment(" " * inner)]
            if y == 1:
                text = f"Nothing matches /{self.filter}." if self.filter else self.empty
                segs = [Segment("  "), Segment(fmt.cut(text, inner - 2), style(self.roles, "dim"))]
            return self._finish(Strip(segs).adjust_cell_length(inner), y)
        if n >= len(self._lines):
            return self._finish(Strip([Segment(" " * inner)]), y)
        line = self._lines[n]
        kind = line[0]
        if kind == "blank":
            return self._finish(Strip([Segment(" " * inner)]), y)
        if kind == "head":
            return self._finish(self._head(self.rows[line[1]], inner), y)
        if kind == "note":
            r = self.rows[line[1]]
            segs = [Segment(" " * r.indent), *line[2].render(self.app.console)]
            return self._finish(Strip(segs).adjust_cell_length(inner), y)
        ri = line[1]
        entry = self.rows[ri]
        selected = self._entries and self._entries[self.cursor] == ri
        surface = (f"wash2:{self.hue}" if self.active else "surface") if selected else None
        if kind == "more":
            return self._finish(self._more(entry, line[2], inner, surface, ri, selected), y)
        return self._finish(self._entry_line(entry, line[2], inner, surface, ri, selected), y)

    def _head(self, sec: Section, inner: int) -> Strip:
        hue = sec.hue or self.hue
        label = f"  {sec.label} "
        room = max(0, inner - cell_len(label) - 8)   # a long note gives way to the rule
        note = f" {fmt.cut(sec.note, room)}  " if sec.note and room > 4 else "  "
        rule = self.glyphs.rule_h * max(0, inner - cell_len(label) - cell_len(note))
        return Strip([
            Segment(label, style(self.roles, f"hue:{hue}+bold")),
            Segment(rule, style(self.roles, f"rule:{hue}")),
            Segment(note, style(self.roles, "dim")),
        ]).adjust_cell_length(inner)

    def _bar(self, selected: bool, surface: str | None) -> Segment:
        r = self.roles
        if selected:
            return Segment(self.glyphs.select, style(r, f"mark:{self.hue}" if self.active else "faint", surface))
        return Segment(" ")

    def _entry_line(self, e: Entry, sub: int, inner: int, surface: str | None, ri: int, selected: bool) -> Strip:
        r = self.roles
        kw = self._kw.get(ri, 0)
        if sub == 0:
            left = _fit(e.key, kw) if kw else []
            body = [(s, role + ("+bold" if selected and "bold" not in role else "")) for s, role in e.title]
            right = e.figure
        else:
            left = [(" " * kw, "fg")] if kw else []
            body, right = e.meta, e.mark
        lead = 1 + (kw + 2 if kw else 0)
        room = inner - 1 - lead - 2
        right = _fit(right, max(0, room - 8)) if _width(right) > room - 8 else right
        right_w = _width(right)
        body = _fit(body, max(0, room - (right_w + 2 if right_w else 0)))
        gap = max(0, room - _width(body) - right_w)
        segs = [self._bar(selected, surface), Segment(" ", style(r, "fg", surface))]
        for s, role in left:
            segs.append(Segment(s, style(r, role, surface)))
        if kw:
            segs.append(Segment(" " * (kw - _width(left) + 2), style(r, "fg", surface)))
        for s, role in body:
            segs.append(Segment(s, style(r, role, surface)))
        segs.append(Segment(" " * gap, style(r, "fg", surface)))
        for s, role in right:
            segs.append(Segment(s, style(r, role, surface)))
        segs.append(Segment("  ", style(r, "fg", surface)))
        return Strip(segs).adjust_cell_length(inner)

    def _more(self, e: Entry, text: Text, inner: int, surface: str | None, ri: int, selected: bool) -> Strip:
        r = self.roles
        kw = self._kw.get(ri, 0)
        lead = 1 + (kw + 2 if kw else 0)
        segs = [self._bar(selected, surface), Segment(" " * lead, style(r, "fg", surface)),
                *text.render(self.app.console)]
        used = sum(cell_len(s.text) for s in segs)
        segs.append(Segment(" " * max(0, inner - used), style(r, "fg", surface)))
        return Strip(segs).adjust_cell_length(inner)

    def _finish(self, strip: Strip, y: int) -> Strip:
        total, h = len(self._lines), self.size.height
        ch, role = " ", "faint"
        if total > h > 0:
            start = int(self.top * h / total)
            end = max(start + 1, int((self.top + h) * h / total))
            ch, role = (self.glyphs.rule_v_on, "faint") if start <= y < end else (self.glyphs.rule_v, "rule")
        return Strip(list(strip) + [Segment(ch, style(self.roles, role))])

    # mouse: a click selects, the wheel moves
    def on_click(self, event) -> None:
        n = self.top + event.y
        if 0 <= n < len(self._lines) and self._lines[n][0] in ("entry", "more"):
            ri = self._lines[n][1]
            if ri in self._entries:
                self.go(self._entries.index(ri))

    def on_mouse_scroll_down(self, event) -> None:
        self.move(3)

    def on_mouse_scroll_up(self, event) -> None:
        self.move(-3)


class SheetIndex(Static, can_focus=False):
    """The sections, down the left: where you are on a long page."""

    DEFAULT_CSS = "SheetIndex { width: 26; height: 1fr; border-right: solid $tc-rule; padding: 0 1 0 0; }"

    def show(self, roles: Roles, glyphs: Glyphs, hue: str, sections: list[tuple[str, int]], current: str) -> None:
        h = max(1, self.size.height)
        spaced = comfy() and 2 * len(sections) - 1 <= h     # a blank line between, when they fit
        cur = next((i for i, (label, _) in enumerate(sections) if label == current), 0)
        start = 0
        if len(sections) > h:   # too many even close together: a window around where you are
            start = max(0, min(cur - h // 2, len(sections) - h))
        t = Text(no_wrap=True, overflow="ellipsis")
        shown = sections[start:start + h]
        for i, (label, n) in enumerate(shown):
            on = label == current
            t.append(glyphs.select if on else " ", style(roles, f"mark:{hue}"))
            name = fmt.cut(label, 19)
            t.append(f" {name}", style(roles, f"hue:{hue}+bold" if on else "dim"))
            if n:
                t.append(f"{n:>{22 - cell_len(name)}}", style(roles, f"hue:{hue}" if on else "faint"))
            if i < len(shown) - 1:
                t.append("\n\n" if spaced else "\n")
        self.update(t)


class Sheet(Vertical, can_focus=False):
    DEFAULT_CSS = """
    Sheet { height: 1fr; display: none; padding: 0 1 0 1; }
    Sheet > #sheet-head { height: auto; }
    Sheet > Horizontal { height: 1fr; }
    """

    def __init__(self, roles: Roles, glyphs: Glyphs, **kw):
        super().__init__(**kw)
        self.roles, self.glyphs = roles, glyphs
        self.head = Static("", id="sheet-head")
        self.index = SheetIndex("")
        self.body = SheetBody(roles, glyphs)
        self.body.on_moved = self._moved
        self.page = None

    def compose(self):
        yield self.head
        with Horizontal():
            yield self.index
            yield self.body

    def show(self, page, *, keep: str | None = None) -> None:
        """`page` on the sheet: its rows, its colour, its head."""
        new = page is not self.page
        if new and self.page is not None:   # back to it later: on the same row
            self.page.resume_at = getattr(self.body.selected, "id", None)
        self.page = page
        self.body.hue = page.hue
        self.body.one_key_column = page.one_key_column
        if new:
            self.body.filter = ""
            self.body.top = 0
        if new:
            keep = keep or getattr(page, "resume_at", None) or page.first()
        self.body.set_rows(page.rows(), keep=keep)
        self._moved()

    def set_roles(self, roles: Roles) -> None:
        self.roles = self.body.roles = roles
        self._moved()

    def _moved(self) -> None:
        if self.page is None:
            return
        self._paint_head()
        sections = self.body.sections()
        wide = self.size.width >= 110 and len(sections) >= 3 and not self.body.filter
        self.index.display = wide
        if wide:
            self.index.show(self.roles, self.glyphs, self.page.hue, sections, self.body.section_of(self.body.selected))

    def _paint_head(self) -> None:
        r, page = self.roles, self.page
        t = Text(no_wrap=True, overflow="ellipsis")
        t.append(f" {page.title}", style(r, f"hue:{page.hue}+bold"))
        sub = page.subtitle() if callable(page.subtitle) else page.subtitle
        if sub:
            t.append(f"   {sub}", style(r, "dim"))
        t.append("\n ")
        if self.body.filter:
            n = len(self.body.items)
            t.append(f"/{self.body.filter}", style(r, "hue:yellow+bold"))
            t.append(f"   {n} shown" if n else "   nothing matches", style(r, "dim"))
            t.append("   Esc", style(r, "hue:yellow"))
            t.append(" shows everything again", style(r, "dim"))
        else:
            for key, what in page.hints:
                t.append(key, style(r, f"hue:{page.hue}+bold"))
                t.append(f" {what}   ", style(r, "dim"))
        if comfy():
            t.append("\n")
        self.head.update(t)
