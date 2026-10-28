"""The Edition in the terminal: today's paper as one ruled column.

    T H E   E D I T I O N
    No 91 · Monday 27 October 2026                     7 of 20 read
    ═══════════════════════════════════════════════════════════════
    The lede's headline, its dek, its copy, and its sources numbered
    ───────────────────────────────────────────────────────────────
    the columns, then In Brief by room

At most 76 cells wide, centred. j/k go story by story; Enter opens a story's first
source where it lives (an HN story in the Wire's reader, a Reddit post in the
Dispatch, a video in mpv), `3⏎` its third; that marks the story read. `]n` goes to
the next story you haven't opened, `x` marks one read or not, `X` the whole paper,
`[p` `]p` the paper before and after. What you've read is the terminal's own record,
a month of papers deep.
"""

from __future__ import annotations

import time

from ... import fmt
from ...api import ApiError
from ...keys import Bind
from ...ui.units import UnitView
from ..base import RoomView

HUE = "cyan"
ROOM_OF = {"hackernews": "The Wire", "reddit": "The Dispatch", "youtube": "Screening Room", "github": "GitHub"}
KEEP_PAPERS = 31


def words(text: str, width: int, role: str) -> list[list[tuple[str, str]]]:
    lines, cur, used = [], [], 0
    for para in (text or "").split("\n"):
        for w in para.split():
            if used and used + len(w) + 1 > width:
                lines.append(cur)
                cur, used = [], 0
            cur.append(((" " if used else "") + w, role))
            used += len(w) + (1 if used else 0)
        if cur:
            lines.append(cur)
            cur, used = [], 0
    return lines


def source_name(item: dict) -> str:
    return item.get("source") or ROOM_OF.get(item.get("platform") or "", item.get("platform") or "")


class Edition(RoomView):
    def __init__(self, room, **kw):
        super().__init__(room, **kw)
        app = self.app
        self.paper: dict | None = None
        self.dates: list[str] = []
        self.date: str | None = None
        self.error = ""
        self.paper_view = UnitView(self._unit, roles=app.roles, glyphs=app.glyphs, head=self._nameplate,
                                   hue=HUE, id="paper", empty=["Fetching today's paper…"])

    def compose(self):
        yield self.paper_view

    # ── read marks ───────────────────────────────────────────────────────────

    def _marks(self) -> set:
        if not self.paper:
            return set()
        return set(self.app.state.data.setdefault("edition_read", {}).get(self.paper["date"], []))

    def _mark(self, ids: list[str], read: bool = True) -> None:
        allread = self.app.state.data.setdefault("edition_read", {})
        cur = set(allread.get(self.paper["date"], []))
        cur = cur | set(ids) if read else cur - set(ids)
        allread[self.paper["date"]] = sorted(cur)
        for d in sorted(allread)[:-KEEP_PAPERS]:
            del allread[d]
        self.app.state.save()

    # ── data ─────────────────────────────────────────────────────────────────

    def reload(self, force: bool = False) -> None:
        date = self.date

        def work():
            api = self.app.api
            try:
                if force:
                    api.post("/edition/rebuild")
                    self.app.call_from_thread(self.app.say, "Recomposing the paper; it takes a minute or two.")
                    return
                dates = [e["date"] for e in (api.get("/edition/archive") or {}).get("editions") or []]
                paper = api.get(f"/edition/{date}") if date else api.get("/edition/latest")
                self.app.call_from_thread(self._got, paper, dates, "")
            except ApiError as e:
                msg = "No paper yet: the press composes one after the edition hour." if e.status == 404 else str(e)
                self.app.call_from_thread(self._got, None, [], msg)
        self.run_worker(work, thread=True, group="edition", exclusive=True)

    def _got(self, paper: dict | None, dates: list[str], error: str) -> None:
        self.error = error
        if dates:
            self.dates = dates
        if paper is None:
            self.paper_view.empty = [error or "No paper."]
            self.paper_view.set_units([])
            return
        self.paper = paper
        self.date = paper.get("date")
        self.paper_view.set_units(self._units(paper))
        self.app.refresh_chrome()

    def _units(self, paper: dict) -> list[dict]:
        units = []
        if paper.get("lede"):
            units.append({"kind": "lede", "story": paper["lede"]})
        for c in paper.get("columns") or []:
            units.append({"kind": "column", "story": c})
        by_room: dict[str, list] = {}
        for b in paper.get("briefs") or []:
            room = ROOM_OF.get(((b.get("items") or [{}])[0]).get("platform") or "", "Elsewhere")
            by_room.setdefault(room, []).append(b)
        first = True
        for room, briefs in by_room.items():
            for i, b in enumerate(briefs):
                units.append({"kind": "brief", "story": b, "_group": room if i == 0 else None,
                              "_brief_start": first})
                first = False
        for u in units:
            items = u["story"].get("items") or []
            u["id"] = items[0].get("id") if items else None
            u["_text"] = " ".join(str(u["story"].get(k) or "") for k in ("headline", "dek", "body"))
        return units

    # ── drawing ──────────────────────────────────────────────────────────────

    def _nameplate(self, width: int):
        g = self.app.glyphs
        p = self.paper
        if not p:
            return []
        name = "T H E   E D I T I O N"
        lines = [[(" " * max(0, (width - len(name)) // 2) + name, "fg+bold")]]
        when = time.strftime("%A %-d %B %Y", time.strptime(p["date"], "%Y-%m-%d"))
        left = f"No {p.get('issue')} {g.dot} {when}"
        total = len(self.paper_view.units)
        read = len(self._marks() & {u["id"] for u in self.paper_view.units})
        right = "読了 · all read" if total and read >= total else f"{read} of {total} read"
        lines.append([(left, "dim"), (" " * max(1, width - len(left) - len(right) - 1), "fg"),
                      (right, f"hue:{HUE}" if read >= total and total else "dim")])
        lines.append([(g.rule_double * width, f"mark:{HUE}")])
        if p.get("status") == "wire":
            lines.append([("Headlines only: no local writer was ready, so these are the sources' own words.",
                           "faint")])
        elif p.get("model"):
            lines.append([(f"Written by {p['model']} {g.dot} from {p.get('sources')} sources over "
                           f"{p.get('window_h')} hours", "faint")])
        lines.append([])
        return lines

    def _sources(self, story: dict, width: int, read: bool):
        g = self.app.glyphs
        items = story.get("items") or []
        line = []
        for n, it in enumerate(items[:6], 1):
            line.append((f"{n} ", "faint"))
            line.append((fmt.cut(source_name(it), 22) + "  ", "dim"))
        if len(items) > 6:
            line.append((f"+{len(items) - 6}  ", "faint"))
        if read:
            line.append((f"{g.watched} read", "faint"))
        return [line]

    def _unit(self, u: dict, width: int):
        g = self.app.glyphs
        s = u["story"]
        read = u["id"] in self._marks()
        head_role = "dim+bold" if read else "fg+bold"
        lines = []
        if u["kind"] == "brief":
            if u.get("_brief_start"):
                lines.append([("In Brief ", "fg+bold"), (g.rule_h * max(2, width - 9), "rule")])
            if u.get("_group"):
                lines.append([(u["_group"], f"hue:{HUE}")])
            first = words(fmt.clean(s.get("headline")), width - 4, "dim" if read else "fg")
            for i, ln in enumerate(first):
                lines.append(([(f"{g.watched} " if read else f"{g.dot} ", "faint")] if i == 0 else [("  ", "fg")]) + ln)
            return lines
        lines += words(fmt.clean(s.get("headline")), width, head_role)
        edited = self.paper and self.paper.get("status") != "wire" and s.get("synthesized", True)
        if s.get("dek") and edited:
            lines += words(fmt.clean(s["dek"]), width, "dim+italic")
        elif not edited:
            items = s.get("items") or []
            lines.append([(f"{len(items)} source{'s' if len(items) != 1 else ''}", "faint")])
        if s.get("body"):
            lines.append([])
            if edited:
                lines += words(s["body"].strip(), width, "dim" if read else "fg")
            else:
                lines.append([("From the sources", "faint")])
                lines += words(fmt.clean(s["body"]), width, "dim")[:3]
        lines.append([])
        lines += self._sources(s, width, read)
        lines.append([(g.rule_h * width, "rule")])
        return lines

    # ── keys ─────────────────────────────────────────────────────────────────

    def binds(self) -> list[Bind]:
        return [
            Bind(("enter",), "open", "open the story (3⏎ its third source)"), Bind(("l",), "open", "open the story"),
            Bind(("x",), "read", "read / not read"), Bind(("X",), "read_all", "mark the paper read"),
            Bind(("]", "n"), "next_unread", "next unread story"),
            Bind(("[", "p"), "older", "the paper before"), Bind(("]", "p"), "newer", "the paper after"),
            Bind(("s",), "save", "save its first source"), Bind(("R",), "recompose", "recompose today's paper"),
        ]

    def active_list(self):
        return self.paper_view

    def selected(self) -> dict | None:
        u = self.paper_view.selected
        items = (u or {}).get("story", {}).get("items") or []
        return items[0] if items else None

    def crumbs(self) -> list[str]:
        if not self.paper:
            return ["The Edition"]
        latest = not self.dates or self.paper["date"] == self.dates[0]
        return [f"No {self.paper.get('issue')}" + ("" if latest else f" {self.app.glyphs.dot} {self.paper['date']}")]

    def web_route(self) -> str:
        return f"/edition?d={self.paper['date']}" if self.paper else "/edition"

    def handle(self, action: str, count: int | None) -> bool:
        app = self.app
        u = self.paper_view.selected
        if action in ("open", "right"):
            if u:
                items = u["story"].get("items") or []
                n = (count or 1) - 1
                if n < len(items):
                    self._mark([u["id"]])
                    self.paper_view.repaint()
                    app.open_item(items[n])
            return True
        if action == "read" and u:
            self._mark([u["id"]], read=u["id"] not in self._marks())
            self.paper_view.repaint()
            return True
        if action == "read_all" and self.paper:
            self._mark([x["id"] for x in self.paper_view.units if x["id"]])
            self.paper_view.repaint()
            app.say("The whole paper is marked read.")
            return True
        if action == "next_unread":
            marks = self._marks()
            units = self.paper_view.units
            order = list(range(self.paper_view.cursor + 1, len(units))) + list(range(0, self.paper_view.cursor + 1))
            nxt = next((i for i in order if units[i]["id"] not in marks), None)
            if nxt is None:
                app.say("You've opened every story in this paper.")
            else:
                self.paper_view.go(nxt)
                self.paper_view.place("top")
            return True
        if action in ("older", "newer"):
            if not self.paper or not self.dates or self.paper["date"] not in self.dates:
                return True
            i = self.dates.index(self.paper["date"]) + (1 if action == "older" else -1)
            if 0 <= i < len(self.dates):
                self.date = self.dates[i]
                self.reload()
            else:
                app.say("That's the newest paper." if action == "newer" else "That's the oldest paper kept.")
            return True
        if action == "save":
            item = self.selected()
            if item:
                app.toggle_saved(item)
            return True
        if action == "recompose":
            self.reload(force=True)
            return True
        return False

    def on_unit_view_moved(self, event: UnitView.Moved) -> None:
        self.app.refresh_chrome()
