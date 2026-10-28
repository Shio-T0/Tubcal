"""Space f: find anything — a room or place, something you saved, or a search of
YouTube, Hacker News, Reddit and GitHub at once (the server's /api/search/all, from
two letters on, after a short pause in typing).

Type to narrow; Ctrl-n / Ctrl-p (or the arrows) move; Enter opens the result where it
lives (a video plays, a story opens in the Wire's reader…); Esc closes.
"""

from __future__ import annotations

from rich.cells import cell_len
from rich.style import Style
from rich.text import Text
from textual.containers import Vertical
from textual.widgets import Static

from .. import fmt
from ..saved import KINDS, kind_of
from .itemlist import Head, ItemList, RowParts
from .paint import style

GROUP_LABEL = {"youtube": "YouTube", "hackernews": "Hacker News", "reddit": "Reddit", "github": "GitHub"}


class Finder(Vertical, can_focus=False):
    DEFAULT_CSS = """
    Finder {
        layer: float; position: absolute; width: 90; height: 24; display: none;
        border: round $tc-rule; background: $tc-surface; padding: 0 1;
    }
    Finder > #q { height: 1; }
    """

    def __init__(self, roles, glyphs, **kw):
        super().__init__(**kw)
        self.roles, self.glyphs = roles, glyphs
        self.query_text = ""
        self.cursor = 0
        self.places: list[dict] = []
        self.saved: list[dict] = []
        self.remote: dict[str, list[dict]] = {}
        self.remote_for = ""
        self.searching = False
        self.input = Static("", id="q")
        self.list = ItemList(self._row, roles=roles, glyphs=glyphs, hue="blue", lines_per_item=1, divider=False,
                             empty=["Type to find a room, something you saved, or anything on the platforms."])

    def compose(self):
        yield self.input
        yield self.list

    def open(self, places: list[dict], saved: list[dict], size) -> None:
        self.places, self.saved = places, saved
        self.query_text, self.cursor = "", 0
        self.remote, self.remote_for = {}, ""
        w = min(100, max(50, size.width - 8))
        h = min(30, max(10, size.height - 6))
        self.styles.width, self.styles.height = w, h
        self.styles.offset = ((size.width - w) // 2, 2)
        self.display = True
        self.refresh_results()

    def close(self) -> None:
        self.display = False

    # ── results ──────────────────────────────────────────────────────────────

    def refresh_results(self) -> None:
        q = self.query_text.strip().lower()
        rows: list = []
        places = [p for p in self.places if not q or q in p["_match"]]
        if places:
            rows += [Head("Rooms and places", len(places)), *places[:12]]
        if q:
            saved = [s for s in self.saved if q in (fmt.clean(s.get("title")) + " " + (s.get("source") or "")).lower()]
            if saved:
                rows += [Head("Saved", len(saved)), *[dict(s, _saved=True) for s in saved[:6]]]
            if self.remote_for and self.remote_for.lower() == q:
                for key, label in GROUP_LABEL.items():
                    items = self.remote.get(key) or []
                    if items:
                        rows += [Head(label, len(items)), *items[:8]]
        if self.searching:
            self.list.empty = ["Searching YouTube, Hacker News, Reddit and GitHub…"]
        elif q and self.remote_for == q:
            self.list.empty = [f"Nothing found for “{self.query_text.strip()}”."]
        elif q:
            self.list.empty = ["No room or saved item matches; the platforms are searched when you pause."]
        else:
            self.list.empty = ["Type to find a room, something you saved, or anything on the platforms."]
        keep = (self.list.selected or {}).get("id")
        self.list.set_rows(rows, keep=keep)
        self._paint_input()

    def _paint_input(self) -> None:
        r, g = self.roles, self.glyphs
        t = Text(no_wrap=True)
        t.append(f"{g.prompt} ", style(r, "mark:green"))
        t.append(self.query_text)
        t.append(" ", Style(reverse=True))
        hint = "searching…" if self.searching else ("" if len(self.query_text.strip()) >= 2 else "2 letters search the platforms")
        pad = max(1, (self.size.width or 80) - 2 - cell_len(t.plain) - cell_len(hint))
        t.append(" " * pad)
        t.append(hint, style(r, "faint"))
        self.input.update(t)

    def _row(self, x: dict) -> RowParts:
        g = self.glyphs
        if x.get("_place"):
            return RowParts(sign=(g.web if x.get("_web") else " ", "faint"),
                            title=[(x["title"], "fg"), (f"  {x.get('_sub') or ''}", "faint")])
        kind = kind_of(x)
        src = fmt.clean(x.get("source") or x.get("author") or "")
        label = KINDS.get(kind, ("",))[0] if x.get("_saved") else ""
        return RowParts(sign=(g.saved if x.get("_saved") else " ", "mark:blue"),
                        title=[(fmt.clean(x.get("title")) or x.get("url") or "", "fg"),
                               (f"  {src}" if src else "", "faint"), (f"  {label}" if label else "", "faint")])
