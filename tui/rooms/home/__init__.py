"""Home: what to watch now, before where to go.

    Late night. 3 new uploads, 2 episodes to watch, 1 stream live, and paper No 312 is in.

    [ the set's screen ]   Pick up where you left off: the tuned item, where you are, ⏎
    Up next ─────── 6      Coming up ─────── 5
    Channels: a line each for Social, Coding and Video

Up next is the web's pick-up queue (frontend/src/components/home/lineup.js): half-
watched videos and the next episode of what you're watching, most recently touched
first, topped up with fresh uploads. j/k tune the screen; Enter plays. Coming up is
what's live, premieres, and the next airing of your shows (l moves there).

Each part loads on its own from reads the rooms already make, so a slow AniList never
holds up the videos. Home belongs to no module; it only asks for what's installed.
"""

from __future__ import annotations

import time

from rich.text import Text
from textual.containers import Horizontal, Vertical
from textual.widgets import Static

from ... import fmt
from ...anime import ACTIVE, watch_state
from ...api import ApiError
from ...images import youtube_thumb
from ...keys import Bind
from ...media.player import COMPLETE
from ...ui.itemlist import Head, ItemList, RowParts
from ...ui.paint import style
from ...ui.picture import Well
from ...ui.preview import well_size
from ..base import RoomView

PICKUP_MAX = 6
AHEAD = 8 * 86400


def open_files(session) -> list[str]:
    """The files left open in the Composing Room (its saved session's panes)."""
    files: list[str] = []
    panes = session.get("panes") if isinstance(session, dict) else None
    for pane in panes or []:
        for f in pane.get("tabs") or []:
            if f not in files:
                files.append(f)
    return files


def greeting(now: float | None = None) -> str:
    h = time.localtime(now or time.time()).tm_hour
    if h >= 23 or h < 5:
        return "Late night"
    if h < 12:
        return "Good morning"
    if h < 18:
        return "Good afternoon"
    return "Good evening"


class Home(RoomView):
    DEFAULT_CSS = """
    Home { layout: vertical; padding: 1 2 0 2; }
    Home #hello { height: auto; margin-bottom: 1; }
    Home #set { height: auto; margin-bottom: 1; }
    Home #tuned { width: 1fr; height: auto; padding: 0 0 0 3; }
    Home #lists { height: 1fr; }
    Home #lists > ItemList { width: 1fr; }
    Home #channels { height: auto; margin-top: 1; }
    """

    def __init__(self, room, **kw):
        super().__init__(room, **kw)
        app = self.app
        r, g = app.roles, app.glyphs
        self.data: dict = {}
        self.hello = Static("", id="hello")
        self.screen_well = Well(r, g, backend=app.image_backend)
        self.tuned = Static("", id="tuned")
        self.upnext = ItemList(self._pick_row, roles=r, glyphs=g, hue="blue", lines_per_item=1, divider=False,
                               id="upnext", empty=["Looking for what you were watching…"])
        self.coming = ItemList(self._coming_row, roles=r, glyphs=g, hue="yellow", lines_per_item=1, divider=False,
                               id="coming", empty=["Nothing live or airing soon."])
        self.channels_line = Static("", id="channels")
        self.focus_pane = "upnext"
        self.coming.active = False

    def compose(self):
        yield self.hello
        with Horizontal(id="set"):
            yield self.screen_well
            yield self.tuned
        with Horizontal(id="lists"):
            yield self.upnext
            yield self.coming
        yield self.channels_line

    def on_mount(self) -> None:
        self._layout()

    def on_resize(self) -> None:
        self._layout()

    def _layout(self) -> None:
        w = self.size.width or self.app.size.width
        h = self.app.size.height
        cols, rows = well_size(min(44, max(24, w // 3)), 16 / 9, self.app.term.cell_px)
        self.screen_well.set_size(cols, rows)
        self.screen_well.display = h >= 28
        self.coming.display = w >= 100
        if not self.coming.display and self.focus_pane == "coming":
            self.focus_pane = "upnext"

    # ── data: each part on its own ───────────────────────────────────────────

    def reload(self, force: bool = False) -> None:
        reg = self.app.registry
        jobs = {}
        if reg and reg.has("youtube"):
            jobs["continue"] = lambda: (self.app.api.get("/youtube/continue") or {}).get("items") or []
            jobs["feed"] = lambda: (self.app.api.get("/feed/youtube", timeout=60) or {}).get("items") or []
            jobs["live"] = lambda: (self.app.api.get("/youtube/live", timeout=60) or {}).get("items") or []
        if reg and reg.has("anime"):
            def anime():
                self.app.anime.load(force=force)
                return self.app.anime.entries or []
            jobs["anime"] = anime
        if reg and reg.has("edition"):
            jobs["edition"] = lambda: self.app.api.get("/edition/latest") or {}
        if reg and reg.has("editor"):
            jobs["editor"] = lambda: (self.app.api.get("/editor/state") or {}).get("session") or {}
        if reg and reg.has("github"):
            jobs["github"] = lambda: self.app.api.get("/github/inbox/count") or {}
        for name, job in jobs.items():
            self.run_worker(lambda name=name, job=job: self._fetch(name, job), thread=True, group=f"home-{name}")
        self._paint()

    def _fetch(self, name: str, job) -> None:
        try:
            value = job()
        except ApiError:
            value = None
        self.app.call_from_thread(self._got, name, value)

    def _got(self, name: str, value) -> None:
        self.data[name] = value
        self._paint()

    def activate(self) -> None:
        if not self.loaded or time.time() - getattr(self, "_loaded_at", 0) > 120:
            self.loaded = True
            self._loaded_at = time.time()
            self.reload()
        else:
            self._paint()

    # ── the line-up ──────────────────────────────────────────────────────────

    def _new(self, item: dict) -> bool:
        return self.app.state.upload_is_new(item, played=self.app.player.fraction(item.get("id") or "") is not None)

    def pickup(self) -> list[dict]:
        progress = self.app.player.progress
        out = []
        for item in self.data.get("continue") or []:
            p = progress.get(item["id"])
            if p and p.get("duration") and p["position"] / p["duration"] >= COMPLETE:
                continue
            out.append({"kind": "video", "id": item["id"], "item": item,
                        "at": (item.get("extra") or {}).get("watched_at") or 0})
        for e in self.data.get("anime") or []:
            if e.get("status") not in ACTIVE:
                continue
            w = watch_state(e["media"], e, progress)
            if w["can_play"]:
                out.append({"kind": "anime", "id": f"anime:{e['media']['id']}", "m": e["media"], "w": w,
                            "at": e.get("updated_at") or 0})
        out.sort(key=lambda x: -x["at"])
        picked = out[:PICKUP_MAX]
        if len(picked) < PICKUP_MAX:
            have = {x["id"] for x in picked}
            feed = [i for i in self.data.get("feed") or [] if not (i.get("extra") or {}).get("live_status")
                    and i["id"] not in have]
            fresh = [i for i in feed if self._new(i)] + \
                    [i for i in feed if not self._new(i) and self.app.player.fraction(i["id"]) is None]
            for item in fresh:
                if len(picked) >= PICKUP_MAX:
                    break
                if item["id"] in have:
                    continue
                have.add(item["id"])
                picked.append({"kind": "fresh", "id": item["id"], "item": item, "new": self._new(item),
                               "at": item.get("published_at") or 0})
        return picked

    def coming_up(self) -> list[dict]:
        now = time.time()
        rows = []
        for item in self.data.get("live") or []:
            extra = item.get("extra") or {}
            if extra.get("live_status") == "is_live":
                rows.append({"kind": "live", "id": item["id"], "at": now - 1, "item": item})
            elif extra.get("live_status") == "is_upcoming" and now < (extra.get("scheduled_at") or 0) < now + AHEAD:
                rows.append({"kind": "stream", "id": item["id"], "at": extra["scheduled_at"], "item": item})
        for e in self.data.get("anime") or []:
            m = e["media"]
            at = m.get("next_airing_at") or 0
            if not (now < at < now + AHEAD):
                continue
            if e.get("status") in ACTIVE or (e.get("status") == "PLANNING" and m.get("next_episode") == 1):
                rows.append({"kind": "premiere" if m.get("next_episode") == 1 else "episode",
                             "id": f"anime:{m['id']}", "at": at, "m": m})
        rows.sort(key=lambda x: x["at"])
        return rows

    # ── rows ─────────────────────────────────────────────────────────────────

    def _pick_row(self, x: dict) -> RowParts:
        g = self.app.glyphs
        n = next((i for i, it in enumerate(self.upnext.items, 1) if it is x), 0)
        number = (f"{n} ", "faint")
        if x["kind"] == "anime":
            m, w = x["m"], x["w"]
            total = f" of {w['total']}" if w["total"] else ""
            title = [number, (fmt.clean(m.get("title")), "fg"), (f" {g.dot} ep {w['next_n']}{total}", "dim")]
            if w["resume_at"] is not None:
                return RowParts(sign=(g.partial(w["resume_at"] / max(1, w["resume_at"] + w["remaining_of_next"])), "mark:blue"),
                                title=title, figure=[(f"{fmt.duration(w['remaining_of_next'])} left", "dim")])
            return RowParts(sign=(g.new, "mark:blue"), title=title, figure=[(f"{w['left']} to watch", "dim")])
        item = x["item"]
        p = self.app.player.progress.get(item["id"]) or {}
        title = [number, (fmt.clean(item.get("title")), "fg")]
        if p.get("duration") and p.get("position"):
            frac = p["position"] / p["duration"]
            return RowParts(sign=(g.partial(frac), "mark:red"), title=title,
                            figure=[(f"{fmt.duration(p['duration'] - p['position'])} left", "dim")])
        label = f"new {g.dot} {fmt.ago(item.get('published_at'))}" if x.get("new") else fmt.ago(item.get("published_at"))
        return RowParts(sign=(g.new if x.get("new") else " ", "mark:red"), title=title, figure=[(label, "dim")])

    def _coming_row(self, x: dict) -> RowParts:
        g = self.app.glyphs
        if x["kind"] == "live":
            item = x["item"]
            return RowParts(sign=(g.live, "mark:red"), title=[("LIVE  ", "hue:red+bold"),
                            (fmt.clean(item.get("source")), "fg"), (f" {g.dot} {fmt.clean(item.get('title'))}", "dim")])
        when = fmt.slot(x["at"])
        if x["kind"] == "stream":
            item = x["item"]
            return RowParts(sign=(g.upcoming, "mark:yellow"), title=[(f"{when:<11}", "hue:yellow"),
                            (fmt.clean(item.get("source")), "fg"), (f" {g.dot} premiere", "dim")])
        m = x["m"]
        what = "premiere" if x["kind"] == "premiere" else f"ep {m.get('next_episode')}"
        return RowParts(sign=(g.upcoming, "mark:blue"), title=[(f"{when:<11}", "hue:yellow"),
                        (fmt.clean(m.get("title")), "fg"), (f" {g.dot} {what}", "dim")])

    # ── painting ─────────────────────────────────────────────────────────────

    def _paint(self) -> None:
        keep = (self.upnext.selected or {}).get("id")
        picks = self.pickup()
        self.upnext.set_rows([Head("Up next", len(picks)), *picks] if picks else [], keep=keep)
        if not picks and all(k in self.data for k in ("continue", "feed")):
            self.upnext.empty = ["Nothing half-watched and nothing new.", "g y  the Screening Room"]
        coming = self.coming_up()
        self.coming.set_rows([Head("Coming up", len(coming)), *coming] if coming else [])
        self._paint_hello()
        self._paint_channels()
        self._tune(self.upnext.selected)

    def _counts(self) -> dict:
        progress = self.app.player.progress
        feed = self.data.get("feed") or []
        new = sum(1 for i in feed if not (i.get("extra") or {}).get("live_status") and self._new(i))
        eps = shows = airing_week = 0
        now = time.time()
        for e in self.data.get("anime") or []:
            if e.get("status") not in ACTIVE:
                continue
            m = e["media"]
            if m.get("status") == "RELEASING":
                w = watch_state(m, e, progress)
                if w["left"] > 0:
                    eps += w["left"]
                    shows += 1
            if now < (m.get("next_airing_at") or 0) < now + 7 * 86400:
                airing_week += 1
        live = sum(1 for i in self.data.get("live") or [] if (i.get("extra") or {}).get("live_status") == "is_live")
        return {"new": new, "eps": eps, "shows": shows, "live": live, "airing_week": airing_week}

    def _paint_hello(self) -> None:
        r = self.app.roles
        c = self._counts()
        bits = []
        if c["new"]:
            bits.append(f"{c['new']} new upload{'s' if c['new'] != 1 else ''}")
        if c["eps"]:
            bits.append(f"{c['eps']} episode{'s' if c['eps'] != 1 else ''} to watch")
        if c["live"]:
            bits.append(f"{c['live']} stream{'s' if c['live'] != 1 else ''} live")
        paper = self.data.get("edition") or {}
        if paper.get("issue"):
            bits.append(f"paper No {paper['issue']} is in")
        t = Text()
        t.append(greeting() + ".", style(r, "fg+bold"))
        if bits:
            sentence = ", ".join(bits[:-1]) + (" and " if len(bits) > 1 else "") + bits[-1]
            t.append(" " + sentence[0].upper() + sentence[1:] + ".", style(r, "fg"))
        elif self.data:
            t.append(" Nothing new since you last looked.", style(r, "dim"))
        self.hello.update(t)

    def _paint_channels(self) -> None:
        r, g = self.app.roles, self.app.glyphs
        reg = self.app.registry
        if not reg:
            return
        c = self._counts()
        t = Text()
        rule = g.rule_h * max(4, (self.size.width or 100) - 16)
        t.append("Channels ", style(r, "fg+bold"))
        t.append(rule + "\n", style(r, "rule"))
        for n, (cid, label, _rooms) in enumerate(reg.channels(), 1):
            bits = []
            if cid == "social":
                paper = self.data.get("edition") or {}
                if paper.get("issue"):
                    stories = len(paper.get("columns") or []) + (1 if paper.get("lede") else 0) + len(paper.get("briefs") or [])
                    bits.append(f"Paper No {paper['issue']} {g.dot} {stories} stories")
            elif cid == "coding":
                files = open_files(self.data.get("editor"))
                if files:
                    bits.append(f"{len(files)} file{'s' if len(files) != 1 else ''} open in the editor")
                unread = (self.data.get("github") or {}).get("unread")
                if unread:
                    bits.append(f"{unread} GitHub notification{'s' if unread != 1 else ''}")
            elif cid == "video":
                if c["new"]:
                    bits.append(f"{c['new']} new upload{'s' if c['new'] != 1 else ''}")
                if c["airing_week"]:
                    bits.append(f"{c['airing_week']} show{'s' if c['airing_week'] != 1 else ''} on your list air this week")
            t.append(f"  {n} ", style(r, "faint"))
            t.append(f"{label:<8}", style(r, "fg+bold"))
            t.append(f" {g.dot} ".join(bits) if bits else "", style(r, "dim"))
            t.append("\n")
        self.channels_line.update(t)

    def _tune(self, x: dict | None) -> None:
        """The screen and the panel beside it follow the selected preset."""
        r, g = self.app.roles, self.app.glyphs
        if not x:
            self.screen_well.show(None, "")
            self.tuned.update(Text("Pick up where you left off", style(r, "dim")))
            return
        t = Text()
        t.append("Pick up where you left off\n", style(r, "dim"))
        if x["kind"] == "anime":
            m, w = x["m"], x["w"]
            t.append(fmt.clean(m.get("title")) + "\n", style(r, "fg+bold"))
            line = f"Episode {w['next_n']}" + (f" of {w['total']}" if w["total"] else "")
            if w["resume_at"] is not None:
                line += f" {g.dot} {fmt.duration(w['resume_at'])} in {g.dot} {fmt.duration(w['remaining_of_next'])} left"
            t.append(line + "\n\n", style(r, "fg"))
            from ...ui.tape import tape
            p = self.app.player.progress.get(f"anime:{m['id']}:{w['next_n']}") or {}
            partial = p["position"] / p["duration"] if w["resume_at"] is not None and p.get("duration") else None
            bar, ruler = tape(r, g, watched=w["watched"], aired=w["aired"], total=w["total"], next_n=w["next_n"],
                              partial=partial, width=max(10, min(60, (self.size.width or 100) - self.screen_well.cols - 12)))
            t.append_text(bar)
            t.append("\n")
            t.append_text(ruler)
            t.append(f"\n{w['watched']} watched {g.dot} {w['aired']} aired\n\n", style(r, "dim"))
            t.append("⏎", style(r, "hue:yellow+bold"))
            t.append(f"  {'resume' if w['resume_at'] is not None else 'play'} episode {w['next_n']}", style(r, "fg"))
            t.append("   K", style(r, "hue:yellow+bold"))
            t.append("  title page", style(r, "fg"))
            self.screen_well.show(m.get("banner") or m.get("cover_xl") or m.get("cover"), (m.get("title") or "?")[:1])
        else:
            item = x["item"]
            p = self.app.player.progress.get(item["id"]) or {}
            t.append(fmt.clean(item.get("title")) + "\n", style(r, "fg+bold"))
            when = fmt.ago_long(item.get("published_at"))
            t.append(fmt.clean(item.get("source")) + (f" {g.dot} {when}" if when else "") + "\n\n", style(r, "dim"))
            if p.get("duration") and p.get("position"):
                t.append(f"{fmt.duration(p['position'])} of {fmt.duration(p['duration'])} {g.dot} "
                         f"{fmt.duration(p['duration'] - p['position'])} left\n\n", style(r, "fg"))
                verb = f"resume at {fmt.duration(max(0, p['position'] - 2))}"
            else:
                verb = "play"
            t.append("⏎", style(r, "hue:yellow+bold"))
            t.append(f"  {verb}", style(r, "fg"))
            self.screen_well.show(youtube_thumb(item), (item.get("source") or "?")[:1])
        self.tuned.update(t)

    def on_item_list_moved(self, event: ItemList.Moved) -> None:
        if event.list is self.upnext:
            self._tune(event.item if isinstance(event.item, dict) else None)
        self.app.refresh_chrome()

    # ── keys ─────────────────────────────────────────────────────────────────

    def binds(self) -> list[Bind]:
        return [Bind(("enter",), "play", "play"), Bind(("p",), "play", "play"),
                Bind(("K",), "details", "the title page / details")]

    def active_list(self) -> ItemList:
        return self.coming if self.focus_pane == "coming" else self.upnext

    def selected(self) -> dict | None:
        x = self.active_list().selected
        return self.item_of(x) if x else None

    def item_of(self, row: dict) -> dict | None:
        return row.get("item") or {"url": f"https://anilist.co/anime/{row['m']['id']}", "id": row["id"]}

    def playable_of(self, row: dict) -> dict | None:
        return row.get("item") if self.focus_pane == "upnext" else None

    def crumbs(self) -> list[str]:
        return ["Home", "Coming up" if self.focus_pane == "coming" else "Up next"]

    def web_route(self) -> str:
        return "/"

    def _mark_focus(self) -> None:
        self.upnext.active = self.focus_pane == "upnext"
        self.coming.active = self.focus_pane == "coming"
        self.upnext.repaint()
        self.coming.repaint()

    def handle(self, action: str, count: int | None) -> bool:
        app = self.app
        if action in ("left", "right"):
            if self.coming.display:
                self.focus_pane = "coming" if action == "right" else "upnext"
                self._mark_focus()
            return True
        x = self.active_list().selected
        if action == "play" and x:
            if x["kind"] == "anime":
                app.anime.play(x["m"], x["w"]["next_n"])
            elif x["kind"] in ("video", "fresh", "live"):
                app.play(x["item"])
            elif x["kind"] == "stream":
                app.say(f"It starts {fmt.until(x['at'])}.")
            else:
                self._open_title(x["m"])
            return True
        if action == "details" and x:
            if x.get("m"):
                self._open_title(x["m"])
            else:
                app.go_room("youtube")
            return True
        return False

    def _open_title(self, m: dict) -> None:
        app = self.app
        if not (app.registry and app.registry.has("anime")):
            return
        app.in_room("anime", lambda room: room.open_title(m))

    def refresh_rows(self) -> None:
        self._paint()


SCREEN = Home
