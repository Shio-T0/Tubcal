"""The Saved drawer: everything you saved, from any room or the web, on the right.

To do / Done / All (Tab), grouped by channel then kind, as the web's Saved page sorts
them. Enter opens an entry the way it opens anywhere: a video or an episode plays, an
anime title opens its title page, the rest open in the browser or Tubcal's web UI.
`x` marks one done (or not), `i` writes its note in your editor, `dd` takes it off
(`u` puts it back), `q` closes.
"""

from __future__ import annotations

from rich.text import Text
from textual.containers import Vertical
from textual.widgets import Static

from .. import fmt
from ..keys import Bind
from ..saved import CHANNEL_LABEL, CHANNEL_ORDER, KIND_ORDER, KINDS, TONE, channel_of, kind_of
from .chrome import Winbar
from .itemlist import Head, ItemList, RowParts
from .paint import style

VIEWS = [("todo", "To do"), ("done", "Done"), ("all", "All")]


class SavedDrawer(Vertical, can_focus=False):
    DEFAULT_CSS = """
    SavedDrawer {
        layer: float; dock: right; width: 64; height: 1fr; display: none;
        border-left: round $tc-rule; background: $tc-surface; padding: 0 0 0 1;
    }
    SavedDrawer > #hint { height: 1; }
    """

    def __init__(self, roles, glyphs, **kw):
        super().__init__(**kw)
        self.roles, self.glyphs = roles, glyphs
        self.view = "todo"
        self.items: list[dict] = []
        self.winbar = Winbar(roles, glyphs)
        self.winbar.hue = "blue"
        self.list = ItemList(self._row, roles=roles, glyphs=glyphs, hue="blue", divider=False,
                             empty=["Nothing saved yet.", "s  saves what's selected, in any room"])
        self.hint = Static("", id="hint")

    def compose(self):
        yield self.winbar
        yield self.list
        yield self.hint

    def binds(self) -> list[Bind]:
        return [Bind(("enter",), "open", "open"), Bind(("l",), "open", "open"),
                Bind(("x",), "done", "done / not done"), Bind(("i",), "note", "write a note"),
                Bind(("d", "d"), "remove", "take it off"),
                Bind(("u",), "undo", "undo"), Bind(("s",), "close", "close")]

    def show_items(self, items: list[dict]) -> None:
        self.items = items
        self._paint()

    def _paint(self) -> None:
        if self.view == "todo":
            shown = [i for i in self.items if not i.get("done_at")]
        elif self.view == "done":
            shown = [i for i in self.items if i.get("done_at")]
        else:
            shown = list(self.items)
        groups: dict[tuple, list] = {}
        for it in shown:
            groups.setdefault((channel_of(it), kind_of(it)), []).append(it)
        rows: list = []
        for ch in CHANNEL_ORDER:
            for kind in KIND_ORDER:
                its = groups.get((ch, kind))
                if not its:
                    continue
                its.sort(key=lambda i: -(i.get("saved_at") or 0))
                rows.append(Head(f"{CHANNEL_LABEL[ch]} · {KINDS[kind][0]}", len(its)))
                rows += its
        if self.items and not shown:
            self.list.empty = ["Everything here is done." if self.view == "todo" else "Nothing marked done yet."]
        self.list.set_rows(rows)
        todo = sum(1 for i in self.items if not i.get("done_at"))
        self.winbar.views = [("todo", "To do", todo or None), ("done", "Done", (len(self.items) - todo) or None),
                             ("all", "All", len(self.items) or None)]
        self.winbar.current = self.view
        self.winbar.right = "Saved"
        self.winbar.refresh()
        t = Text()
        for k, what in (("⏎", "open"), ("x", "done"), ("i", "note"), ("dd", "take off"), ("Tab", "view"),
                        ("q", "close")):
            t.append(f"{k} ", style(self.roles, "hue:yellow"))
            t.append(f"{what}   ", style(self.roles, "dim"))
        self.hint.update(t)

    def step_view(self, n: int) -> None:
        ids = [v for v, _ in VIEWS]
        self.view = ids[(ids.index(self.view) + n) % len(ids)]
        self._paint()

    def _row(self, it: dict) -> RowParts:
        g = self.glyphs
        kind = kind_of(it)
        done = bool(it.get("done_at"))
        sign = (g.watched, "faint") if done else (g.new, f"mark:{TONE.get(kind, 'blue')}")
        meta = []
        src = fmt.clean(it.get("source") or it.get("author") or "")
        if src:
            meta.append((src, "dim"))
        if it.get("saved_at"):
            meta.append(((f" {g.dot} " if src else "") + f"saved {fmt.ago(it['saved_at'])} ago", "faint"))
        if it.get("note"):
            meta.append((f" {g.dot} {fmt.clean(it['note'])}", "dim+italic"))
        return RowParts(sign=sign, title=[(fmt.clean(it.get("title")) or it.get("url") or it.get("id"), "faint" if done else "fg")],
                        meta=meta)

    def update_item(self, item_id: str, **fields) -> None:
        for it in self.items:
            if it.get("id") == item_id:
                it.update(fields)
        self._paint()
