"""A discussion, laid out for reading: the story or post on top, then the comments.

    Ask HN: How do you keep a home server boring?
    ashton · 298 points · 6 hours ago
    …the post…

    quietbyte · 5h
    One machine per job…
    │ ashton OP · 5h
    │ Separate machines is the part I keep skipping.
    │ ┃ • quietbyte · 41m  new
    │ ┃ Three. They draw less than the old tower did.
    ▸ hexnut · 4h · 31 replies hidden

Each level of replies is a rail in its own colour (the depth reads from the position
as well, never from colour alone); the comment under the cursor has a heavy rail.
j / k go comment by comment, Ctrl-e / Ctrl-y line by line, [[ ]] between top-level
comments, ]n [n between comments new since your last visit, za folds the replies under
a comment, zM folds every top-level thread, zR opens them all.

It answers to the same calls as ItemList (move, go, page, place, search, position,
items, selected), so the app's movement keys work on it unchanged.
"""

from __future__ import annotations

from typing import Callable

from rich.segment import Segment
from textual.geometry import Size
from textual.message import Message
from textual.strip import Strip
from textual.widget import Widget

from .. import fmt
from ..glyphs import Glyphs
from ..theme import Roles
from .html import parse, wrap
from .paint import style

RAIL_HUES = ["blue", "magenta", "cyan", "green", "yellow", "red"]
Line = list[tuple[str, str]]


def flatten(comments: list[dict], depth: int = 0) -> list[dict]:
    out = []
    for c in comments or []:
        c = dict(c)
        c["_depth"] = depth
        kids = c.pop("children", None) or []
        c["_kids"] = len(kids)
        c["_desc"] = 0
        out.append(c)
        sub = flatten(kids, depth + 1)
        c["_desc"] = len(sub)
        out += sub
    return out


class ThreadView(Widget, can_focus=False):
    DEFAULT_CSS = "ThreadView { height: 1fr; width: 1fr; }"

    class Moved(Message):
        def __init__(self, sender: "ThreadView", comment: dict | None):
            super().__init__()
            self.view = sender
            self.comment = comment

    def __init__(self, *, roles: Roles, glyphs: Glyphs, empty: list[str] | None = None, **kw):
        super().__init__(**kw)
        self.roles, self.glyphs = roles, glyphs
        self.head_fn: Callable[[int], list[Line]] | None = None
        self.comments: list[dict] = []
        self.folded: set = set()
        self.since: float | None = None        # comments after this are new
        self.op: str | None = None
        self.cursor = -1                       # -1 = the story / post itself
        self.top = 0
        self.active = True
        self.empty = empty or [""]
        self.notice: str = ""                  # a line under the head ("Loading…", an error)
        self._lines: list[tuple[Line, int]] = []
        self._start: dict[int, int] = {}       # comment index → its first line
        self._visible: list[int] = []
        self._width = 0
        self.matches: list[int] = []

    # ── data ─────────────────────────────────────────────────────────────────

    def set_thread(self, head_fn, comments: list[dict], *, since: float | None = None, op: str | None = None,
                   notice: str = "") -> None:
        self.head_fn = head_fn
        self.comments = flatten(comments)
        self.folded = set()
        self.since = since
        self.op = op
        self.notice = notice
        self.cursor = -1
        self.top = 0
        self._layout(force=True)
        self.post_message(self.Moved(self, None))

    def clear(self, notice: str = "") -> None:
        self.set_thread(None, [], notice=notice)

    def is_new(self, c: dict) -> bool:
        return bool(self.since) and (c.get("created_at") or 0) > self.since

    @property
    def new_count(self) -> int:
        return sum(1 for c in self.comments if self.is_new(c))

    # ── layout ───────────────────────────────────────────────────────────────

    def _hidden(self) -> set[int]:
        hidden: set[int] = set()
        for i, c in enumerate(self.comments):
            if i in hidden:
                continue
            if c.get("id") in self.folded:
                hidden.update(range(i + 1, i + 1 + c["_desc"]))
        return hidden

    def _layout(self, force: bool = False) -> None:
        width = max(20, self.size.width - 1)
        if not force and width == self._width:
            return
        self._width = width
        g = self.glyphs
        lines: list[tuple[Line, int]] = []
        if self.head_fn:
            for ln in self.head_fn(width - 2):
                lines.append(([(" ", "fg")] + ln, -1))
            lines.append(([], -1))
        if self.notice:
            lines.append(([(" " + self.notice, "dim")], -1))
            lines.append(([], -1))
        hidden = self._hidden()
        self._start, self._visible = {}, []
        for i, c in enumerate(self.comments):
            if i in hidden:
                continue
            self._visible.append(i)
            self._start[i] = len(lines)
            depth = c["_depth"]
            rails = [(g.rule_v + " ", f"mark:{RAIL_HUES[d % len(RAIL_HUES)]}") for d in range(depth)]
            head: Line = [(" ", "fg")] + rails
            if self.is_new(c):
                head.append((g.new + " ", "mark:blue"))
            author = c.get("author") or "[deleted]"
            head.append((author, "fg+bold"))
            if self.op and author == self.op:
                head.append((" OP", "hue:blue"))
            bits = [fmt.ago(c.get("created_at"))]
            if c.get("score") is not None:
                bits.append(f"{fmt.compact(c['score'])} points")
            head.append((f" {g.dot} " + f" {g.dot} ".join(b for b in bits if b), "faint"))
            if self.is_new(c):
                head.append(("  new", "hue:blue"))
            if c.get("id") in self.folded:
                n = c["_desc"]
                head.append((f"  {g.folded} {n} repl{'y' if n == 1 else 'ies'} hidden", "dim"))
                lines.append((head, i))
                lines.append(([], i))
                continue
            lines.append((head, i))
            room = width - 2 - 2 * depth
            blocks, _links = parse(c.get("body_html"))
            for ln in wrap(blocks, room):
                lines.append(([(" ", "fg")] + rails + ln, i))
            lines.append(([(" ", "fg")] + rails, i))
        self._lines = lines
        self.virtual_size = Size(self.size.width, len(lines))
        self.refresh()

    def on_resize(self) -> None:
        self._layout()
        self._keep_visible()

    # ── movement (ItemList's calls) ──────────────────────────────────────────

    @property
    def items(self) -> list[dict]:
        return [self.comments[i] for i in self._visible]

    @property
    def selected(self) -> dict | None:
        return self.comments[self.cursor] if self.cursor >= 0 else None

    @property
    def position(self) -> tuple[int, int]:
        n = len(self._visible)
        at = self._visible.index(self.cursor) + 1 if self.cursor in self._visible else 0
        return (at, n)

    def _set(self, ci: int) -> None:
        self.cursor = ci
        self._keep_visible()
        self.refresh()
        self.post_message(self.Moved(self, self.selected))

    def move(self, n: int) -> None:
        vis = self._visible
        if not vis:
            return
        if self.cursor < 0:
            idx = -1
        else:
            idx = vis.index(self.cursor) if self.cursor in vis else 0
        idx = max(-1, min(len(vis) - 1, idx + n))
        self._set(vis[idx] if idx >= 0 else -1)

    def go(self, index: int) -> None:
        vis = self._visible
        if index < 0 or not vis:
            self._set(-1)
            self.top = 0
            return
        self._set(vis[min(index, len(vis) - 1)])

    def page(self, fraction: float) -> None:
        """Ctrl-d/u/f/b scroll by lines; the cursor follows to the comment at the top."""
        rows = max(1, int(self.size.height * abs(fraction) / 2))
        self.scroll_lines(rows if fraction > 0 else -rows)

    def scroll_lines(self, n: int) -> None:
        h = self.size.height
        self.top = max(0, min(self.top + n, max(0, len(self._lines) - h)))
        # the comment under the top of the screen becomes the current one
        ci = self._lines[self.top][1] if self._lines else -1
        if ci != self.cursor:
            self.cursor = ci
            self.post_message(self.Moved(self, self.selected))
        self.refresh()

    def place(self, where: str) -> None:
        if self.cursor < 0:
            return
        line = self._start.get(self.cursor, 0)
        h = self.size.height
        self.top = {"center": line - h // 2 + 1, "top": line, "bottom": line - h + 2}[where]
        self.top = max(0, min(self.top, max(0, len(self._lines) - h)))
        self.refresh()

    def _keep_visible(self) -> None:
        if self.cursor < 0:
            self.top = 0 if self.top < 4 else self.top
            return
        h = max(1, self.size.height)
        start = self._start.get(self.cursor, 0)
        end = start
        while end + 1 < len(self._lines) and self._lines[end + 1][1] == self.cursor:
            end += 1
        if start < self.top + 1:
            self.top = max(0, start - 1)
        elif end > self.top + h - 1:
            self.top = min(start - 1, end - h + 1) if end - start + 1 < h else start - 1
        self.top = max(0, min(self.top, max(0, len(self._lines) - h)))

    def jump(self, kind: str, forward: bool = True) -> bool:
        """[[ ]] (top-level) and [n ]n (new) — False when there's nowhere to go."""
        vis = self._visible
        if not vis:
            return False
        if kind == "top":
            cands = [i for i in vis if self.comments[i]["_depth"] == 0]
        else:
            # every new comment in reading order, folded away or not
            cands = [i for i, c in enumerate(self.comments) if self.is_new(c)]
        if not cands:
            return False
        if forward:
            nxt = next((i for i in cands if i > self.cursor), None)
        else:
            nxt = next((i for i in reversed(cands) if i < self.cursor), None)
        if nxt is None:
            return False
        if nxt not in vis:
            # open the folds it's inside
            self.folded -= {c.get("id") for j, c in enumerate(self.comments)
                            if j < nxt <= j + c["_desc"]}
            self._layout(force=True)
        self._set(nxt)
        self.place("top")
        return True

    def fold(self, what: str) -> None:
        """za: the current comment's replies · zM: every top-level thread · zR: none."""
        if what == "toggle":
            c = self.selected
            if not c or not c["_desc"]:
                return
            self.folded ^= {c.get("id")}
        elif what == "all":
            self.folded = {c.get("id") for c in self.comments if c["_depth"] == 0 and c["_desc"]}
            if self.cursor >= 0 and self.comments[self.cursor]["_depth"] > 0:
                # the cursor goes up to the top-level comment that now hides it
                self.cursor = max(i for i in range(self.cursor + 1) if self.comments[i]["_depth"] == 0)
        else:
            self.folded = set()
        self._layout(force=True)
        self._keep_visible()
        self.post_message(self.Moved(self, self.selected))

    def search(self, pattern: str, *, forward: bool = True, from_next: bool = True) -> bool:
        pat = pattern.lower()
        from .html import plain
        self.matches = [i for i in self._visible
                        if pat and (pat in plain(self.comments[i].get("body_html")).lower()
                                    or pat in (self.comments[i].get("author") or "").lower())]
        if not self.matches:
            return False
        if forward:
            nxt = next((m for m in self.matches if m > self.cursor or (not from_next and m == self.cursor)),
                       self.matches[0])
        else:
            nxt = next((m for m in reversed(self.matches) if m < self.cursor), self.matches[-1])
        self._set(nxt)
        return True

    def repaint(self) -> None:
        self._layout(force=True)

    # ── drawing ──────────────────────────────────────────────────────────────

    def render_line(self, y: int) -> Strip:
        width = self.size.width
        r, g = self.roles, self.glyphs
        n = self.top + y
        if not self._lines:
            text = self.empty[y - 1] if 1 <= y <= len(self.empty) else ""
            return Strip([Segment("  " + text, style(r, "dim"))]).adjust_cell_length(width)
        if n >= len(self._lines):
            return Strip([Segment(" " * width)])
        spans, ci = self._lines[n]
        segs = []
        current = ci >= 0 and ci == self.cursor
        depth = self.comments[ci]["_depth"] if ci >= 0 else 0
        for k, (text, role) in enumerate(spans):
            # the current comment's own rail (its deepest) is the heavy one
            if current and text == g.rule_v + " " and k == depth:
                text, role = g.rule_v_on + " ", role if self.active else "faint"
            segs.append(Segment(text, style(r, role)))
        if current and depth == 0 and spans:
            segs[0] = Segment(g.rule_v_on, style(r, "mark:blue" if self.active else "faint"))
        return Strip(segs).adjust_cell_length(width)

    def on_mouse_scroll_down(self, event) -> None:
        self.scroll_lines(3)

    def on_mouse_scroll_up(self, event) -> None:
        self.scroll_lines(-3)
