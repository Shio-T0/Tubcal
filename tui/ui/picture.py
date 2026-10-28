"""The image well: a fixed box of cells that holds a slate until its picture arrives.

Its size is set before anything loads, so nothing moves when the picture lands. A new
picture is asked for 120 ms after the selection stops moving; an answer for an item
that's no longer selected is dropped. The picture is drawn by textual-image, in the
terminal's own protocol when it has one (kitty graphics in this desktop's st, sixel
elsewhere) or in coloured half-blocks.
"""

from __future__ import annotations

from textual.containers import Container

from .preview import Slate


def image_class(backend: str):
    """textual-image's widget for a backend, or None for no pictures."""
    if backend == "off":
        return None
    try:
        from textual_image import widget as tiw
    except Exception:
        return None
    return {"kitty": tiw.TGPImage, "sixel": tiw.SixelImage}.get(backend, tiw.HalfcellImage)


class Well(Container, can_focus=False):
    DEFAULT_CSS = "Well { width: 48; height: 13; } Well > Slate { width: 1fr; height: 1fr; }"

    def __init__(self, roles, glyphs, *, backend: str = "halfcell", cover: bool = True, **kw):
        super().__init__(**kw)
        self.roles, self.glyphs = roles, glyphs
        self.backend = backend
        self.cover = cover
        self.slate = Slate(roles, glyphs)
        self.picture = None
        self._im = None
        self._want: str | None = None
        self._timer = None
        self.cols, self.rows = 48, 13

    def compose(self):
        yield self.slate

    def set_size(self, cols: int, rows: int) -> None:
        if (cols, rows) == (self.cols, self.rows):
            return
        self.cols, self.rows = cols, rows
        self.styles.width = cols
        self.styles.height = rows
        if self.picture is not None and self.picture.display:
            self.picture.display = False
            self.slate.display = True
            if self._want:
                self._schedule(self._want)

    def show(self, url: str | None, label: str = "") -> None:
        """Show `url`'s picture (after a short pause), the slate meanwhile."""
        self.slate.label = label
        self.slate.refresh()
        if url == self._want and self.picture is not None and self.picture.display:
            return
        self._want = url
        if self.picture is not None:
            self.picture.display = False
        self.slate.display = True
        if self._timer:
            self._timer.stop()
            self._timer = None
        if url and self.backend != "off":
            self._schedule(url)

    def _schedule(self, url: str) -> None:
        self._timer = self.set_timer(0.12, lambda: self._load(url))

    def _load(self, url: str) -> None:
        if url != self._want:
            return
        cols, rows = self.cols, self.rows
        pics, cell = self.app.pictures, self.app.term.cell_px
        cover = self.cover

        def work():
            im = pics.fitted(url, cols, rows, cell, cover=cover)
            if im is not None:
                self.app.call_from_thread(self._place, url, im, (cols, rows))
        self.run_worker(work, thread=True, group="well", exclusive=True)

    def redraw(self) -> None:
        """Send the picture to the terminal again: after the editor had the terminal, it
        may have dropped the images it held (kitty graphics live in the terminal)."""
        if self.picture is None or not self.picture.display or self._im is None:
            return
        self.picture.remove()
        self.picture = None
        self._place(self._want, self._im, (self.cols, self.rows))

    def _place(self, url: str, im, size: tuple[int, int]) -> None:
        if url != self._want or size != (self.cols, self.rows):
            return
        self._im = im
        if self.picture is None:
            cls = image_class(self.backend)
            if cls is None:
                return
            self.picture = cls(im)
            self.picture.styles.width = self.cols
            self.picture.styles.height = self.rows
            self.mount(self.picture)
        else:
            self.picture.styles.width = self.cols
            self.picture.styles.height = self.rows
            self.picture.image = im
        self.slate.display = False
        self.picture.display = True
