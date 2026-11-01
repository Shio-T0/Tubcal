"""Settings (`Space ,`, `:settings`, `:set` alone): what the web interface's Settings
does that matters here, and the terminal's own.

    Accounts            link or unlink AniList, Reddit, GitHub
    Following           how many of each; Enter lists them (the Following page)
    Rooms in the tabs   each room on or off
    Playback, The Anime, Where rooms open   the server's, shared with the web and the phone
    This terminal       tui.toml: spacing, icons, pictures, the player, the editor…
    Your data           the picture cache, the read marks, tui.toml in your editor
    More                the keys, the commands, checkhealth, messages, about, the web's Settings

Enter changes the selected one (a switch flips, a choice steps on, a text goes to the
command line as `:set name=`), `h` `l` step a choice back and on. Unlinking and
forgetting take a second Enter. Each setting's `:set` name is beside it.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from .. import accounts, prefs
from .. import config as config_mod
from ..api import ApiError
from ..images import cache_dir
from ..rooms import ALL_ROOMS, CHANNELS
from ..theme import ROOM_HUES
from . import Entry, Note, Page, Section, ticks

ARMED_FOR = 5.0
PURPOSE = {
    "anilist": "Your list, the sync, the social pages",
    "reddit": "Your own front page; without it the Dispatch reads RSS",
    "github": "Your inbox, stars and work: the gh CLI's sign-in or a token",
}
PLATFORMS = (("youtube", "YouTube", "channel"), ("reddit", "Reddit", "subreddit"), ("github", "GitHub", "repo or person"))
START = {"accounts": "Accounts", "following": "Following", "rooms": "Rooms in the tabs", "playback": "Playback",
         "anime": "The Anime", "terminal": "This terminal", "data": "Your data"}


def home(path: Path | str) -> str:
    p, h = str(path), str(Path.home())
    return "~" + p[len(h):] if p.startswith(h + os.sep) else p


def folder_size(path: Path) -> int:
    try:
        return sum(f.stat().st_size for f in path.iterdir() if f.is_file())
    except OSError:
        return 0


class SettingsPage(Page):
    id = "settings"
    title = "Settings"
    subtitle = "Accounts, what you follow, the rooms, playback, and this terminal's own"
    route = "/settings"
    hints = (("⏎", "change"), ("h l", "step"), ("Tab", "next section"), ("/", "filter"), ("q", "close"))

    def __init__(self, app, start: str = ""):
        super().__init__(app)
        self.start = start
        self.got: dict | None = None
        self.armed: dict[str, float] = {}
        self._loading = False

    # ── loading ──────────────────────────────────────────────────────────────

    def opened(self) -> None:
        if self._loading:
            return
        self._loading = True
        app = self.app

        def work():
            got: dict = {}
            for key, path in (("oauth", "/oauth/status"), ("subs", "/subscriptions"), ("settings", "/settings")):
                try:
                    got[key] = app.api.get(path, timeout=20) or {}
                except ApiError:
                    got[key] = None
            if app.registry and app.registry.has("github"):
                try:
                    got["github"] = app.api.get("/github/account", timeout=20) or {}
                except ApiError:
                    got["github"] = None
            got["pictures"] = folder_size(app.pictures.folder) if not app.private else 0

            def show():
                self._loading = False
                self.got = got
                if got.get("settings"):
                    app.settings.update(got["settings"])
                self.repaint()
            app.call_from_thread(show)
        app.run_worker(work, thread=True, group="settings", exclusive=True)

    def tick(self) -> None:
        now = time.monotonic()
        gone = [k for k, t in self.armed.items() if now - t > ARMED_FOR]
        for k in gone:
            del self.armed[k]
        if gone:
            self.repaint()

    def first(self) -> str | None:
        want = START.get(self.start)
        if not want:
            return None
        seen = False
        for r in self.rows():
            if isinstance(r, Section):
                seen = r.label == want
            elif seen and isinstance(r, Entry):
                return r.id
        return None

    # ── the rows ─────────────────────────────────────────────────────────────

    def rows(self):
        out: list = []
        out += self._accounts()
        out += self._following()
        out += self._rooms()
        for section, note in prefs.SECTIONS.items():
            ps = [p for p in prefs.shown(self.app) if p.section == section]
            if not ps:
                continue
            if section == "This terminal":
                note = home(config_mod.path())
            out.append(Section(section, note))
            out += [self._pref(p) for p in ps]
        out += self._data()
        out += self._more()
        return out

    def _switch(self, on: bool, words: tuple[str, str] = ("on", "off")) -> list:
        g = self.app.glyphs
        return [(f"{g.on} ", "hue:green"), (words[0], "fg")] if on else [(f"{g.off} ", "faint"), (words[1], "dim")]

    def _armed(self, eid: str, what: str) -> list | None:
        return [(f"⏎ again to {what}", "hue:red+bold")] if eid in self.armed else None

    def _arm(self, eid: str, what: str, then) -> None:
        """Destructive things take a second Enter within a few seconds."""
        if eid in self.armed:
            del self.armed[eid]
            then()
        else:
            self.armed[eid] = time.monotonic()
            self.app.say(f"Press Enter again to {what}.", "warn")
        self.repaint()

    def _accounts(self) -> list:
        reg, got = self.app.registry, self.got
        out = [Section("Accounts", "the tokens stay on this machine")]
        oauth = (got or {}).get("oauth") or {}
        for provider, (label, _, room_id) in accounts.OAUTH.items():
            if reg and not reg.has(room_id):
                continue
            eid = f"acct:{provider}"
            if got is None:
                figure, on = [("reading…", "faint")], False
            else:
                on = bool((oauth.get(provider) or {}).get("connected"))
                figure = self._switch(on, ("connected", "not connected"))
            mark = self._armed(eid, "unlink") or [(f":unlink {provider}" if on else f":link {provider}", "faint")]
            act = (lambda p=provider, e=eid, n=label: self._arm(e, f"unlink {n}", lambda: self._unlink(p))) if on \
                else (lambda p=provider: self._link(p))
            out.append(Entry(eid, [(label, "fg")], figure=figure, meta=[(PURPOSE[provider], "dim")], mark=mark,
                             act=act, find="account link oauth"))
        if not reg or reg.has("github"):
            gh = (got or {}).get("github")
            eid = "acct:github"
            on = bool(gh and gh.get("linked"))
            figure = [("reading…", "faint")] if got is None else \
                self._switch(on, (f"linked as {gh.get('login')}" if on else "", "not linked"))
            mark = self._armed(eid, "unlink") or [(":unlink github" if on else ":link github", "faint")]
            act = (lambda: self._arm(eid, "unlink GitHub", lambda: self._unlink("github"))) if on else \
                (lambda: self._link("github"))
            out.append(Entry(eid, [("GitHub", "fg")], figure=figure, meta=[(PURPOSE["github"], "dim")], mark=mark,
                             act=act, find="account link token gh"))
        if len(out) == 1:
            out.append(Note([("No room here uses an account.", "dim")]))
        return out

    def _link(self, provider: str) -> None:
        self.app.close_pages()
        accounts.link(self.app, provider)

    def _unlink(self, provider: str) -> None:
        accounts.unlink(self.app, provider)   # the page reads its accounts again when it's done

    def _following(self) -> list:
        from .following import FollowingPage
        app, reg = self.app, self.app.registry
        subs = (self.got or {}).get("subs") or {}
        out = [Section("Following")]
        for platform, label, word in PLATFORMS:
            if reg and not reg.has(accounts.PLATFORM_ROOM[platform]):
                continue
            rows = subs.get(platform) or []
            n = len(rows)
            names = ", ".join(str(x.get("display_name")) for x in rows[:6]) + (" …" if n > 6 else "")
            plural = word + ("s" if n != 1 and platform != "github" else "")
            figure = [("reading…", "faint")] if self.got is None else [(f"{n} {plural}", "fg" if n else "dim")]
            meta = [(names, "dim")] if names else ticks(f"Nothing yet: `:follow` {'@name' if platform == 'youtube' else 'r/name' if platform == 'reddit' else 'owner/repo'}")
            out.append(Entry(f"follow:{platform}", [(label, "fg")], figure=figure, meta=meta,
                             mark=[(":follow …  :unfollow …", "faint")], find="following subscriptions",
                             act=lambda p=platform: app.open_page(FollowingPage(app, p))))
        if len(out) == 1:
            out.append(Note([("No room here follows anything.", "dim")]))
        return out

    def _rooms(self) -> list:
        app, reg = self.app, self.app.registry
        active = set(app.settings.get("active_rooms") or (reg.active if reg else []))
        out = [Section("Rooms in the tabs", "a room out of the tabs still opens when asked for")]
        channel = {rid: label for _cid, label, _k, ids in CHANNELS for rid in ids}
        for rm in ALL_ROOMS:
            hue = ROOM_HUES.get(rm.id, "blue")
            go = next((b.keys for b in app.global_binds if b.action == f"room:{rm.id}" and len(b.keys) == 2), None)
            where = channel.get(rm.id, "") + (f" · g{go[1]}" if go and len(go) == 2 else "")
            if reg and not reg.has(rm.id):
                out.append(Entry(f"room:{rm.id}", [(rm.label, "faint")], figure=[("not installed", "faint")],
                                 meta=[(where, "faint")], mark=[(f"tubcal add {rm.id}", "faint")],
                                 act=lambda r=rm: app.say(f"{r.label} isn't installed here: tubcal add {r.id}"),
                                 find="room module"))
                continue
            on = rm.fixed or rm.id in active
            figure = [("always on", "dim")] if rm.fixed else self._switch(on)
            mark = [] if rm.fixed else [(f":room {'off' if on else 'on'} {rm.id}", "faint")]
            out.append(Entry(f"room:{rm.id}", [(rm.label, f"hue:{hue}")], figure=figure, meta=[(where, "dim")],
                             mark=mark, act=(lambda r=rm, o=on: self._room(r, not o)), data=("room", rm, on),
                             find="room tabs"))
        return out

    def _room(self, rm, on: bool) -> None:
        if rm.fixed:
            self.app.say(f"{rm.label} is always on.")
            return
        accounts.room(self.app, f"{'on' if on else 'off'} {rm.id}")

    def _pref(self, p: prefs.Pref) -> Entry:
        v = prefs.value(self.app, p)
        meta = [(p.hint, "dim")] + ([(" · from the next start", "faint")] if p.restart else [])
        return Entry(f"pref:{p.name}", [(p.label, "fg")], figure=self._value(p, v), meta=meta,
                     mark=[(f":set {p.name}", "faint")], data=p, find=f"{p.name} {p.key} set",
                     act=lambda p=p: self._activate(p))

    def _value(self, p: prefs.Pref, v) -> list:
        g, hue = self.app.glyphs, self.hue
        if p.kind == "switch":
            return self._switch(bool(v))
        if p.kind == "text":
            return [(str(v), "fg")] if v else [("not set", "faint")]
        cur = prefs.option_index(p, v)
        strip: list = []
        for i, (_, label) in enumerate(p.options):
            if strip:
                strip.append(("  ", "fg"))
            strip += [(g.choice_l, f"hue:{hue}"), (label, f"hue:{hue}+bold"), (g.choice_r, f"hue:{hue}")] \
                if i == cur else [(label, "dim")]
        if cur < 0:
            strip = [(g.choice_l, f"hue:{hue}"), (prefs.label_of(p, v), f"hue:{hue}+bold"),
                     (g.choice_r, f"hue:{hue}"), ("  ", "fg")] + strip
        return strip

    def _activate(self, p: prefs.Pref) -> None:
        if p.kind == "text":
            self.app.close_pages()
            self.app.start_command(f"set {p.name}={prefs.value(self.app, p) or ''}")
            return
        self.change(p, prefs.step(p, prefs.value(self.app, p), 1))

    def change(self, p: prefs.Pref, v) -> None:
        app = self.app

        def done(problem):
            app.say(problem, "error") if problem else app.say(prefs.said(p, v))
            app.pref_changed(p)
            self.repaint()
        prefs.put(app, p, v, done=done)
        self.repaint()

    def _data(self) -> list:
        app = self.app
        out = [Section("Your data", "this terminal's")]
        size = (self.got or {}).get("pictures")
        mb = "in memory only" if app.private else ("…" if size is None else f"{size / 1e6:.1f} MB")
        out.append(Entry("data:pictures", [("Pictures", "fg")], figure=[(mb, "fg")],
                         meta=[(f"Kept for a week in {home(cache_dir())}", "dim")],
                         mark=self._armed("data:pictures", "empty it") or [(":cache clear", "faint")],
                         act=lambda: self._arm("data:pictures", "empty the picture cache", self._clear_pictures),
                         find="cache images thumbnails"))
        out.append(Entry("data:marks", [("Read marks and podcast places", "fg")],
                         meta=[("What the terminal marked read or seen, and where you stopped in each episode", "dim")],
                         mark=self._armed("data:marks", "forget them") or [(":history clear", "faint")],
                         act=lambda: self._arm("data:marks", "forget the read marks", self._forget),
                         find="history seen read"))
        out.append(Entry("data:toml", [("tui.toml in your editor", "fg")], meta=[(home(config_mod.path()), "dim")],
                         act=self._edit_toml, find="config file edit keys"))
        return out

    def _clear_pictures(self) -> None:
        self.app.run_command("cache clear")
        if self.got is not None:
            self.got["pictures"] = folder_size(self.app.pictures.folder) if not self.app.private else 0

    def _forget(self) -> None:
        self.app.run_command("history clear")

    def _edit_toml(self) -> None:
        from .. import editor
        p = config_mod.path()
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("# Tubcal in a terminal. :settings changes most of these; your own keys go under\n"
                         "# [keys] (the names are on the :keys page).\n")
        if editor.open_file(self.app, str(p)):
            self.app.reload_config()
            self.repaint()

    def _more(self) -> list:
        app = self.app
        out = [Section("More")]
        for eid, title, meta, act in (
                ("more:keys", "Keys", "Every key, by what it does (`?`)", app.open_keys),
                ("more:help", "Commands", "Every `:` command (`:help`)", lambda: app.run_command("help")),
                ("more:health", "checkhealth", "What works here", lambda: app.run_command("checkhealth")),
                ("more:messages", "Messages", "What this session said", lambda: app.run_command("messages")),
                ("more:about", "About", "The licence, and what Tubcal builds on", lambda: app.run_command("about"))):
            out.append(Entry(eid, [(title, "fg")], meta=ticks(meta), act=act))
        if app.web:
            out.append(Entry("more:web", [(f"The rest of Settings {app.glyphs.web}", "fg")],
                             meta=[("The subtitle look, the Archive's and the Edition's models, the editor, "
                                    "your data's snapshots: in the web interface", "dim")],
                             act=lambda: app.open_web("/settings"), find="web browser"))
        else:
            out.append(Note(ticks("The rest of Settings (the subtitle look, the Archive's and the Edition's "
                                  "models, your data's snapshots) is in the web interface, which this install "
                                  "doesn't have: `tubcal add web`.")))
        return out

    # ── keys ─────────────────────────────────────────────────────────────────

    def handle(self, action: str, entry: Entry | None, count: int | None) -> bool:
        if entry is None:
            return False
        data = entry.data
        if isinstance(data, prefs.Pref) and action in ("left", "right", "increase", "decrease"):
            n = 1 if action in ("right", "increase") else -1
            if data.kind == "text":
                return action in ("increase", "decrease")
            v = prefs.value(self.app, data)
            new = (n > 0) if data.kind == "switch" else prefs.step(data, v, n * (count or 1))
            if new != v:
                self.change(data, new)
            return True
        if isinstance(data, tuple) and data[0] == "room" and action in ("left", "right", "increase", "decrease"):
            _, rm, on = data
            want = action in ("right", "increase")
            if want != on:
                self._room(rm, want)
            return True
        return False
