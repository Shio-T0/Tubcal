"""What the terminal remembers between runs, in $XDG_STATE_HOME/tubcal/tui.json (0600):
the room you were in, each view's settings, which channels you've seen up to when, the
Wire's and the Edition's read marks, and where you stopped in podcast episodes (the
browser keeps its own of each of these).

No item titles and no watch history: that's the server's. The jumplist and the `/` and
`:` histories stay in memory. In a private session nothing is written. `:history clear`
forgets the read marks and the podcast places (`forget_marks`).
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .bootstrap import state_dir

NEW_WINDOW = 2 * 86400


class State:
    def __init__(self, private: bool = False, file: Path | None = None):
        self.private = private
        self.file = file or state_dir() / "tui.json"
        self.data: dict = {"room": None, "views": {}, "seen": {}, "first_run": None,
                           "wire_seen": {}, "edition_read": {}, "radio": []}
        try:
            loaded = json.loads(self.file.read_text())
            if isinstance(loaded, dict):
                for k, default in list(self.data.items()):
                    # a value of the wrong shape (a hand edit, an older file) keeps the default
                    if k in loaded and (default is None or isinstance(loaded[k], type(default))):
                        self.data[k] = loaded[k]
        except (OSError, ValueError):
            pass

    def save(self) -> None:
        if self.private:
            return
        tmp = self.file.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(self.data, f)
        os.replace(tmp, self.file)

    def forget_marks(self) -> None:
        """What `:history clear` forgets: read marks and podcast places."""
        self.data["wire_seen"], self.data["edition_read"], self.data["radio"] = {}, {}, []
        self.save()

    def view(self, room: str) -> dict:
        return self.data["views"].setdefault(room, {})

    # "new" per channel, until you open it or watch from it (the web's rule)
    def seen_at(self, channel_id: str) -> float:
        return float(self.data["seen"].get(channel_id) or 0)

    def mark_seen(self, channel_id: str, when: float | None = None) -> None:
        self.data["seen"][channel_id] = when or time.time()

    def upload_is_new(self, item: dict, *, played: bool) -> bool:
        """A YouTube upload is new until you play it or mark its channel seen; on a first
        run, the last two days count as new."""
        if played:
            return False
        channel = (item.get("extra") or {}).get("channel_id") or item.get("source") or ""
        first = float(self.data.get("first_run") or time.time())
        seen = self.seen_at(f"yt:{channel}") or first - NEW_WINDOW
        return float(item.get("published_at") or 0) > seen
