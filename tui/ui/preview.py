"""The preview pane: an image well, then whatever the room writes about the selection.

The well's size is fixed from the pane width and the picture's shape (16:9 for a video)
before any picture arrives, so nothing moves when it does. Until then (and in rooms or
terminals without pictures) it shows a slate: the surface tone with an initial in it.
Below 24 rows there is no well at all.
"""

from __future__ import annotations

from rich.text import Text
from textual.containers import Vertical
from textual.widget import Widget
from textual.widgets import Static

from ..glyphs import Glyphs
from ..theme import Roles
from .paint import style


def well_size(width: int, ratio: float, cell_px: tuple[int, int]) -> tuple[int, int]:
    """(columns, rows) for a picture `ratio` = w/h wide, `width` columns at most."""
    cw, ch = cell_px if all(cell_px) else (8, 18)
    cols = max(8, width)
    rows = max(3, round(cols * cw / ratio / ch))
    return cols, rows


class Slate(Widget, can_focus=False):
    """The well before (or instead of) its picture."""

    def __init__(self, roles: Roles, glyphs: Glyphs, **kw):
        super().__init__(**kw)
        self.roles, self.glyphs = roles, glyphs
        self.label = ""

    def render(self) -> Text:
        r = self.roles
        w, h = self.size.width, self.size.height
        t = Text(no_wrap=True, overflow="crop")
        fill = style(r, "faint+bold", "surface")
        for y in range(h):
            row = " " * w
            if y == h // 2 and self.label:
                lab = self.label[: max(0, w - 2)]
                left = (w - len(lab)) // 2
                row = " " * left + lab + " " * (w - left - len(lab))
            t.append(row, fill)
            if y < h - 1:
                t.append("\n")
        return t


class Preview(Vertical, can_focus=False):
    DEFAULT_CSS = """
    Preview { width: 1fr; padding: 0 1 0 1; }
    Preview > Well { margin-bottom: 1; }
    Preview > #body { height: 1fr; }
    """

    def __init__(self, roles: Roles, glyphs: Glyphs, *, ratio: float = 16 / 9,
                 cell_px: tuple[int, int] = (8, 18), backend: str = "halfcell", max_cols: int = 64, **kw):
        super().__init__(**kw)
        from .picture import Well
        self.roles, self.glyphs = roles, glyphs
        self.ratio = ratio
        self.cell_px = cell_px
        self.max_cols = max_cols
        self.well = Well(roles, glyphs, backend=backend)
        self.slate = self.well.slate
        self.body = Static("", id="body")

    def compose(self):
        yield self.well
        yield self.body

    def on_resize(self) -> None:
        self._fit_well()

    def set_shape(self, ratio: float, max_cols: int) -> None:
        """Another picture shape (a podcast's square art, a video's 16:9)."""
        if (ratio, max_cols) != (self.ratio, self.max_cols):
            self.ratio, self.max_cols = ratio, max_cols
            self._fit_well()

    def _fit_well(self) -> None:
        width = self.size.width - 2
        cols, rows = well_size(min(width, self.max_cols), self.ratio, self.cell_px)
        show = self.app.size.height >= 24 and width >= 30
        self.well.display = show
        if show:
            self.well.set_size(cols, rows)

    def show(self, body: Text | None, initial: str = "", url: str | None = None) -> None:
        if not self.well.display:
            self._fit_well()
        self.well.show(url, initial)
        self.body.update(body or Text(""))

    def blank(self, sentence: str = "") -> None:
        """Nothing selected: no empty picture box either."""
        self.well.show(None, "")
        self.well.display = False
        self.body.update(Text(sentence, style(self.roles, "dim")))
