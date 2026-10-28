"""The rooms, as the web has them (frontend/src/lib/rooms.js): same ids, channels,
order and numbering, so `2 Wire` in the terminal is `2 Wire` in the browser.

A room shows when its module is installed (`/api/health`) and it is switched on in
Settings (`active_rooms`; the Anime is always on). Its terminal screen lives in
`tui/rooms/<id>/`, which belongs to that module in modules.ini, so it is imported only
when the server lists the module. A room without a terminal screen yet opens in the
web UI (`built=False`, drawn with ↗).
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass


@dataclass(frozen=True)
class Room:
    id: str
    label: str
    short: str
    route: str
    gkey: str = ""          # g + this letter jumps here (the web's keys)
    fixed: bool = False
    built: bool = False     # has a terminal screen


ALL_ROOMS = [
    Room("edition", "The Edition", "Edition", "/edition", "e", built=True),
    Room("hackernews", "The Wire", "Wire", "/hackernews", "n", built=True),
    Room("reddit", "The Dispatch", "Dispatch", "/reddit", "r", built=True),
    Room("editor", "The Composing Room", "Editor", "/editor", "c", built=True),
    Room("dev", "The Workbench", "Workbench", "/dev", "d", built=True),
    Room("github", "GitHub", "GitHub", "/github", built=True),
    Room("youtube", "Screening Room", "YouTube", "/youtube", "y", built=True),
    Room("anime", "The Anime", "Anime", "/anime", "a", fixed=True, built=True),
    Room("archive", "The Archive", "Archive", "/archive", built=True),
]

CHANNELS = [
    ("social", "Social", "s", ["edition", "hackernews", "reddit"]),
    ("coding", "Coding", "c", ["editor", "dev", "github"]),
    ("video", "Video", "v", ["youtube", "anime", "archive"]),
]

DEFAULT_ACTIVE = ["edition", "youtube", "reddit", "hackernews", "archive", "editor", "dev"]
ROOM_BY_ID = {r.id: r for r in ALL_ROOMS}
# the places that aren't rooms
HOME = Room("home", "Home", "Home", "/", "h", fixed=True, built=True)


class Registry:
    def __init__(self, modules: list[str] | None, active: list[str] | None):
        self.modules = set(modules) if modules else {r.id for r in ALL_ROOMS}
        self.active = set(active if active is not None else DEFAULT_ACTIVE)

    def has(self, room_id: str) -> bool:
        return room_id in self.modules

    def channels(self) -> list[tuple[str, str, list[Room]]]:
        """[(channel id, label, rooms in order)], empty channels left out."""
        out = []
        for cid, label, _key, ids in CHANNELS:
            rooms = [ROOM_BY_ID[i] for i in ids
                     if i in self.modules and (ROOM_BY_ID[i].fixed or i in self.active)]
            if rooms:
                out.append((cid, label, rooms))
        return out

    def channel_of(self, room_id: str) -> str | None:
        for cid, _label, _key, ids in CHANNELS:
            if room_id in ids:
                return cid
        return None

    def number(self, room_id: str) -> tuple[int, int] | None:
        """(channel number, room number), both 1-based, or None when it isn't shown."""
        for ci, (_cid, _label, rooms) in enumerate(self.channels(), 1):
            for ri, r in enumerate(rooms, 1):
                if r.id == room_id:
                    return ci, ri
        return None

    def rooms_in(self, channel_id: str) -> list[Room]:
        for cid, _label, rooms in self.channels():
            if cid == channel_id:
                return rooms
        return []

    def by_gkey(self, key: str) -> Room | None:
        if key == "w":
            key = "n"
        for _cid, _label, rooms in self.channels():
            for r in rooms:
                if r.gkey == key:
                    return r
        return None

    def sibling(self, room_id: str, step: int) -> Room | None:
        cid = self.channel_of(room_id)
        rooms = self.rooms_in(cid) if cid else []
        ids = [r.id for r in rooms]
        if room_id not in ids or len(ids) < 2:
            return None
        return rooms[(ids.index(room_id) + step) % len(rooms)]


def load_screen(room: Room):
    """The room's terminal screen class, imported only now (module seam)."""
    if not room.built:
        return None
    mod = importlib.import_module(f"tui.rooms.{room.id}")
    return mod.SCREEN
