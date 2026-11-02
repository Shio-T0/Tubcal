"""The Archive in the terminal: what was said in the videos you watched.

Views (Tab / S-Tab): Search (`Space /` or `:ar words`), Ask (`:ask a question`, or `i`
to write one in your editor) and Library, the transcribed videos; Enter on one reads
its transcript. Every line that comes from a video (a search hit, a citation, a part
of a transcript) plays that video from there, or seeks to it when it's already the
one playing. `s` saves it as a moment.

The answers come from the local models (Ollama), in two passes, so asking takes a
while; the room says so and keeps the last answer on screen meanwhile.
"""

from __future__ import annotations

import re
import textwrap

from rich.text import Text
from textual.containers import Vertical
from textual.widgets import Static

from ... import fmt
from ...api import ApiError, seg
from ...keys import Bind
from ...ui.chrome import Winbar
from ...ui.itemlist import Head, ItemList, RowParts
from ...ui.paint import style, who
from ...ui.preview import Preview
from ..base import RoomView

HUE = "magenta"
VIEWS = [("search", "Search"), ("ask", "Ask"), ("library", "Library")]


def video_of(row: dict) -> dict:
    """A hit, a citation or a transcript part → the video it's from, as a feed item."""
    iid = row.get("item_id") or ""
    vid = iid[3:] if iid.startswith("yt:") else None
    return {"id": iid, "platform": "youtube", "title": row.get("title") or "", "source": row.get("source_name") or "",
            "url": row.get("url") or (f"https://www.youtube.com/watch?v={vid}" if vid else None),
            "thumbnail": row.get("thumbnail") or (f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else None),
            "extra": {"video_id": vid}}


def moment_item(video: dict, t: float, quote: str) -> dict:
    """saveable.js momentItem: the video, a time and what was said there."""
    sec = max(0, int(t or 0))
    return {"id": f"moment:{video['id']}@{sec}", "platform": "youtube", "title": video.get("title"),
            "url": video.get("url"), "thumbnail": video.get("thumbnail"), "source": video.get("source"),
            "extra": {"kind": "moment", "t": sec, "quote": quote or "", "video": video}}


def markdown_text(roles, md: str) -> Text:
    """The model's light Markdown (a summary): **bold** drawn bold, `*   ` bullets as •,
    and a TL;DR heading left out (the pane already says Summary)."""
    t = Text()
    for line in str(md or "").strip().splitlines():
        line = re.sub(r"^\s*[*-]\s+", "• ", line.rstrip())
        if re.fullmatch(r"\**\s*TL;?DR:?\s*\**:?", line.strip(), re.I):
            continue
        for k, part in enumerate(re.split(r"\*\*(.+?)\*\*", line)):
            t.append(part, style(roles, "fg+bold" if k % 2 else "fg"))
        t.append("\n")
    t.rstrip()
    return t


def answer_text(roles, answer: str) -> Text:
    """The answer, its [n] citation marks in the room's colour."""
    t = Text()
    for part in re.split(r"(\[\d+(?:,\s*\d+)*\])", answer or ""):
        t.append(part, style(roles, f"hue:{HUE}+bold" if re.fullmatch(r"\[\d+(?:,\s*\d+)*\]", part) else "fg"))
    return t


class Archive(RoomView):
    VIEWS = VIEWS
    DEFAULT_CSS = "Archive #answer { height: auto; max-height: 50%; padding: 0 2 1 2; display: none; }"

    def __init__(self, room, **kw):
        super().__init__(room, **kw)
        app = self.app
        saved = app.state.view(room.id)
        self.view = saved.get("view") if saved.get("view") in ("ask", "library") else "library"
        self.query_text = ""
        self.hits: list[dict] = []
        self.mode = ""                 # semantic | keyword
        self.question = ""
        self.answer: dict | None = None
        self.asking = False
        self.docs: list[dict] | None = None
        self.doc: dict | None = None   # the transcript being read
        self.status: dict | None = None
        self.busy: set[str] = set()
        r, g = app.roles, app.glyphs
        self.winbar = Winbar(r, g)
        self.winbar.hue = HUE
        self.panel = Static("", id="answer")
        self.list = ItemList(self._row, roles=r, glyphs=g, hue=HUE, id="list", empty=["Loading…"])
        self.preview = Preview(r, g, cell_px=app.term.cell_px, backend=app.image_backend, id="preview")

    def compose(self):
        with Vertical(id="middle"):
            yield self.winbar
            yield self.panel
            yield self.list
        yield self.preview

    def on_mount(self) -> None:
        self._layout()

    def on_resize(self) -> None:
        self._layout()

    def _layout(self) -> None:
        w = self.size.width or self.app.size.width
        self.preview.display = w >= 90
        if w >= 90:
            self.preview.styles.width = max(40, min(66, int(w * 0.4)))

    # ── data ─────────────────────────────────────────────────────────────────

    def view_available(self, view: str) -> bool:
        return view != "search" or bool(self.query_text)

    def set_view(self, view: str) -> None:
        self.doc = None
        super().set_view(view)

    def reload(self, force: bool = False) -> None:
        if self.status is None or force:
            self.run_worker(self._fetch_status, thread=True, group="ar-status")
        if self.view == "library":
            if self.doc is not None:
                self.open_doc(self.doc)
                return
            if self.docs is None or force:
                self.busy.add("library")
                self.run_worker(self._fetch_docs, thread=True, group="ar-docs", exclusive=True)
        elif self.view == "search" and self.query_text and (force or not self.hits):
            self.search_platform(self.query_text)
            return
        self._show()

    def _fetch_status(self) -> None:
        try:
            st = self.app.api.get("/brain/status", timeout=10)
        except ApiError:
            return

        def show():
            self.status = st
            self._show()
        self.app.call_from_thread(show)

    def _fetch_docs(self) -> None:
        try:
            docs = (self.app.api.get("/brain/docs", timeout=20) or {}).get("items") or []
            err = None
        except ApiError as e:
            docs, err = None, str(e)

        def show():
            self.busy.discard("library")
            if err:
                self.app.say(err, "error")
                if self.docs is None:
                    self.list.empty = [f"{self.app.glyphs.error} {err}", "r  try again"]
            else:
                self.docs = docs
            self._show()
        self.app.call_from_thread(show)

    search_command = "ar"

    def search_platform(self, query: str) -> None:
        q = query.strip()
        if not q:
            return
        self.query_text, self.doc = q, None
        self.view = "search"
        self.busy.add("search")
        self.hits = []
        self.list.empty = [f"Looking through the transcripts for “{q}”…"]
        self._show()

        def work():
            try:
                d = self.app.api.get("/brain/search", q=q, timeout=60) or {}
                hits, mode, err = d.get("results") or [], d.get("mode") or "", None
            except ApiError as e:
                hits, mode, err = [], "", str(e)

            def show():
                if q != self.query_text:
                    return
                self.busy.discard("search")
                self.hits, self.mode = hits, mode
                if err:
                    self.app.say(err, "error")
                self._show()
            self.app.call_from_thread(show)
        self.run_worker(work, thread=True, group="ar-search", exclusive=True)
        self.app.refresh_chrome()

    def ask(self, question: str) -> None:
        q = question.strip()
        if not q:
            return
        if self.asking:
            self.app.say("Still answering the last question.", "warn")
            return
        self.question, self.asking, self.doc = q, True, None
        self.view = "ask"
        self.app.say("Asking the Archive: the local model reads in two passes, so this takes a while.")
        self._show()

        def work():
            try:
                d, err = self.app.api.post("/brain/ask", {"question": q}, timeout=300) or {}, None
            except ApiError as e:
                d = None
                err = ("The local models aren't ready (Ollama, or the models the Archive uses). "
                       "Settings → The Archive says which.") if e.status == 503 else str(e)

            def show():
                self.asking = False
                if err:
                    self.app.say(err, "error")
                    self.answer = {"answer": "", "citations": [], "error": err}
                else:
                    self.answer = d
                self._show()
                self.app.refresh_chrome()
            self.app.call_from_thread(show)
        self.run_worker(work, thread=True, group="ar-ask", exclusive=True)
        self.app.refresh_chrome()

    def ask_in_editor(self) -> None:
        from ... import editor
        if self.view != "ask":
            self.set_view("ask")
        context = ["Ask the Archive a question about the videos you've watched.",
                   "It answers from their transcripts, with the places it read."]
        q = editor.compose(self.app, self.question if not self.answer else "", context=context)
        if q:
            self.ask(" ".join(q.split()))
        elif q is None:
            self.app.say("No question asked.")

    def open_doc(self, doc: dict) -> None:
        iid = doc.get("item_id")
        self.doc = dict(doc)
        self.view = "library"
        self.busy.add("doc")
        self.list.empty = ["Reading the transcript…"]
        self.list.set_rows([])
        self._paint_winbar()

        def work():
            try:
                d, err = self.app.api.get(f"/brain/doc/{seg(iid)}", timeout=20), None
            except ApiError as e:
                d, err = None, str(e)

            def show():
                self.busy.discard("doc")
                if self.doc is None or self.doc.get("item_id") != iid:
                    return
                if err:
                    self.app.say(err, "error")
                    self.list.empty = [f"{self.app.glyphs.error} {err}", "h  back to the library"]
                    self.list.set_rows([])
                    return
                self.doc = d
                self._show()
            self.app.call_from_thread(show)
        self.run_worker(work, thread=True, group="ar-doc", exclusive=True)
        self.app.refresh_chrome()

    # ── showing ──────────────────────────────────────────────────────────────

    def _show(self) -> None:
        r, g = self.app.roles, self.app.glyphs
        self.panel.display = self.view == "ask"
        rows: list = []
        if self.view == "search":
            rows = [Head(f"“{self.query_text}”", len(self.hits)), *self.hits] if self.hits else []
            if "search" not in self.busy:
                self.list.empty = [f"Nothing said in your videos matches “{self.query_text}”."] if self.query_text \
                    else ["Space /  search what was said in the videos you watched"]
        elif self.view == "ask":
            t = Text()
            if self.question:
                t.append(self.question + "\n", style(r, "fg+bold"))
            if self.asking:
                t.append("Reading the transcripts…", style(r, "dim"))
            elif self.answer and self.answer.get("error"):
                t.append(f"{g.error} {self.answer['error']}", style(r, "hue:red"))
            elif self.answer and self.answer.get("empty"):
                t.append("Nothing in the Archive comes close to that question.", style(r, "dim"))
            elif self.answer:
                t.append_text(answer_text(r, self.answer.get("answer") or ""))
            else:
                t.append("Ask about anything said in the videos you've watched.\n", style(r, "dim"))
                t.append("i  write a question in your editor   :ask <question>  ask in a line", style(r, "faint"))
            self.panel.update(t)
            cites = (self.answer or {}).get("citations") or []
            expanded = set((self.answer or {}).get("expanded") or [])
            rows = [Head("Where it read", len(cites)), *[dict(c, _deep=c.get("n") in expanded) for c in cites]] \
                if cites else []
            self.list.empty = [""]
        elif self.doc is not None:
            chunks = self.doc.get("chunks")
            if chunks is not None:
                rows = [Head(fmt.clean(self.doc.get("title")), len(chunks)),
                        *[dict(c, item_id=self.doc.get("item_id"), title=self.doc.get("title"),
                               source_name=self.doc.get("source_name"), url=self.doc.get("url"),
                               thumbnail=self.doc.get("thumbnail"), _part=True) for c in chunks]]
                self.list.empty = ["This transcript is empty."]
        else:
            docs = self.docs or []
            ready = [d for d in docs if d.get("status") == "ready"]
            waiting = [d for d in docs if d.get("status") != "ready"]
            if ready:
                rows += [Head("Transcribed", len(ready)), *ready]
            if waiting:
                rows += [Head("Waiting or failed", len(waiting)), *waiting]
            if self.docs is not None:
                self.list.empty = ["Nothing transcribed yet. The web UI's Archive adds videos, or turns on "
                                   "transcribing everything you watch."]
        self.list.set_rows(rows)
        self._paint_winbar()
        self.app.refresh_chrome()

    def _paint_winbar(self) -> None:
        wb = self.winbar
        wb.views = [(v, label, len(self.docs) if v == "library" and self.docs else None)
                    for v, label in VIEWS if self.view_available(v)]
        wb.current = self.view
        wb.busy = bool(self.busy) or self.asking
        bits = []
        if self.view == "search" and self.mode:
            bits.append("by meaning" if self.mode == "semantic" else "by words (the embedding model isn't up)")
        if self.view == "library" and self.doc is not None:
            bits.append(fmt.cut(fmt.clean(self.doc.get("title")), 40))
        st = self.status
        if st and not st.get("ollama"):
            bits.append("Ollama isn't running")
        wb.right = f" {self.app.glyphs.dot} ".join(bits)
        wb.refresh()

    # ── rows ─────────────────────────────────────────────────────────────────

    def _at_playhead(self, row: dict) -> bool:
        p = self.app.player.playing
        if not p or p.item.get("id") != row.get("item_id"):
            return False
        pos = self.app.player.now.pos
        return float(row.get("t_start") or 0) <= pos < float(row.get("t_end") or 1e9)

    def _row(self, row: dict) -> RowParts:
        g = self.app.glyphs
        saved = self.app.saved
        here = self._at_playhead(row) if "t_start" in row else False
        sign = (g.playing, f"mark:{HUE}") if here else (" ", "fg")
        if row.get("_part"):
            # what was said, over both lines of the row
            room = max(20, (self.list.size.width or 80) - 16)
            lines = textwrap.wrap(fmt.clean(row.get("text")), room) or [""]
            rest = " ".join(lines[1:])
            mark = [(g.saved, "mark:blue")] if self._saveable(row)["id"] in saved else []
            return RowParts(sign=sign, title=[(lines[0], "fg")], figure=[(fmt.duration(row.get("t_start")) or "0:00", "dim")],
                            meta=[(rest, "fg")], mark=mark)
        if "n" in row and "snippet" not in row:   # a citation
            title = [(f"[{row['n']}] ", f"hue:{HUE}+bold"), (fmt.clean(row.get("title")), "fg")]
            meta = [("read closely" if row.get("_deep") else "", "dim")]
            return RowParts(sign=sign, title=title, figure=[(fmt.duration(row.get("t_start")) or "0:00", "dim")],
                            meta=meta)
        if "snippet" in row:                      # a search hit
            mark = [(g.saved, "mark:blue")] if self._saveable(row)["id"] in saved else []
            meta = [(fmt.clean(row.get("title")), "dim")]
            if row.get("source_name"):
                meta.append((f" {g.dot} {fmt.clean(row['source_name'])}", "faint"))
            return RowParts(sign=sign, title=[("“" + fmt.clean(row.get("snippet")), "fg")],
                            figure=[(fmt.duration(row.get("t_start")) or "0:00", "dim")], meta=meta, mark=mark)
        # a video in the library
        ready = row.get("status") == "ready"
        st = (g.error, "hue:red") if row.get("status") == "error" else \
            (g.watched, "faint") if ready else (g.upcoming, "mark:yellow")
        src = fmt.clean(row.get("source_name") or "")
        meta = [(src, who(src))]
        if not ready:
            meta.append((f" {g.dot} {row.get('status') or ''}", "hue:yellow"))
        if row.get("indexed_at") or row.get("added_at"):
            meta.append((f" {g.dot} {fmt.ago(row.get('indexed_at') or row.get('added_at'))}", "faint"))
        return RowParts(sign=st, title=[(fmt.clean(row.get("title")), "fg" if ready else "dim")],
                        figure=[(fmt.duration(row.get("duration")), "dim")] if row.get("duration") else [], meta=meta)

    def _saveable(self, row: dict) -> dict:
        video = video_of(row)
        if "t_start" in row:
            return moment_item(video, row.get("t_start") or 0, row.get("text") or row.get("snippet") or "")
        return video

    # ── the preview ──────────────────────────────────────────────────────────

    def on_item_list_moved(self, event: ItemList.Moved) -> None:
        self._preview(event.item)
        self.app.refresh_chrome()

    def _preview(self, row: dict | None) -> None:
        pv = self.preview
        if not pv.display:
            return
        if not row:
            pv.blank()
            return
        r, g = self.app.roles, self.app.glyphs
        video = video_of(row)
        t = Text()
        t.append(fmt.clean(row.get("title")) + "\n", style(r, "fg+bold"))
        if row.get("source_name"):
            t.append(fmt.clean(row["source_name"]) + "\n", style(r, "fg"))
        t.append("\n")
        said = row.get("text") or row.get("snippet")
        if said:
            t.append(fmt.duration(row.get("t_start")) or "0:00", style(r, f"hue:{HUE}"))
            if row.get("t_end"):
                t.append(f"–{fmt.duration(row['t_end'])}", style(r, f"hue:{HUE}"))
            t.append("\n" + str(said).strip() + "\n\n", style(r, "fg"))
        if row.get("_part") and self.doc and self.doc.get("summary"):
            t.append("Summary\n", style(r, "fg+bold"))
            t.append_text(markdown_text(r, self.doc["summary"]))
            t.append("\n\n")
        if "t_start" in row:
            playing = self.app.player.playing
            here = playing and playing.item.get("id") == row.get("item_id")
            t.append(f"⏎  {'seeks to' if here else 'plays from'} {fmt.duration(row.get('t_start')) or '0:00'}"
                     f"   s  saves the moment", style(r, "faint"))
        elif row.get("status") == "ready":
            t.append("⏎  reads the transcript   p  plays the video", style(r, "faint"))
        elif row.get("error"):
            t.append(f"{g.error} {row['error']}", style(r, "hue:red"))
        pv.show(t, (row.get("source_name") or "▶")[:1].upper(), video.get("thumbnail"))

    # ── keys ─────────────────────────────────────────────────────────────────

    def binds(self) -> list[Bind]:
        return [
            Bind(("enter",), "open", "play from here / read"), Bind(("p",), "play", "play the video"),
            Bind(("i",), "write", "write a question"), Bind(("s",), "save", "save the moment"),
            Bind(("a",), "enqueue", "add the video to the queue"), Bind(("u",), "undo", "undo"),
        ]

    def active_list(self) -> ItemList:
        return self.list

    def selected(self) -> dict | None:
        row = self.list.selected
        return self._saveable(row) if row else None

    def item_of(self, row: dict) -> dict | None:
        return self._saveable(row)

    def playable_of(self, row: dict) -> dict | None:
        return video_of(row)

    def crumbs(self) -> list[str]:
        out = [dict(VIEWS).get(self.view, "")]
        if self.view == "library" and self.doc is not None:
            out.append(fmt.cut(fmt.clean(self.doc.get("title")), 30))
        return out

    def web_route(self) -> str:
        return "/archive"

    def handle(self, action: str, count: int | None) -> bool:
        app = self.app
        row = self.list.selected
        if action in ("left", "close", "escape") and self.view == "library" and self.doc is not None:
            self.doc = None
            self._show()
            return True
        if action in ("right", "open"):
            if not row:
                if self.view == "ask":
                    self.ask_in_editor()
                return True
            if "t_start" in row:
                self.play_at(row)
            elif row.get("status") == "ready":
                self.open_doc(row)
            else:
                app.say("This one isn't transcribed yet.", "warn")
            return True
        if action == "play" and row:
            if "t_start" in row:
                self.play_at(row)
            else:
                app.play(video_of(row))
            return True
        if action == "write":
            self.ask_in_editor()
            return True
        if action == "save" and row:
            app.toggle_saved(self._saveable(row))
            self.list.repaint()
            return True
        if action == "enqueue" and row:
            app.say(f"Added to the queue ({app.player.enqueue(video_of(row))}).")
            return True
        if action == "undo":
            app.undo()
            return True
        return False

    def play_at(self, row: dict) -> None:
        """Play the row's video from its time, or seek there when it's already playing."""
        app = self.app
        t = float(row.get("t_start") or 0)
        playing = app.player.playing
        if playing and playing.item.get("id") == row.get("item_id") and app.player.mpv.alive:
            try:
                app.player.seek(t, absolute=True)
                app.say(f"At {fmt.duration(t) or '0:00'}.")
            except Exception as e:
                app.say(str(e), "error")
            return
        app.play(video_of(row), start=t)

    def refresh_rows(self) -> None:
        self.list.repaint()
