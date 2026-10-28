"""What every room screen has: views (Tab / S-Tab), panes (h / l), a list that takes
the movement keys, and its own key table on top of the global one.

Rooms reach the app's shared pieces through `self.app` (api, player, roles, glyphs,
state, saved). Network calls run in thread workers; results come back with
`self.app.call_from_thread`.
"""

from __future__ import annotations

from rich.text import Text
from textual.containers import Horizontal
from textual.widgets import Static

from ..keys import Bind
from ..ui.itemlist import ItemList
from ..ui.paint import style
from . import Room


class RoomView(Horizontal):
    DEFAULT_CSS = "RoomView { height: 1fr; }"
    VIEWS: list[tuple[str, str]] = []

    def __init__(self, room: Room, **kw):
        super().__init__(**kw)
        self.room = room
        self.view = self.VIEWS[0][0] if self.VIEWS else ""
        self.loaded = False

    # what the app asks of a room
    def binds(self) -> list[Bind]:
        return []

    def crumbs(self) -> list[str]:
        return [dict(self.VIEWS).get(self.view, "")] if self.VIEWS else []

    def active_list(self) -> ItemList | None:
        return None

    def selected(self) -> dict | None:
        lst = self.active_list()
        return lst.selected if lst else None

    # VISUAL acts on many rows of the active list at once
    def item_of(self, row: dict) -> dict | None:
        """The item a row of the active list stands for (to save, to copy its link),
        or None when the row is a place, not a thing."""
        return row

    def playable_of(self, row: dict) -> dict | None:
        """What `a` puts in the queue for a row, or None."""
        return None

    def handle_many(self, action: str, rows: list[dict]) -> bool:
        """One of the room's own actions (what `dd` or `x` does here) on every row of a
        VISUAL range; False = not on a range in this room."""
        return False

    def web_route(self) -> str:
        return self.room.route

    def activate(self) -> None:
        """Shown (again). Load on first show."""
        if not self.loaded:
            self.loaded = True
            self.reload()

    def reload(self, force: bool = False) -> None:
        pass

    def handle(self, action: str, count: int | None) -> bool:
        """A room action; False = not this room's."""
        return False

    def set_view(self, view: str) -> None:
        self.view = view
        self.app.state.view(self.room.id)["view"] = view
        self.reload()
        self.app.refresh_chrome()

    def step_view(self, n: int) -> None:
        ids = [v for v, _ in self.VIEWS if self.view_available(v)]
        if not ids:
            return
        i = ids.index(self.view) if self.view in ids else 0
        self.set_view(ids[(i + n) % len(ids)])

    def view_available(self, view: str) -> bool:
        return True


class WebRoom(RoomView):
    """A room the terminal doesn't draw yet: one sentence, and Enter opens it on the web."""

    DEFAULT_CSS = "WebRoom { align: center middle; } WebRoom > Static { width: auto; height: auto; }"

    def compose(self):
        r = self.app.roles
        g = self.app.glyphs
        t = Text(justify="left")
        t.append(f"{self.room.label}", style(r, "fg+bold"))
        t.append(" opens in Tubcal's web UI for now.\n\n", style(r, "dim"))
        t.append("  ⏎  ", style(r, "hue:yellow+bold"))
        t.append(f"open it in the browser {g.web}\n", style(r, "fg"))
        t.append("  H L  ", style(r, "hue:yellow+bold"))
        t.append("the rooms beside it", style(r, "fg"))
        yield Static(t)

    def binds(self) -> list[Bind]:
        return [Bind(("enter",), "open_web", "open it in the browser"),
                Bind(("l",), "open_web", "open it in the browser")]
