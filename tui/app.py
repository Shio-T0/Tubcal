"""Tubcal in the terminal.

One screen: the tabline, the room you're in, the statusline. Keys go through
`keys.Keys` (vim-style: counts, chords, which-key), never through Textual's own
bindings, which are switched off (no Ctrl+P palette, no Tab focus cycling, no
Ctrl+C quit: like vim, `:q` or `ZZ` quits).
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from rich.text import Text
from textual import events
from textual.app import App
from textual.containers import Container
from textual.screen import Screen
from textual.theme import Theme
from textual.widgets import Static

from . import accounts, fmt, links
from . import config as config_mod
from .api import Api, ApiError, seg, server_port
from .bootstrap import REPO, log_path, start_server
from .glyphs import choose as choose_glyphs
from .anime import Shows
from .images import Pictures
from .keys import GLOBAL, VISUAL, Bind, Hit, Keys, remap, token_of
from .media.player import Player
from .media.radio import Radio, episode_of
from .media.sleep import SleepTimer
from .media.sleep import parse as parse_sleep
from .rooms import CHANNELS, HOME, ROOM_BY_ID, Registry, load_screen
from .rooms.base import RoomView, WebRoom
from .state import State
from .terminal import TermInfo
from .theme import ROOM_HUES, gamma_ok, solve, textual_variables
from .saved import kind_of
from .ui.chrome import Statusline, Tabline, WhichKey
from .ui.drawer import VIEWS, SavedDrawer
from .ui.finder import Finder
from .ui.itemlist import ItemList
from .ui import paint
from .ui.paint import style

COMMANDS = ["q", "quit", "qa", "open", "play", "yt", "hn", "r", "ar", "ask", "sleep", "radio", "private",
            "checkhealth", "messages", "map", "theme", "refresh", "set", "cache", "history", "follow",
            "unfollow", "link", "unlink", "room", "settings", "about"]
SEARCH_ROOMS = {"yt": "youtube", "hn": "hackernews", "r": "reddit", "ar": "archive"}
# the keys that stretch a VISUAL range instead of ending it
MOVES = {"down", "up", "top", "bottom", "half_down", "half_up", "page_down", "page_up", "center", "to_top",
         "to_bottom", "search_next", "search_prev"}


@dataclass
class Jump:
    room: str
    view: str


class Info(Static):
    """A full-page sheet over the room (`:checkhealth`, `:messages`, `?`); q closes it."""
    DEFAULT_CSS = "Info { height: 1fr; padding: 1 2; overflow-y: auto; display: none; }"


class Main(Screen, inherit_bindings=False):
    BINDINGS = []
    DEFAULT_CSS = """
    Main { layers: base float; background: ansi_default; }
    #body { height: 1fr; }
    """

    def compose(self):
        app: TubcalApp = self.app  # type: ignore[assignment]
        yield app.tabline
        yield Container(id="body")
        yield app.info
        yield app.drawer
        yield app.finder
        yield app.statusline
        yield app.whichkey

    def on_key(self, event: events.Key) -> None:
        event.stop()
        event.prevent_default()
        self.app.handle_key(event)  # type: ignore[attr-defined]


class TubcalApp(App, inherit_bindings=False):
    BINDINGS = []
    ENABLE_COMMAND_PALETTE = False
    ESCAPE_TO_MINIMIZE = False
    TITLE = "Tubcal"

    def __init__(self, term: TermInfo, *, start_room: str | None = None, url: str | None = None,
                 private: bool = False, base: str | None = None, transport=None):
        # the colour roles first: Textual reads our CSS variables inside App.__init__
        self.term = term
        self.cfg, cfg_problem = config_mod.load()
        paint.LOOK["comfy"] = self.cfg["spacing"] != "compact"   # before any widget is made
        self.glyphs = choose_glyphs(self.cfg["icons"])
        self.roles = solve(term.palette)
        super().__init__()
        self.private = private
        self.state = State(private=private)
        if not self.state.data.get("first_run"):
            self.state.data["first_run"] = time.time()
        self.first_run = float(self.state.data["first_run"])
        self.api = Api(base or f"http://127.0.0.1:{server_port(REPO)}", transport=transport, private=private)
        self.settings: dict = {}
        self.pictures = Pictures(self.api, private=private)
        choice = self.cfg["images"]
        self.image_backend = term.image_backend if choice == "auto" else choice
        self.player = Player(self.api, notify=self._notify_threadsafe, changed=self._player_changed,
                             settings=self.settings, config=self.cfg)
        self.saved: dict[str, dict] = {}
        self.anime = Shows(self)
        self.player.follow = self.anime.follow
        self.player.on_finished = self._finished_threadsafe
        self.radio = Radio(self.state, notify=self._notify_threadsafe, changed=self._player_changed,
                           config=self.cfg)
        self.sleep = SleepTimer(lambda: [self.player.mpv, self.radio.mpv],
                                notify=self._notify_threadsafe, changed=self._player_changed)
        # one sound at a time, and the sleep timer's "end of this one"
        self.player.on_audible = self.radio.pause
        self.radio.on_audible = self.player.pause
        self.player.on_end = self.sleep.ended
        self.radio.on_end = self.sleep.ended
        self.undo_stack: list[tuple[str, dict]] = []   # ("batch", [...]) for a VISUAL range
        self._visual_list: ItemList | None = None
        self.registry: Registry | None = None
        self.rooms: dict[str, RoomView] = {}
        self.room_id = start_room or self.state.data.get("room") or "home"
        self.start_url = url
        self._key_problems: list[str] = []
        self.global_binds = self._layer("keys", GLOBAL)
        self.visual_binds = self._layer("visual", VISUAL)
        self.keys = Keys(self.global_binds)
        self.mode = "NORMAL"
        self.buffer, self.cursor = "", 0
        self.cmd_history: list[str] = []
        self.search_term = ""
        self.jumps: list[Jump] = []
        self.messages: list[tuple[float, str, str]] = []
        self.live = 0
        self.web = True   # the server has the web interface (/api/health says)
        self.ready = False
        self._whichkey_timer = None
        self.tabline = Tabline(self.roles, self.glyphs)
        self.statusline = Statusline(self.roles, self.glyphs)
        self.whichkey = WhichKey(self.roles)
        self.info = Info("")
        self.drawer = SavedDrawer(self.roles, self.glyphs)
        self.finder = Finder(self.roles, self.glyphs)
        self._find_timer = None
        self.statusline.private = private
        self._startup_problem = cfg_problem

    # ── setup ────────────────────────────────────────────────────────────────

    def get_theme_variable_defaults(self) -> dict[str, str]:
        """Our colour variables exist from the first stylesheet parse on, before the
        terminal theme is registered."""
        roles = getattr(self, "roles", None)
        ours = textual_variables(roles) if roles is not None else {}
        return {**super().get_theme_variable_defaults(),
                "ansi-background": "ansi_default", "ansi-foreground": "ansi_default", **ours}

    def on_mount(self) -> None:
        self.register_theme(Theme(
            name="tubcal-terminal", primary="ansi_blue", background="ansi_default",
            foreground="ansi_default", surface="ansi_default", panel="ansi_default",
            dark=self.term.palette.dark if self.term.palette else True,
            ansi=True, variables={"ansi-background": "ansi_default", "ansi-foreground": "ansi_default",
                                  **textual_variables(self.roles)},
        ))
        self.theme = "tubcal-terminal"
        self.ansi_color = True
        self.push_screen(Main())
        self.set_interval(1.0, self._tick)
        if self._startup_problem:
            self.say(self._startup_problem, "warn")
        self._say_key_problems()
        self.run_worker(self._boot, thread=True, group="boot")

    def _boot(self) -> None:
        api = self.api
        health = api.health()
        if health is None:
            how = start_server()
            t0 = time.monotonic()
            while health is None and time.monotonic() - t0 < 90:
                secs = int(time.monotonic() - t0)
                self.call_from_thread(self._starting, f"Starting the Tubcal server · {secs} s · {how}")
                time.sleep(0.5)
                health = api.health()
            if health is None:
                self.call_from_thread(self._server_down, f"The Tubcal server didn't start. Its log: {log_path()}")
                return
        try:
            self.settings.update(api.get("/settings") or {})
        except ApiError:
            pass
        try:
            for it in (api.get("/saved") or {}).get("items") or []:
                self.saved[it.get("id")] = it
        except ApiError:
            pass
        self.player.load_progress()
        self.call_from_thread(self._on_server_ready, health)
        try:
            self.pictures.prune()
        except OSError:
            pass

    def _starting(self, text: str) -> None:
        self.tabline.starting = text
        self.tabline.refresh()

    def _server_down(self, text: str) -> None:
        self.tabline.server_down = True
        self.tabline.registry = Registry(None, None)
        self.tabline.refresh()
        self.say(text, "error")

    def _on_server_ready(self, health: dict) -> None:
        self.web = health.get("web", True) is not False
        if not self.web:   # nothing to open in a browser: Settings is a sheet here
            self.global_binds = [Bind(b.keys, b.action, b.help.removesuffix(" ↗")) for b in self.global_binds]
            self.keys = Keys(self.global_binds)
        self.registry = Registry(health.get("modules"), self.settings.get("active_rooms"))
        self.tabline.registry = self.registry
        self.tabline.built = {r.id for r in ROOM_BY_ID.values() if r.built and self.registry.has(r.id)}
        self.ready = True
        room = self.room_id if self.room_id == "home" or (
            self.room_id in ROOM_BY_ID and self.registry.has(self.room_id)) else None
        self.go_room(room or "home", remember=False)
        if self.start_url:
            self.run_worker(lambda: self._open_url(self.start_url), thread=True)
        self.run_worker(self._watch_live, thread=True, group="live")

    def _watch_live(self) -> None:
        """How many of your channels are live, every 5 minutes (the tabline's ● n live).
        Stops as soon as the app closes (a thread worker can't be killed, only asked)."""
        from textual.worker import get_current_worker
        worker = get_current_worker()
        while not worker.is_cancelled:
            if self.registry and self.registry.has("youtube"):
                try:
                    items = (self.api.get("/youtube/live", timeout=60) or {}).get("items") or []
                    n = sum(1 for i in items if (i.get("extra") or {}).get("live_status") == "is_live")
                    if not worker.is_cancelled:
                        self.call_from_thread(self.set_live, n)
                except (ApiError, RuntimeError):
                    pass
            for _ in range(300):
                if worker.is_cancelled:
                    return
                time.sleep(1)

    def set_live(self, n: int) -> None:
        self.live = n
        self.tabline.live = n
        self.tabline.refresh()

    # ── rooms ────────────────────────────────────────────────────────────────

    @property
    def room(self) -> RoomView | None:
        return self.rooms.get(self.room_id)

    def go_room(self, room_id: str, *, remember: bool = True) -> None:
        if room_id == "saved":
            self.open_drawer()
            return
        if room_id == "settings":
            self._settings()
            return
        if not self.registry:
            return
        room = HOME if room_id == "home" else ROOM_BY_ID.get(room_id)
        if not room or (room is not HOME and not self.registry.has(room_id)):
            name = room.label if room else room_id
            self.say(f"{name} isn't installed here: tubcal add {room_id}", "warn")
            return
        if room is not HOME and not self.registry.number(room_id):
            # switched off in Settings: it opens when asked for, but isn't in the tabs
            self.say(f"{room.label} is switched off in Settings → Rooms; it opens anyway when you ask.")
        if remember and self.room_id != room_id and self.room:
            self.jumps.append(Jump(self.room_id, self.room.view))
            del self.jumps[:-50]
        body = self.screen.query_one("#body", Container)
        if self.room is not None:
            self.room.display = False
        self.room_id = room_id
        self.state.data["room"] = room_id
        self.state.save()
        if room_id not in self.rooms:
            cls = load_screen(room) or WebRoom
            view = cls(room)
            self.rooms[room_id] = view
            body.mount(view)
        view = self.rooms[room_id]
        view.display = True
        self.keys = Keys(self.global_binds)
        self.keys.push(self._layer(room_id, view.binds()))
        self._say_key_problems()
        self.tabline.room_id = room_id
        self.close_info()
        view.activate()
        self.refresh_chrome()

    def go_channel(self, channel_id: str) -> None:
        rooms = self.registry.rooms_in(channel_id) if self.registry else []
        if not rooms:
            self.say("That channel has no rooms on this install.", "warn")
            return
        built = [r for r in rooms if r.built]
        self.go_room((built or rooms)[0].id)

    # ── chrome ───────────────────────────────────────────────────────────────

    def refresh_chrome(self) -> None:
        room = self.room
        sl = self.statusline
        sl.mode = self.mode
        sl.crumbs = room.crumbs() if room else []
        sl.hue = "blue" if self.drawer.display else ROOM_HUES.get(self.room_id, "blue")
        if self.drawer.display:
            sl.crumbs = ["Saved", dict(VIEWS).get(self.drawer.view, "")]
        lst = self.active_list()
        sl.position = lst.position if lst else (0, 0)
        rng = self._visual_list.visual_range() if self.mode == "VISUAL" and self._visual_list else None
        if rng:
            sl.pending = f"{rng[1] - rng[0] + 1} rows"
        stale = getattr(room, "stale", {}).get(getattr(room, "view", ""), False) if room else False
        loading = room and getattr(room, "view", None) in getattr(room, "busy", set())
        sl.stale = "loading" if loading else ("cached" if stale else "")
        sl.now = self.player.now
        sl.refresh()
        self.tabline.refresh()

    def state_changed(self) -> None:
        self.refresh_chrome()

    def _tick(self) -> None:
        self.sleep.tick()
        self.statusline.sleep = self.sleep.label()
        self.statusline.clear_message()
        self.statusline.refresh()

    def say(self, text: str, level: str = "info") -> None:
        if text:
            self.messages.append((time.time(), level, text))
            del self.messages[:-200]
        self.statusline.say(text, level)

    def _notify_threadsafe(self, text: str, level: str) -> None:
        self.call_from_thread(self.say, text, level)

    def _player_changed(self) -> None:
        try:
            self.call_from_thread(self._player_repaint)
        except RuntimeError:  # already on the app's thread
            self._player_repaint()

    def _player_repaint(self) -> None:
        sl = self.statusline
        sl.now = self.player.now
        sl.radio = self.radio.now
        sl.radio_show = (self.radio.episode or {}).get("show") or ""
        sl.sleep = self.sleep.label()
        sl.refresh()
        # the rows' signs and "left" times follow the playing item, every couple of seconds
        now = time.monotonic()
        if now - getattr(self, "_rows_painted", 0) >= 2 and self.room and hasattr(self.room, "refresh_rows"):
            self._rows_painted = now
            self.room.refresh_rows()

    def _finished_threadsafe(self, item: dict) -> None:
        self.call_from_thread(self._finished, item)

    def _finished(self, item: dict) -> None:
        if str(item.get("id", "")).startswith("anime:"):
            self.anime.finished(item)
        for room in self.rooms.values():
            if hasattr(room, "refresh_rows"):
                room.refresh_rows()

    def queue_position(self, item_id: str) -> int:
        for n, it in enumerate(self.player.queue, 1):
            if it.get("id") == item_id:
                return n
        return 0

    # ── keys ─────────────────────────────────────────────────────────────────

    def handle_key(self, event: events.Key) -> None:
        token = token_of(event.key, event.character)
        self.statusline.clear_message(key=True)
        if self.mode in ("COMMAND", "SEARCH"):
            self._edit_line(token, event.character)
            return
        if self.mode == "FIND":
            self._edit_find(token, event.character)
            return
        hit = self.keys.feed(token)
        if hit == "pending":
            self.statusline.pending = self.keys.describe()
            self._arm_whichkey()
            self.statusline.refresh()
            return
        self._hide_whichkey()
        self.statusline.pending = ""
        if hit is None:
            self.statusline.refresh()
            return
        self.dispatch_hit(hit)

    def _layer(self, name: str, binds: list) -> list:
        """A key layer with your own keys from tui.toml over it: `[keys]` for the global
        table, `[keys.<room id>]`, `[keys.saved]`, `[keys.visual]` for the others."""
        mine = self.cfg["keys"] if name == "keys" else self.cfg["keys"].get(name)
        if not isinstance(mine, dict) or not mine:
            return list(binds)
        known = {b.action for b in binds}
        if name != "keys":
            known |= {b.action for b in self.global_binds}
        else:
            known |= ({f"room:{r}" for r in (*ROOM_BY_ID, "home", "saved")} |
                      {f"channel:{c[0]}" for c in CHANNELS} | {f"channel_n:{n}" for n in (1, 2, 3)})
        out, problems = remap(binds, mine, known, where="keys" if name == "keys" else f"keys.{name}",
                              under=[] if name == "keys" else self.global_binds)
        self._key_problems += [p for p in problems if p not in self._key_problems]
        return out

    def _say_key_problems(self) -> None:
        """What was wrong in your keys, once each: all in :messages, the first in the line."""
        new = [p for p in self._key_problems if p not in getattr(self, "_keys_said", set())]
        if not new:
            return
        self._keys_said = getattr(self, "_keys_said", set()) | set(new)
        self.messages += [(time.time(), "warn", p) for p in new]
        self.statusline.say(new[0] if len(new) == 1 else f"{new[0]} (and {len(new) - 1} more in :messages)", "warn")

    def _arm_whichkey(self) -> None:
        if self._whichkey_timer:
            self._whichkey_timer.stop()
        if self.keys.pending:
            self._whichkey_timer = self.set_timer(0.3, self._show_whichkey)

    def _show_whichkey(self) -> None:
        if self.keys.pending:
            title = " ".join(k.replace("space", "Space") for k in self.keys.pending)
            self.whichkey.show_keys(title, self.keys.next_keys())

    def _hide_whichkey(self) -> None:
        if self._whichkey_timer:
            self._whichkey_timer.stop()
            self._whichkey_timer = None
        self.whichkey.display = False

    def active_list(self):
        if self.drawer.display:
            return self.drawer.list
        return self.room.active_list() if self.room else None

    def selected_item(self) -> dict | None:
        if self.drawer.display:
            return self.drawer.list.selected
        return self.room.selected() if self.room else None

    def dispatch_hit(self, hit: Hit) -> None:
        action, count = hit.action, hit.count
        if self.mode == "VISUAL" and self._visual(action):
            self.refresh_chrome()
            return
        room = self.room
        if self.drawer.display:
            if self._drawer_action(action, count):
                self.refresh_chrome()
                return
            room = None
        lst = room.active_list() if room else self.active_list()
        n = count or 1
        info_open = self.info.display
        # the info sheet takes the movement keys while it's open
        if info_open and action in ("down", "up", "half_down", "half_up", "page_down", "page_up", "top", "bottom"):
            step = {"down": 1, "up": -1, "half_down": 10, "half_up": -10, "page_down": 20, "page_up": -20}
            if action == "top":
                self.info.scroll_home(animate=False)
            elif action == "bottom":
                self.info.scroll_end(animate=False)
            else:
                self.info.scroll_relative(y=step[action] * n, animate=False)
            return
        if room and room.handle(action, count):
            self.refresh_chrome()
            return
        if lst is not None:
            moves = {"down": n, "up": -n}
            if action in moves:
                lst.move(moves[action])
            elif action == "top":
                lst.go(count - 1 if count else 0)
            elif action == "bottom":
                lst.go(count - 1 if count else len(lst.items) - 1)
            elif action in ("half_down", "half_up", "page_down", "page_up"):
                lst.page({"half_down": 1, "half_up": -1, "page_down": 2, "page_up": -2}[action] * n)
            elif action in ("center", "to_top", "to_bottom"):
                lst.place({"center": "center", "to_top": "top", "to_bottom": "bottom"}[action])
            elif action in ("search_next", "search_prev"):
                if self.search_term:
                    found = lst.search(self.search_term, forward=action == "search_next")
                    if not found:
                        self.say(f"Not found: {self.search_term}", "warn")
            else:
                lst = None
            if lst is not None:
                self.refresh_chrome()
                return
        self._global(action, count)
        self.refresh_chrome()

    def _global(self, action: str, count: int | None) -> None:
        room = self.room
        if action.startswith("room:"):
            self.go_room(action.split(":", 1)[1])
        elif action.startswith("channel:"):
            self.go_channel(action.split(":", 1)[1])
        elif action.startswith("channel_n:"):
            chans = self.registry.channels() if self.registry else []
            i = int(action.split(":")[1]) - 1
            if 0 <= i < len(chans):
                self.go_channel(chans[i][0])
        elif action in ("next_room", "prev_room"):
            if self.registry:
                sib = self.registry.sibling(self.room_id, 1 if action == "next_room" else -1)
                if sib:
                    self.go_room(sib.id)
        elif action in ("next_view", "prev_view") and room:
            room.step_view(1 if action == "next_view" else -1)
        elif action == "jump_back":
            if self.jumps:
                j = self.jumps.pop()
                self.go_room(j.room, remember=False)
                if self.room and self.room.view != j.view and j.view:
                    self.room.set_view(j.view)
        elif action == "command":
            self._start_line("COMMAND", ":")
        elif action == "search":
            self._start_line("SEARCH", "/")
        elif action == "search_platform":
            if room and getattr(room, "search_command", None):
                self._start_line("COMMAND", ":", room.search_command + " ")
            else:
                self.say("This room has no search here yet; Space f finds things everywhere.", "warn")
        elif action == "find":
            self.open_finder()
        elif action == "help":
            self._help()
        elif action in ("escape", "close"):
            if self.info.display:
                self.close_info()
            elif action == "close":
                self.say("Type :q and press Enter to quit Tubcal.")
        elif action == "quit":
            self.quit()
        elif action == "refresh" and room:
            room.reload()
        elif action == "open_browser":
            item = self.selected_item()
            if item and item.get("url"):
                problem = links.open_url(links.clean(item["url"]), self.cfg["browser"])
                self.say(problem or "Opened in the browser.", "error" if problem else "info")
        elif action == "open_web":
            self._open_web(room.web_route() if room else "/")
        elif action in ("copy_link", "copy_link_time"):
            item = self.selected_item()
            if item and item.get("url"):
                url = links.clean(item["url"])
                playing = self.player.playing
                if action == "copy_link_time" and playing and playing.item.get("id") == item.get("id"):
                    url = links.at_time(url, self.player.current_link_time())
                self._copy(url)
        elif action == "private":
            self.set_private(not self.private)
        elif action == "visual":
            self.start_visual()
        elif action == "saved":
            self.open_drawer()
        elif action == "settings":
            self._settings()
        elif action.startswith("player_"):
            self._player_action(action)
        elif action.startswith("radio_"):
            self._radio_action(action)
        elif action == "sleep_prompt":
            self._start_line("COMMAND", ":", "sleep ")
            self.say("Minutes (30, 1h30), `end` for the end of what's playing, or `off`.")
        elif action == "queue":
            q = self.player.queue
            if not q:
                self.say("The queue is empty. `a` on a video adds it.")
            else:
                self.say("Up next: " + " · ".join(fmt.cut(fmt.clean(i.get("title")), 30) for i in q[:4]))

    # ── VISUAL: a range of rows ──────────────────────────────────────────────

    def start_visual(self) -> None:
        lst = self.active_list()
        if not isinstance(lst, ItemList) or not lst.items:
            self.say("VISUAL works on a list of things; this pane isn't one.", "warn")
            return
        lst.anchor = lst.cursor
        lst.refresh()
        self._visual_list = lst
        self.keys.push(self.visual_binds)
        self.mode = "VISUAL"

    def end_visual(self) -> None:
        lst, self._visual_list = self._visual_list, None
        if lst is not None:
            lst.anchor = None
            lst.refresh()
        self.keys.drop(self.visual_binds)
        if self.mode == "VISUAL":
            self.mode = "NORMAL"
        self.statusline.pending = ""

    def _visual(self, action: str) -> bool:
        """VISUAL's own keys; True when handled here. Movement falls through to the
        list and stretches the range; any other key ends VISUAL and then does what it
        always does."""
        lst = self._visual_list
        if lst is None or lst.anchor is None or lst is not self.active_list():
            self.end_visual()   # the list was reloaded or replaced under the range
            if action.startswith("visual_"):
                self.say("The list changed, so the range is gone.", "warn")
                return True
            return False
        if action in MOVES:
            return False
        if not action.startswith("visual_"):
            self.end_visual()
            return False
        if action == "visual_swap":
            lst.swap_ends()
            return True
        rows = lst.range_items()
        drawer = self.drawer.display
        room = None if drawer else self.room
        self.end_visual()
        if action == "visual_end" or not rows:
            return True
        item_of = (lambda r: r) if drawer or room is None else room.item_of
        if action == "visual_save":
            items = [i for i in map(item_of, rows) if i and i.get("id")]
            if not items:
                self.say("Nothing here can be saved.", "warn")
            else:
                self.save_many(items)
                if drawer:
                    self.drawer.show_items([i for i in self.drawer.items if i.get("id") in self.saved])
        elif action == "visual_copy":
            urls = [links.clean(i["url"]) for i in map(item_of, rows) if i and i.get("url")]
            if not urls:
                self.say("These have no links to copy.", "warn")
            else:
                self._copy("\n".join(urls), f"Copied {len(urls)} link{'s' if len(urls) != 1 else ''}.")
        elif action == "visual_queue":
            plays = [p for p in map(room.playable_of, rows) if p] if room else []
            if not plays:
                self.say("Nothing here goes in the queue.", "warn")
            else:
                for p in plays:
                    n = self.player.enqueue(p)
                self.say(f"Added {len(plays)} to the queue ({n}).")
                if lst is not None:
                    lst.repaint()
        elif action in ("visual_d", "visual_x"):
            key = "d" if action == "visual_d" else "x"
            own = self.keys.action_for(("d", "d") if key == "d" else ("x",))
            done = bool(own) and (self._drawer_many(own, rows) if drawer else
                                  bool(room) and room.handle_many(own, rows))
            if not done:
                self.say(f"{key} doesn't work on several rows here.", "warn")
        return True

    def save_many(self, items: list[dict]) -> None:
        """`s` on a range: saves the ones not saved yet, or, when every one already is,
        takes them all out. One `u` takes it back."""
        now = int(time.time())
        clean = [{**{k: v for k, v in i.items() if not k.startswith("_")}, "saved_at": i.get("saved_at") or now}
                 for i in items]
        clean = list({i["id"]: i for i in clean}.values())
        if not clean:
            return
        if all(i["id"] in self.saved for i in clean):
            olds = [self.saved.pop(i["id"]) for i in clean]
            self.undo_stack.append(("batch", [("unsave", o) for o in olds]))
            self.run_worker(lambda: [self._api_quiet("delete", f"/saved/{seg(o['id'])}") for o in olds], thread=True)
            self.say(f"Took {len(olds)} out of Saved · u undo")
        else:
            new = [i for i in clean if i["id"] not in self.saved]
            for i in new:
                self.saved[i["id"]] = i
            self.undo_stack.append(("batch", [("save", i) for i in new]))
            self.run_worker(lambda: [self._api_quiet("post", "/saved", {"item": i}) for i in new], thread=True)
            self.say(f"Saved {len(new)} · u undo")
        self._repaint_lists()

    def _drawer_many(self, action: str, rows: list[dict]) -> bool:
        d = self.drawer
        if action == "done":
            done = not all(r.get("done_at") for r in rows)
            stamp = int(time.time()) if done else None
            for r in rows:
                d.update_item(r["id"], done_at=stamp)
            self.run_worker(lambda: [self._api_patch(f"/saved/{seg(r['id'])}", {"done": done}) for r in rows],
                            thread=True)
            self.say(f"{len(rows)} marked done." if done else f"{len(rows)} back on the to-do list.")
            return True
        if action == "remove":
            self.save_many([r for r in rows if r.get("id") in self.saved])
            d.show_items([i for i in d.items if i.get("id") in self.saved])
            return True
        return False

    def _repaint_lists(self) -> None:
        if self.room:
            lst = self.room.active_list()
            if lst is not None:
                lst.repaint()
            if hasattr(self.room, "list"):
                self.room.list.repaint()

    # ── the finder (Space f) ─────────────────────────────────────────────────

    def _places(self) -> list[dict]:
        out = [{"id": "place:home", "title": "Home", "_place": True, "_go": "home", "_sub": "",
                "_match": "home start"}]
        reg = self.registry
        if reg:
            for n, (cid, label, rooms) in enumerate(reg.channels(), 1):
                for k, room in enumerate(rooms, 1):
                    out.append({"id": f"place:{room.id}", "title": room.label, "_place": True, "_go": room.id,
                                "_web": not room.built, "_sub": f"{label} {k}",
                                "_match": f"{room.label} {room.short} {room.id} {label}".lower()})
        out += [{"id": "place:saved", "title": "Saved", "_place": True, "_go": "saved", "_sub": "drawer",
                 "_match": "saved bookmarks later"},
                {"id": "place:settings", "title": "Settings", "_place": True, "_go": "settings", "_web": self.web,
                 "_sub": "in the web UI" if self.web else "accounts, following, rooms",
                 "_match": "settings preferences options accounts follow"}]
        return out

    def open_finder(self) -> None:
        self.close_drawer()
        self.mode = "FIND"
        self.statusline.mode = "SEARCH"
        self.finder.open(self._places(), list(self.saved.values()), self.size)
        self.refresh_chrome()

    def close_finder(self) -> None:
        self.finder.close()
        self.mode = "NORMAL"
        if self._find_timer:
            self._find_timer.stop()
        self.refresh_chrome()

    def _edit_find(self, token: str, char: str | None) -> None:
        f = self.finder
        if token in ("escape", "ctrl+c"):
            self.close_finder()
            return
        if token in ("down", "ctrl+n", "ctrl+j", "tab"):
            f.list.move(1)
            return
        if token in ("up", "ctrl+p", "ctrl+k", "shift+tab"):
            f.list.move(-1)
            return
        if token == "enter":
            x = f.list.selected
            self.close_finder()
            if not x:
                return
            if x.get("_place"):
                self.go_room(x["_go"])
            else:
                self.open_item({k: v for k, v in x.items() if not k.startswith("_")})
            return
        q = f.query_text
        if token == "backspace":
            q = q[:-1]
        elif token == "ctrl+w":
            q = q.rstrip().rsplit(" ", 1)[0] + " " if " " in q.rstrip() else ""
        elif token == "ctrl+u":
            q = ""
        elif token == "space":
            q += " "
        elif char and char.isprintable() and len(char) == 1:
            q += char
        else:
            return
        f.query_text = q
        f.refresh_results()
        if self._find_timer:
            self._find_timer.stop()
        if len(q.strip()) >= 2:
            self._find_timer = self.set_timer(0.32, lambda: self._find_remote(q))

    def _find_remote(self, q: str) -> None:
        if self.finder.query_text != q or not self.finder.display:
            return
        self.finder.searching = True
        self.finder.refresh_results()

        def work():
            try:
                data = self.api.get("/search/all", q=q.strip(), timeout=25) or {}
            except ApiError:
                data = {}

            def show():
                if self.finder.query_text == q:
                    self.finder.remote, self.finder.remote_for = data, q.strip().lower()
                    self.finder.searching = False
                    self.finder.refresh_results()
            self.call_from_thread(show)
        self.run_worker(work, thread=True, group="find", exclusive=True)

    # ── the Saved drawer ─────────────────────────────────────────────────────

    def open_drawer(self) -> None:
        if not self.drawer.display:
            self.drawer.display = True
            self.drawer.styles.width = max(40, min(70, self.size.width // 2))
            self.keys.push(self._layer("saved", self.drawer.binds()))
            self._say_key_problems()
        self.drawer.show_items(sorted(self.saved.values(), key=lambda i: -(i.get("saved_at") or 0)))

        def fetch():
            try:
                items = (self.api.get("/saved") or {}).get("items") or []
            except ApiError as e:
                self.call_from_thread(self.say, str(e), "error")
                return

            def show():
                self.saved = {i["id"]: i for i in items}
                shown = [i.get("id") for i in self.drawer.items]
                if set(shown) == set(self.saved):   # the same things: no reshuffle under the cursor
                    items[:] = [self.saved[i] for i in shown]
                self.drawer.show_items(items)
            self.call_from_thread(show)
        self.run_worker(fetch, thread=True, group="saved", exclusive=True)
        self.refresh_chrome()

    def close_drawer(self) -> None:
        if self.drawer.display:
            self.drawer.display = False
            self.keys.pop()
            self.refresh_chrome()

    def _drawer_action(self, action: str, count: int | None) -> bool:
        d = self.drawer
        item = d.list.selected
        if action in ("close", "escape", "left"):
            self.close_drawer()
        elif action in ("next_view", "prev_view"):
            d.step_view(1 if action == "next_view" else -1)
        elif action in ("open", "right"):
            if item:
                self.open_saved(item)
        elif action == "done" and item:
            done = not item.get("done_at")
            d.update_item(item["id"], done_at=int(time.time()) if done else None)
            self.run_worker(lambda: self._api_patch(f"/saved/{seg(item['id'])}", {"done": done}), thread=True)
            self.say("Marked done." if done else "Back on the to-do list.")
        elif action == "note" and item:
            self._write_note(item)
        elif action == "remove" and item:
            self.toggle_saved(item)
            d.show_items([i for i in d.items if i.get("id") != item["id"]])
        elif action == "undo":
            self.undo()
            d.show_items(sorted(self.saved.values(), key=lambda i: -(i.get("saved_at") or 0)))
        else:
            return False
        return True

    def _write_note(self, item: dict) -> None:
        from . import editor
        title = fmt.clean(item.get("title")) or item.get("url") or item.get("id")
        context = [f"Your note on: {title}"]
        if item.get("source"):
            context.append(f"From: {fmt.clean(item['source'])}")
        if item.get("url"):
            context.append(links.clean(item["url"]))
        text = editor.compose(self, item.get("note") or "", context=context)
        if text is None:
            self.say("Nothing changed.")
            return
        note = text or None
        self.drawer.update_item(item["id"], note=note)
        if item["id"] in self.saved:
            self.saved[item["id"]]["note"] = note
        self.run_worker(lambda: self._api_patch(f"/saved/{seg(item['id'])}", {"note": note or ""}), thread=True)
        self.say("Note kept." if note else "Note taken away.")

    def _api_patch(self, path: str, body: dict) -> None:
        try:
            self.api.patch(path, body)
        except ApiError as e:
            self.call_from_thread(self.say, str(e), "error")

    def open_saved(self, item: dict) -> None:
        self.close_drawer()
        self.open_item(item)

    def open_item(self, item: dict) -> None:
        """An item, opened where it lives: a video or an episode plays, an HN story opens
        in the Wire's reader, a Reddit post in the Dispatch, an anime title its page;
        anything else (or a room this install doesn't have) opens in the browser."""
        kind, extra = kind_of(item), item.get("extra") or {}
        url = item.get("url") or ""
        has = (lambda m: self.registry is not None and self.registry.has(m))
        if kind == "podcast" and extra.get("audio"):
            self.tune(episode_of(item))
        elif kind == "moment" and has("youtube") and extra.get("video"):
            self.play(extra["video"], start=float(extra.get("t") or 0))
        elif (kind == "video" and has("youtube")) or extra.get("stream_key"):
            self.play(item)
        elif kind == "story" and extra.get("hn_id") and has("hackernews"):
            self.in_room("hackernews", lambda room: room.open_story(item))
        elif kind == "post" and extra.get("post_id") and has("reddit"):
            self.in_room("reddit", lambda room: room.open_post(item))
        elif kind == "anime" and extra.get("anilist_id") and has("anime"):
            mid = extra["anilist_id"]

            def fetch():
                media = self.anime.detail(mid)
                if media:
                    self.call_from_thread(self._open_anime_title, media)
                else:
                    self.call_from_thread(self.say, "AniList didn't answer for that title.", "error")
            self.run_worker(fetch, thread=True)
        elif kind == "file" and extra.get("path") and has("editor"):
            self.in_room("editor", lambda room: room.open_path(extra["path"]))
        elif url.startswith("/"):
            self._open_web(url)
        elif url.startswith(("http://", "https://")):
            problem = links.open_url(links.clean(url), self.cfg["browser"])
            self.say(problem or "Opened in the browser.", "error" if problem else "info")
        else:
            self.say("Nothing to open for this one.", "warn")

    def _open_anime_title(self, media: dict) -> None:
        self.in_room("anime", lambda room: room.open_title(media))

    def in_room(self, room_id: str, then) -> None:
        """Go to a room, then do something in it once it has been put together (a room
        opened for the first time mounts on the next refresh)."""
        self.go_room(room_id)
        if self.room_id != room_id or self.room is None:
            return
        room = self.room
        if room.is_mounted and room.children:
            then(room)
        else:
            room.call_after_refresh(lambda: then(room))

    def _player_action(self, action: str) -> None:
        p = self.player
        try:
            if action == "player_pause":
                p.toggle_pause()
            elif action == "player_next":
                if not p.next():
                    self.say("The queue is empty.")
            elif action == "player_stop":
                p.stop()
            elif action == "player_forward":
                p.seek(10)
            elif action == "player_back":
                p.seek(-10)
            elif action == "player_quality":
                hs = p.playing.heights if p.playing else []
                if not hs:
                    self.say("Nothing is playing with a choice of quality.", "warn")
                else:
                    self._start_line("COMMAND", ":", "set quality=")
                    self.say("Heights: " + ", ".join(f"{h}" for h in hs))
        except Exception as e:  # mpv gone mid-command
            self.say(str(e), "error")

    def _radio_action(self, action: str) -> None:
        r = self.radio
        if not r.on:
            self.say("The radio is off. Podcasts are in the Workbench (g d).")
            return
        try:
            if action == "radio_pause":
                r.toggle()
            elif action == "radio_forward":
                r.seek(30)
            elif action == "radio_back":
                r.seek(-15)
            elif action == "radio_off":
                r.switch_off()
                self.say("Radio off; your place in the episode is kept.")
        except Exception as e:
            self.say(str(e), "error")

    def tune(self, episode: dict) -> None:
        """A podcast episode on the bench radio."""
        self.radio.tune(episode)
        left = self.radio.place_of(episode.get("id") or "")
        self.say(f"On the radio: {fmt.cut(fmt.clean(episode.get('title')), 50)}"
                 + (f" (from {fmt.duration(left)})" if left else ""))

    def after_suspend(self) -> None:
        """Back from the editor: the terminal was someone else's, so draw everything
        again (pictures included: the terminal may have dropped them)."""
        from .ui.picture import Well
        try:
            for well in self.screen.query(Well):
                well.redraw()
        except Exception:
            pass
        self.refresh(layout=True)

    def _copy(self, text: str, said: str | None = None) -> None:
        if not links.copy(text):
            self.copy_to_clipboard(text)
        self.say(said or f"Copied {fmt.cut(text, 60)}")

    def _settings(self) -> None:
        if self.web:
            self._open_web("/settings")
        else:
            accounts.settings_sheet(self)

    def _open_web(self, route: str) -> None:
        if not self.web:
            self.say("This Tubcal has no web interface (tubcal add web adds it); o opens a thing on its "
                     "own site.", "warn")
            return
        problem = links.open_url(self.api.url(route), self.cfg["browser"])
        self.say(problem or f"Opened {route} in the web UI {self.glyphs.web}", "error" if problem else "info")

    # ── the command and search line ──────────────────────────────────────────

    def _start_line(self, mode: str, prompt: str, text: str = "") -> None:
        self.mode = mode
        self.buffer, self.cursor = text, len(text)
        self._hist_i = len(self.cmd_history)
        sl = self.statusline
        sl.mode, sl.prompt, sl.buffer, sl.cursor = mode, prompt, self.buffer, self.cursor
        sl.search_info = ""
        sl.refresh()

    def _end_line(self) -> None:
        self.mode = "NORMAL"
        sl = self.statusline
        sl.prompt, sl.buffer, sl.search_info = "", "", ""
        self.refresh_chrome()

    def _edit_line(self, token: str, char: str | None) -> None:
        b, c = self.buffer, self.cursor
        if token in ("escape", "ctrl+c"):
            self._end_line()
            return
        if token == "enter":
            text = self.buffer
            mode = self.mode
            self._end_line()
            if mode == "COMMAND":
                if text.strip():
                    self.cmd_history.append(text)
                self.run_command(text)
            else:
                self._do_search(text)
            return
        if token == "backspace":
            if not b:
                self._end_line()
                return
            if c:
                b, c = b[:c - 1] + b[c:], c - 1
        elif token == "ctrl+w":
            head = b[:c].rstrip()
            cut_at = head.rfind(" ") + 1
            b, c = b[:cut_at] + b[c:], cut_at
        elif token == "ctrl+u":
            b, c = b[c:], 0
        elif token in ("left", "ctrl+b"):
            c = max(0, c - 1)
        elif token in ("right", "ctrl+f"):
            c = min(len(b), c + 1)
        elif token in ("home", "ctrl+a"):
            c = 0
        elif token in ("end", "ctrl+e"):
            c = len(b)
        elif token in ("up", "down") and self.mode == "COMMAND" and self.cmd_history:
            self._hist_i = max(0, min(len(self.cmd_history), self._hist_i + (-1 if token == "up" else 1)))
            b = self.cmd_history[self._hist_i] if self._hist_i < len(self.cmd_history) else ""
            c = len(b)
        elif token == "tab" and self.mode == "COMMAND":
            word = b.split(" ")[0]
            options = [cmd for cmd in COMMANDS if cmd.startswith(word)]
            if " " not in b and options:
                b = options[0] + " "
                c = len(b)
                if len(options) > 1:
                    self.statusline.search_info = " ".join(options)
        elif char and char.isprintable() and len(char) == 1:
            b, c = b[:c] + char + b[c:], c + 1
        elif token == "space":
            b, c = b[:c] + " " + b[c:], c + 1
        self.buffer, self.cursor = b, c
        sl = self.statusline
        sl.buffer, sl.cursor = b, c
        if self.mode == "SEARCH":
            lst = self.active_list()
            if lst is not None and b:
                found = lst.search(b, from_next=False)
                sl.search_info = f"{len(lst.matches)} found" if found else "not found"
        sl.refresh()

    def _do_search(self, text: str) -> None:
        self.search_term = text
        lst = self.active_list()
        if lst is None or not text:
            return
        if lst.search(text, from_next=False):
            self.say(f"/{text}  {len(lst.matches)} found · n N")
        else:
            self.say(f"Not found: {text}", "warn")

    def run_command(self, text: str) -> None:
        cmd, _, arg = text.strip().partition(" ")
        arg = arg.strip()
        if cmd in ("q", "quit", "qa", "q!", "qa!", "wq", "x"):
            self.quit()
        elif cmd in ("open", "play"):
            if arg:
                self.run_worker(lambda: self._open_url(arg), thread=True)
            else:
                self.say(f":{cmd} needs a link.", "warn")
        elif cmd in SEARCH_ROOMS:
            if arg:
                room_id = SEARCH_ROOMS[cmd]
                if self.room_id != room_id:
                    self.go_room(room_id)
                room = self.room
                if self.room_id == room_id and room and hasattr(room, "search_platform"):
                    room.search_platform(arg)
            else:
                self.say(f":{cmd} needs some words to search for.", "warn")
        elif cmd == "private":
            self.set_private(arg != "off")
        elif cmd == "sleep":
            self._sleep_command(arg)
        elif cmd == "radio":
            if arg in ("off", "stop"):
                self._radio_action("radio_off")
            elif arg in ("", "pause", "play"):
                self._radio_action("radio_pause")
            else:
                self.say("`:radio` pauses or plays, `:radio off` switches it off.", "warn")
        elif cmd == "ask":
            if not (self.registry and self.registry.has("archive")):
                self.say("The Archive isn't installed here: tubcal add archive", "warn")
            elif arg:
                self.in_room("archive", lambda room: room.ask(arg))
            else:
                self.in_room("archive", lambda room: room.ask_in_editor())
        elif cmd == "history" and arg == "clear":
            self.state.forget_marks()
            self.say("Forgot the terminal's read marks and podcast places. Your watch history is the "
                     "server's: Settings → Your data, in the web UI.")
        elif cmd == "checkhealth":
            self.run_worker(self._checkhealth, thread=True)
        elif cmd == "messages":
            self._show_messages()
        elif cmd == "map":
            self._show_map()
        elif cmd == "theme":
            self._theme_reload()
        elif cmd == "cache" and arg == "clear":
            n = self.pictures.clear()
            self.say(f"Picture cache emptied ({n} files).")
        elif cmd == "refresh":
            if self.room:
                self.room.reload(force=True)
        elif cmd == "set":
            self._set(arg)
        elif cmd == "follow":
            accounts.follow(self, arg)
        elif cmd == "unfollow":
            accounts.unfollow(self, arg)
        elif cmd == "link":
            accounts.link(self, arg)
        elif cmd == "unlink":
            accounts.unlink(self, arg)
        elif cmd == "room":
            accounts.room(self, arg)
        elif cmd == "settings":
            accounts.settings_sheet(self)
        elif cmd == "about":
            accounts.about(self)
        elif cmd:
            self.say(f"Not a command: {cmd}", "error")

    def _sleep_command(self, arg: str) -> None:
        what = parse_sleep(arg)
        if what is None:
            left = self.sleep.label()
            self.say((f"Sleep timer: {left}. " if left else "")
                     + "`:sleep 30` (minutes), `:sleep 1h30`, `:sleep end` or `:sleep off`.",
                     "warn" if arg else "info")
        elif what == "off":
            self.sleep.cancel()
            self.say("Sleep timer off.")
        elif what == "end":
            self.sleep.set_end()
            self.say("Sleep timer: everything stops when what's playing ends.")
        else:
            self.sleep.set_seconds(what)
            h, m = divmod(round(what / 60), 60)
            span = " ".join(x for x in (f"{h} h" if h else "", f"{m} min" if m else "") if x) or f"{int(what)} s"
            self.say(f"Sleep timer: {span}. The last 12 s fade out.")
        self._player_repaint()

    def _set(self, arg: str) -> None:
        key, _, val = arg.partition("=")
        key, val = key.strip(), val.strip()
        if key == "quality" and val.isdigit():
            self.player.set_quality(int(val))
            self.say(f"Switching to {val}p…")
        elif key == "ytdl":
            self.cfg["youtube_player"] = "ytdl" if val in ("on", "yes", "1", "") else "server"
            self.say(f"YouTube plays through {'mpv’s own yt-dlp' if self.cfg['youtube_player'] == 'ytdl' else 'the Tubcal server'}.")
        else:
            self.say("`:set quality=720` or `:set ytdl=on|off`.", "warn")

    def _open_url(self, url: str) -> None:
        """A link → the room/item it is. YouTube videos play; others open on the web."""
        try:
            d = self.api.get("/youtube/link", url=url) if self.registry and self.registry.has("youtube") else None
        except ApiError:
            d = None
        path = (d or {}).get("path") or ""
        if path.startswith("/youtube/open?v="):
            vid = path.split("v=", 1)[1].split("&", 1)[0]
            item = {"id": f"yt:{vid}", "platform": "youtube", "title": "",
                    "url": f"https://www.youtube.com/watch?v={vid}", "extra": {"video_id": vid}}
            try:
                meta = self.api.get(f"/youtube/video/{seg(vid)}", timeout=60) or {}
                item["title"] = meta.get("title") or url
                item["source"] = meta.get("author") or ""
                item["extra"]["channel_id"] = meta.get("channel_id")
                item["thumbnail"] = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                if meta.get("live_status") == "is_live":
                    item["extra"]["live_status"] = "is_live"
            except ApiError:
                item["title"] = url
            self.call_from_thread(self.play, item)
        else:
            self.call_from_thread(self.say, "Tubcal can only play YouTube links here; `o` opens others.", "warn")

    # ── playing, saving ──────────────────────────────────────────────────────

    def play(self, item: dict, start: float | None = None) -> None:
        if self.registry and not self.registry.has("youtube") and item.get("platform") == "youtube":
            self.say("The Screening Room isn't installed: `tubcal add youtube`.", "warn")
            return
        self.player.play(item, start=start)
        self.say(f"Playing {fmt.cut(fmt.clean(item.get('title')), 50)}" +
                 (" (private: not recorded)" if self.private else ""))

    def toggle_saved(self, item: dict) -> None:
        iid = item.get("id")
        if not iid:
            return
        if iid in self.saved:
            old = self.saved.pop(iid)
            self.undo_stack.append(("unsave", old))
            self.run_worker(lambda: self._api_quiet("delete", f"/saved/{seg(iid)}"), thread=True)
            self.say("Removed from Saved · u undo")
        else:
            clean = {k: v for k, v in item.items() if not k.startswith("_")}
            clean.setdefault("saved_at", int(time.time()))   # listed newest first at once
            self.saved[iid] = clean
            self.undo_stack.append(("save", clean))
            self.run_worker(lambda: self._api_quiet("post", "/saved", {"item": clean}), thread=True)
            self.say("Saved · u undo")
        if self.room:
            self.room.active_list() and self.room.active_list().repaint()
            if hasattr(self.room, "list"):
                self.room.list.repaint()

    def undo(self) -> None:
        if not self.undo_stack:
            self.say("Nothing to undo.")
            return
        what, item = self.undo_stack.pop()
        steps = item if what == "batch" else [(what, item)]
        back = [i for w, i in steps if w == "unsave"]
        out = [i for w, i in steps if w != "unsave"]
        for i in back:
            self.saved[i["id"]] = i
        for i in out:
            self.saved.pop(i.get("id"), None)

        def send():
            for i in back:
                self._api_quiet("post", "/saved", {"item": i})
            for i in out:
                self._api_quiet("delete", f"/saved/{seg(i['id'])}")
        self.run_worker(send, thread=True)
        if what != "batch":
            self.say("Back in Saved." if back else "Taken out of Saved again.")
        else:
            self.say(f"{len(back)} back in Saved." if back else f"{len(out)} taken out of Saved again.")
        self._repaint_lists()

    def _api_quiet(self, method: str, path: str, body=None) -> None:
        try:
            if method == "post":
                self.api.post(path, body)
            else:
                self.api.delete(path)
        except ApiError as e:
            self.call_from_thread(self.say, str(e), "error")

    def set_private(self, on: bool) -> None:
        self.private = on
        self.api.private = on
        if on:
            self.pictures.go_private()
        self.state.private = on
        self.statusline.private = on
        self.say("Private session: nothing you play is recorded, no resume points, AniList isn't updated, "
                 "and pictures stay in memory." if on else "Private session off: plays are recorded again.")

    # ── sheets ───────────────────────────────────────────────────────────────

    def _show_info(self, text: Text) -> None:
        self.info.update(text)
        self.info.display = True
        body = self.screen.query_one("#body")
        body.display = False
        self._hide_whichkey()

    def close_info(self) -> None:
        if self.info.display:
            self.info.display = False
            self.screen.query_one("#body").display = True

    def _help(self) -> None:
        r = self.roles
        t = Text()
        t.append("Keys", style(r, "fg+bold"))
        t.append("   q closes this\n\n", style(r, "dim"))
        rows = []
        for b in self.global_binds + (self.keys.layers[-1] if len(self.keys.layers) > 1 else []):
            rows.append((" ".join(k.replace("space", "Space") for k in b.keys), b.help or b.action))
        seen = set()
        for keys, label in rows:
            if keys in seen:
                continue
            seen.add(keys)
            t.append(f"  {keys:<14}", style(r, "hue:yellow"))
            t.append(f"{label}\n", style(r, "fg"))
        t.append("\nIn VISUAL", style(r, "fg+bold"))
        t.append("   V in a list; j k G and counts stretch the range\n", style(r, "dim"))
        for b in self.visual_binds:
            if b.keys != ("v",):
                t.append(f"  {' '.join(b.keys):<14}", style(r, "hue:yellow"))
                t.append(f"{b.help}\n", style(r, "fg"))
        t.append("\nCommands\n", style(r, "fg+bold"))
        for c, what in (("q", "quit"), ("open <link>", "play a YouTube link"), ("yt <words>", "search YouTube"),
                        ("hn <words>", "search Hacker News"), ("r <words>", "search Reddit"),
                        ("ar <words>", "search what was said in your videos"),
                        ("private", "a session that records nothing"), ("checkhealth", "what works here"),
                        ("messages", "this session's messages"), ("map", "every key with its action's name"),
                        ("theme", "read the terminal's colours again"),
                        ("set quality=720", "another quality for what's playing"),
                        ("set ytdl=on", "YouTube through mpv's own yt-dlp"),
                        ("sleep 30 | end | off", "the sleep timer"), ("radio off", "switch the radio off"),
                        ("ask <question>", "ask the Archive"),
                        ("history clear", "forget the terminal's read marks and podcast places"),
                        ("follow @name | r/sub", "follow a channel or subreddit (alone: the selected one's)"),
                        ("unfollow [name]", "stop following it"),
                        ("link anilist|reddit|github", "link an account"), ("unlink …", "unlink it"),
                        ("room on|off <room>", "a room in the tabs or not"),
                        ("settings", "accounts, what you follow, the rooms"),
                        ("about", "the licence and what Tubcal builds on")):
            t.append(f"  :{c:<28}", style(r, "hue:yellow"))
            t.append(f"{what}\n", style(r, "fg"))
        self._show_info(t)

    def _show_map(self) -> None:
        """vim's :map: every key in force here, with its action's name (what tui.toml's
        [keys] takes) and what it does."""
        from .keys import notation
        r = self.roles
        t = Text()
        t.append("Keys in force", style(r, "fg+bold"))
        t.append("   the action names are what [keys] in ~/.config/tubcal/tui.toml takes · q closes\n", style(r, "dim"))
        layers = [("everywhere", self.keys.layers[0], "keys")]
        if len(self.keys.layers) > 1:
            name = "saved" if self.drawer.display else self.room_id
            layers.append((f"here ([keys.{name}])", self.keys.layers[-1], name))
        layers.append(("in VISUAL ([keys.visual])", self.visual_binds, "visual"))
        for title, layer, _ in layers:
            t.append(f"\n{title}\n", style(r, "fg+bold"))
            for b in sorted(layer, key=lambda b: (b.action, b.keys)):
                t.append(f"  {notation(b.keys):<14}", style(r, "hue:yellow"))
                t.append(f"{b.action:<20}", style(r, "fg"))
                t.append(f"{b.help}\n" if b.help and b.help != b.action else "\n", style(r, "dim"))
        self._show_info(t)

    def _show_messages(self) -> None:
        r = self.roles
        t = Text()
        t.append("Messages", style(r, "fg+bold"))
        t.append("   this session only · q closes\n\n", style(r, "dim"))
        for ts, level, text in self.messages[-100:]:
            t.append(time.strftime("%H:%M:%S ", time.localtime(ts)), style(r, "faint"))
            t.append(text + "\n", style(r, {"error": "hue:red", "warn": "hue:yellow"}.get(level, "fg")))
        if not self.messages:
            t.append("No messages yet.\n", style(r, "dim"))
        self._show_info(t)

    def _checkhealth(self) -> None:
        import shutil
        r, g, term = self.roles, self.glyphs, self.term
        checks: list[tuple[str, str, str]] = []  # (state ok|warn|error, title, detail)
        h = self.api.health()
        checks.append(("ok", "Tubcal server", f"{self.api.base} · modules: {', '.join(h.get('modules') or [])}")
                      if h else ("error", "Tubcal server", f"not answering at {self.api.base}"))
        mpv = shutil.which("mpv")
        checks.append(("ok", "mpv", mpv) if mpv else ("error", "mpv", "not installed: videos can't play here"))
        checks.append(("ok" if self.image_backend != "off" else "warn", "Pictures",
                       {"kitty": "kitty graphics (sharp, in the terminal itself)",
                        "sixel": "sixel graphics", "halfcell": "coloured half-blocks (this terminal draws no pictures)",
                        "off": "off (`images` in the config)"}.get(self.image_backend, self.image_backend)
                       + (" · kept in memory only (private)" if self.private else "")))
        checks.append(("ok" if term.palette else "warn", "Colours",
                       f"from {term.palette.source} ({term.took_ms} ms)" if term.palette
                       else "the terminal didn't say; using its named colours"))
        checks.append(("ok", "Cell size", f"{term.cell_px[0]}×{term.cell_px[1]} px" if all(term.cell_px) else "unknown"))
        checks.append(("ok", "Glyphs", g.kind))
        checks.append(("ok", "YouTube plays through", "mpv's own yt-dlp" if self.cfg["youtube_player"] == "ytdl"
                       else "the Tubcal server (one extraction, mpv only talks to 127.0.0.1)"))
        from . import editor
        argv = editor.resolve(self.cfg.get("editor") or "")
        checks.append(("ok", "Writing", f"in {' '.join(argv)} (notes, questions, comments)") if argv else
                      ("warn", "Writing", "no editor found: set `editor` in the config, or $VISUAL"))
        checks.append(("ok" if mpv else "warn", "The radio", "podcasts on a second mpv, without a window" if mpv
                       else "needs mpv too"))
        checks.append(("warn" if self.private else "ok", "Private session", "on" if self.private else "off"))
        missed = gamma_ok(r)

        def show():
            t = Text()
            t.append("checkhealth", style(r, "fg+bold"))
            t.append("   q closes this\n\n", style(r, "dim"))
            for state, title, detail in checks:
                mark, role = {"ok": ("✓ ok", "hue:green"), "warn": ("! warning", "hue:yellow"),
                              "error": ("✗ error", "hue:red")}[state]
                t.append(f"  {mark:<10}", style(r, role))
                t.append(f"{title}: ", style(r, "fg+bold"))
                t.append(f"{detail}\n", style(r, "fg"))
            if r.truecolor:
                t.append("\nThe palette, solved for contrast\n", style(r, "fg+bold"))
                for name in ("fg", "dim", "faint", "rule", "surface", "surface2",
                             "hue.red", "hue.yellow", "hue.green", "hue.blue", "hue.magenta", "hue.cyan", "hue.dispatch"):
                    hexv = r.hex.get(name, "")
                    ratio = r.ratios.get(name)
                    sample = style(r, "fg")
                    from rich.style import Style
                    sample = Style(color=hexv) if hexv else sample
                    t.append(f"  {name:<12}", style(r, "dim"))
                    t.append("████ ", sample)
                    t.append(f"{hexv}  {ratio}:1\n" if ratio else f"{hexv}\n", style(r, "fg"))
                if missed:
                    t.append(f"\n  ! {', '.join(missed)} couldn't reach their contrast target on this palette.\n",
                             style(r, "hue:yellow"))
            self._show_info(t)
        self.call_from_thread(show)

    def _theme_reload(self) -> None:
        from .terminal import probe, xrdb_palette
        if self.term.term.startswith("st"):
            pal = xrdb_palette()
        else:
            with self.suspend():
                pal = probe().palette
        if not pal:
            self.say("The terminal didn't say its colours.", "warn")
            return
        if self.term.palette and pal.digest() == self.term.palette.digest():
            self.say("The colours are the same.")
            return
        self.term.palette = pal
        self.apply_roles(solve(pal))
        self.say("Colours read again.")

    def apply_roles(self, roles) -> None:
        self.roles = roles
        for w in (self.tabline, self.statusline, self.whichkey):
            w.roles = roles
        for room in self.rooms.values():
            for lst in room.query("ItemList"):
                lst.roles = roles
            for pv in room.query("Preview"):
                pv.roles = roles
                pv.slate.roles = roles
        self.refresh(layout=True)
        for room in self.rooms.values():
            if hasattr(room, "refresh_rows"):
                room.refresh_rows()
        self.refresh_chrome()

    def on_app_focus(self, event: events.AppFocus) -> None:
        """A rice switch recolours st live (xrdb -merge + USR1), so read xrdb again."""
        if self.term.term.startswith("st") and self.term.palette and self.term.palette.source in ("osc", "xrdb"):
            self.run_worker(self._refresh_from_xrdb, thread=True, group="xrdb", exclusive=True)

    def _refresh_from_xrdb(self) -> None:
        from .terminal import xrdb_palette
        time.sleep(0.3)
        pal = xrdb_palette()
        if pal and self.term.palette and pal.digest() != self.term.palette.digest():
            self.term.palette = pal
            self.call_from_thread(self.apply_roles, solve(pal))

    # ── quitting ─────────────────────────────────────────────────────────────

    async def action_quit(self) -> None:
        self.quit()

    def quit(self) -> None:
        self.state.save()
        for p in (self.player, self.radio):
            try:
                p.shutdown()
            except Exception:
                pass
        self.exit()
