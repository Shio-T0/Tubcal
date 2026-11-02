"""The pages a `:` command (or a key) opens over the room: Settings, the keys, the
commands, what's playing, what you follow, the messages, checkhealth, about.

A page says what's on it (`rows()`: Sections, Entries and Notes from `ui/sheet.py`)
and what its keys do; the app shows it on the sheet (`TubcalApp.open_page`), keeps a
stack of them (q goes back to the one before, the last back to the room) and gives
each the same keys: j k and the rest move, Tab goes to the next section, `/` filters,
Enter runs the selected entry, `h` goes back, Esc clears the filter or closes.

Pages are the core's: a room's own code is reached only through the app.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..keys import Bind
from ..ui.sheet import Entry, Note, Row, Section, ticks

if TYPE_CHECKING:
    from ..app import TubcalApp

__all__ = ["Page", "TextPage", "Entry", "Note", "Section", "ticks", "COMMON"]

# every page has these on top of the global keys
COMMON = [Bind(("enter",), "activate", "run it / change it"), Bind(("+",), "increase", "the next choice"),
          Bind(("-",), "decrease", "the choice before")]


class Page:
    id = ""
    title = ""
    subtitle: str = ""
    hue = "blue"
    route: str | None = None       # what `O` opens in the web UI
    hints: tuple = (("Tab", "next section"), ("/", "filter"), ("q", "close"))
    one_key_column = False         # every section's keys in one column width

    def __init__(self, app: TubcalApp):
        self.app = app

    def rows(self) -> list[Row]:
        return []

    def binds(self) -> list[Bind]:
        """This page's own keys, over COMMON."""
        return []

    def handle(self, action: str, entry: Entry | None, count: int | None) -> bool:
        """A key on this page; False = the sheet's usual (Enter runs `entry.act`)."""
        return False

    def item_of(self, entry: Entry | None) -> dict | None:
        """The thing an entry stands for, for `o` and `yy`."""
        return None

    def first(self) -> str | None:
        """The entry to start on."""
        return None

    def opened(self) -> None:
        """Shown for the first time: start what it needs to load."""

    def tick(self) -> None:
        """Every second while it's on top."""

    def reload(self) -> None:
        self.opened()

    def repaint(self, keep: str | None = None) -> None:
        if self.app.page is self:
            self.app.sheet.show(self, keep=keep)
            self.app.refresh_chrome()


class TextPage(Page):
    """A page of given rows (the OAuth steps, a short sheet of facts)."""

    def __init__(self, app: TubcalApp, title: str, rows: list[Row], *, subtitle: str = "", hue: str = "blue",
                 page_id: str = "text"):
        super().__init__(app)
        self.title, self.subtitle, self.hue, self.id = title, subtitle, hue, page_id
        self._rows = rows
        self.hints = (("/", "filter"), ("q", "close"))

    def rows(self) -> list[Row]:
        return self._rows
