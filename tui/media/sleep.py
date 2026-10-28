"""The sleep timer: one for the whole station, as on the web (lib/sleepTimer.js).

`end` stops when what's playing ends (the video, the episode, or the podcast when
nothing else plays): nothing from the queue, no next episode. A number of minutes
fades whichever player you can hear out over the last 12 s so it's silent on time,
pauses every player, and puts the volume back for next time.
"""

from __future__ import annotations

import re
import threading
import time
from typing import Callable

FADE = 12.0
STEP = 0.2


def parse(arg: str) -> float | str | None:
    """`:sleep` words → seconds, "end", "off", or None when they mean nothing.
    30 · 30m · 1h · 1h30 · 1:30 · 90s · end · off"""
    a = (arg or "").strip().lower()
    if a in ("end", "eof", "this"):
        return "end"
    if a in ("off", "cancel", "no", "0"):
        return "off"
    if re.fullmatch(r"\d+(\.\d+)?", a):
        return float(a) * 60
    m = re.fullmatch(r"(\d+):(\d{1,2})", a)
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60
    if not re.fullmatch(r"(\d+\s*[hms]?\s*)+", a):
        return None
    total, prev = 0, ""
    for n, unit in re.findall(r"(\d+)\s*([hms]?)", a):
        # a bare number after hours is minutes (1h30), after minutes seconds (1m30)
        unit = unit or ("s" if prev == "m" else "m")
        total += int(n) * {"h": 3600, "m": 60, "s": 1}[unit]
        prev = unit
    return float(total) if total else None


class SleepTimer:
    """`players()` gives the mpv controllers that can make sound (video, radio)."""

    def __init__(self, players: Callable[[], list], *, notify: Callable[[str, str], None],
                 changed: Callable[[], None]):
        self.players = players
        self.notify = notify
        self.changed = changed
        self.mode = ""           # "" | "end" | "time"
        self.deadline = 0.0
        self._fading = False
        self._gen = 0             # a new setting stops a fade that's under way

    # ── setting ──────────────────────────────────────────────────────────────

    def set_seconds(self, seconds: float) -> None:
        self._gen += 1
        self.mode, self.deadline = "time", time.monotonic() + max(1.0, seconds)
        self.changed()

    def set_end(self) -> None:
        self._gen += 1
        self.mode = "end"
        self.changed()

    def cancel(self) -> None:
        self._gen += 1
        self.mode = ""
        self.changed()

    @property
    def on(self) -> bool:
        return bool(self.mode)

    def left(self) -> float | None:
        if self.mode != "time":
            return None
        return max(0.0, self.deadline - time.monotonic())

    def label(self) -> str:
        """For the statusline: "end", "23m", "0:40"."""
        if self.mode == "end":
            return "end"
        left = self.left()
        if left is None:
            return ""
        if left >= 120:
            return f"{int(left // 60)}m"
        return f"{int(left // 60)}:{int(left % 60):02d}"

    # ── running ──────────────────────────────────────────────────────────────

    def tick(self) -> None:
        """Every second, from the app."""
        left = self.left()
        if left is not None and left <= FADE and not self._fading:
            self._fading = True
            threading.Thread(target=self._fade, args=(self._gen,), daemon=True, name="tubcal-sleep").start()

    def ended(self) -> bool:
        """A player's item reached its end. True = stop here (don't play what's next)."""
        if self.mode != "end":
            return False
        self.mode = ""
        self.notify("Sleep timer: stopped at the end, as asked.", "info")
        self.changed()
        # anything else still playing pauses too (from another thread: this one is the
        # ending player's reader, and asking its own mpv from here would wait forever)
        threading.Thread(target=self._pause_all, daemon=True).start()
        return True

    def _pause_all(self) -> None:
        for m in self.players():
            try:
                if m.alive:
                    m.set("pause", True)
            except Exception:
                pass

    def _fade(self, gen: int) -> None:
        loud = []
        for m in self.players():
            try:
                if m.alive and not m.get("pause", True) and not m.get("idle-active", True):
                    loud.append((m, float(m.get("volume") or 100)))
            except Exception:
                continue
        try:
            while gen == self._gen:
                left = self.left() or 0.0
                if left <= 0:
                    break
                k = max(0.0, min(1.0, left / FADE))
                for m, v0 in loud:
                    try:
                        m.set("volume", round(v0 * k, 1))
                    except Exception:
                        pass
                time.sleep(STEP)
            if gen == self._gen:
                self._pause_all()
        finally:
            for m, v0 in loud:   # your volume, back for next time
                try:
                    m.set("volume", v0)
                except Exception:
                    pass
            self._fading = False
        if gen == self._gen:
            self.mode = ""
            self.notify("Sleep timer: everything is paused. Good night.", "info")
            self.changed()
