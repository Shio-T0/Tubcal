"""The Dispatch in the terminal: your subreddits as a list and a reader.

Views (Tab / S-Tab) are Hot, New and Top (the `reddit_sort` setting, as on the web)
and Search (`Space /` or `:r words`). From 140 columns an index on the left lists
your subreddits; picking one shows only it. Enter opens the post and its comments
beside the list from 120 columns, in its place below; the reader works like the
Wire's (j/k, [[ ]], za zM zR).

Without a Reddit account Tubcal reads Reddit's RSS, which has no scores or comment
counts and is rate-limited hard; the winbar says so, and a refused thread says when
to try again.
"""

from __future__ import annotations

from textual.containers import Vertical

from ... import fmt
from ...api import ApiError
from ...keys import Bind
from ...ui.chrome import Winbar
from ...ui.itemlist import Head, ItemList, RowParts
from ...ui.thread import ThreadView
from ..base import RoomView

HUE = "dispatch"
SORTS = [("hot", "Hot"), ("new", "New"), ("top", "Top")]


def is_youtube(url: str | None) -> bool:
    import re
    return bool(url) and bool(re.match(r"^https?://(www\.|m\.)?(youtube\.com/(watch|shorts|live)|youtu\.be/)", url))


class Dispatch(RoomView):
    VIEWS = SORTS + [("search", "Search")]

    def __init__(self, room, **kw):
        super().__init__(room, **kw)
        app = self.app
        sort = app.settings.get("reddit_sort")
        self.view = sort if sort in dict(SORTS) else "hot"
        self.search_query = ""
        self.sub: str | None = None
        self.subs: list[dict] = []
        self.data: dict[tuple, list[dict]] = {}
        self.limited = False
        self.stale: dict[str, bool] = {}
        self.busy: set[str] = set()
        self.focus_pane = "list"
        self.post: dict | None = None
        r, g = app.roles, app.glyphs
        self.winbar = Winbar(r, g)
        self.winbar.hue = HUE
        self.index = ItemList(self._index_row, roles=r, glyphs=g, hue=HUE, lines_per_item=1, id="subs")
        self.list = ItemList(self._row, roles=r, glyphs=g, hue=HUE, id="posts", empty=["Loading your subreddits…"])
        self.reader = ThreadView(roles=r, glyphs=g, id="post", empty=["Enter on a post opens it here."])
        self.reader.active = False

    def compose(self):
        yield self.index
        with Vertical(id="listcol"):
            yield self.winbar
            yield self.list
        yield self.reader

    DEFAULT_CSS = "Dispatch #listcol { width: 1fr; } Dispatch #post { width: 1fr; }"

    def on_mount(self) -> None:
        self._layout()

    def on_resize(self) -> None:
        self._layout()

    @property
    def side_by_side(self) -> bool:
        return (self.size.width or self.app.size.width) >= 120

    def _layout(self) -> None:
        w = self.size.width or self.app.size.width
        col = self.query_one("#listcol")
        self.index.display = w >= 140
        self.index.styles.width = 24
        if not self.index.display and self.focus_pane == "index":
            self.focus_pane = "list"
        if self.side_by_side:
            col.display = True
            col.styles.width = max(50, min(66, int(w * 0.4)))
            self.reader.display = True
        else:
            col.styles.width = "1fr"
            reading = self.focus_pane == "reader" and self.post is not None
            col.display = not reading
            self.reader.display = reading
        self._mark_focus()

    def _mark_focus(self) -> None:
        self.index.active = self.focus_pane == "index"
        self.list.active = self.focus_pane == "list"
        self.reader.active = self.focus_pane == "reader"
        self.index.repaint()
        self.list.repaint()
        self.reader.refresh()

    # ── data ─────────────────────────────────────────────────────────────────

    def view_available(self, view: str) -> bool:
        return view != "search" or bool(self.search_query)

    def set_view(self, view: str) -> None:
        if view in dict(SORTS):
            self.app.settings["reddit_sort"] = view

            def put():
                try:
                    self.app.api.put("/settings", {"reddit_sort": view})
                except ApiError:
                    pass
            self.run_worker(put, thread=True)
        super().set_view(view)

    def _key(self) -> tuple:
        return (self.view, self.sub or "", self.search_query if self.view == "search" else "")

    def reload(self, force: bool = False) -> None:
        key = self._key()
        self.busy.add(self.view)
        self._paint_winbar()
        if not self.data.get(key):
            self.list.empty = ["Loading…"]
            self.list.set_rows([])
        if not self.subs:
            self.run_worker(self._fetch_subs, thread=True, group="rd-subs")
        self.run_worker(lambda: self._fetch(key, force), thread=True, group="rd-feed", exclusive=True)

    def _fetch_subs(self) -> None:
        try:
            subs = (self.app.api.get("/subscriptions") or {}).get("reddit") or []
        except ApiError:
            subs = []
        self.app.call_from_thread(self._got_subs, subs)

    def _got_subs(self, subs: list[dict]) -> None:
        self.subs = subs
        self._show_index()

    def _fetch(self, key: tuple, force: bool) -> None:
        view, sub, query = key
        api = self.app.api
        try:
            if force:
                api.post("/refresh?scope=reddit")
            if view == "search":
                d = api.get("/reddit/search", q=query, sub=sub or None, timeout=40)
            else:
                d = api.get("/feed/reddit", sort=view, subs=sub or None, timeout=60)
            self.app.call_from_thread(self._got, key, d.get("items") or [], bool(d.get("stale")),
                                      bool(d.get("limited")), None)
        except ApiError as e:
            self.app.call_from_thread(self._got, key, None, False, False, str(e))

    def _got(self, key, items, stale, limited, error) -> None:
        self.busy.discard(key[0])
        if error:
            if not self.data.get(key):
                self.list.empty = [f"{self.app.glyphs.error} {error}", "r  try again"]
            self.app.say(error, "error")
        else:
            self.data[key] = items
            self.stale[key[0]] = stale
            self.limited = limited
        if key == self._key():
            self._show()
        self._paint_winbar()
        self.app.refresh_chrome()

    def _show(self) -> None:
        items = self.data.get(self._key()) or []
        if self.view == "search":
            rows = [Head(f"“{self.search_query}”" + (f" in r/{self.sub}" if self.sub else ""), len(items)), *items] \
                if items else []
            self.list.empty = [f"Nothing on Reddit for “{self.search_query}”."]
        else:
            rows = items
            self.list.empty = ["No posts. Add subreddits in the web UI (O)."] if not self.subs else ["No posts right now."]
        self.list.set_rows(rows)

    def _show_index(self) -> None:
        rows: list = [Head("Subreddits", len(self.subs)), {"id": "sub:", "title": "All of yours", "_sub": ""}]
        rows += [{"id": f"sub:{s['source_id']}", "title": f"r/{s['source_id']}", "_sub": s["source_id"]}
                 for s in sorted(self.subs, key=lambda s: s["source_id"].lower())]
        self.index.set_rows(rows, keep=f"sub:{self.sub or ''}")

    def _paint_winbar(self) -> None:
        wb = self.winbar
        wb.views = [(v, label, None) for v, label in self.VIEWS if self.view_available(v)]
        wb.current = self.view
        wb.busy = self.view in self.busy
        bits = [f"r/{self.sub}" if self.sub else "all of yours"]
        if self.limited:
            bits.append("RSS, no account")
        if self.stale.get(self.view):
            bits.append("cached")
        wb.right = f" {self.app.glyphs.dot} ".join(bits)
        wb.refresh()

    # ── rows ─────────────────────────────────────────────────────────────────

    def _index_row(self, row: dict) -> RowParts:
        on = row.get("_sub", "") == (self.sub or "")
        return RowParts(sign=("•" if on else " ", f"mark:{HUE}"),
                        title=[(row["title"], "fg+bold" if on else "fg")])

    def _row(self, item: dict) -> RowParts:
        g = self.app.glyphs
        extra = item.get("extra") or {}
        meta = [(item.get("source") or "", f"hue:{HUE}")]
        if item.get("author"):
            meta.append((f" {g.dot} {item['author']}", "faint"))
        if item.get("published_at"):
            meta.append((f" {g.dot} {fmt.ago(item['published_at'])}", "faint"))
        link = extra.get("link_url")
        if link and not extra.get("is_self") in (True, "True"):
            from urllib.parse import urlsplit
            host = (urlsplit(link).hostname or "").removeprefix("www.")
            if host and "reddit" not in host:
                meta.append((f" {g.dot} " + (f"{g.playing} " if is_youtube(link) else "") + host, "dim"))
        figure = [(f"{fmt.compact(item['score'])} pts", "dim")] if item.get("score") is not None else []
        mark = []
        if item.get("comments_count") is not None:
            n = item["comments_count"]
            mark.append((f"{fmt.compact(n)} comment{'s' if n != 1 else ''}", "dim"))
        if item.get("id") in self.app.saved:
            mark.append((f" {g.saved}", "mark:blue"))
        return RowParts(sign=(" ", "fg"), title=[(fmt.clean(item.get("title")), "fg")], figure=figure,
                        meta=meta, mark=mark)

    # ── the reader ───────────────────────────────────────────────────────────

    def open_post(self, item: dict) -> None:
        extra = item.get("extra") or {}
        sub, pid = extra.get("subreddit"), extra.get("post_id")
        if not (sub and pid):
            return
        self.post = item
        self.focus_pane = "reader"
        self._layout()
        self.reader.set_thread(lambda w: self._head(item, None, w), [], notice="Loading the post…")

        def work():
            try:
                d = self.app.api.get(f"/reddit/post/{sub}/{pid}", timeout=60)
            except ApiError as e:
                self.app.call_from_thread(self._post_error, item, str(e))
                return
            self.app.call_from_thread(self._thread, item, d)
        self.run_worker(work, thread=True, group="rd-post", exclusive=True)
        self.app.refresh_chrome()

    def _post_error(self, item: dict, error: str) -> None:
        if self.post is item:
            self.reader.set_thread(lambda w: self._head(item, None, w), [],
                                   notice=f"{self.app.glyphs.error} {error} · r tries again")

    def _thread(self, item: dict, d: dict) -> None:
        if self.post is not item:
            return
        post = d.get("post") or item
        merged = dict(item, **{k: v for k, v in post.items() if v is not None})
        self.post = merged
        op = (merged.get("author") or "").removeprefix("u/")
        notice = "Reddit's RSS has no replies to replies; a Reddit account shows them all." if d.get("limited") else ""
        self.reader.set_thread(lambda w: self._head(merged, d.get("selftext_html"), w), d.get("comments") or [],
                               op=op, notice=notice)
        self.app.refresh_chrome()

    def _head(self, item: dict, html: str | None, width: int):
        from ...ui.html import parse, wrap
        g = self.app.glyphs
        lines = []
        cur, used = [], 0
        for w_ in fmt.clean(item.get("title")).split():
            if used and used + len(w_) + 1 > width:
                lines.append(cur)
                cur, used = [], 0
            cur.append(((" " if used else "") + w_, "fg+bold"))
            used += len(w_) + (1 if used else 0)
        lines.append(cur)
        bits = [item.get("source") or "", item.get("author") or "", fmt.ago_long(item.get("published_at"))]
        if item.get("score") is not None:
            bits.append(f"{fmt.compact(item['score'])} points")
        lines.append([(f" {g.dot} ".join(b for b in bits if b), "dim")])
        link = (item.get("extra") or {}).get("link_url")
        if link and "reddit.com" not in link:
            lines.append([("o ", "hue:yellow"), (fmt.cut(link, width - 14), "dim+underline"),
                          ("  p plays it" if is_youtube(link) else "", "faint")])
        if html:
            lines.append([])
            blocks, _ = parse(html)
            lines += wrap(blocks, width)
        return lines

    # ── keys ─────────────────────────────────────────────────────────────────

    def binds(self) -> list[Bind]:
        return [
            Bind(("enter",), "open", "open the post"), Bind(("p",), "play_link", "play a YouTube link"),
            Bind(("s",), "save", "save / unsave"), Bind(("u",), "undo", "undo"),
            Bind(("[", "["), "prev_top", "previous top-level comment"), Bind(("]", "]"), "next_top", "next top-level comment"),
            Bind(("z", "a"), "fold", "fold these replies"), Bind(("z", "M"), "fold_all", "fold every thread"),
            Bind(("z", "R"), "unfold_all", "open every thread"),
            Bind(("ctrl+e",), "line_down", "a line down"), Bind(("ctrl+y",), "line_up", "a line up"),
            Bind(("R",), "force_refresh", "fetch everything again"),
        ]

    def active_list(self):
        return {"index": self.index, "reader": self.reader}.get(self.focus_pane, self.list)

    def selected(self) -> dict | None:
        if self.focus_pane == "reader":
            return self.post
        return self.list.selected if self.focus_pane == "list" else None

    def item_of(self, row: dict) -> dict | None:
        return row if self.focus_pane == "list" else None

    def crumbs(self) -> list[str]:
        out = [dict(self.VIEWS).get(self.view, "") + (f" › r/{self.sub}" if self.sub else "")]
        if self.focus_pane == "reader" and self.post:
            out.append(fmt.cut(fmt.clean(self.post.get("title")), 32))
        return out

    def web_route(self) -> str:
        return f"/reddit/r/{self.sub}" if self.sub else "/reddit"

    search_command = "r"

    def search_platform(self, query: str) -> None:
        self.search_query = query.strip()
        if self.search_query:
            self.view = "search"
            self.focus_pane = "list"
            self._layout()
            self.reload()
            self.app.refresh_chrome()

    def handle(self, action: str, count: int | None) -> bool:
        app = self.app
        pane = self.focus_pane
        if action in ("right", "open"):
            if pane == "index":
                row = self.index.selected or {}
                self.sub = row.get("_sub") or None
                self.focus_pane = "list"
                self._layout()
                self._show_index()
                self.reload()
            elif pane == "list" and self.list.selected:
                self.open_post(self.list.selected)
            return True
        if action == "left":
            if pane == "reader":
                self.focus_pane = "list"
            elif pane == "list" and self.index.display:
                self.focus_pane = "index"
            else:
                return False
            self._layout()
            return True
        if action in ("close", "escape") and pane == "reader" and not self.side_by_side:
            self.focus_pane = "list"
            self._layout()
            return True
        if action in ("next_top", "prev_top") and self.post is not None:
            if pane != "reader":
                self.focus_pane = "reader"
                self._layout()
            if not self.reader.jump("top", forward=action == "next_top"):
                app.say("No more top-level comments.")
            return True
        if action in ("fold", "fold_all", "unfold_all") and self.post is not None:
            self.reader.fold({"fold": "toggle", "fold_all": "all", "unfold_all": "none"}[action])
            return True
        if action in ("line_down", "line_up"):
            if pane == "reader":
                self.reader.scroll_lines((count or 1) * (1 if action == "line_down" else -1))
            return True
        if action == "play_link":
            item = self.selected()
            url = ((item or {}).get("extra") or {}).get("link_url")
            if is_youtube(url):
                app.run_worker(lambda: app._open_url(url), thread=True)
            else:
                app.say("That post isn't a YouTube link; o opens it in the browser.")
            return True
        if action == "save":
            item = self.selected()
            if item:
                app.toggle_saved({k: v for k, v in item.items() if not k.startswith("_")})
            return True
        if action == "undo":
            app.undo()
            return True
        if action == "refresh" and pane == "reader" and self.post:
            self.open_post(self.post)
            return True
        if action == "force_refresh":
            self.reload(force=True)
            return True
        return False

    def on_item_list_moved(self, event: ItemList.Moved) -> None:
        self.app.refresh_chrome()

    def on_thread_view_moved(self, event: ThreadView.Moved) -> None:
        self.app.refresh_chrome()

    def refresh_rows(self) -> None:
        self.list.repaint()
