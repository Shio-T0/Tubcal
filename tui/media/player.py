"""What plays, from where, and what Tubcal remembers about it.

A video plays from the server's own HLS master (`/api/youtube/hls/<vid>/<itag>.m3u8`):
one shared extraction, expired-URL healing, and mpv never talks to anyone but
127.0.0.1. `youtube_player = "ytdl"` in the config hands YouTube links to mpv's own
yt-dlp instead (4K, VP9, captions) — only by choice, never as a silent fallback.

History is posted when an item opens, then progress every 5 s and on pause, stop and
end; a video under 95 % resumes 2 s before where you left. An anime episode's progress
(`anime:<id>:<ep>`) is what lets the server mark it on AniList at 80 %.
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from ..api import Api, ApiError, seg
from .mpv import Mpv, MpvError

COMPLETE = 0.95
PROGRESS_EVERY = 5.0


@dataclass
class Playing:
    item: dict
    url: str
    kind: str = "youtube"          # youtube | live | anime | audio
    itag: str | None = None
    heights: list[int] = field(default_factory=list)
    quality: str = ""
    started: float = field(default_factory=time.monotonic)


@dataclass
class NowState:
    """What the statusline shows."""
    title: str = ""
    pos: float = 0.0
    dur: float = 0.0
    paused: bool = False
    buffering: bool = False
    loading: bool = False
    quality: str = ""
    queue: int = 0
    active: bool = False


def item_video_id(item: dict) -> str | None:
    extra = item.get("extra") or {}
    if extra.get("video_id"):
        return extra["video_id"]
    iid = item.get("id") or ""
    return iid[3:] if iid.startswith("yt:") else None


class Player:
    def __init__(self, api: Api, *, notify: Callable[[str, str], None], changed: Callable[[], None],
                 settings: dict | None = None, config: dict | None = None):
        self.api = api
        self.notify = notify            # (text, level) from any thread; the app marshals
        self.changed = changed          # the now-state changed (statusline repaint)
        self.settings = settings or {}
        self.config = config or {}
        self.mpv = Mpv(self._on_event, extra_args=self.config.get("mpv_args") or [],
                       mpris=self.config.get("mpris", True))
        self.queue: list[dict] = []
        self.playing: Playing | None = None
        self.now = NowState()
        self.progress: dict[str, dict] = {}
        # what plays after an item when the queue is empty (the next episode of a show)
        self.follow: Callable[[dict], dict | None] | None = None
        # told (from mpv's thread) when an item played to its end
        self.on_finished: Callable[[dict], None] | None = None
        # it started making sound (the app pauses the radio)
        self.on_audible: Callable[[], None] | None = None
        # an item ended: True = stop here, nothing next (the sleep timer's "end")
        self.on_end: Callable[[], bool] | None = None
        self._last_post = 0.0
        self._lock = threading.Lock()

    # ── progress map (for resume points and the row signs) ───────────────────

    def load_progress(self) -> None:
        try:
            self.progress = (self.api.get("/progress") or {}).get("progress") or {}
        except ApiError:
            pass

    def fraction(self, item_id: str) -> float | None:
        p = self.progress.get(item_id)
        if not p or not p.get("duration"):
            return None
        return min(1.0, float(p["position"]) / float(p["duration"]))

    def duration(self, item_id: str) -> float | None:
        """The real length, when a play recorded one ("mark watched" stores 1 of 1)."""
        d = float((self.progress.get(item_id) or {}).get("duration") or 0)
        return d if d > 1 else None

    def resume_at(self, item_id: str) -> float:
        f = self.fraction(item_id)
        p = self.progress.get(item_id) or {}
        if f is None or f >= COMPLETE or float(p.get("position") or 0) < 5:
            return 0.0
        return max(0.0, float(p["position"]) - 2)

    # ── playing ──────────────────────────────────────────────────────────────

    def play(self, item: dict, *, start: float | None = None) -> None:
        """Resolve and load `item` in a worker thread."""
        self.now.loading = True
        self.now.title = item.get("title") or ""
        self.changed()
        threading.Thread(target=self._play, args=(item, start), daemon=True, name="tubcal-play").start()

    def enqueue(self, item: dict) -> int:
        self.queue.append(item)
        self.now.queue = len(self.queue)
        self._tell_has_next()
        self.changed()
        return len(self.queue)

    def next(self) -> bool:
        if not self.queue:
            nxt = self._followed()
            if nxt is None:
                return False
            self.play(nxt, start=0.0)
            return True
        self.now.queue = len(self.queue) - 1
        self.play(self.queue.pop(0))
        return True

    def _followed(self) -> dict | None:
        p = self.playing
        if not (p and self.follow):
            return None
        try:
            return self.follow(p.item)
        except Exception:
            return None

    def _resolve_youtube(self, item: dict) -> Playing:
        vid = item_video_id(item)
        if not vid:
            raise ApiError("This item has no video to play.")
        live = (item.get("extra") or {}).get("live_status") == "is_live"
        if self.config.get("youtube_player") == "ytdl":
            return Playing(item=item, url=f"https://www.youtube.com/watch?v={vid}",
                           kind="live" if live else "youtube", quality="yt-dlp")
        data = self.api.get(f"/youtube/stream/{seg(vid)}", timeout=60)
        streams = data.get("streams") or []
        if not streams:
            raise ApiError("YouTube gave no stream for this video.")
        cap = int(self.config.get("video_max_height") or 0)
        want = int(self.config.get("_quality_pick") or 0)
        heights = sorted({int(s.get("height") or 0) for s in streams if s.get("kind") == "hls"}, reverse=True)
        pick = None
        for s in streams:
            h = int(s.get("height") or 0)
            if want and h != want:
                continue
            if cap and h > cap:
                continue
            pick = s
            break
        pick = pick or streams[-1]
        if pick.get("kind") == "hls":
            url = self.api.url(f"/api/youtube/hls/{seg(vid)}/{seg(pick['itag'])}.m3u8")
        else:
            url = self.api.url(f"/api/youtube/stream/{seg(vid)}/data?itag={seg(pick['itag'])}")
        return Playing(item=item, url=url, kind="live" if live else "youtube", itag=str(pick["itag"]),
                       heights=heights, quality=pick.get("quality") or "")

    def _resolve(self, item: dict) -> Playing:
        extra = item.get("extra") or {}
        if extra.get("stream_key"):
            return self._resolve_anime(item)
        if item.get("platform") == "youtube" or (item.get("id") or "").startswith("yt:"):
            return self._resolve_youtube(item)
        audio = extra.get("audio")
        if audio:
            return Playing(item=item, url=audio, kind="audio")
        raise ApiError("Tubcal can't play this here; `o` opens it in the browser.")

    def _resolve_anime(self, item: dict) -> Playing:
        key = item["extra"]["stream_key"]
        data = self.api.get(f"/anime/stream/{seg(key)}", timeout=90)
        streams = data.get("streams") or []
        if not streams:
            raise ApiError("No source had this episode.")
        s = streams[0]
        url = self.api.url(f"/api/anime/hls/{seg(key)}/{seg(s['itag'])}.m3u8") if s.get("kind") == "hls" \
            else self.api.url(f"/api/anime/stream/{seg(key)}/data?itag={seg(s['itag'])}")
        p = Playing(item=item, url=url, kind="anime", itag=str(s["itag"]), quality=s.get("quality") or "")
        p.item = dict(item, _anime=data)
        return p

    def _play(self, item: dict, start: float | None) -> None:
        with self._lock:
            try:
                self.flush()
                p = self._resolve(item)
                self.mpv.ensure()
            except (ApiError, MpvError) as e:
                self.now.loading = False
                self.changed()
                self.notify(str(e), "error")
                return
            item_id = item.get("id") or ""
            if start is None:
                start = self.resume_at(item_id) if p.kind not in ("live",) else 0.0
            try:
                self.api.record_open({k: v for k, v in item.items() if not k.startswith("_")})
            except ApiError:
                pass  # history is a nicety; playback goes on
            opts = {"force-media-title": item.get("title") or "Tubcal",
                    "ytdl": "yes" if p.url.startswith("https://www.youtube.com/") else "no"}
            if start:
                opts["start"] = f"{start:.2f}"
            if p.url.startswith("https://www.youtube.com/"):
                opts["ytdl-raw-options"] = "no-cookies=,no-cookies-from-browser=,no-mark-watched="
            # the new item is current before mpv says anything about it
            self.playing = p
            self._last_post = time.monotonic()
            self.now = NowState(title=item.get("title") or "", quality=p.quality, queue=len(self.queue),
                                active=True, loading=True)
            self.changed()
            try:
                self.mpv.set("force-window", "immediate")
                rate = self.settings.get("playback_rate")
                if rate:
                    self.mpv.set("speed", float(rate))
                vol = self.settings.get("player_volume")
                if vol is not None:
                    self.mpv.set("volume", round(float(vol) * 100))
                self.mpv.command("loadfile", p.url, "replace", -1, opts)
            except MpvError as e:
                self.playing = None
                self.now = NowState(queue=len(self.queue))
                self.changed()
                self.notify(str(e), "error")
                return
            if self.on_audible:
                self.on_audible()
            threading.Thread(target=self._after_load, args=(p,), daemon=True).start()

    def _after_load(self, p: Playing) -> None:
        """Chapters, subtitles and skip cues, once the item is loading."""
        try:
            self._tell_has_next()
            if p.kind == "youtube" and p.quality != "yt-dlp":
                vid = item_video_id(p.item)
                meta = self.api.get(f"/youtube/video/{seg(vid)}", timeout=60) or {}
                chapters = meta.get("chapters") or []
                if chapters:
                    self.mpv.message("tubcal-chapters", json.dumps(chapters))
            elif p.kind == "anime":
                data = p.item.get("_anime") or {}
                subs = data.get("subtitles") or []
                lang = (self.settings.get("subtitle_style") or {}).get("lang") or "en"
                show = (self.settings.get("subtitle_style") or {}).get("show", True)
                chosen = next((s for s in subs if s.get("lang") == lang), None) or \
                    next((s for s in subs if s.get("default")), None) or (subs[0] if subs else None)
                for s in subs:
                    flag = "select" if (s is chosen and show) else "auto"
                    self.mpv.command("sub-add", self.api.url(s["src"]), flag, s.get("label") or s.get("lang") or "",
                                     s.get("lang") or "")
                skip = data.get("skip") or {}
                if skip:
                    skip = dict(skip, auto=bool(self.settings.get("anime_auto_skip")))
                    self.mpv.message("tubcal-skip", json.dumps(skip))
        except (ApiError, MpvError):
            pass

    def _tell_has_next(self) -> None:
        if self.mpv.alive:
            try:
                self.mpv.message("tubcal-has-next", "yes" if (self.queue or self._followed()) else "no")
            except MpvError:
                pass

    # ── controls ─────────────────────────────────────────────────────────────

    def toggle_pause(self) -> None:
        if self.mpv.alive:
            self.mpv.command("cycle", "pause")

    def pause(self) -> None:
        """Quietly, when the radio starts."""
        if self.mpv.alive and self.playing and not self.now.paused:
            try:
                self.mpv.set("pause", True)
            except MpvError:
                pass

    def stop(self) -> None:
        self.flush()
        if self.mpv.alive:
            self.mpv.command("stop")
        self.playing = None
        self.now = NowState(queue=len(self.queue))
        self.changed()

    def seek(self, seconds: float, absolute: bool = False) -> None:
        if self.mpv.alive:
            self.mpv.command("seek", seconds, "absolute" if absolute else "relative")

    def set_quality(self, height: int) -> None:
        """Reload the same item at another height, at the same time and pause state."""
        p = self.playing
        if not p or p.kind != "youtube" or p.quality == "yt-dlp":
            self.notify("Quality can only change on a YouTube video.", "warn")
            return
        pos = float(self.mpv.get("time-pos") or 0)
        paused = bool(self.mpv.get("pause"))
        self.config["_quality_pick"] = height

        def go():
            self._play(p.item, pos)
            if paused:
                try:
                    self.mpv.set("pause", True)
                except MpvError:
                    pass
            self.config["_quality_pick"] = 0
        threading.Thread(target=go, daemon=True).start()

    def current_link_time(self) -> int:
        return int(float(self.mpv.get("time-pos") or 0)) if self.mpv.alive else 0

    # ── what mpv tells us ────────────────────────────────────────────────────

    def _on_event(self, ev: dict) -> None:
        name = ev.get("event")
        if name == "property-change":
            prop, val = ev.get("name"), ev.get("data")
            if prop == "time-pos" and val is not None:
                self.now.pos = float(val)
                self.now.loading = False
                p = self.playing
                if p and p.kind != "live" and self.now.dur:
                    # the local map follows along, so rows and resume points are current
                    self.progress[p.item.get("id") or ""] = {"position": self.now.pos, "duration": self.now.dur}
                if time.monotonic() - self._last_post >= PROGRESS_EVERY:
                    self._last_post = time.monotonic()
                    self._post_progress()
            elif prop == "duration" and val:
                self.now.dur = float(val)
            elif prop == "pause":
                was = self.now.paused
                self.now.paused = bool(val)
                if val:
                    self._post_progress()
                elif was and self.playing and self.on_audible:   # unpaused in mpv's window
                    self.on_audible()
            elif prop == "paused-for-cache":
                self.now.buffering = bool(val)
            self.changed()
        elif name == "end-file":
            reason = ev.get("reason")
            if reason in ("eof", "error"):
                self._post_progress(final=True)
                if reason == "eof" and self.playing and self.on_finished:
                    try:
                        self.on_finished(self.playing.item)
                    except Exception:
                        pass
                if reason == "error":
                    self.notify("mpv couldn't play this item.", "error")
                held = reason == "eof" and self.on_end is not None and self.on_end()
                if held or not self.next():
                    self.playing = None
                    self.now = NowState(queue=0)
                    self.changed()
        elif name == "idle":
            try:
                self.mpv.set("force-window", "no")
            except MpvError:
                pass
        elif name == "client-message":
            args = ev.get("args") or []
            if args[:2] == ["tubcal-event", "next"]:
                self.next()
        elif name == "mpv-exit":
            self._post_progress(final=True)
            self.playing = None
            self.now = NowState(queue=len(self.queue))
            self.changed()

    def _post_progress(self, final: bool = False) -> None:
        p = self.playing
        if not p or p.kind == "live":
            return
        pos, dur = self.now.pos, self.now.dur
        if not dur:
            return
        item_id = p.item.get("id") or ""
        if final and pos >= dur - 1:
            pos = dur
        self.progress[item_id] = {"position": pos, "duration": dur}

        def send():
            try:
                self.api.record_progress(item_id, pos, dur)
            except ApiError:
                pass
        threading.Thread(target=send, daemon=True).start()

    def flush(self) -> None:
        self._post_progress()

    def shutdown(self) -> None:
        self._post_progress(final=False)
        self.mpv.close(quit=True)
