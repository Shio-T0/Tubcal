"""The Workbench in the terminal: one programming language at a time, its podcasts on
the bench radio, its talks in the player, its change log, its trending repos and its
manuals.

Views (Tab / S-Tab): Podcasts, Talks (with the Screening Room), Change log, Repos (with
GitHub), Manuals. The language is chosen from the index pane at 140 columns, or with
`]l` / `[l` anywhere (Rust first, as on the web). Enter plays a podcast on the radio
(from where you stopped) or a talk in mpv, and opens the rest in the browser.
"""

from __future__ import annotations

from rich.text import Text
from textual.containers import Vertical

from ... import fmt
from ...api import ApiError, seg
from ...images import youtube_thumb
from ...keys import Bind
from ...media.radio import podcast_item
from ...ui.chrome import Winbar
from ...ui.itemlist import Head, ItemList, RowParts
from ...ui.paint import style
from ...ui.preview import Preview
from ..base import RoomView

HUE = "cyan"
VIEWS = [("podcasts", "Podcasts"), ("videos", "Talks"), ("updates", "Change log"), ("repos", "Repos"),
         ("docs", "Manuals")]
NEEDS = {"videos": "youtube", "repos": "github"}


def post_item(p: dict, lang: str | None) -> dict:
    """A change-log entry as a saved entry (saveable.js devPostItem)."""
    release = p.get("type") == "release"
    title = p.get("title") or ""
    if release:
        title = f"{p.get('tag')}" + (f" — {title}" if title and title != p.get("tag") else "")
    return {"id": f"dev:{p.get('id') or p.get('url')}", "platform": "dev", "title": title, "url": p.get("url"),
            "thumbnail": None, "source": p.get("source") or (f"{lang} releases" if lang else None),
            "published_at": p.get("published_at") or None, "extra": {"kind": "article", "lang": lang, "release": release}}


def doc_item(d: dict, lang: str | None) -> dict:
    """A manual as a saved entry (saveable.js docItem)."""
    return {"id": f"doc:{d.get('url')}", "platform": "dev", "title": d.get("title") or "", "url": d.get("url"),
            "thumbnail": None, "source": " · ".join(x for x in (lang, d.get("kind")) if x) or None,
            "description": d.get("note") or "", "extra": {"kind": "doc", "lang": lang}}


class Workbench(RoomView):
    VIEWS = VIEWS

    def __init__(self, room, **kw):
        super().__init__(room, **kw)
        app = self.app
        saved = app.state.view(room.id)
        self.view = saved.get("view") if saved.get("view") in dict(VIEWS) else "podcasts"
        self.lang = saved.get("lang") or "rust"
        self.languages: list[dict] = []
        self.dossiers: dict[str, dict] = {}
        self.releases: dict[str, dict] = {}
        self.data: dict[tuple[str, str], list[dict]] = {}
        self.stale: dict[str, bool] = {}
        self.busy: set[str] = set()
        self.focus_pane = "list"
        r, g = app.roles, app.glyphs
        self.index = ItemList(self._index_row, roles=r, glyphs=g, hue=HUE, lines_per_item=1, id="index")
        self.list = ItemList(self._row, roles=r, glyphs=g, hue=HUE, id="list", empty=["Loading…"])
        self.preview = Preview(r, g, cell_px=app.term.cell_px, backend=app.image_backend, id="preview")
        self.winbar = Winbar(r, g)
        self.winbar.hue = HUE

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
        self.index.display = w >= 140
        self.preview.display = w >= 90
        self.index.styles.width = 26
        if w >= 90:
            self.preview.styles.width = max(40, min(66, int(w * 0.4)))
        if w < 140 and self.focus_pane == "index":
            self.focus_pane = "list"
        self.index.active = self.focus_pane == "index"
        self.list.active = self.focus_pane == "list"
        self.index.repaint()
        self.list.repaint()

    @property
    def lang_name(self) -> str:
        return next((x.get("name") for x in self.languages if x.get("id") == self.lang), self.lang.title())

    # ── data ─────────────────────────────────────────────────────────────────

    def view_available(self, view: str) -> bool:
        need = NEEDS.get(view)
        return not need or bool(self.app.registry and self.app.registry.has(need))

    def reload(self, force: bool = False) -> None:
        if not self.view_available(self.view):
            self.view = "podcasts"
        view, lang = self.view, self.lang
        key = f"{lang}:{view}"
        self.busy.add(key)
        self._paint_winbar()
        if (lang, view) not in self.data:
            self.list.empty = ["Loading…"]
            self.list.set_rows([])
        self.run_worker(lambda: self._fetch(lang, view), thread=True, group=f"dev-{view}", exclusive=True)
        if not self.languages:
            self.run_worker(self._fetch_languages, thread=True, group="dev-langs")

    def _fetch_languages(self) -> None:
        try:
            langs = (self.app.api.get("/dev/languages") or {}).get("languages") or []
        except ApiError:
            return

        def show():
            self.languages = langs
            if langs and self.lang not in [x.get("id") for x in langs]:
                self.set_lang(langs[0]["id"])
            self._show_index()
            self._paint_winbar()
        self.app.call_from_thread(show)

    def _fetch(self, lang: str, view: str) -> None:
        api = self.app.api
        try:
            if view == "docs" or lang not in self.dossiers:
                self.dossiers[lang] = api.get(f"/dev/{seg(lang)}") or {}
            if view == "docs":
                items, stale = list(self.dossiers[lang].get("docs") or []), False
            else:
                d = api.get(f"/dev/{seg(lang)}/{view}", timeout=60) or {}
                items = d.get("episodes") if view == "podcasts" else d.get("items")
                items, stale = items or [], bool(d.get("stale"))
            if lang not in self.releases:
                try:
                    self.releases[lang] = api.get(f"/dev/{seg(lang)}/release", timeout=30) or {}
                except ApiError:
                    self.releases[lang] = {}
            self.app.call_from_thread(self._got, lang, view, items, stale, None)
        except ApiError as e:
            self.app.call_from_thread(self._got, lang, view, None, False, str(e))

    def _got(self, lang, view, items, stale, error) -> None:
        self.busy.discard(f"{lang}:{view}")
        if error:
            if (lang, view) not in self.data:
                self.list.empty = [f"{self.app.glyphs.error} {error}", "r  try again"]
                if (lang, view) == (self.lang, self.view):
                    self.list.set_rows([])
            self.app.say(error, "error")
        else:
            self.data[(lang, view)] = items
            self.stale[f"{lang}:{view}"] = stale
        if (lang, view) == (self.lang, self.view):
            self._show()
        self._paint_winbar()
        self.app.refresh_chrome()

    def _show(self) -> None:
        items = self.data.get((self.lang, self.view))
        if items is None:
            return
        name = self.lang_name
        rows: list = []
        if self.view == "podcasts":   # newest first; each row says how long ago
            rows = sorted(items, key=lambda e: -float(e.get("published_at") or 0))
            empty = [f"No {name} podcast has a recent episode."]
        elif self.view == "updates":
            rows = sorted(items, key=lambda p: -float(p.get("published_at") or 0))
            empty = [f"Nothing new from {name}'s core team."]
        elif self.view == "docs":
            kinds: dict[str, list] = {}
            for d in items:
                kinds.setdefault((d.get("kind") or "other").capitalize(), []).append(d)
            for label, ds in kinds.items():
                rows += [Head(label, len(ds)), *ds]
            empty = ["No manuals listed."]
        else:
            rows = items
            empty = ["Nothing here right now."]
        self.list.empty = empty
        self.list.set_rows(rows)
        self._show_index()
        self._paint_winbar()

    def set_lang(self, lang: str) -> None:
        if lang == self.lang:
            return
        self.lang = lang
        self.app.state.view(self.room.id)["lang"] = lang
        self.app.state.save()
        self._show_index()
        if (lang, self.view) in self.data:
            self._show()
        self.reload()
        self.app.refresh_chrome()

    def _step_lang(self, n: int) -> None:
        ids = [x.get("id") for x in self.languages]
        if not ids:
            return
        i = ids.index(self.lang) if self.lang in ids else 0
        self.set_lang(ids[(i + n) % len(ids)])
        self.app.say(self.lang_name)

    def _paint_winbar(self) -> None:
        wb = self.winbar
        wb.views = [(v, label, None) for v, label in VIEWS if self.view_available(v)]
        wb.current = self.view
        wb.busy = f"{self.lang}:{self.view}" in self.busy
        rel = self.releases.get(self.lang) or {}
        bits = [self.lang_name + (f" {rel['tag']}" if rel.get("tag") else "")]
        if self.stale.get(f"{self.lang}:{self.view}"):
            bits.append("cached")
        wb.right = f" {self.app.glyphs.dot} ".join(bits)
        wb.refresh()

    def _show_index(self) -> None:
        rows: list = [Head("Languages", len(self.languages) or None)]
        rows += [{"id": f"lang:{x['id']}", "title": x.get("name") or x["id"], "_lang": x["id"]}
                 for x in self.languages]
        self.index.set_rows(rows, keep=f"lang:{self.lang}")

    # ── rows ─────────────────────────────────────────────────────────────────

    def _index_row(self, row: dict) -> RowParts:
        on = row.get("_lang") == self.lang
        return RowParts(sign=("•" if on else " ", f"mark:{HUE}"),
                        title=[(row["title"], "fg+bold" if on else "fg")])

    def episode(self, ep: dict) -> dict:
        return dict(ep, lang=self.lang)

    def _row(self, it: dict) -> RowParts:
        g, app = self.app.glyphs, self.app
        saved = [(g.saved, "mark:blue")] if self._saveable(it)["id"] in app.saved else []
        if self.view == "podcasts":
            tuned = app.radio.episode and app.radio.episode.get("id") == it.get("id")
            left = app.radio.left(it)
            if tuned:
                sign = (g.paused if app.radio.now.paused else g.playing, f"mark:{HUE}")
            elif left:
                dur = float(it.get("duration") or 0)
                sign = (g.partial(1 - left / dur) if dur else g.partial(0.5), f"mark:{HUE}")
            else:
                sign = (" ", "fg")
            figure = [(f"{fmt.duration(left)} left", "dim")] if left else \
                [(fmt.duration(it.get("duration")), "dim")] if it.get("duration") else []
            meta = [(fmt.clean(it.get("show")), "dim")]
            if it.get("published_at"):
                meta.append((f" {g.dot} {fmt.ago(it['published_at'])}", "faint"))
            return RowParts(sign=sign, title=[(fmt.clean(it.get("title")), "fg")], figure=figure, meta=meta, mark=saved)
        if self.view == "videos":
            extra = it.get("extra") or {}
            frac = app.player.fraction(it.get("id") or "")
            sign = (g.watched, "faint") if frac and frac >= 0.95 else \
                (g.partial(frac), f"mark:{HUE}") if frac else (" ", "fg")
            meta = [(fmt.clean(it.get("source")), "dim")]
            if extra.get("view_count"):
                meta.append((f" {g.dot} {fmt.compact(extra['view_count'])} views", "faint"))
            if it.get("published_at"):
                meta.append((f" {g.dot} {fmt.ago(it['published_at'])}", "faint"))
            figure = [(fmt.duration(extra.get("length_seconds")), "dim")] if extra.get("length_seconds") else []
            return RowParts(sign=sign, title=[(fmt.clean(it.get("title")), "fg")], figure=figure, meta=meta, mark=saved)
        if self.view == "updates":
            release = it.get("type") == "release"
            title = it.get("tag") or it.get("title") if release else it.get("title")
            meta = [(fmt.clean(it.get("source") or ""), "dim")]
            if it.get("published_at"):
                meta.append((f" {g.dot} {fmt.ago(it['published_at'])}", "faint"))
            return RowParts(sign=("◆" if release else " ", f"mark:{HUE}"), title=[(fmt.clean(title), "fg")],
                            figure=[("release", f"hue:{HUE}")] if release else [], meta=meta, mark=saved)
        if self.view == "repos":
            extra = it.get("extra") or {}
            figure = [(f"★ {fmt.compact(extra.get('stars'))}", "dim")] if extra.get("stars") else []
            if extra.get("stars_gained"):
                figure.append((f" +{fmt.compact(extra['stars_gained'])}", f"hue:{HUE}"))
            meta = [(fmt.clean(extra.get("description") or ""), "dim")]
            return RowParts(sign=(" ", "fg"), title=[(it.get("title") or "", "fg")], figure=figure, meta=meta,
                            mark=saved)
        # a manual
        return RowParts(sign=(" ", "fg"), title=[(fmt.clean(it.get("title")), "fg")],
                        meta=[(fmt.clean(it.get("note") or ""), "dim")], mark=saved)

    def _saveable(self, it: dict) -> dict:
        name = self.lang_name
        if self.view == "podcasts":
            return podcast_item(it, self.lang)
        if self.view == "updates":
            return post_item(it, name)
        if self.view == "docs":
            return doc_item(it, name)
        return it

    # ── the preview ──────────────────────────────────────────────────────────

    def on_item_list_moved(self, event: ItemList.Moved) -> None:
        if event.list is self.list:
            self._preview(event.item)
            self.app.refresh_chrome()

    def _preview(self, it: dict | None) -> None:
        pv = self.preview
        if not pv.display:
            return
        if not it:
            pv.blank()
            return
        r, g = self.app.roles, self.app.glyphs
        t = Text()
        if self.view == "podcasts":
            pv.set_shape(1.0, 28)
            t.append(fmt.clean(it.get("title")) + "\n", style(r, "fg+bold"))
            t.append(fmt.clean(it.get("show")), style(r, "fg"))
            if it.get("published_at"):
                t.append(f" {g.dot} {fmt.ago_long(it['published_at'])}", style(r, "dim"))
            t.append("\n")
            left = self.app.radio.left(it)
            if it.get("duration"):
                t.append(fmt.duration(it["duration"]), style(r, "dim"))
                if left:
                    t.append(f" {g.dot} {fmt.duration(left)} left, picks up where you stopped", style(r, "dim"))
                t.append("\n")
            t.append("\n")
            if it.get("summary"):
                summary = fmt.clean(it["summary"])
                # the feed's summary is cut short by the server: say so
                t.append(summary + ("" if summary[-1:] in ".!?…)\"" else "…") + "\n", style(r, "fg"))
            t.append("\n⏎  on the radio   Space r  the radio's keys", style(r, "faint"))
            pv.show(t, (it.get("show") or "♪")[:1].upper(), it.get("show_art"))
            return
        if self.view == "videos":
            pv.set_shape(16 / 9, 64)
            extra = it.get("extra") or {}
            t.append(fmt.clean(it.get("title")) + "\n", style(r, "fg+bold"))
            t.append(fmt.clean(it.get("source")), style(r, "fg"))
            if it.get("published_at"):
                t.append(f" {g.dot} {fmt.ago_long(it['published_at'])}", style(r, "dim"))
            t.append("\n")
            if extra.get("view_count"):
                t.append(f"{fmt.compact(extra['view_count'])} views\n", style(r, "dim"))
            if extra.get("description"):
                t.append("\n" + "\n".join(str(extra["description"]).splitlines()[:10]) + "\n", style(r, "fg"))
            pv.show(t, (it.get("source") or "▶")[:1].upper(), youtube_thumb(it))
            return
        pv.set_shape(16 / 9, 64)
        if self.view == "updates":
            t.append(fmt.clean(it.get("tag") if it.get("type") == "release" else it.get("title")) + "\n",
                     style(r, "fg+bold"))
            t.append(fmt.clean(it.get("source") or ""), style(r, "fg"))
            if it.get("published_at"):
                t.append(f" {g.dot} {fmt.ago_long(it['published_at'])}", style(r, "dim"))
            t.append("\n\n")
            if it.get("summary"):
                t.append(fmt.clean(it["summary"]) + "\n", style(r, "fg"))
        elif self.view == "repos":
            extra = it.get("extra") or {}
            t.append((it.get("title") or "") + "\n", style(r, "fg+bold"))
            bits = [extra.get("language") or "", f"★ {fmt.compact(extra.get('stars'))}" if extra.get("stars") else "",
                    f"+{fmt.compact(extra.get('stars_gained'))} lately" if extra.get("stars_gained") else "",
                    f"{fmt.compact(extra.get('forks'))} forks" if extra.get("forks") else ""]
            t.append(f" {g.dot} ".join(b for b in bits if b) + "\n\n", style(r, "dim"))
            if extra.get("description"):
                t.append(fmt.clean(extra["description"]) + "\n", style(r, "fg"))
        else:
            t.append(fmt.clean(it.get("title")) + "\n", style(r, "fg+bold"))
            t.append((it.get("kind") or "").capitalize() + "\n\n", style(r, "dim"))
            if it.get("note"):
                t.append(fmt.clean(it["note"]).capitalize() + ".\n", style(r, "fg"))
        if it.get("url"):
            t.append("\n" + fmt.cut(it["url"], 60) + "\n", style(r, "faint"))
            t.append("⏎  opens it in the browser", style(r, "faint"))
        pv.show(t, (self.lang_name or "?")[:1], None)

    # ── keys ─────────────────────────────────────────────────────────────────

    def binds(self) -> list[Bind]:
        return [
            Bind(("enter",), "open", "play / open"), Bind(("p",), "open", "play / open"),
            Bind(("a",), "enqueue", "add a talk to the queue"), Bind(("s",), "save", "save / unsave"),
            Bind(("u",), "undo", "undo"),
            Bind(("]", "l"), "next_lang", "next language"), Bind(("[", "l"), "prev_lang", "previous language"),
        ]

    def active_list(self) -> ItemList:
        return self.index if self.focus_pane == "index" else self.list

    def selected(self) -> dict | None:
        it = self.list.selected
        if not it:
            return None
        return it if self.view in ("videos", "repos") else self._saveable(it)

    def item_of(self, row: dict) -> dict | None:
        if self.focus_pane != "list":
            return None
        return row if self.view in ("videos", "repos") else self._saveable(row)

    def playable_of(self, row: dict) -> dict | None:
        return row if self.focus_pane == "list" and self.view == "videos" else None

    def crumbs(self) -> list[str]:
        return [self.lang_name, dict(VIEWS).get(self.view, "")]

    def web_route(self) -> str:
        return "/dev" if self.lang == "rust" else f"/dev?l={self.lang}"

    def handle(self, action: str, count: int | None) -> bool:
        app = self.app
        it = self.list.selected
        if action == "left":
            if self.index.display and self.focus_pane == "list":
                self.focus_pane = "index"
                self._layout()
                return True
            return False
        if action in ("right", "open", "play"):
            if self.focus_pane == "index":
                row = self.index.selected or {}
                if row.get("_lang"):
                    self.set_lang(row["_lang"])
                self.focus_pane = "list"
                self._layout()
            elif it:
                self._open(it)
            return True
        if action in ("next_lang", "prev_lang"):
            self._step_lang(1 if action == "next_lang" else -1)
            return True
        if action == "enqueue" and it:
            if self.view != "videos":
                app.say("Only talks go in the queue; the radio plays one episode at a time.", "warn")
            else:
                app.say(f"Added to the queue ({app.player.enqueue(it)}).")
                self.list.repaint()
            return True
        if action == "save" and it:
            app.toggle_saved(self._saveable(it))
            self.list.repaint()
            return True
        if action == "undo":
            app.undo()
            return True
        return False

    def _open(self, it: dict) -> None:
        app = self.app
        if self.view == "podcasts":
            app.tune(self.episode(it))
            self.list.repaint()
        elif self.view == "videos":
            app.play(it)
        else:
            app.open_item(self._saveable(it))

    def refresh_rows(self) -> None:
        self.list.repaint()
        if self.view == "podcasts":
            self._preview(self.list.selected)
