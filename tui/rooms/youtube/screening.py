"""The Screening Room in the terminal: your channels' uploads, what's live, what you
were watching, your history, and YouTube search.

Views (Tab / S-Tab): Latest (day groups), Live, Continue, History, and Search once
you've searched (`Space /`). At 140 columns an index pane on the left lists the views
and your channels with their new counts; picking a channel filters Latest to it. At
90 columns a preview pane on the right shows the selected video.

"New" follows the web's rule as closely as the terminal can: an upload is new until
you watch it or mark its channel seen (`x`). The marks are the terminal's own (the
browser keeps its in localStorage).
"""

from __future__ import annotations

import time
from collections import Counter

from rich.text import Text
from textual.containers import Vertical

from ... import fmt
from ...api import ApiError, seg
from ...images import youtube_thumb
from ...keys import Bind
from ...media.player import COMPLETE, item_video_id
from ...ui.chrome import Winbar
from ...ui.itemlist import Head, ItemList, RowParts
from ...ui.paint import style, who
from ...ui.preview import Preview
from ..base import RoomView



def history_item(h: dict) -> dict:
    """A /history row in the feed-item shape the rest of the room uses."""
    iid = h.get("item_id") or ""
    return {
        "id": iid, "platform": "youtube", "title": h.get("title") or "", "url": h.get("url"),
        "thumbnail": h.get("thumbnail"), "source": h.get("source_name") or "", "author": h.get("source_name"),
        "published_at": h.get("watched_at"),
        "extra": {"video_id": iid[3:] if iid.startswith("yt:") else None, "channel_id": h.get("source_id"),
                  "watch_count": h.get("watch_count")},
    }


class ScreeningRoom(RoomView):
    VIEWS = [("latest", "Latest"), ("live", "Live"), ("continue", "Continue"), ("history", "History"),
             ("search", "Search")]

    def __init__(self, room, **kw):
        super().__init__(room, **kw)
        app = self.app
        saved_view = app.state.view(room.id)
        self.view = saved_view.get("view") if saved_view.get("view") in dict(self.VIEWS) else "latest"
        if self.view == "search":
            self.view = "latest"
        self.hide_watched = bool(saved_view.get("hide_watched"))
        self.channel = None          # filter Latest to one channel id
        self.search_query = ""
        self.data: dict[str, list[dict]] = {}
        self.stale: dict[str, bool] = {}
        self.busy: set[str] = set()
        self.errors: dict[str, str] = {}
        self.focus_pane = "list"
        self.details: dict | None = None   # K: full metadata of the selection
        r, g = app.roles, app.glyphs
        self.index = ItemList(self._index_row, roles=r, glyphs=g, hue="red", lines_per_item=1, id="index")
        self.list = ItemList(self._row, roles=r, glyphs=g, hue="red", id="list",
                             empty=["Loading…"])
        self.preview = Preview(r, g, cell_px=app.term.cell_px, backend=app.image_backend, id="preview")
        self.winbar = Winbar(r, g)
        self.winbar.hue = "red"

    def compose(self):
        yield self.index
        with Vertical(id="middle"):
            yield self.winbar
            yield self.list
        yield self.preview

    def on_mount(self) -> None:
        self._layout()

    def on_resize(self) -> None:
        self._layout()

    def _layout(self) -> None:
        w = self.size.width or self.app.size.width
        three, two = w >= 140, w >= 90
        self.index.display = three
        self.preview.display = two
        self.index.styles.width = 26
        if two:
            self.preview.styles.width = max(40, min(66, int(w * 0.4)))
        if not three and self.focus_pane == "index":
            self.focus_pane = "list"
        self._mark_focus()

    def _mark_focus(self) -> None:
        self.index.active = self.focus_pane == "index"
        self.list.active = self.focus_pane == "list"
        self.index.repaint()
        self.list.repaint()

    # ── data ─────────────────────────────────────────────────────────────────

    def view_available(self, view: str) -> bool:
        return view != "search" or bool(self.search_query)

    def reload(self, force: bool = False) -> None:
        view = self.view
        self.busy.add(view)
        self._paint_winbar()
        self.app.refresh_chrome()
        if not self.data.get(view):
            self.list.empty = ["Loading…"]
            self.list.set_rows([])
        self.run_worker(lambda: self._fetch(view, force), thread=True, group=f"yt-{view}", exclusive=True)

    def _fetch(self, view: str, force: bool) -> None:
        api = self.app.api
        try:
            if force and view == "latest":
                api.post("/refresh?scope=youtube")
            if view == "latest":
                d = api.get("/feed/youtube", timeout=60)
                items, stale = d.get("items") or [], d.get("stale")
            elif view == "live":
                d = api.get("/youtube/live", timeout=60)
                items, stale = d.get("items") or [], d.get("stale")
            elif view == "continue":
                items, stale = (api.get("/youtube/continue") or {}).get("items") or [], False
            elif view == "history":
                rows = (api.get("/history", platform="youtube") or {}).get("items") or []
                items, stale = [history_item(h) for h in rows], False
            elif view == "search":
                d = api.get("/youtube/search", q=self.search_query, timeout=30)
                items, stale = d.get("items") or [], d.get("stale")
            else:
                return
            self.app.call_from_thread(self._got, view, items, bool(stale), None)
        except ApiError as e:
            self.app.call_from_thread(self._got, view, None, False, str(e))

    def _got(self, view: str, items: list | None, stale: bool, error: str | None) -> None:
        self.busy.discard(view)
        if error:
            self.errors[view] = error
            if not self.data.get(view):
                self.list.empty = [f"{self.app.glyphs.error} {error}", "r  try again"]
            self.app.say(error, "error")
        else:
            self.errors.pop(view, None)
            self.data[view] = items or []
            self.stale[view] = stale
            if view == "live":
                self.app.set_live(sum(1 for i in items or [] if (i.get("extra") or {}).get("live_status") == "is_live"))
        if view == self.view:
            self._show()
        self._show_index()
        self._paint_winbar()
        self.app.refresh_chrome()

    def _channel_id(self, item: dict) -> str:
        return (item.get("extra") or {}).get("channel_id") or item.get("source") or ""

    def is_new(self, item: dict) -> bool:
        return self.app.state.upload_is_new(item, played=self.app.player.fraction(item.get("id") or "") is not None)

    def _show(self) -> None:
        view = self.view
        items = list(self.data.get(view) or [])
        rows: list = []
        if view == "latest":
            if self.channel:
                items = [i for i in items if self._channel_id(i) == self.channel]
            if self.hide_watched:
                items = [i for i in items if (self.app.player.fraction(i["id"]) or 0) < COMPLETE]
            groups: dict[str, list] = {}
            for it in sorted(items, key=lambda i: -float(i.get("published_at") or 0)):
                groups.setdefault(fmt.day_label(it.get("published_at")), []).append(it)
            for label, its in groups.items():
                rows.append(Head(label, len(its)))
                rows += its
            empty = ["No uploads from your channels in this feed.", "a  add a channel (in the web UI for now)"]
            if self.hide_watched:
                empty = ["Everything here is watched.", "Space t w  show watched videos"]
        elif view == "live":
            now_live = [i for i in items if (i.get("extra") or {}).get("live_status") == "is_live"]
            upcoming = sorted([i for i in items if i not in now_live],
                              key=lambda i: float((i.get("extra") or {}).get("scheduled_at") or 0))
            if now_live:
                rows += [Head("Live now", len(now_live)), *now_live]
            if upcoming:
                rows += [Head("Coming up", len(upcoming)), *upcoming]
            empty = ["None of your channels is live or has a stream planned."]
        elif view == "history":
            groups = {}
            for it in items:
                groups.setdefault(fmt.day_label(it.get("published_at")), []).append(it)
            for label, its in groups.items():
                rows.append(Head(label, len(its)))
                rows += its
            empty = ["Nothing watched yet."]
        elif view == "search":
            rows = [Head(f"“{self.search_query}”", len(items)), *items] if items else []
            empty = [f"No results for “{self.search_query}”."]
        else:
            rows = items
            empty = ["Nothing half-watched."]
        self.list.empty = empty
        self.list.set_rows(rows)
        self._paint_winbar()
        self.app.state_changed()

    def _paint_winbar(self) -> None:
        wb = self.winbar
        wb.views = []
        for v, label in self.VIEWS:
            if not self.view_available(v):
                continue
            n = None
            if v == "live":
                n = sum(1 for i in self.data.get("live") or []
                        if (i.get("extra") or {}).get("live_status") == "is_live") or None
            elif v == "continue":
                n = len(self.data.get("continue") or []) or None
            wb.views.append((v, label, n))
        wb.current = self.view
        wb.busy = self.view in self.busy
        bits = []
        if self.view == "latest":
            if self.channel:
                bits.append(next((i.get("source") for i in self.data.get("latest") or []
                                  if self._channel_id(i) == self.channel), "one channel"))
            else:
                bits.append("all channels")
            if self.hide_watched:
                bits.append("hiding watched")
        if self.stale.get(self.view):
            bits.append("cached")
        wb.right = f" {self.app.glyphs.dot} ".join(bits)
        wb.refresh()

    def _show_index(self) -> None:
        feed = self.data.get("latest") or []
        news = Counter(self._channel_id(i) for i in feed if self.is_new(i))
        names: dict[str, str] = {}
        for i in feed:
            names.setdefault(self._channel_id(i), i.get("source") or "")
        rows: list = [Head("Views")]
        for v, label in self.VIEWS:
            if not self.view_available(v):
                continue
            n = len(self.data.get(v) or []) if v in self.data else None
            rows.append({"id": f"view:{v}", "title": label, "_n": n, "_view": v})
        busiest = sorted(names, key=lambda c: (-news.get(c, 0), names[c].lower()))
        rows.append(Head("Channels", len(names)))
        rows.append({"id": "chan:", "title": "All channels", "_n": len(feed), "_chan": ""})
        for c in busiest:
            rows.append({"id": f"chan:{c}", "title": names[c], "_n": news.get(c) or None, "_chan": c})
        self.index.set_rows(rows, keep=f"chan:{self.channel}" if self.channel else f"view:{self.view}")

    # ── rows ─────────────────────────────────────────────────────────────────

    def _index_row(self, row: dict) -> RowParts:
        on = (row.get("_view") == self.view and not self.channel) or \
             ("_chan" in row and row["_chan"] == (self.channel or "") and self.view == "latest" and self.channel)
        n = row.get("_n")
        name = fmt.clean(row["title"])
        # a channel in its own colour, as in the list; the views in the room's
        role = who(name) if row.get("_chan") else "fg"
        return RowParts(sign=("•" if on else " ", "mark:red"),
                        title=[(name, role + ("+bold" if on else ""))],
                        figure=[(str(n), "hue:red" if row.get("_chan") else "dim")] if n else [])

    def _row(self, item: dict) -> RowParts:
        g = self.app.glyphs
        extra = item.get("extra") or {}
        iid = item.get("id") or ""
        frac = self.app.player.fraction(iid)
        live = extra.get("live_status")
        title = fmt.clean(item.get("title"))
        src = fmt.clean(item.get("source") or item.get("author") or "")
        meta = [(src, who(src))]
        figure: list = []
        if live == "is_live":
            sign = (g.live, "mark:red")
            figure = [("LIVE", "hue:red+bold")]
        elif live == "is_upcoming":
            sign = (g.upcoming, "mark:yellow")
            figure = [(fmt.until(extra.get("scheduled_at")), "hue:yellow")]
            when = extra.get("scheduled_at")
            if when:
                meta.append((f" {g.dot} {fmt.day_label(when).lower()} {fmt.clock(when)}", "dim"))
        else:
            if frac is not None and frac >= COMPLETE:
                sign = (g.watched, "faint")
            elif frac is not None:
                sign = (g.partial(frac), "mark:red")
            elif self.view in ("latest",) and self.is_new(item):
                sign = (g.new, "mark:red")
            else:
                sign = (" ", "fg")
            dur = extra.get("length_seconds") or self.app.player.duration(iid)
            if dur:
                figure = [(fmt.duration(dur), "dim")]
            when = item.get("published_at")
            if when:
                label = fmt.ago(when)
                if self.view == "history":
                    label = f"watched {fmt.clock(when)}" if fmt.day_label(when) == "Today" else f"watched {label} ago"
                    n = extra.get("watch_count") or 0
                    if n > 1:
                        label += f" {g.dot} {n}×"
                meta.append((f" {g.dot} {label}", "dim"))
            if frac is not None and frac < COMPLETE:
                p = self.app.player.progress.get(iid) or {}
                left = float(p.get("duration") or 0) - float(p.get("position") or 0)
                meta.append((f" {g.dot} {fmt.duration(left)} left", "dim"))
        mark: list = []
        if iid in self.app.saved:
            mark.append((g.saved, "mark:blue"))
        q = self.app.queue_position(iid)
        if q:
            mark.append((f" {g.queued}{q}", "dim"))
        return RowParts(sign=sign, title=[(title, "fg")], figure=figure, meta=meta, mark=mark)

    # ── the preview ──────────────────────────────────────────────────────────

    def on_item_list_moved(self, event: ItemList.Moved) -> None:
        if event.list is self.list:
            self.details = None
            self._preview(event.item)
            self.app.refresh_chrome()

    def _preview(self, item: dict | None) -> None:
        if not self.preview.display:
            return
        if not item:
            self.preview.blank()
            return
        r, g = self.app.roles, self.app.glyphs
        extra = item.get("extra") or {}
        iid = item.get("id") or ""
        t = Text()
        t.append(fmt.clean(item.get("title")) + "\n", style(r, "fg+bold"))
        src = fmt.clean(item.get("source") or "")
        when = item.get("published_at")
        t.append(src, style(r, who(src, "+bold")))
        if when:
            word = "watched " if self.view == "history" else ""
            t.append(f" {g.dot} {word}{fmt.ago_long(when)}", style(r, "dim"))
        t.append("\n")
        live = extra.get("live_status")
        if live == "is_live":
            t.append(f"{g.live} LIVE now\n", style(r, "hue:red+bold"))
        elif live == "is_upcoming" and extra.get("scheduled_at"):
            at = extra["scheduled_at"]
            t.append(f"{g.upcoming} {fmt.until(at)} {g.dot} {fmt.day_label(at)} {fmt.clock(at)}\n",
                     style(r, "hue:yellow"))
        p = self.app.player.progress.get(iid)
        if p and p.get("duration") and not self.app.player.duration(iid):
            t.append("Marked watched\n", style(r, "dim"))
        elif p and p.get("duration"):
            pos, dur = float(p["position"]), float(p["duration"])
            width = max(10, self.preview.size.width - 2 - 14)
            t.append_text(bar(r, g, pos, dur, width))
            t.append("\n")
            frac = pos / dur
            if frac < COMPLETE:
                t.append(f"{fmt.duration(dur - pos)} left {g.dot} resumes at {fmt.duration(max(0, pos - 2))}\n",
                         style(r, "dim"))
            else:
                t.append("Watched\n", style(r, "dim"))
        d = self.details
        if d:
            stats = []
            if d.get("view_count"):
                stats.append(f"{fmt.compact(d['view_count'])} views")
            if d.get("like_count"):
                stats.append(f"{fmt.compact(d['like_count'])} likes")
            if d.get("channel_followers"):
                stats.append(f"{fmt.compact(d['channel_followers'])} subscribers")
            if stats:
                t.append(f" {g.dot} ".join(stats) + "\n", style(r, "dim"))
        t.append("\n")
        desc = (d or {}).get("description") if d else extra.get("description")
        if desc:
            lines = [ln.rstrip() for ln in str(desc).strip().splitlines()]
            keep = 40 if d else 10
            text = "\n".join(lines[:keep])
            t.append(text + "\n", style(r, "fg"))
        if d and d.get("chapters"):
            t.append("\nChapters\n", style(r, "fg+bold"))
            for c in d["chapters"][:30]:
                t.append(f"  {fmt.duration(c.get('start')):>7}  ", style(r, "dim"))
                t.append(fmt.clean(c.get("title")) + "\n", style(r, "fg"))
        if not d:
            t.append("\nK  more about this video", style(r, "faint"))
        initial = (src[:1] or "▶").upper()
        self.preview.show(t, initial, youtube_thumb(item))

    # ── actions ──────────────────────────────────────────────────────────────

    def binds(self) -> list[Bind]:
        return [
            Bind(("enter",), "play", "play"), Bind(("p",), "play", "play"), Bind(("l",), "right", "play / open"),
            Bind(("a",), "enqueue", "add to the queue"), Bind(("s",), "save", "save / unsave"),
            Bind(("u",), "undo", "undo"), Bind(("x",), "seen", "mark the channel seen"),
            Bind(("d", "d"), "remove", "remove from History"), Bind(("R",), "force_refresh", "fetch everything again"),
            Bind(("space", "t", "w"), "toggle_watched", "hide watched videos"),
        ]

    def active_list(self) -> ItemList:
        return self.index if self.focus_pane == "index" else self.list

    def selected(self) -> dict | None:
        return self.list.selected

    def item_of(self, row: dict) -> dict | None:
        return row if self.focus_pane == "list" else None

    def playable_of(self, row: dict) -> dict | None:
        return row if self.focus_pane == "list" else None

    def handle_many(self, action: str, rows: list[dict]) -> bool:
        app = self.app
        if self.focus_pane != "list":
            return False
        if action == "remove":
            if self.view != "history":
                app.say("d removes videos from History; switch to History with Tab.", "warn")
            else:
                self.run_worker(lambda: self._remove_history(rows), thread=True)
            return True
        if action == "seen":
            chans = list(dict.fromkeys(self._channel_id(i) for i in rows))
            for c in chans:
                app.state.mark_seen(f"yt:{c}")
            app.state.save()
            self.list.repaint()
            self._show_index()
            app.say(f"{len(chans)} channel{'s' if len(chans) != 1 else ''} marked seen.")
            return True
        return False

    def crumbs(self) -> list[str]:
        label = dict(self.VIEWS).get(self.view, "")
        if self.view == "latest" and self.channel:
            name = next((i.get("source") for i in self.data.get("latest") or [] if self._channel_id(i) == self.channel), "")
            label = f"Latest › {name}"
        out = [label]
        sel = self.list.selected
        if sel and self.view in ("latest", "history"):
            out.append(fmt.day_label(sel.get("published_at")))
        return out

    def web_route(self) -> str:
        sel = self.list.selected
        vid = item_video_id(sel) if sel else None
        if vid and self.focus_pane == "list":
            return f"/youtube/open?v={vid}"
        return {"latest": "/youtube?v=latest", "live": "/youtube?v=live", "history": "/youtube/history",
                "search": f"/youtube?q={self.search_query}"}.get(self.view, "/youtube")

    search_command = "yt"

    def search_platform(self, query: str) -> None:
        self.search_query = query.strip()
        if self.search_query:
            self.data.pop("search", None)
            self.set_view("search")

    def handle(self, action: str, count: int | None) -> bool:
        app = self.app
        item = self.list.selected
        if action in ("left",):
            if self.index.display and self.focus_pane == "list":
                self.focus_pane = "index"
                self._mark_focus()
                app.refresh_chrome()
                return True
            return False
        if action == "right":
            if self.focus_pane == "index":
                self._pick_index()
                return True
            action = "play"
        if action == "play":
            if self.focus_pane == "index":
                self._pick_index()
            elif item:
                app.play(item)
            return True
        if action == "enqueue" and item:
            n = app.player.enqueue(item)
            app.say(f"Added to the queue ({n}).")
            self.list.repaint()
            return True
        if action == "save" and item:
            app.toggle_saved(item)
            return True
        if action == "undo":
            app.undo()
            return True
        if action == "seen" and item:
            app.state.mark_seen(f"yt:{self._channel_id(item)}")
            app.state.save()
            self.list.repaint()
            self._show_index()
            app.say(f"{fmt.clean(item.get('source'))}: marked seen.")
            return True
        if action == "remove":
            if self.view != "history" or not item:
                app.say("dd removes a video from History; switch to History with Tab.", "warn")
                return True
            self.run_worker(lambda: self._remove_history([item]), thread=True)
            return True
        if action == "toggle_watched":
            self.hide_watched = not self.hide_watched
            app.state.view(self.room.id)["hide_watched"] = self.hide_watched
            app.state.save()
            self._show()
            app.say("Watched videos hidden." if self.hide_watched else "Watched videos shown.")
            return True
        if action == "force_refresh":
            self.reload(force=True)
            return True
        if action == "details" and item:
            vid = item_video_id(item)
            if vid:
                app.say("Fetching the details…")
                self.run_worker(lambda: self._details(item, vid), thread=True, group="yt-details", exclusive=True)
            return True
        return False

    def _pick_index(self) -> None:
        row = self.index.selected or {}
        if "_view" in row:
            self.channel = None
            self.set_view(row["_view"])
        elif "_chan" in row:
            self.channel = row["_chan"] or None
            if self.view != "latest":
                self.set_view("latest")
            else:
                self._show()
        self.focus_pane = "list"
        self._mark_focus()
        self._show_index()
        self.app.refresh_chrome()

    def _details(self, item: dict, vid: str) -> None:
        try:
            d = self.app.api.get(f"/youtube/video/{seg(vid)}", timeout=60)
        except ApiError as e:
            self.app.call_from_thread(self.app.say, str(e), "error")
            return

        def show():
            if self.list.selected is item:
                self.details = d
                self._preview(item)
                self.app.say("")
        self.app.call_from_thread(show)

    def _remove_history(self, items: list[dict]) -> None:
        gone: set[str] = set()
        problem = None
        for item in items:
            try:
                self.app.api.delete("/history", item_id=item["id"])
                gone.add(item["id"])
            except ApiError as e:
                problem = str(e)
                break

        def done():
            self.data["history"] = [i for i in self.data.get("history") or [] if i["id"] not in gone]
            self._show()
            if problem:
                self.app.say(problem, "error")
            else:
                self.app.say("Removed from History." if len(gone) == 1 else f"Removed {len(gone)} from History.")
        self.app.call_from_thread(done)

    def refresh_rows(self) -> None:
        self.list.repaint()
        self._preview(self.list.selected)


def bar(roles, glyphs, pos: float, dur: float, width: int) -> Text:
    """12:03 ━━━━━━━━━╸──────── 41:10"""
    t = Text(no_wrap=True)
    t.append(f"{fmt.duration(pos)} ", style(roles, "fg"))
    frac = 0 if not dur else max(0.0, min(1.0, pos / dur))
    cells = frac * width
    full = int(cells)
    half = 1 if cells - full >= 0.5 and full < width else 0
    t.append(glyphs.bar_on * full + glyphs.bar_half * half, style(roles, "mark:red"))
    t.append(glyphs.bar_off * (width - full - half), style(roles, "rule"))
    t.append(f" {fmt.duration(dur)}", style(roles, "dim"))
    return t
