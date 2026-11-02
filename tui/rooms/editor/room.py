"""The Composing Room in the terminal: the files your editor session has open, and what
git says changed beside them, opened in your own editor while the interface steps aside.

The web editor keeps its open tabs on the server (`/api/editor/state`), per pane,
relative to the workspace root (`/api/editor/status`). Enter opens one in your editor
with your own setup (nvim as you use it; drafts for posts are the ones written without
a trace). A saved file (`s`, or one saved on the web) opens the same way from Saved.
`O` opens the file in the web editor instead.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from rich.text import Text
from textual.containers import Vertical

from ... import fmt
from ...api import ApiError
from ...keys import Bind
from ...ui.chrome import Winbar
from ...ui.itemlist import Head, ItemList, RowParts
from ...ui.paint import style, who
from ..base import RoomView

HUE = "green"
VIEWS = [("open", "Open files"), ("changed", "Changed")]
GIT = {"M": "modified", "A": "added", "D": "deleted", "R": "renamed", "??": "new", "U": "conflict"}


def file_item(path: str) -> dict:
    """saveable.js fileItem."""
    name = path.rsplit("/", 1)[-1]
    folder = path[: -len(name)].rstrip("/")
    return {"id": f"file:{path}", "platform": "editor", "title": name, "url": f"/editor?open={quote(path, safe='')}",
            "thumbnail": None, "source": folder or "workspace root", "extra": {"kind": "file", "path": path}}


def inside(root: str, rel: str) -> Path | None:
    """The file's real place, only when it's inside the workspace (no ../, no symlink out)."""
    try:
        base = Path(root).resolve()
        p = (base / rel).resolve()
    except (OSError, ValueError):
        return None
    return p if p == base or p.is_relative_to(base) else None


class Composing(RoomView):
    VIEWS = VIEWS

    def __init__(self, room, **kw):
        super().__init__(room, **kw)
        saved = self.app.state.view(room.id)
        self.view = saved.get("view") if saved.get("view") in dict(VIEWS) else "open"
        self.root: str | None = None
        self.session: dict | None = None
        self.changes: dict[str, dict] = {}     # repo → {branch, changes}
        self.busy: set[str] = set()
        self._pending: str | None = None      # a file asked for before the workspace was known
        r, g = self.app.roles, self.app.glyphs
        self.winbar = Winbar(r, g)
        self.winbar.hue = HUE
        self.list = ItemList(self._row, roles=r, glyphs=g, hue=HUE, id="list", empty=["Loading…"])

    def compose(self):
        with Vertical():
            yield self.winbar
            yield self.list

    # ── data ─────────────────────────────────────────────────────────────────

    def reload(self, force: bool = False) -> None:
        self.busy.add(self.view)
        self._paint_winbar()
        self.run_worker(self._fetch, thread=True, group="ed", exclusive=True)

    def _fetch(self) -> None:
        api = self.app.api
        try:
            status = api.get("/editor/status", timeout=10) or {}
            session = (api.get("/editor/state", timeout=10) or {}).get("session") or {}
            changes = {}
            for path in self._paths(session)[:12]:
                try:
                    g = api.get("/editor/git/status", path=path, timeout=10) or {}
                except ApiError:
                    continue
                if g.get("repo") is not None and g.get("repo") not in changes:
                    changes[g["repo"]] = g
            err = None
        except ApiError as e:
            status, session, changes, err = None, None, {}, str(e)

        def show():
            self.busy.clear()
            if err:
                self.app.say(err, "error")
                self.list.empty = [f"{self.app.glyphs.error} {err}", "r  try again"]
                self.list.set_rows([])
            else:
                self.root = status.get("root")
                self.session, self.changes = session, changes
                self._show()
                if self._pending:
                    rel, self._pending = self._pending, None
                    self.call_after_refresh(lambda: self.open_path(rel))
            self._paint_winbar()
            self.app.refresh_chrome()
        self.app.call_from_thread(show)

    @staticmethod
    def _paths(session: dict) -> list[str]:
        out: list[str] = []
        for pane in session.get("panes") or []:
            for p in pane.get("tabs") or []:
                if isinstance(p, str) and p not in out:
                    out.append(p)
        return out

    def _show(self) -> None:
        rows: list = []
        if self.view == "open":
            panes = (self.session or {}).get("panes") or []
            for n, pane in enumerate(panes, 1):
                tabs = [t for t in pane.get("tabs") or [] if isinstance(t, str)]
                if not tabs:
                    continue
                label = "Open files" if len(panes) == 1 else f"Pane {n}"
                rows.append(Head(label, len(tabs)))
                rows += [dict(file_item(t), _active=t == pane.get("active")) for t in tabs]
            self.list.empty = ["No files are open in the editor.", "O  opens the web editor"]
        else:
            for repo, g in self.changes.items():
                files = g.get("changes") or []
                if files:
                    rows.append(Head(f"{repo or 'workspace'} · {g.get('branch') or ''}".rstrip(" ·"), len(files)))
                    rows += [dict(file_item(c["path"]), _git=c.get("status")) for c in files]
            self.list.empty = ["Nothing changed in the repos of your open files."]
        self.list.set_rows(rows)

    def _paint_winbar(self) -> None:
        wb = self.winbar
        n_changed = sum(len(g.get("changes") or []) for g in self.changes.values()) or None
        n_open = len(self._paths(self.session or {})) or None
        wb.views = [("open", "Open files", n_open), ("changed", "Changed", n_changed)]
        wb.current = self.view
        wb.busy = bool(self.busy)
        wb.right = fmt.cut(self.root or "", 40).replace(str(Path.home()), "~", 1) if self.root else ""
        wb.refresh()

    def _row(self, it: dict) -> RowParts:
        g = self.app.glyphs
        st = it.get("_git")
        sign = (g.playing, f"mark:{HUE}") if it.get("_active") else \
            ((st or "?")[:1], "hue:yellow" if st not in ("??", "A") else f"mark:{HUE}") if st else (" ", "fg")
        meta = [(it.get("source") or "", who(it.get("source") or ""))]
        if st:
            meta.append((f" {g.dot} {GIT.get(st, GIT.get(st[:1], st))}", "faint"))
        mark = [(g.saved, "mark:blue")] if it["id"] in self.app.saved else []
        return RowParts(sign=sign, title=[(it.get("title") or "", "fg+bold" if it.get("_active") else "fg")],
                        meta=meta, mark=mark)

    # ── keys ─────────────────────────────────────────────────────────────────

    def binds(self) -> list[Bind]:
        return [Bind(("enter",), "open", "open it in your editor"), Bind(("l",), "open", "open it in your editor"),
                Bind(("s",), "save", "save / unsave"), Bind(("u",), "undo", "undo")]

    def active_list(self) -> ItemList:
        return self.list

    def crumbs(self) -> list[str]:
        return [dict(VIEWS).get(self.view, "")]

    def web_route(self) -> str:
        it = self.list.selected
        return it["url"] if it else "/editor"

    def handle(self, action: str, count: int | None) -> bool:
        it = self.list.selected
        if action in ("open", "right"):
            if it:
                self.open_path(it["extra"]["path"])
            return True
        if action == "save" and it:
            self.app.toggle_saved({k: v for k, v in it.items() if not k.startswith("_")})
            self.list.repaint()
            return True
        if action == "undo":
            self.app.undo()
            return True
        return False

    def open_path(self, rel: str) -> None:
        """A workspace file in your own editor; back here when you quit it."""
        from ... import editor
        if not self.root:   # just opened: once the workspace is known
            self._pending = rel
            return
        p = inside(self.root, rel)
        if p is None:
            self.app.say("That path is outside the workspace.", "error")
            return
        if not p.exists():
            self.app.say(f"{rel} isn't there any more.", "warn")
            return
        if editor.open_file(self.app, str(p)):
            self.reload()   # what git says may have changed
