"""The Wire in the terminal: Hacker News as a board and a reader.

Views (Tab / S-Tab) are HN's six lists (the last one chosen is the `hn_list` setting,
as on the web) and Search (`Space /` or `:hn words`). A line reads: rank, headline
(with its Ask/Show HN tag), where it's from, who and when, points with a heat cell
(points per hour, so a rising story reads hot), and the comments with "+N" arrived
since you last opened the thread. Stories you've read go quiet.

Enter opens the discussion: beside the board from 120 columns, in its place below.
In the reader: j/k comment by comment, [[ ]] top-level, ]n [n new since your last
visit, za zM zR folds. `o` opens the article; `p` plays it when it's a YouTube link.
What you've read is kept in the terminal's state (the browser keeps its own).
"""

from __future__ import annotations

import time

from textual.containers import Vertical

from ... import fmt
from ...api import ApiError
from ...keys import Bind
from ...ui.chrome import Winbar
from ...ui.itemlist import Head, ItemList, RowParts
from ...ui.thread import ThreadView
from ..base import RoomView

HUE = "yellow"
LISTS = [("top", "Top"), ("best", "Best"), ("new", "New"), ("ask", "Ask"), ("show", "Show"), ("job", "Jobs")]
KEEP_SEEN = 800


def split_kind(title: str) -> tuple[str | None, str]:
    """('Ask HN', 'How do you…') — the web's splitKind."""
    import re
    m = re.match(r"^(Ask|Show|Tell|Launch) HN:\s*", title or "", re.I)
    if not m:
        return None, title or ""
    return f"{m.group(1).capitalize()} HN", (title or "")[m.end():]


def heat_of(item: dict, now: float | None = None) -> float:
    """Points per hour since posting, as 0–1."""
    if not item.get("score") or not item.get("published_at"):
        return 0.0
    hours = max(1.0, ((now or time.time()) - item["published_at"]) / 3600)
    return min(1.0, item["score"] / hours / 60)


def is_youtube(url: str | None) -> bool:
    import re
    return bool(url) and bool(re.match(r"^https?://(www\.|m\.)?(youtube\.com/(watch|shorts|live)|youtu\.be/)", url))


class Wire(RoomView):
    VIEWS = LISTS + [("search", "Search")]

    def __init__(self, room, **kw):
        super().__init__(room, **kw)
        app = self.app
        hn = app.settings.get("hn_list")
        self.view = hn if hn in dict(LISTS) else "top"
        self.search_query = ""
        self.data: dict[str, list[dict]] = {}
        self.more: dict[str, bool] = {}
        self.pages: dict[str, int] = {}
        self.stale: dict[str, bool] = {}
        self.busy: set[str] = set()
        self.focus_pane = "board"
        self.story: dict | None = None
        r, g = app.roles, app.glyphs
        self.winbar = Winbar(r, g)
        self.winbar.hue = HUE
        self.board = ItemList(self._row, roles=r, glyphs=g, hue=HUE, id="board", empty=["Loading the wire…"])
        self.reader = ThreadView(roles=r, glyphs=g, id="reader",
                                 empty=["Enter on a story opens its discussion here."])
        self.reader.active = False

    def compose(self):
        with Vertical(id="boardcol"):
            yield self.winbar
            yield self.board
        yield self.reader

    DEFAULT_CSS = "Wire #boardcol { width: 1fr; } Wire #reader { width: 1fr; }"

    def on_mount(self) -> None:
        self._layout()

    def on_resize(self) -> None:
        self._layout()

    @property
    def side_by_side(self) -> bool:
        return (self.size.width or self.app.size.width) >= 120

    def _layout(self) -> None:
        col = self.query_one("#boardcol")
        if self.side_by_side:
            col.display = True
            col.styles.width = max(54, min(72, int((self.size.width or self.app.size.width) * 0.42)))
            self.reader.display = True
        else:
            col.styles.width = "1fr"
            reading = self.focus_pane == "reader" and self.story is not None
            col.display = not reading
            self.reader.display = reading
        self._mark_focus()

    def _mark_focus(self) -> None:
        self.board.active = self.focus_pane == "board"
        self.reader.active = self.focus_pane == "reader"
        self.board.repaint()
        self.reader.refresh()

    # ── seen marks ───────────────────────────────────────────────────────────

    def _seen(self) -> dict:
        return self.app.state.data.setdefault("wire_seen", {})

    def last_visit(self, item: dict) -> list | None:
        return self._seen().get(str((item.get("extra") or {}).get("hn_id")))

    def _visit(self, item: dict) -> None:
        seen = self._seen()
        seen[str(item["extra"]["hn_id"])] = [int(time.time()), item.get("comments_count") or 0]
        if len(seen) > KEEP_SEEN:
            for k in sorted(seen, key=lambda k: seen[k][0])[: len(seen) - KEEP_SEEN]:
                del seen[k]
        self.app.state.save()

    # ── data ─────────────────────────────────────────────────────────────────

    def view_available(self, view: str) -> bool:
        return view != "search" or bool(self.search_query)

    def set_view(self, view: str) -> None:
        if view in dict(LISTS):
            self.app.settings["hn_list"] = view
            self.run_worker(lambda: self._quiet_put({"hn_list": view}), thread=True)
        super().set_view(view)

    def _quiet_put(self, body: dict) -> None:
        try:
            self.app.api.put("/settings", body)
        except ApiError:
            pass

    def reload(self, force: bool = False) -> None:
        view = self.view
        self.busy.add(view)
        self.pages[view] = 0
        self._paint_winbar()
        if not self.data.get(view):
            self.board.empty = ["Loading the wire…"]
            self.board.set_rows([])
        self.run_worker(lambda: self._fetch(view, 0, force), thread=True, group=f"hn-{view}", exclusive=True)

    def _fetch(self, view: str, page: int, force: bool) -> None:
        api = self.app.api
        try:
            if force:
                api.post("/refresh?scope=hackernews")
            if view == "search":
                d = api.get("/hackernews/search", q=self.search_query, timeout=30)
                items, more = d.get("items") or [], False
            else:
                d = api.get("/feed/hackernews", list=view, page=page, timeout=30)
                items, more = d.get("items") or [], bool(d.get("has_more"))
            self.app.call_from_thread(self._got, view, page, items, more, bool(d.get("stale")), None)
        except ApiError as e:
            self.app.call_from_thread(self._got, view, page, None, False, False, str(e))

    def _got(self, view, page, items, more, stale, error) -> None:
        self.busy.discard(view)
        if error:
            if not self.data.get(view):
                self.board.empty = [f"{self.app.glyphs.error} {error}", "r  try again"]
            self.app.say(error, "error")
        else:
            self.data[view] = (self.data.get(view) or []) + items if page else items
            self.more[view] = more
            self.pages[view] = page
            self.stale[view] = stale
        if view == self.view:
            self._show()
        self._paint_winbar()
        self.app.refresh_chrome()

    def _show(self) -> None:
        items = self.data.get(self.view) or []
        if self.view == "search":
            rows = [Head(f"“{self.search_query}”", len(items)), *items] if items else []
            self.board.empty = [f"Nothing on HN for “{self.search_query}”."]
        else:
            rows = items
            self.board.empty = ["Nothing on this list right now."]
        self.board.set_rows(rows)

    def _paint_winbar(self) -> None:
        wb = self.winbar
        wb.views = [(v, label, None) for v, label in self.VIEWS if self.view_available(v)]
        wb.current = self.view
        wb.busy = self.view in self.busy
        wb.right = "cached" if self.stale.get(self.view) else ""
        wb.refresh()

    # ── rows ─────────────────────────────────────────────────────────────────

    def _row(self, item: dict) -> RowParts:
        g = self.app.glyphs
        extra = item.get("extra") or {}
        n = (item.get("_rank") or (self.board.items.index(item) + 1 if item in self.board.items else 0))
        seen = self.last_visit(item)
        read = seen is not None
        kind, rest = split_kind(item.get("title") or "")
        title = [(f"{n:02d} ", "faint")]
        if kind:
            title.append((kind + " ", f"hue:{HUE}"))
        title.append((fmt.clean(rest), "dim" if read else "fg"))
        heat = heat_of(item)
        cells = g.heat
        figure = [(fmt.compact(item.get("score")) or "–", "dim"),
                  (" " + cells[min(len(cells) - 1, int(heat * len(cells)))], f"mark:{HUE}" if heat > 0.3 else "faint")]
        meta = []
        if extra.get("domain"):
            meta.append(((f"{g.playing} " if is_youtube(item.get("url")) else "") + extra["domain"], "dim"))
        if item.get("author"):
            meta.append(((f" {g.dot} " if meta else "") + item["author"], "faint"))
        if item.get("published_at"):
            meta.append((f" {g.dot} {fmt.ago(item['published_at'])}", "faint"))
        if read:
            meta.append((f" {g.dot} read", "faint"))
        n_comments = item.get("comments_count") or 0
        fresh = max(0, n_comments - seen[1]) if seen else 0
        mark = [(f"+{fmt.compact(fresh)} {g.dot} ", "hue:blue")] if fresh else []
        mark.append((f"{fmt.compact(n_comments)} comment{'s' if n_comments != 1 else ''}", "dim"))
        if item.get("id") in self.app.saved:
            mark.append((f" {g.saved}", "mark:blue"))
        return RowParts(sign=(" ", "fg"), title=title, figure=figure, meta=meta, mark=mark)

    # ── the reader ───────────────────────────────────────────────────────────

    def open_story(self, item: dict) -> None:
        """Open a story's discussion (from the board, the Edition, Saved or the finder)."""
        hn_id = (item.get("extra") or {}).get("hn_id")
        if not hn_id:
            return
        self.story = item
        prev = self.last_visit(item)
        since = prev[0] if prev else None
        self.focus_pane = "reader"
        self._layout()
        self.reader.set_thread(lambda w: self._head(item, None, w), [], notice="Loading the discussion…")

        def work():
            try:
                d = self.app.api.get(f"/hackernews/item/{hn_id}", timeout=40)
            except ApiError as e:
                self.app.call_from_thread(self._thread_error, item, str(e))
                return
            self.app.call_from_thread(self._thread, item, d, since)
        self.run_worker(work, thread=True, group="hn-thread", exclusive=True)
        self.app.refresh_chrome()

    def _thread_error(self, item: dict, error: str) -> None:
        if self.story is item:
            self.reader.set_thread(lambda w: self._head(item, None, w), [],
                                   notice=f"{self.app.glyphs.error} {error} · r tries again")

    def _thread(self, item: dict, d: dict, since: float | None) -> None:
        if self.story is not item:
            return
        story = d.get("story") or item
        merged = dict(item, **{k: v for k, v in story.items() if v is not None})
        self.story = merged
        self.reader.set_thread(lambda w: self._head(merged, story.get("text_html"), w), d.get("comments") or [],
                               since=since, op=story.get("author"))
        new = self.reader.new_count
        self._visit(merged)
        self.board.repaint()
        if since and new:
            self.app.say(f"{new} new comment{'s' if new != 1 else ''} since you last read it · ]n to the first")
        self.app.refresh_chrome()

    def _head(self, item: dict, text_html: str | None, width: int):
        from ...ui.html import parse, wrap
        g = self.app.glyphs
        kind, rest = split_kind(item.get("title") or "")
        lines = []
        title = [(kind + " ", f"hue:{HUE}+bold")] if kind else []
        words = (rest or "").split()
        cur, used = list(title), sum(len(t) for t, _ in title)
        for w_ in words:
            if used and used + len(w_) + 1 > width:
                lines.append(cur)
                cur, used = [], 0
            cur.append(((" " if used else "") + w_, "fg+bold"))
            used += len(w_) + (1 if used else 0)
        lines.append(cur)
        bits = [item.get("author") or "", f"{fmt.compact(item.get('score'))} points" if item.get("score") else "",
                fmt.ago_long(item.get("published_at"))]
        lines.append([(f" {g.dot} ".join(b for b in bits if b), "dim")])
        url = item.get("url") or ""
        if url and "news.ycombinator.com/item" not in url:
            label = (item.get("extra") or {}).get("domain") or url
            lines.append([("o ", "hue:yellow"), (fmt.cut(label, width - 12), "dim+underline"),
                          ("  p plays it" if is_youtube(url) else "", "faint")])
        n = item.get("comments_count")
        if n is not None:
            lines.append([(f"{n} comment{'s' if n != 1 else ''}", "faint")])
        if text_html:
            lines.append([])
            blocks, _ = parse(text_html)
            lines += wrap(blocks, width)
        return lines

    # ── keys ─────────────────────────────────────────────────────────────────

    def binds(self) -> list[Bind]:
        return [
            Bind(("enter",), "open", "open the discussion"), Bind(("p",), "play_link", "play a YouTube link"),
            Bind(("s",), "save", "save / unsave"), Bind(("u",), "undo", "undo"),
            Bind(("[", "["), "prev_top", "previous top-level comment"), Bind(("]", "]"), "next_top", "next top-level comment"),
            Bind(("[", "n"), "prev_new", "previous new comment"), Bind(("]", "n"), "next_new", "next new comment"),
            Bind(("z", "a"), "fold", "fold these replies"), Bind(("z", "M"), "fold_all", "fold every thread"),
            Bind(("z", "R"), "unfold_all", "open every thread"),
            Bind(("ctrl+e",), "line_down", "a line down"), Bind(("ctrl+y",), "line_up", "a line up"),
            Bind(("R",), "force_refresh", "fetch the list again"),
        ]

    def active_list(self):
        return self.reader if self.focus_pane == "reader" else self.board

    def selected(self) -> dict | None:
        return self.story if self.focus_pane == "reader" else self.board.selected

    def item_of(self, row: dict) -> dict | None:
        return row if self.focus_pane == "board" else None

    def crumbs(self) -> list[str]:
        out = [dict(self.VIEWS).get(self.view, "")]
        if self.focus_pane == "reader" and self.story:
            out.append(fmt.cut(fmt.clean(split_kind(self.story.get("title") or "")[1]), 32))
        return out

    def web_route(self) -> str:
        sel = self.selected()
        hn = (sel or {}).get("extra", {}).get("hn_id")
        base = f"/hackernews?l={self.view}" if self.view != "search" else f"/hackernews?q={self.search_query}"
        return f"{base}&s={hn}" if hn else base

    def search_platform(self, query: str) -> None:
        self.search_query = query.strip()
        if self.search_query:
            self.data.pop("search", None)
            self.view = "search"
            self.focus_pane = "board"
            self._layout()
            self.reload()
            self.app.refresh_chrome()

    search_command = "hn"

    def handle(self, action: str, count: int | None) -> bool:
        app = self.app
        reader = self.focus_pane == "reader"
        if action in ("right", "open") and not reader:
            item = self.board.selected
            if item:
                self.open_story(item)
            return True
        if action == "left" and reader:
            self.focus_pane = "board"
            self._layout()
            return True
        if action in ("close", "escape") and reader and not self.side_by_side:
            self.focus_pane = "board"
            self._layout()
            return True
        if action in ("next_top", "prev_top", "next_new", "prev_new"):
            if self.story is None:
                return True
            if not reader:
                self.focus_pane = "reader"
                self._layout()
            kind = "top" if "top" in action else "new"
            if not self.reader.jump(kind, forward=action.startswith("next")):
                app.say("No more new comments." if kind == "new" else "No more top-level comments.")
            return True
        if action in ("fold", "fold_all", "unfold_all") and self.story is not None:
            self.reader.fold({"fold": "toggle", "fold_all": "all", "unfold_all": "none"}[action])
            return True
        if action in ("line_down", "line_up"):
            if reader:
                self.reader.scroll_lines((count or 1) * (1 if action == "line_down" else -1))
            return True
        if action == "play_link":
            item = self.selected()
            url = (item or {}).get("url")
            if is_youtube(url):
                app.run_worker(lambda: app._open_url(url), thread=True)
            else:
                app.say("That story isn't a YouTube link; o opens it in the browser.")
            return True
        if action == "save":
            item = self.selected()
            if item:
                app.toggle_saved({k: v for k, v in item.items() if not k.startswith("_")})
            return True
        if action == "undo":
            app.undo()
            return True
        if action == "refresh" and reader and self.story:
            self.open_story(self.story)
            return True
        if action == "force_refresh":
            self.reload(force=True)
            return True
        if action in ("down", "bottom", "page_down", "half_down") and not reader:
            # reaching the end of a list fetches its next page
            view = self.view
            items = self.board.items
            if self.more.get(view) and view not in self.busy and self.board.cursor >= len(items) - 3:
                self.busy.add(view)
                page = self.pages.get(view, 0) + 1
                self.run_worker(lambda: self._fetch(view, page, False), thread=True, group=f"hn-more-{view}")
            return False
        return False

    def on_item_list_moved(self, event: ItemList.Moved) -> None:
        if self.board.items and self.board.cursor >= len(self.board.items) - 2:
            self.handle("down", None)
        self.app.refresh_chrome()

    def on_thread_view_moved(self, event: ThreadView.Moved) -> None:
        self.app.refresh_chrome()

    def refresh_rows(self) -> None:
        self.board.repaint()
