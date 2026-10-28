"""The bench radio: podcast episodes on a second mpv with no window, so one plays on
while you go from room to room. One sound at a time: the app pauses the video when the
radio starts and the radio when a video starts (`on_audible` on both).

Episodes have the Workbench's shape (`{id, title, show, show_art, audio, duration,
url, lang}`, the web's lib/radio.js); a saved podcast entry is turned into one by
`episode_of`. Where you stopped in each is kept as the web keeps its own: the 40 most
recent, newest first, in the terminal's state file; one heard to its last 30 s counts
as heard. A private session keeps no places.

The audio comes straight from the podcast's own host, as it does in the browser.
"""

from __future__ import annotations

import threading
import time
from typing import Callable

from .mpv import Mpv, MpvError
from .player import NowState

KEEP = 40
HEARD_END = 30
SAVE_EVERY = 10.0


def episode_of(item: dict) -> dict:
    """A saved podcast entry (saveable.js podcastItem) → an episode (podcastEpisode)."""
    extra = item.get("extra") or {}
    iid = item.get("id") or ""
    return {"id": iid[len("podcast:"):] if iid.startswith("podcast:") else iid,
            "title": item.get("title") or "", "show": item.get("source") or "",
            "show_art": item.get("thumbnail"), "audio": extra.get("audio"),
            "duration": extra.get("duration"), "url": item.get("url"), "lang": extra.get("lang")}


def podcast_item(ep: dict, lang: str | None = None) -> dict:
    """An episode as a saved entry (saveable.js podcastItem)."""
    return {"id": f"podcast:{ep['id']}", "platform": "dev", "title": ep.get("title") or "",
            "url": ep.get("url") or ep.get("audio"), "thumbnail": None, "source": ep.get("show") or "",
            "published_at": ep.get("published_at"),
            "extra": {"kind": "podcast", "audio": ep.get("audio"), "duration": ep.get("duration") or None,
                      "lang": lang}}


class Radio:
    def __init__(self, state, *, notify: Callable[[str, str], None], changed: Callable[[], None],
                 config: dict | None = None):
        self.state = state
        self.notify = notify
        self.changed = changed
        config = config or {}
        self.mpv = Mpv(self._on_event, name="radio", mpris=config.get("mpris", True),
                       extra_args=["--no-video", "--audio-display=no", "--x11-name=tubcal-radio",
                                   *(config.get("mpv_args") or [])])
        self.episode: dict | None = None
        self.now = NowState()
        self.on_audible: Callable[[], None] | None = None   # it started making sound
        self.on_end: Callable[[], bool] | None = None        # True = the sleep timer took it
        self._saved_at = 0.0

    # ── places ───────────────────────────────────────────────────────────────

    def _places(self) -> list:
        return self.state.data.setdefault("radio", [])

    def place_of(self, ep_id: str) -> float:
        for k, at in self._places():
            if k == ep_id:
                return float(at)
        return 0.0

    def left(self, ep: dict) -> float | None:
        """Seconds left in an episode you stopped half-way, else None."""
        at = self.place_of(ep.get("id") or "")
        dur = float(ep.get("duration") or 0)
        if self.episode and self.episode.get("id") == ep.get("id") and self.now.dur:
            at, dur = self.now.pos, self.now.dur
        return dur - at if at > 5 and dur > at else None

    def _keep_place(self) -> None:
        ep = self.episode
        if not ep or self.state.private:
            return
        at, total = self.now.pos, self.now.dur or float(ep.get("duration") or 0)
        heard = total and at >= total - HEARD_END
        rest = [p for p in self._places() if p[0] != ep["id"]]
        self.state.data["radio"] = ([[ep["id"], int(at)]] if at > 5 and not heard else []) + rest
        del self.state.data["radio"][KEEP:]
        self._saved_at = time.monotonic()
        self.state.save()

    # ── playing ──────────────────────────────────────────────────────────────

    @property
    def on(self) -> bool:
        return self.episode is not None

    def tune(self, ep: dict) -> None:
        """Play an episode from where you left it (the one already tuned carries on)."""
        audio = str(ep.get("audio") or "")
        if not audio.startswith(("https://", "http://")):
            self.notify("This episode has no audio to play.", "warn")
            return
        if self.episode and self.episode.get("id") == ep.get("id") and self.mpv.alive:
            if self.now.paused:
                self.toggle()
            return
        self._keep_place()
        at = self.place_of(ep.get("id") or "")
        self.episode = ep
        self.now = NowState(title=ep.get("title") or "", pos=at, dur=float(ep.get("duration") or 0),
                            active=True, loading=True)
        self.changed()
        threading.Thread(target=self._load, args=(ep, audio, at), daemon=True, name="tubcal-radio").start()

    def _load(self, ep: dict, audio: str, at: float) -> None:
        try:
            self.mpv.ensure()
            opts = {"force-media-title": f"{ep.get('show') or ''} — {ep.get('title') or ''}".strip(" —")}
            if at:
                opts["start"] = f"{at:.0f}"
            self.mpv.command("loadfile", audio, "replace", -1, opts)
            self.mpv.set("pause", False)
        except MpvError as e:
            if self.episode is ep:
                self.episode = None
                self.now = NowState()
                self.changed()
            self.notify(str(e), "error")
            return
        if self.on_audible:
            self.on_audible()

    def toggle(self) -> None:
        if not self.mpv.alive or not self.episode:
            if self.episode:   # mpv went away: tune again from the kept place
                ep, self.episode = self.episode, None
                self.tune(ep)
            return
        resuming = self.now.paused
        self.mpv.command("cycle", "pause")
        if resuming and self.on_audible:
            self.on_audible()

    def pause(self) -> None:
        """Quietly, when a video starts."""
        if self.mpv.alive and self.episode and not self.now.paused:
            try:
                self.mpv.set("pause", True)
            except MpvError:
                pass

    def seek(self, seconds: float) -> None:
        if self.mpv.alive and self.episode:
            self.mpv.command("seek", seconds, "relative")

    def switch_off(self) -> None:
        self._keep_place()
        self.episode = None
        self.now = NowState()
        if self.mpv.alive:
            try:
                self.mpv.command("stop")
            except MpvError:
                pass
        self.changed()

    def shutdown(self) -> None:
        self._keep_place()
        self.mpv.close(quit=True)

    # ── what mpv tells us ────────────────────────────────────────────────────

    def _on_event(self, ev: dict) -> None:
        name = ev.get("event")
        if name == "property-change":
            prop, val = ev.get("name"), ev.get("data")
            if not self.episode:
                return
            if prop == "time-pos" and val is not None:
                self.now.pos = float(val)
                self.now.loading = False
                if time.monotonic() - self._saved_at >= SAVE_EVERY:
                    self._keep_place()
            elif prop == "duration" and val:
                self.now.dur = float(val)
            elif prop == "pause":
                was = self.now.paused
                self.now.paused = bool(val)
                if val:
                    self._keep_place()
                elif was and self.on_audible:   # unpaused from the media keys
                    self.on_audible()
            elif prop == "paused-for-cache":
                self.now.buffering = bool(val)
            self.changed()
        elif name == "end-file":
            reason = ev.get("reason")
            if reason == "eof" and self.episode:
                self.now.pos = self.now.dur
                self._keep_place()
                title = self.episode.get("title") or "the episode"
                self.episode = None
                self.now = NowState()
                if not (self.on_end and self.on_end()):
                    self.notify(f"The radio played {title} to the end.", "info")
                self.changed()
            elif reason == "error" and self.episode:
                self.episode = None
                self.now = NowState()
                self.notify("The radio couldn't play that episode.", "error")
                self.changed()
        elif name == "mpv-exit":
            if self.episode:
                self._keep_place()
                self.now.paused = True
                self.changed()
