"""`:following`: every channel, subreddit, repo and person you follow, by platform.

Enter opens one where it lives (a channel's uploads in the Screening Room, a
subreddit in the Dispatch, GitHub on github.com), `dd` unfollows (`u` follows again),
`a` puts `:follow ` on the command line, `o` opens it on its site.
"""

from __future__ import annotations

from .. import accounts, fmt
from ..api import ApiError
from ..keys import Bind
from ..ui.paint import who
from . import Entry, Note, Page, Section, ticks

PLATFORMS = (("youtube", "YouTube", "channels"), ("reddit", "Reddit", "subreddits"),
             ("github", "GitHub", "repos and people"))


def site_url(row: dict) -> str:
    sid = str(row.get("source_id") or "")
    return {"youtube": f"https://www.youtube.com/channel/{sid}", "reddit": f"https://www.reddit.com/r/{sid}",
            "github": f"https://github.com/{sid}"}.get(row.get("platform") or "", "")


def follow_input(row: dict) -> str:
    """What `:follow` takes to follow it again."""
    sid = str(row.get("source_id") or "")
    return {"youtube": f"https://www.youtube.com/channel/{sid}", "reddit": f"r/{sid}"}.get(row.get("platform"), sid)


class FollowingPage(Page):
    id = "following"
    title = "Following"
    subtitle = "What the rooms follow for you"
    route = "/settings?s=subscriptions"
    hints = (("⏎", "open"), ("dd", "unfollow"), ("u", "undo"), ("a", "follow"), ("/", "filter"), ("q", "close"))

    def __init__(self, app, platform: str = ""):
        super().__init__(app)
        self.platform = platform
        self.subs: dict | None = None
        self.gone: list[dict] = []    # unfollowed here, newest last: `u` brings one back

    def binds(self) -> list[Bind]:
        return [Bind(("d", "d"), "unfollow", "unfollow"), Bind(("u",), "undo", "follow it again"),
                Bind(("a",), "add", "follow something"), Bind(("i",), "add", "follow something")]

    def opened(self) -> None:
        app = self.app

        def work():
            try:
                subs = app.api.get("/subscriptions", timeout=20) or {}
            except ApiError as e:
                app.call_from_thread(app.say, str(e), "error")
                subs = {}

            def show():
                first = self.subs is None
                self.subs = subs
                keep = None
                if first and self.platform and subs.get(self.platform):
                    keep = f"sub:{subs[self.platform][0]['id']}"
                self.repaint(keep=keep)
            app.call_from_thread(show)
        app.run_worker(work, thread=True, group="following", exclusive=True)

    def rows(self):
        reg = self.app.registry
        if self.subs is None:
            return [Note([("Reading what you follow…", "dim")])]
        out: list = []
        for platform, label, word in PLATFORMS:
            if reg and not reg.has(accounts.PLATFORM_ROOM[platform]):
                continue
            rows = self.subs.get(platform) or []
            out.append(Section(label, f"{len(rows)} {word}"))
            if not rows:
                example = {"youtube": "@name", "reddit": "r/name", "github": "owner/repo"}[platform]
                out.append(Note(ticks(f"Nothing yet: `:follow {example}`, or `a` here.")))
            for row in rows:
                name = str(row.get("display_name") or row.get("source_id") or "")
                since = fmt.ago_long(row.get("added_at")) if row.get("added_at") else ""
                meta = [(str(row.get("source_id") or ""), "dim")] + ([(f" · followed {since}", "faint")]
                                                                      if since else [])
                out.append(Entry(f"sub:{row['id']}", [(name, who(name))], meta=meta,
                                 find=f"{platform} {label}", data=row, act=lambda r=row: self._open(r)))
        return out

    def item_of(self, entry: Entry | None) -> dict | None:
        row = entry.data if entry else None
        if not isinstance(row, dict):
            return None
        return {"id": f"sub:{row.get('id')}", "title": row.get("display_name"), "url": site_url(row)}

    def _open(self, row: dict) -> None:
        app = self.app
        platform, sid = row.get("platform"), str(row.get("source_id") or "")
        if platform == "youtube" and app.registry and app.registry.has("youtube"):
            app.in_room("youtube", lambda room: room.show_channel(sid))
        elif platform == "reddit" and app.registry and app.registry.has("reddit"):
            app.in_room("reddit", lambda room: room.show_subreddit(sid))
        else:
            app.open_link(site_url(row))

    def handle(self, action: str, entry: Entry | None, count: int | None) -> bool:
        app = self.app
        row = entry.data if entry and isinstance(entry.data, dict) else None
        if action == "add":
            app.close_pages()
            app.start_command("follow ")
            return True
        if action == "undo":
            if not self.gone:
                app.say("Nothing to follow again.")
                return True
            row = self.gone.pop()
            app.run_command(f"follow {follow_input(row)}")
            app.set_timer(1.5, self.reload)
            return True
        if action == "unfollow" and row:
            self._unfollow(row)
            return True
        return False

    def _unfollow(self, row: dict) -> None:
        app = self.app
        name = row.get("display_name") or row.get("source_id")
        for p in self.subs.values() if self.subs else []:
            if row in p:
                p.remove(row)
        self.gone.append(row)
        self.repaint()

        def work():
            try:
                app.api.delete(f"/subscriptions/{row['id']}")
                app.call_from_thread(accounts._followed, app, row["platform"],
                                     f"Not following {name} any more · u follows again", "info", True)
            except ApiError as e:
                app.call_from_thread(app.say, str(e), "error")
                app.call_from_thread(self.reload)
        app.run_worker(work, thread=True, group="unfollow")
