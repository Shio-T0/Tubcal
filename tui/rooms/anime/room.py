"""The Anime in the terminal: your AniList list by shelf, and a title page to watch from.

Views (Tab / S-Tab) are the shelves: Watching (rewatches included), Planning,
Completed, Paused, Dropped. Each row says where you are: the next episode, how far
into it you got, what's left, or when the next one airs. The preview (≥90 columns)
has the cover, the facts and the episode tape.

Enter opens the title page: the cover, where you are with the tape, and the episodes,
one line each (titles past your next episode are veiled; `Space t s` shows them).
Episodes play in mpv with subtitles, the skip-opening cue and the next episode after
it; finishing one moves your place on (the server marks it on AniList at 80 %).

The rest of the Anime (Browse, Seasons, the Ledger, the forum, profiles…) opens in the
web UI with `O`.
"""

from __future__ import annotations

import re
import time

from rich.text import Text
from textual.containers import Horizontal, Vertical
from textual.widgets import Static

from ... import fmt
from ...anime import ACTIVE, COMPLETE, anime_item, watch_state
from ...api import ApiError
from ...keys import Bind
from ...ui.chrome import Winbar
from ...ui.itemlist import Head, ItemList, RowParts
from ...ui.paint import style
from ...ui.picture import Well
from ...ui.preview import Preview, well_size
from ...ui.tape import tape
from ..base import RoomView

SHELF_OF = {"CURRENT": "CURRENT", "REPEATING": "CURRENT", "PLANNING": "PLANNING",
            "COMPLETED": "COMPLETED", "PAUSED": "PAUSED", "DROPPED": "DROPPED"}
HUE = "blue"


def plain(html: str | None) -> str:
    """AniList's description HTML as plain text."""
    text = re.sub(r"<br\s*/?>", "\n", html or "", flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    for a, b in (("&amp;", "&"), ("&quot;", '"'), ("&#039;", "'"), ("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", " ")):
        text = text.replace(a, b)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def season_line(m: dict) -> str:
    bits = [m.get("format") and m["format"].replace("_", " ").title().replace("Tv", "TV")]
    if m.get("season") and m.get("year"):
        bits.append(f"{m['season'].title()} {m['year']}")
    elif m.get("year") or m.get("start_year"):
        bits.append(str(m.get("year") or m.get("start_year")))
    if m.get("studios"):
        studios = m["studios"]
        bits.append(studios[0] if isinstance(studios, list) and studios and isinstance(studios[0], str) else None)
    if m.get("episodes"):
        bits.append(f"{m['episodes']} episodes")
    if m.get("duration"):
        bits.append(f"{m['duration']} min")
    status = {"FINISHED": "finished", "RELEASING": "airing", "NOT_YET_RELEASED": "not yet aired",
              "CANCELLED": "cancelled", "HIATUS": "on hiatus"}.get(m.get("status") or "")
    bits.append(status)
    return " · ".join(b for b in bits if b)


class AnimeRoom(RoomView):
    VIEWS = [("CURRENT", "Watching"), ("PLANNING", "Planning"), ("COMPLETED", "Completed"),
             ("PAUSED", "Paused"), ("DROPPED", "Dropped")]

    def __init__(self, room, **kw):
        super().__init__(room, **kw)
        app = self.app
        saved = app.state.view(room.id)
        self.view = saved.get("view") if saved.get("view") in dict(self.VIEWS) else "CURRENT"
        self.spoilers = bool(saved.get("spoilers"))
        self.mode = "list"          # list | title
        self.title_media: dict | None = None
        self.busy: set[str] = set()
        self.stale: dict[str, bool] = {}
        r, g = app.roles, app.glyphs
        self.winbar = Winbar(r, g)
        self.winbar.hue = HUE
        self.list = ItemList(self._row, roles=r, glyphs=g, hue=HUE, id="alist", empty=["Loading your list…"])
        self.preview = Preview(r, g, ratio=2 / 3, max_cols=22, cell_px=app.term.cell_px,
                               backend=app.image_backend, id="apreview")
        # the title page
        self.cover = Well(r, g, backend=app.image_backend)
        self.facts = Static("", id="facts")
        self.episodes = ItemList(self._episode_row, roles=r, glyphs=g, hue=HUE, lines_per_item=1,
                                 divider=True, id="episodes", empty=["Looking for the episodes…"])

    def compose(self):
        with Horizontal(id="shelf"):
            with Vertical(id="amiddle"):
                yield self.winbar
                yield self.list
            yield self.preview
        with Vertical(id="title"):
            with Horizontal(id="top"):
                yield self.cover
                yield self.facts
            yield self.episodes

    DEFAULT_CSS = """
    AnimeRoom { layout: vertical; }
    AnimeRoom #shelf { height: 1fr; }
    AnimeRoom #title { height: 1fr; display: none; }
    AnimeRoom #top { height: auto; margin: 1 1 1 2; }
    AnimeRoom #facts { width: 1fr; height: auto; padding: 0 0 0 3; }
    """

    def on_mount(self) -> None:
        self._layout()

    def on_resize(self) -> None:
        self._layout()

    def _layout(self) -> None:
        w = self.size.width or self.app.size.width
        self.preview.display = w >= 90 and self.mode == "list"
        if w >= 90:
            self.preview.styles.width = max(40, min(60, int(w * 0.4)))
        cols, rows = well_size(22 if w >= 100 else 14, 2 / 3, self.app.term.cell_px)
        self.cover.set_size(cols, rows)
        self.cover.display = self.app.size.height >= 24

    # ── data ─────────────────────────────────────────────────────────────────

    def reload(self, force: bool = False) -> None:
        self.busy.add("list")
        self._paint_winbar()
        anime = self.app.anime

        def work():
            anime.load(force=True)
            self.app.call_from_thread(self._got)
        self.run_worker(work, thread=True, group="anime-list", exclusive=True)

    def activate(self) -> None:
        if not self.loaded or time.time() - self.app.anime.loaded_at > 60:
            self.loaded = True
            self.reload()

    def _got(self) -> None:
        self.busy.discard("list")
        anime = self.app.anime
        if anime.error and not anime.entries:
            g = self.app.glyphs
            self.list.empty = [f"{g.error} {anime.error}",
                               "Connect AniList in the web UI (Settings → Accounts): O"] if "connected" in anime.error \
                else [f"{g.error} {anime.error}", "r  try again"]
        self._show()
        self.app.refresh_chrome()

    def _shelf(self, status: str) -> list[dict]:
        out = [e for e in self.app.anime.entries or [] if SHELF_OF.get(e.get("status")) == status]
        return sorted(out, key=lambda e: -(e.get("updated_at") or 0))

    def _show(self) -> None:
        entries = self._shelf(self.view)
        rows: list = []
        if self.view == "CURRENT":
            # what you can play now first, then what you're waiting on
            ready = [e for e in entries if self._w(e)["can_play"]]
            waiting = [e for e in entries if e not in ready]
            if ready:
                rows += [Head("Ready to watch", len(ready)), *ready]
            if waiting:
                rows += [Head("Waiting for the next episode", len(waiting)), *waiting]
        else:
            rows = entries
        if self.app.anime.entries is not None and not entries and not self.app.anime.error:
            self.list.empty = [{"CURRENT": "Nothing on Watching.", "PLANNING": "Nothing planned."}.get(
                self.view, "Nothing on this shelf.")]
        self.list.set_rows([r if isinstance(r, Head) else dict(r, id=f"anime:{r['media']['id']}") for r in rows])
        self._paint_winbar()

    def _paint_winbar(self) -> None:
        wb = self.winbar
        counts: dict[str, int] = {}
        for e in self.app.anime.entries or []:
            s = SHELF_OF.get(e.get("status"))
            if s:
                counts[s] = counts.get(s, 0) + 1
        wb.views = [(v, label, counts.get(v)) for v, label in self.VIEWS]
        wb.current = self.view
        wb.busy = bool(self.busy)
        viewer = self.app.anime.viewer or {}
        wb.right = viewer.get("name") or ""
        wb.refresh()

    def _w(self, e: dict) -> dict:
        return watch_state(e["media"], e, self.app.player.progress)

    # ── rows ─────────────────────────────────────────────────────────────────

    def _row(self, e: dict) -> RowParts:
        g = self.app.glyphs
        m = e["media"]
        w = self._w(e)
        total = w["total"] or "?"
        if w["resume_at"] is not None:
            p = self.app.player.progress.get(f"anime:{m['id']}:{w['next_n']}") or {}
            sign = (g.partial(p["position"] / p["duration"]) if p.get("duration") else g.partial_lo, f"mark:{HUE}")
        elif e.get("status") == "COMPLETED":
            sign = (g.watched, "faint")
        elif w["can_play"] and e.get("status") in ACTIVE:
            sign = (g.new, f"mark:{HUE}")
        elif w["airing_at"]:
            sign = (g.upcoming, "mark:yellow")
        else:
            sign = (" ", "fg")
        meta: list = []
        status = e.get("status")
        if status in ("CURRENT", "REPEATING", "PAUSED", "DROPPED") and w["can_play"]:
            meta.append((f"ep {w['next_n']}", "fg"))
            if w["resume_at"] is not None:
                meta.append((f" {g.dot} {fmt.duration(w['resume_at'])} in {g.dot} "
                             f"{fmt.duration(w['remaining_of_next'])} left", "dim"))
            elif w["left"] > 1:
                meta.append((f" {g.dot} {w['left']} to watch {g.dot} {fmt.span(w['catch_up'] * 60)}", "dim"))
        elif w["airing_at"]:
            meta.append((f"ep {w['airing_ep']} {fmt.day_label(w['airing_at']).lower()} {fmt.clock(w['airing_at'])}"
                         f" {g.dot} {fmt.until(w['airing_at'])}", "hue:yellow"))
        elif status == "PLANNING":
            meta.append((season_line(m), "dim"))
        elif status == "COMPLETED":
            meta.append((season_line(m), "dim"))
        else:
            meta.append((season_line(m), "dim"))
        if status == "REPEATING":
            meta.append((f" {g.dot} rewatching", "dim"))
        mark: list = []
        if e.get("score"):
            mark.append((f"{e['score']:g}", "hue:yellow"))
        if f"anime:{m['id']}" in self.app.saved:
            mark.append((f" {g.saved}", "mark:blue"))
        figure = [(f"{w['watched']}", f"hue:{HUE}"), (f"/{total}", "dim")] if status != "PLANNING" else \
            [(f"{w['total']} eps" if w["total"] else "", "faint")]
        return RowParts(sign=sign, title=[(fmt.clean(m.get("title")), "fg")], figure=figure, meta=meta, mark=mark)

    def _episode_row(self, ep: dict) -> RowParts:
        g = self.app.glyphs
        m = self.title_media or {}
        e = self.app.anime.entry(m.get("id")) or m.get("list_entry") or {}
        watched = e.get("progress") or 0
        n = ep["number"]
        p = self.app.player.progress.get(f"anime:{m.get('id')}:{n}") or {}
        frac = (p.get("position") or 0) / p["duration"] if p.get("duration") else None
        aired = ep.get("_aired", True)
        if n <= watched:
            sign = (g.watched, "faint")
        elif frac is not None and 0.02 < frac < COMPLETE:
            sign = (g.partial(frac), f"mark:{HUE}")
        elif not aired:
            sign = (g.tape_unaired, "faint")
        else:
            sign = (" ", "fg")
        title = ep.get("title") or ""
        veil = not self.spoilers and n > watched + 1 and title
        name = [(f"{n:>4}  ", "dim")]
        if veil:
            name.append(("░" * min(24, max(6, len(title))), "faint"))
        else:
            name.append((fmt.clean(title) or f"Episode {n}", "fg" if aired else "faint"))
        figure: list = []
        if frac is not None and 0.02 < frac < COMPLETE:
            figure = [(f"{fmt.duration(p['position'])} in", f"hue:{HUE}")]
        elif not ep.get("key") and aired:
            figure = [("no source yet", "faint")]
        elif not aired:
            figure = [("not aired", "faint")]
        elif m.get("duration"):
            figure = [(f"{m['duration']} min", "faint")]
        return RowParts(sign=sign, title=name, figure=figure)

    # ── the preview ──────────────────────────────────────────────────────────

    def on_item_list_moved(self, event: ItemList.Moved) -> None:
        if event.list is self.list and event.item and not isinstance(event.item, Head):
            self._preview(event.item)
        self.app.refresh_chrome()

    def _where(self, t: Text, m: dict, e: dict, width: int) -> None:
        r, g = self.app.roles, self.app.glyphs
        w = watch_state(m, e, self.app.player.progress)
        p = self.app.player.progress.get(f"anime:{m['id']}:{w['next_n']}") or {}
        partial = (p["position"] / p["duration"]) if (w["resume_at"] is not None and p.get("duration")) else None
        bar, ruler = tape(r, g, watched=w["watched"], aired=w["aired"], total=w["total"],
                          next_n=w["next_n"], partial=partial, width=max(10, width), hue=HUE)
        t.append_text(bar)
        t.append("\n")
        t.append_text(ruler)
        t.append("\n")
        bits = [f"{w['watched']} watched", f"{w['aired']} aired"]
        if w["total"]:
            bits.append(f"{w['total']} in all")
        t.append(f" {g.dot} ".join(bits) + "\n", style(r, "dim"))
        if w["can_play"]:
            line = f"Episode {w['next_n']}"
            if w["resume_at"] is not None:
                line += f" {g.dot} {fmt.duration(w['resume_at'])} in {g.dot} {fmt.duration(w['remaining_of_next'])} left"
            if w["left"] > 0:
                line += f" {g.dot} {fmt.span(w['catch_up'] * 60)} to the end of what's aired"
            t.append(line + "\n", style(r, "fg"))
        if w["airing_at"]:
            t.append(f"Episode {w['airing_ep']} airs {fmt.day_label(w['airing_at']).lower()} "
                     f"{fmt.clock(w['airing_at'])} {g.dot} {fmt.until(w['airing_at'])}\n", style(r, "hue:yellow"))

    def _preview(self, e: dict) -> None:
        if not self.preview.display:
            return
        r, g = self.app.roles, self.app.glyphs
        m = e["media"]
        t = Text()
        t.append(fmt.clean(m.get("title")) + "\n", style(r, "fg+bold"))
        if m.get("title_native"):
            t.append(m["title_native"] + "\n", style(r, "dim"))
        t.append(season_line(m) + "\n", style(r, "dim"))
        status = {"CURRENT": "Watching", "REPEATING": "Rewatching", "PLANNING": "Planning",
                  "COMPLETED": "Completed", "PAUSED": "Paused", "DROPPED": "Dropped"}.get(e.get("status"), "")
        line = status
        if e.get("score"):
            line += f" {g.dot} your score {e['score']:g}"
        if m.get("score"):
            line += f" {g.dot} AniList {m['score']}%"
        t.append(line + "\n\n", style(r, "fg"))
        self._where(t, m, e, self.preview.size.width - 4)
        if m.get("genres"):
            t.append("\n" + ", ".join(m["genres"][:5]) + "\n", style(r, "faint"))
        t.append("\n⏎ title page   p play   + −  your place", style(r, "faint"))
        self.preview.show(t, (m.get("title") or "?")[:1], m.get("cover_xl") or m.get("cover"))

    # ── the title page ───────────────────────────────────────────────────────

    def open_title(self, media: dict) -> None:
        self.mode = "title"
        self.title_media = dict(media)
        self.query_one("#shelf").display = False
        self.query_one("#title").display = True
        self.preview.display = False
        self.episodes.empty = ["Looking for the episodes…"]
        self.episodes.set_rows([])
        self._paint_title()
        mid = media["id"]
        anime = self.app.anime

        def work():
            d = anime.detail(mid)
            self.app.call_from_thread(self._title_detail, mid, d)
            eps = anime.episode_list(d or media)
            self.app.call_from_thread(self._title_episodes, mid, eps)
        self.run_worker(work, thread=True, group="anime-title", exclusive=True)
        self.app.refresh_chrome()

    def close_title(self) -> None:
        self.mode = "list"
        self.query_one("#title").display = False
        self.query_one("#shelf").display = True
        self._layout()
        if self.list.selected:
            self._preview(self.list.selected)
        self.list.repaint()
        self.app.refresh_chrome()

    def _title_detail(self, mid: int, d: dict | None) -> None:
        if not self.title_media or self.title_media["id"] != mid or not d:
            return
        self.title_media.update(d)
        self._paint_title()

    def _title_episodes(self, mid: int, eps: list[dict]) -> None:
        if not self.title_media or self.title_media["id"] != mid:
            return
        m = self.title_media
        e = self.app.anime.entry(mid) or m.get("list_entry") or {}
        w = watch_state(m, e, self.app.player.progress)
        rows = [dict(ep, id=f"anime:{mid}:{ep['number']}", _aired=ep["number"] <= max(w["aired"], 0) or bool(ep.get("key")))
                for ep in eps]
        if not rows:
            self.episodes.empty = ["No source has this title's episodes yet.", "O  the title in the web UI"]
        self.episodes.set_rows([Head("Episodes", len(rows)), *rows] if rows else [])
        # open on your next episode
        target = w["next_n"]
        for i, row in enumerate(self.episodes.items):
            if row["number"] == target:
                self.episodes.go(i)
                break
        self._paint_title()

    def _paint_title(self) -> None:
        m = self.title_media
        if not m:
            return
        r, g = self.app.roles, self.app.glyphs
        e = self.app.anime.entry(m["id"]) or m.get("list_entry") or {"status": None, "progress": 0}
        t = Text()
        t.append(fmt.clean(m.get("title")) + "\n", style(r, "fg+bold"))
        names = [x for x in (m.get("title_native"), m.get("title_romaji")) if x and x != m.get("title")]
        if names:
            t.append(f" {g.dot} ".join(names) + "\n", style(r, "dim"))
        t.append(season_line(m) + "\n", style(r, "dim"))
        bits = []
        st = {"CURRENT": "Watching", "REPEATING": "Rewatching", "PLANNING": "Planning", "COMPLETED": "Completed",
              "PAUSED": "Paused", "DROPPED": "Dropped"}.get(e.get("status") or "")
        bits.append(st or "Not on your list")
        if e.get("score"):
            bits.append(f"your score {e['score']:g}")
        if m.get("score"):
            bits.append(f"AniList {m['score']}%")
        t.append(f" {g.dot} ".join(bits) + "\n\n", style(r, "fg"))
        width = max(20, self.size.width - self.cover.cols - 10)
        head = "Where you are "
        t.append(head, style(r, "fg+bold"))
        t.append(g.rule_h * max(2, min(width, 70) - len(head)) + "\n", style(r, "rule"))
        self._where(t, m, e, min(width, 70))
        audio = self.app.anime.audio_for(m["id"])
        t.append("\n")
        t.append("⏎", style(r, "hue:yellow+bold"))
        t.append(" play   ", style(r, "fg"))
        t.append("+ −", style(r, "hue:yellow+bold"))
        t.append(" your place   ", style(r, "fg"))
        t.append("a", style(r, "hue:yellow+bold"))
        t.append(f" {'sub' if audio == 'sub' else 'dub'} → {'dub' if audio == 'sub' else 'sub'}   ", style(r, "fg"))
        t.append("Space t s", style(r, "hue:yellow+bold"))
        t.append(" episode titles " + ("shown" if self.spoilers else "veiled"), style(r, "fg"))
        self.facts.update(t)
        self.cover.show(m.get("cover_xl") or m.get("cover"), (m.get("title") or "?")[:1])
        self.episodes.repaint()

    # ── actions ──────────────────────────────────────────────────────────────

    def binds(self) -> list[Bind]:
        return [
            Bind(("enter",), "open", "open / play"), Bind(("p",), "play", "play the next episode"),
            Bind(("+",), "bump", "one more watched"), Bind(("-",), "unbump", "one less watched"),
            Bind(("a",), "audio", "sub / dub"), Bind(("s",), "save", "save / unsave"), Bind(("u",), "undo", "undo"),
            Bind(("space", "t", "s"), "spoilers", "show episode titles"), Bind(("R",), "force_refresh", "read the list again"),
        ]

    def active_list(self) -> ItemList:
        return self.episodes if self.mode == "title" else self.list

    def selected(self) -> dict | None:
        if self.mode == "title":
            return self.title_media and anime_item(self.title_media)
        e = self.list.selected
        return self.item_of(e) if e else None

    def item_of(self, row: dict) -> dict | None:
        if self.mode == "title" or "media" not in row:
            return None
        return anime_item(row["media"]) | {"url": f"https://anilist.co/anime/{row['media']['id']}"}

    def crumbs(self) -> list[str]:
        if self.mode == "title" and self.title_media:
            return [dict(self.VIEWS).get(self.view, ""), fmt.cut(fmt.clean(self.title_media.get("title")), 30)]
        return [dict(self.VIEWS).get(self.view, "")]

    def web_route(self) -> str:
        if self.mode == "title" and self.title_media:
            return f"/anime/{self.title_media['id']}"
        e = self.list.selected
        return f"/anime/{e['media']['id']}" if e and self.list.active else "/anime?tab=list"

    def _current_media(self) -> dict | None:
        if self.mode == "title":
            return self.title_media
        e = self.list.selected
        return e["media"] if e else None

    def handle(self, action: str, count: int | None) -> bool:
        app = self.app
        if action in ("left", "close", "escape") and self.mode == "title":
            self.close_title()
            return True
        if action in ("right", "open"):
            if self.mode == "title":
                action = "play_selected"
            else:
                e = self.list.selected
                if e:
                    self.open_title(e["media"])
                return True
        if action == "play_selected":
            ep = self.episodes.selected
            if ep and self.title_media:
                if not ep.get("key"):
                    app.say(f"No source has episode {ep['number']} yet.", "warn")
                else:
                    app.anime.play(self.title_media, ep["number"])
            return True
        if action == "play":
            m = self._current_media()
            if m:
                e = app.anime.entry(m["id"]) or m.get("list_entry") or {"status": "PLANNING", "progress": 0}
                w = watch_state(m, e, app.player.progress)
                if w["can_play"]:
                    app.anime.play(m, w["next_n"])
                else:
                    app.say("Nothing new to play: " + ("you've seen every aired episode." if w["aired"] else "it hasn't aired yet."))
            return True
        if action in ("bump", "unbump"):
            m = self._current_media()
            e = app.anime.entry(m["id"]) if m else None
            if not e:
                app.say("Add it to your list in the web UI first (O).", "warn")
                return True
            new = (e.get("progress") or 0) + (count or 1) * (1 if action == "bump" else -1)
            if e.get("media", {}).get("episodes"):
                new = min(new, e["media"]["episodes"])
            self.run_worker(lambda: self._set_progress(m["id"], new), thread=True, group="anime-write")
            return True
        if action == "audio":
            m = self._current_media()
            if m:
                cur = app.anime.audio_for(m["id"])
                app.anime.audio[m["id"]] = "dub" if cur == "sub" else "sub"
                app.say(f"{fmt.cut(fmt.clean(m.get('title')), 30)}: {'dub' if cur == 'sub' else 'sub'} for this session.")
                self._paint_title()
            return True
        if action == "spoilers":
            self.spoilers = not self.spoilers
            app.state.view(self.room.id)["spoilers"] = self.spoilers
            app.state.save()
            self._paint_title()
            app.say("Episode titles shown." if self.spoilers else "Episode titles past your next one are veiled.")
            return True
        if action == "save":
            m = self._current_media()
            if m:
                app.toggle_saved(anime_item(m))
                self.list.repaint()
            return True
        if action == "undo":
            app.undo()
            return True
        if action == "force_refresh":
            self.reload(force=True)
            return True
        return False

    def _set_progress(self, mid: int, progress: int) -> None:
        try:
            out = self.app.anime.set_progress(mid, progress)
        except ApiError as e:
            self.app.call_from_thread(self.app.say, str(e), "error")
            return

        def done():
            self.app.say(f"Your place: episode {out.get('progress', progress)}"
                         + (" · completed" if out.get("status") == "COMPLETED" else ""))
            if self.mode == "list":
                self._show()
            self._paint_title()
            if self.mode == "title" and self.title_media:
                self._title_episodes(mid, self.app.anime.episodes.get(mid) or [])
        self.app.call_from_thread(done)

    def refresh_rows(self) -> None:
        self.list.repaint()
        self.episodes.repaint()
        if self.mode == "title":
            self._paint_title()
        elif self.list.selected:
            self._preview(self.list.selected)
