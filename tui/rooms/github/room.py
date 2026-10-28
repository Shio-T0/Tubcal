"""GitHub in the terminal: your inbox and your open work, with comments written in your
own editor.

Views (Tab / S-Tab): Inbox (GitHub's notifications; `Space t a` shows the read ones too)
and Work (review requests, your pull requests, what's assigned to you, mentions). Enter
on an issue or a pull request reads its conversation in the pane beside the list (and
marks the notification read); `i` writes a comment in your editor and posts it. `x`
marks a notification read, `dd` marks it done (`u` within a few seconds takes that
back: GitHub has no undo). Code, diffs and the rest of GitHub are in the web UI (`O`).

Everything here needs a linked account (Settings → Accounts, in the web UI).
"""

from __future__ import annotations

from rich.text import Text
from textual.containers import Vertical
from textual.widgets import Static

from ... import fmt, links
from ...api import ApiError, seg
from ...keys import Bind
from ...ui.chrome import Winbar
from ...ui.html import parse, wrap
from ...ui.itemlist import Head, ItemList, RowParts
from ...ui.paint import style
from ...ui.preview import Preview
from ..base import RoomView
from . import calendar

HUE = "magenta"
VIEWS = [("inbox", "Inbox"), ("work", "Work")]
WORK = [("review", "Review requested"), ("pulls", "Your pull requests"), ("assigned", "Assigned to you"),
        ("mentioned", "Mentions")]
DONE_AFTER = 5.0
REASONS = {"review_requested": "review requested", "ci_activity": "CI", "team_mention": "team mention",
           "security_alert": "security", "state_change": "state change"}


def thread_of(row: dict) -> tuple[str, int] | None:
    """(owner/name, number) for a notification or a work item about an issue or a PR."""
    t = row.get("target") or {}
    if t.get("kind") in ("issue", "pull") and t.get("number") and row.get("repo"):
        return row["repo"], int(t["number"])
    extra = row.get("extra") or {}
    if extra.get("kind") in ("issue", "pull") and extra.get("repo") and extra.get("number"):
        return extra["repo"], int(extra["number"])
    return None


def web_path(row: dict) -> str:
    """The row's place in Tubcal's web UI."""
    th = thread_of(row)
    kind = (row.get("target") or {}).get("kind") or (row.get("extra") or {}).get("kind")
    if th:
        return f"/github/r/{th[0]}/{'pull' if kind == 'pull' else 'issues'}/{th[1]}"
    repo = row.get("repo") or (row.get("extra") or {}).get("repo")
    return f"/github/r/{repo}" if repo else "/github?v=inbox"


class Github(RoomView):
    VIEWS = VIEWS

    def __init__(self, room, **kw):
        super().__init__(room, **kw)
        app = self.app
        saved = app.state.view(room.id)
        self.view = saved.get("view") if saved.get("view") in dict(VIEWS) else "inbox"
        self.show_all = bool(saved.get("show_all"))
        self.account: dict | None = None
        self.inbox: list[dict] | None = None
        self.work: dict | None = None
        self.stale = {}
        self.busy: set[str] = set()
        self.thread: dict | None = None      # the conversation in the pane
        self.thread_for: tuple | None = None
        self._done: tuple | None = None      # (rows, timer): a "done" not sent yet
        self.contrib: dict | None = None     # your contribution calendar
        r, g = app.roles, app.glyphs
        self.winbar = Winbar(r, g)
        self.winbar.hue = HUE
        self.list = ItemList(self._row, roles=r, glyphs=g, hue=HUE, id="list", empty=["Loading…"])
        self.preview = Preview(r, g, ratio=1.0, max_cols=14, cell_px=app.term.cell_px,
                               backend=app.image_backend, id="preview")
        self.calendar = Static("", id="calendar")
        self.calendar.styles.height = calendar.ROWS
        self.calendar.styles.margin = (1, 0, 0, 1)
        self.calendar.display = False

    def compose(self):
        with Vertical(id="middle"):
            yield self.winbar
            yield self.list
            yield self.calendar
        yield self.preview

    def on_mount(self) -> None:
        self._layout()

    def on_resize(self) -> None:
        self._layout()

    def _layout(self) -> None:
        w = self.size.width or self.app.size.width
        self.preview.display = w >= 90
        if w >= 90:
            self.preview.styles.width = max(44, min(80, int(w * 0.48)))
        self._paint_calendar()

    def _paint_calendar(self) -> None:
        """Under the list when there's room for it and for ten of the list's rows."""
        h = self.size.height or self.app.size.height
        w = self.size.width or self.app.size.width
        middle = w - (self.preview.styles.width.value if self.preview.display and self.preview.styles.width else 0)
        show = bool(self.contrib and self.contrib.get("days")) and h >= 1 + 20 + 1 + calendar.ROWS and middle >= 36
        self.calendar.display = show
        if not show:
            return
        r, g = self.app.roles, self.app.glyphs
        t = Text(no_wrap=True, overflow="crop")
        login = (self.account or {}).get("login") or ""
        for n, line in enumerate(calendar.lines(self.contrib, login, int(middle) - 3, g.levels, g.dot)):
            if n:
                t.append("\n")
            for s, role in line:
                t.append(s, style(r, role))
        self.calendar.update(t)

    # ── data ─────────────────────────────────────────────────────────────────

    def reload(self, force: bool = False) -> None:
        view = self.view
        self.busy.add(view)
        self._paint_winbar()
        self.run_worker(lambda: self._fetch(view, force), thread=True, group=f"gh-{view}", exclusive=True)

    def _fetch(self, view: str, force: bool) -> None:
        api = self.app.api
        try:
            if self.account is None or force:
                self.account = api.get("/github/account", timeout=20) or {}
            acct = self.account
            if not acct.get("linked"):
                self.app.call_from_thread(self._got, view, None, None)
                return
            if self.contrib is None or force:
                self.app.call_from_thread(lambda: self.run_worker(lambda: self._fetch_contrib(acct["login"]),
                                                                  thread=True, group="gh-contrib", exclusive=True))
            if view == "inbox":
                if not (acct.get("can") or {}).get("notifications"):
                    self.app.call_from_thread(self._got, view, None, "This account's token can't read notifications "
                                              "(a classic token with `notifications` or `repo` can).")
                    return
                d = api.get("/github/inbox", all="1" if self.show_all else None, timeout=40) or {}
                self.stale[view] = bool(d.get("stale"))
                self.app.call_from_thread(self._got, view, d.get("items") or [], None)
            else:
                self.app.call_from_thread(self._got, view, api.get("/github/work", timeout=60) or {}, None)
        except ApiError as e:
            self.app.call_from_thread(self._got, view, None, str(e))

    def _fetch_contrib(self, login: str) -> None:
        try:
            data = self.app.api.get(f"/github/user/{seg(login)}/contributions", timeout=40) or {}
        except ApiError:
            return   # the calendar is a nicety: no message for it

        def show():
            self.contrib = data
            self._paint_calendar()
        self.app.call_from_thread(show)

    def _got(self, view: str, data, error: str | None) -> None:
        self.busy.discard(view)
        if error:
            self.app.say(error, "error")
        if view == "inbox" and data is not None:
            self.inbox = data
        elif view == "work" and data is not None:
            self.work = data
        if view == self.view:
            self._show(error)
        self._paint_winbar()
        self.app.refresh_chrome()

    def _show(self, error: str | None = None) -> None:
        g = self.app.glyphs
        acct = self.account or {}
        rows: list = []
        if self.account is not None and not acct.get("linked"):
            self.list.empty = ["No GitHub account is linked.",
                               "O  Settings → Accounts in the web UI links one (the GitHub CLI's sign-in, or a token)"]
        elif error and ((self.view == "inbox" and self.inbox is None) or (self.view == "work" and self.work is None)):
            self.list.empty = [f"{g.error} {error}", "r  try again"]
        elif self.view == "inbox":
            pending = [id(r) for r in self._done[0]] if self._done else []
            items = [i for i in self.inbox or [] if id(i) not in pending]
            unread = [i for i in items if i.get("unread")]
            read = [i for i in items if not i.get("unread")]
            if unread:
                rows += [Head("Unread", len(unread)), *unread]
            if read:
                rows += [Head("Read", len(read)), *read]
            self.list.empty = ["Nothing in your inbox." + ("" if self.show_all else " Space t a shows the read ones.")]
        else:
            for key, label in WORK:
                part = (self.work or {}).get(key) or {}
                if part.get("items"):
                    rows += [Head(label, part.get("total") or len(part["items"])), *part["items"]]
            self.list.empty = ["Nothing open waits on you."]
        self.list.set_rows(rows)
        self._paint_winbar()

    def _paint_winbar(self) -> None:
        wb = self.winbar
        n_unread = sum(1 for i in self.inbox or [] if i.get("unread")) or None
        n_work = sum(len(((self.work or {}).get(k) or {}).get("items") or []) for k, _ in WORK) or None
        wb.views = [("inbox", "Inbox", n_unread), ("work", "Work", n_work)]
        wb.current = self.view
        wb.busy = self.view in self.busy
        bits = []
        if self.account and self.account.get("login"):
            bits.append(self.account["login"])
        if self.view == "inbox" and self.show_all:
            bits.append("read ones too")
        if self.stale.get(self.view):
            bits.append("cached")
        wb.right = f" {self.app.glyphs.dot} ".join(bits)
        wb.refresh()

    # ── rows ─────────────────────────────────────────────────────────────────

    def _row(self, row: dict) -> RowParts:
        g = self.app.glyphs
        if "target" in row:   # a notification
            t = row.get("target") or {}
            kind = t.get("kind")
            figure = {"pull": f"PR #{t.get('number')}", "issue": f"#{t.get('number')}", "checks": "checks",
                      "release": "release", "commit": (t.get("sha") or "")[:7], "discussion": "discussion"}.get(kind, "")
            meta = [(row.get("repo") or "", "dim")]
            reason = REASONS.get(row.get("reason"), (row.get("reason") or "").replace("_", " "))
            if reason:
                meta.append((f" {g.dot} {reason}", "faint"))
            if row.get("updated_at"):
                meta.append((f" {g.dot} {fmt.ago(row['updated_at'])}", "faint"))
            unread = row.get("unread")
            return RowParts(sign=(g.new, f"mark:{HUE}") if unread else (" ", "fg"),
                            title=[(fmt.clean(row.get("title")), "fg" if unread else "dim")],
                            figure=[(figure, f"hue:{HUE}" if kind == "pull" else "dim")], meta=meta)
        extra = row.get("extra") or {}
        state = extra.get("state") or "open"
        meta = [(extra.get("repo") or row.get("source") or "", "dim"), (f" {g.dot} {state}", "faint")]
        if extra.get("draft"):
            meta.append((f" {g.dot} draft", "faint"))
        if row.get("published_at"):
            meta.append((f" {g.dot} {fmt.ago(row['published_at'])}", "faint"))
        n = extra.get("comments") or 0
        mark = [(f"{n} comment{'s' if n != 1 else ''}", "dim")] if n else []
        if row.get("id") in self.app.saved:
            mark.append((f" {g.saved}", "mark:blue"))
        return RowParts(sign=(" ", "fg"), title=[(fmt.clean(row.get("title")), "fg")],
                        figure=[(f"#{extra.get('number')}", f"hue:{HUE}" if extra.get("kind") == "pull" else "dim")],
                        meta=meta, mark=mark)

    # ── the pane beside: the row, or its conversation ────────────────────────

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
        th = thread_of(row)
        width = max(20, (pv.size.width or 60) - 3)
        t = Text()
        if th and self.thread_for == th and self.thread:
            t.append_text(self._conversation(self.thread, width))
        else:
            t.append(fmt.clean(row.get("title")) + "\n", style(r, "fg+bold"))
            repo = row.get("repo") or (row.get("extra") or {}).get("repo") or ""
            t.append(repo + (f" #{th[1]}" if th else "") + "\n\n", style(r, "dim"))
            if th:
                t.append("⏎  reads the conversation here" + ("   i  comments" if self._can_comment() else "") + "\n",
                         style(r, "faint"))
            t.append("O  opens it in Tubcal's web UI   o  on github.com", style(r, "faint"))
        avatar = row.get("repo_avatar") or row.get("thumbnail")
        pv.show(t, (row.get("repo") or (row.get("extra") or {}).get("repo") or "?")[:1].upper(), avatar)

    def _conversation(self, d: dict, width: int) -> Text:
        r, g = self.app.roles, self.app.glyphs
        item = d.get("item") or {}
        extra = item.get("extra") or {}
        t = Text()
        t.append(fmt.clean(item.get("title")) + "\n", style(r, "fg+bold"))
        state = extra.get("state") or "open"
        t.append(f"{extra.get('repo')} #{extra.get('number')} {g.dot} ", style(r, "dim"))
        t.append(state, style(r, "hue:green" if state == "open" else f"hue:{HUE}" if state == "merged" else "dim"))
        t.append(f" {g.dot} {item.get('author') or ''}\n", style(r, "dim"))
        labels = [lab.get("name") for lab in extra.get("labels") or [] if isinstance(lab, dict) and lab.get("name")]
        if labels:
            t.append(" ".join(f"[{x}]" for x in labels) + "\n", style(r, "faint"))
        pull = d.get("pull")
        if pull:
            t.append(f"{pull.get('head')} → {pull.get('base')}", style(r, "dim"))
            if pull.get("additions") is not None:
                t.append(f"  +{pull['additions']}", style(r, "hue:green"))
                t.append(f" −{pull.get('deletions') or 0}", style(r, "hue:red"))
            t.append("\n")
        posts = [{"author": item.get("author"), "created_at": extra.get("created_at"), "html": d.get("body_html")}]
        posts += sorted((d.get("comments") or []) + (d.get("reviews") or []), key=lambda c: c.get("created_at") or 0)
        for c in posts:
            t.append("\n")
            t.append(c.get("author") or "ghost", style(r, f"hue:{HUE}+bold"))
            if c.get("state"):
                t.append(f" {c['state'].replace('_', ' ')}", style(r, "dim"))
            if c.get("created_at"):
                t.append(f" {g.dot} {fmt.ago_long(c['created_at'])}", style(r, "faint"))
            t.append("\n")
            blocks, _ = parse(c.get("html") or "")
            lines = wrap(blocks, width)
            if not lines:
                t.append("(nothing written)\n", style(r, "faint"))
            for line in lines:
                for s, role in line:
                    t.append(s, style(r, role))
                t.append("\n")
        if d.get("more_comments"):
            t.append("\nMore comments on the web: O\n", style(r, "faint"))
        if self._can_comment():
            t.append("\ni  write a comment" + (" (locked: only collaborators can)" if d.get("locked") else ""),
                     style(r, "faint"))
        return t

    def _can_comment(self) -> bool:
        return bool(((self.account or {}).get("can") or {}).get("comment"))

    def read_thread(self, row: dict, then=None) -> None:
        th = thread_of(row)
        if not th:
            self.app.say("That one isn't a conversation; o opens it on github.com.")
            return
        owner, name = th[0].split("/", 1)
        self.app.say("Reading the conversation…")

        def work():
            try:
                d, err = self.app.api.get(f"/github/repo/{seg(owner)}/{seg(name)}/thread/{th[1]}", timeout=40), None
            except ApiError as e:
                d, err = None, str(e)

            def show():
                if err:
                    self.app.say(err, "error")
                    return
                self.thread, self.thread_for = d, th
                self.app.say("")
                if self.list.selected is row:
                    self._preview(row)
                if then:
                    then()
            self.app.call_from_thread(show)
        self.run_worker(work, thread=True, group="gh-thread", exclusive=True)
        if row.get("unread") and "target" in row:
            self._mark_read(row)

    # ── writes ───────────────────────────────────────────────────────────────

    def _mark_read(self, row: dict) -> None:
        row["unread"] = False
        self.list.repaint()
        self._paint_winbar()

        def work():
            try:
                self.app.api.patch(f"/github/inbox/{seg(row['id'])}", {})
            except ApiError as e:
                row["unread"] = True
                self.app.call_from_thread(self.app.say, str(e), "error")
                self.app.call_from_thread(self._show)
        self.run_worker(work, thread=True)

    def _done_later(self, rows: list[dict]) -> None:
        self._send_done()   # an earlier one goes now
        timer = self.set_timer(DONE_AFTER, self._send_done)
        self._done = (rows, timer)
        self._show()
        n = len(rows)
        self.app.say(("Marked done" if n == 1 else f"{n} marked done") + " · u takes it back")

    def _send_done(self) -> None:
        if not self._done:
            return
        rows, timer = self._done
        self._done = None
        timer.stop()
        gone = [id(r) for r in rows]
        if self.inbox is not None:
            self.inbox = [i for i in self.inbox if id(i) not in gone]

        def work():
            for row in rows:
                try:
                    self.app.api.delete(f"/github/inbox/{seg(row['id'])}")
                except ApiError as e:
                    self.app.call_from_thread(self.app.say, str(e), "error")
                    return
        self.run_worker(work, thread=True)

    def _undo_done(self) -> bool:
        if not self._done:
            return False
        self._done[1].stop()
        self._done = None
        self._show()
        self.app.say("Back in the inbox.")
        return True

    def comment(self, row: dict) -> None:
        from ... import editor
        th = thread_of(row)
        if not th:
            self.app.say("Only issues and pull requests take comments.", "warn")
            return
        if not self._can_comment():
            self.app.say("This account's token can't comment (it needs `public_repo` or `repo`).", "warn")
            return
        if self.thread_for != th:
            self.read_thread(row, then=lambda: self.comment(row))
            return
        item = (self.thread or {}).get("item") or {}
        context = [f"A comment on {th[0]} #{th[1]}: {fmt.clean(item.get('title') or row.get('title'))}",
                   "Markdown, as on GitHub. Leave the file as it is to post nothing."]
        last = ((self.thread or {}).get("comments") or [])[-1:]
        for c in last:
            from ...ui.html import plain
            context += ["", f"The last comment, by {c.get('author')}:"] + \
                [f"> {ln}" for ln in plain(c.get("html") or "").splitlines()[:20]]
        body = editor.compose(self.app, "", context=context)
        if not body:
            self.app.say("Nothing posted.")
            return
        owner, name = th[0].split("/", 1)
        self.app.say("Posting your comment…")

        def work():
            try:
                self.app.api.post(f"/github/repo/{seg(owner)}/{seg(name)}/thread/{th[1]}/comments", {"body": body},
                                  timeout=40)
            except ApiError as e:
                self.app.call_from_thread(self.app.say, f"Not posted: {e}", "error")
                self.app.call_from_thread(self._keep_draft, body)
                return

            def done():
                self.app.say("Comment posted.")
                self.thread_for = None
                self.read_thread(row)
            self.app.call_from_thread(done)
        self.run_worker(work, thread=True)

    def _keep_draft(self, body: str) -> None:
        """A comment that didn't post goes to the clipboard, so it isn't lost."""
        self.app._copy(body)

    # ── keys ─────────────────────────────────────────────────────────────────

    def binds(self) -> list[Bind]:
        return [
            Bind(("enter",), "open", "read the conversation"), Bind(("i",), "write", "write a comment"),
            Bind(("x",), "read", "mark read"), Bind(("d", "d"), "done", "mark done"),
            Bind(("u",), "undo", "undo"), Bind(("s",), "save", "save / unsave"),
            Bind(("space", "t", "a"), "toggle_all", "show the read ones too"),
        ]

    def active_list(self) -> ItemList:
        return self.list

    def selected(self) -> dict | None:
        row = self.list.selected
        if not row:
            return None
        if "target" in row:   # a notification: the thing it's about
            return {"id": f"github:notif:{row.get('id')}", "platform": "github", "title": row.get("title"),
                    "url": (row.get("target") or {}).get("html_url"), "source": row.get("repo")}
        return row

    def item_of(self, row: dict) -> dict | None:
        """What `s` saves: a notification's issue or pull itself, so it's the same saved
        entry as the one saved from the web."""
        if "target" not in row:
            return row
        item = {"id": f"github:notif:{row.get('id')}", "platform": "github", "title": row.get("title"),
                "url": (row.get("target") or {}).get("html_url"), "source": row.get("repo")}
        th = thread_of(row)
        if th:
            kind = (row.get("target") or {}).get("kind")
            item = dict(item, id=f"github:{kind}:{th[0].lower()}#{th[1]}",
                        extra={"kind": kind, "repo": th[0], "number": th[1]})
        return item

    def handle_many(self, action: str, rows: list[dict]) -> bool:
        notes = [r for r in rows if "target" in r]
        if action not in ("read", "done"):
            return False
        if not notes:
            self.app.say("That works on notifications; these are in Work.", "warn")
        elif action == "read":
            for r in notes:
                if r.get("unread"):
                    self._mark_read(r)
        else:
            self._done_later(notes)
        return True

    def crumbs(self) -> list[str]:
        return [dict(VIEWS).get(self.view, "")]

    def web_route(self) -> str:
        row = self.list.selected
        return web_path(row) if row else f"/github?v={self.view}"

    def handle(self, action: str, count: int | None) -> bool:
        app = self.app
        row = self.list.selected
        if action in ("right", "open"):
            if row:
                if thread_of(row):
                    self.read_thread(row)
                elif app.web:
                    app._open_web(web_path(row))
                else:   # no web interface: the thing on github.com
                    url = (self.item_of(row) or {}).get("url")
                    problem = links.open_url(url, app.cfg["browser"]) if url else "There's nothing to open."
                    app.say(problem or "Opened it on github.com.", "error" if problem else "info")
            return True
        if action == "write" and row:
            self.comment(row)
            return True
        if action == "read" and row and "target" in row:
            if row.get("unread"):
                self._mark_read(row)
            return True
        if action == "done" and row:
            if "target" not in row:
                app.say("dd marks a notification done; this is in Work.", "warn")
            else:
                self._done_later([row])
            return True
        if action == "undo":
            if not self._undo_done():
                app.undo()
            return True
        if action == "save" and row:
            app.toggle_saved(self.item_of(row))
            self.list.repaint()
            return True
        if action == "toggle_all":
            self.show_all = not self.show_all
            app.state.view(self.room.id)["show_all"] = self.show_all
            app.state.save()
            if self.view != "inbox":
                self.set_view("inbox")
            else:
                self.reload()
            return True
        return False

    def on_unmount(self) -> None:
        self._send_done()
