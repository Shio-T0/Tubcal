"""Where you are with a title, and its episodes — for Home and the Anime room.

Mirrors the web's pure helpers, so the terminal and the browser agree on what's next:
- `watch_state`        frontend/src/components/player/anime/watching.js (watchState)
- `build_episode_list`, `episode_item`, `ep_subtitle`, `key_with_audio`
                       frontend/src/components/player/anime/episodeList.js
- `anime_item`         frontend/src/lib/saveable.js (animeItem)
tests/test_tui_anime.py runs episodeList.js under node against the same inputs.
"""

from __future__ import annotations

import base64
import json
import re
import time

COMPLETE = 0.95
ACTIVE = {"CURRENT", "REPEATING"}
RESUMABLE = {"CURRENT", "REPEATING", "PAUSED", "DROPPED"}
SHELVES = [("CURRENT", "Watching"), ("PLANNING", "Planning"), ("COMPLETED", "Completed"),
           ("PAUSED", "Paused"), ("DROPPED", "Dropped"), ("REPEATING", "Rewatching")]


def watch_state(m: dict, entry: dict, progress: dict, now: float | None = None) -> dict:
    status = entry.get("status")
    watched = entry.get("progress") or 0
    total = m.get("episodes") or None
    if m.get("next_episode"):
        aired = m["next_episode"] - 1
    elif m.get("status") == "NOT_YET_RELEASED":
        aired = 0
    else:
        aired = total or watched
    left = max(0, aired - watched)
    next_n = 1 if status == "PLANNING" else watched + 1
    can_play = status != "COMPLETED" and next_n <= aired
    p = progress.get(f"anime:{m['id']}:{next_n}") or {}
    ratio = (p.get("position") or 0) / p["duration"] if p.get("duration") else 0
    resume_at = p["position"] if can_play and 0.02 < ratio < COMPLETE else None
    per = m.get("duration") or 24
    now = now or time.time()
    return {
        "status": status, "watched": watched, "total": total, "aired": aired, "left": left,
        "next_n": next_n, "can_play": can_play, "resume_at": resume_at,
        "remaining_of_next": (p["duration"] - p["position"]) if resume_at is not None else None,
        "catch_up": left * per,
        "airing_at": m.get("next_airing_at") if (m.get("next_airing_at") or 0) > now else None,
        "airing_ep": m.get("next_episode") or None,
        "can_bump": status in RESUMABLE and (not total or watched < total),
    }


def ep_subtitle(title: str | None, number) -> str | None:
    if not title:
        return None
    cleaned = re.sub(r"^\s*episode\s+\d+\s*[-:–—]?\s*", "", title, flags=re.I).strip()
    return cleaned if cleaned and cleaned != str(number) else None


def build_episode_list(media: dict | None, source_episodes: list | None) -> list[dict]:
    merged: dict[int, dict] = {}
    for se in (media or {}).get("streaming") or []:
        if se.get("number") is None:
            continue
        e = merged.setdefault(se["number"], {"number": se["number"]})
        if not e.get("image"):
            e["image"] = se.get("thumbnail")
        if not e.get("url"):
            e["url"], e["site"] = se.get("url"), se.get("site")
        if not e.get("title"):
            e["title"] = ep_subtitle(se.get("title"), se["number"])
    for ep in source_episodes or []:
        if ep.get("number") is None:
            continue
        e = merged.setdefault(ep["number"], {"number": ep["number"]})
        if not e.get("key"):
            e["key"] = ep.get("key")
        if not e.get("image"):
            e["image"] = ep.get("image")
        if not e.get("title"):
            e["title"] = ep_subtitle(ep.get("title"), ep["number"])
    aired = max(merged) if merged else 0
    media = media or {}
    if media.get("next_episode"):
        aired = max(aired, media["next_episode"] - 1)
    elif media.get("episodes") and media.get("status") != "NOT_YET_RELEASED":
        aired = max(aired, media["episodes"])
    for n in range(1, int(aired) + 1):
        merged.setdefault(n, {"number": n})
    out = [merged[k] for k in sorted(merged)]
    uses: dict[str, int] = {}
    for e in out:
        if e.get("image"):
            uses[e["image"]] = uses.get(e["image"], 0) + 1
    for e in out:
        e["still"] = e["image"] if e.get("image") and uses[e["image"]] == 1 else None
    return out


def key_with_audio(key: str | None, audio: str | None) -> str | None:
    """The same episode key asking for the other audio ('sub' / 'dub')."""
    if not key or not audio:
        return key
    try:
        pad = "=" * (-len(key) % 4)
        data = json.loads(base64.urlsafe_b64decode(key + pad))
        if data.get("l") == audio:
            return key
        data["l"] = audio
        # the server's own encoding (anime_source._encode_key): json.dumps, url-safe base64
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode()
    except (ValueError, TypeError):
        return key


def episode_item(media: dict, e: dict, *, audio: str | None = None) -> dict:
    """The player item for one episode. Its id is the progress key the server watches
    to mark the episode on AniList (`anime:<anilist id>:<episode>`)."""
    return {
        "id": f"anime:{media['id']}:{e['number']}",
        "platform": "anime",
        "title": f"{media.get('title')} — Episode {e['number']}",
        "thumbnail": e.get("still") or media.get("cover_xl") or media.get("cover"),
        "url": f"https://anilist.co/anime/{media['id']}",
        "source": media.get("title"),
        "published_at": 0,
        "extra": {
            "stream_key": key_with_audio(e.get("key"), audio),
            "anilist_id": media["id"], "episode": e["number"], "episode_title": e.get("title"),
            "show": media.get("title"), "cover": media.get("cover_xl") or media.get("cover"),
            "banner": media.get("banner"), "color": media.get("color"),
        },
    }


def anime_item(m: dict) -> dict:
    """An AniList title, as Saved keeps it."""
    season = m.get("season")
    when = f"{season[0]}{season[1:].lower()} {m['year']}" if season and m.get("year") else (m.get("year") or m.get("start_year"))
    return {
        "id": f"anime:{m['id']}", "platform": "anime", "title": m.get("title"),
        "url": f"/anime/{m['id']}", "thumbnail": m.get("cover") or m.get("cover_xl"),
        "source": " · ".join(str(x) for x in (m.get("format"), when) if x) or "AniList",
        "extra": {"kind": "anime", "anilist_id": m["id"], "color": m.get("color"),
                  "episodes": m.get("episodes"), "native": m.get("title_native")},
    }


def entries_of(lists: list[dict]) -> list[dict]:
    """Every title on the list once (custom lists repeat titles on a status shelf)."""
    seen, out = set(), []
    for g in lists or []:
        if g.get("custom"):
            continue
        for e in g.get("entries") or []:
            mid = (e.get("media") or {}).get("id")
            if mid in seen:
                continue
            seen.add(mid)
            out.append(e)
    return out


class Shows:
    """Your AniList list and the shows you've opened, shared by Home and the Anime room.

    Blocking methods run in thread workers. The list is read again when it's a minute
    old; an episode played to the end moves your place on locally at once (the server
    marks it on AniList at 80 %)."""

    def __init__(self, app):
        self.app = app
        self.entries: list[dict] | None = None
        self.viewer: dict | None = None
        self.error: str | None = None
        self.loaded_at = 0.0
        self.details: dict[int, dict] = {}
        self.episodes: dict[int, list[dict]] = {}
        self.audio: dict[int, str] = {}

    @property
    def api(self):
        return self.app.api

    def load(self, force: bool = False) -> None:
        if not force and self.entries is not None and time.time() - self.loaded_at < 60:
            return
        from .api import ApiError
        try:
            d = self.api.get("/anime/lists", timeout=60) or {}
            self.entries = entries_of(d.get("lists") or [])
            self.viewer = d.get("viewer")
            self.error = None
        except ApiError as e:
            self.error = "AniList isn't connected." if e.status == 401 else str(e)
            if e.status == 401:
                self.entries = []
        self.loaded_at = time.time()

    def entry(self, mid: int) -> dict | None:
        return next((e for e in self.entries or [] if (e.get("media") or {}).get("id") == mid), None)

    def detail(self, mid: int) -> dict | None:
        if mid not in self.details:
            from .api import ApiError
            try:
                self.details[mid] = self.api.get(f"/anime/media/{mid}", timeout=60) or {}
            except ApiError:
                return None
        return self.details[mid]

    def episode_list(self, media: dict, *, fetch: bool = True) -> list[dict]:
        mid = media["id"]
        if mid not in self.episodes and fetch:
            from .api import ApiError
            try:
                src = (self.api.get(f"/anime/episodes/{mid}", timeout=90) or {}).get("episodes") or []
            except ApiError:
                src = []
            self.episodes[mid] = build_episode_list(self.details.get(mid) or media, src)
        return self.episodes.get(mid) or []

    def audio_for(self, mid: int) -> str:
        return self.audio.get(mid) or self.app.settings.get("anime_sub_pref") or "sub"

    def item(self, media: dict, n: int) -> dict | None:
        """Episode `n`'s player item, or None when no source has it."""
        e = next((x for x in self.episode_list(media) if x["number"] == n), None)
        if not e or not e.get("key"):
            return None
        return episode_item(media, e, audio=self.audio_for(media["id"]))

    def play(self, media: dict, n: int) -> None:
        """Play episode `n` (from a worker): look up its key, then hand it to the player."""
        if media["id"] not in self.episodes:
            self.app.say(f"Finding episode {n} of {media.get('title')}… (the first time takes a while)")

        def work():
            it = self.item(media, n)
            if it is None:
                self.app.call_from_thread(self.app.say, f"Episode {n} of {media.get('title')} isn't available to play yet.", "error")
                return
            self.app.call_from_thread(self.app.play, it)
        self.app.run_worker(work, thread=True, group="anime-play", exclusive=True)

    def follow(self, item: dict) -> dict | None:
        """The next episode after `item`, if it has aired and a source has it (no network)."""
        extra = item.get("extra") or {}
        mid, n = extra.get("anilist_id"), extra.get("episode")
        if not mid or n is None or not str(item.get("id", "")).startswith("anime:"):
            return None
        eps = self.episodes.get(mid) or []
        nxt = next((e for e in eps if e["number"] == int(n) + 1 and e.get("key")), None)
        media = self.details.get(mid) or (self.entry(mid) or {}).get("media")
        if not nxt or not media:
            return None
        return episode_item(media, nxt, audio=self.audio_for(mid))

    def finished(self, item: dict) -> None:
        """An episode played to the end: move your place on here at once."""
        extra = item.get("extra") or {}
        e = self.entry(extra.get("anilist_id"))
        if e and extra.get("episode") and int(extra["episode"]) > (e.get("progress") or 0):
            e["progress"] = int(extra["episode"])
            if e.get("status") == "PLANNING":
                e["status"] = "CURRENT"

    def set_progress(self, mid: int, progress: int) -> dict:
        """Write your place to AniList; returns the stored entry (raises ApiError)."""
        out = self.api.post("/anime/list", {"media_id": mid, "progress": max(0, progress)}) or {}
        e = self.entry(mid)
        if e is not None:
            for k in ("status", "progress", "score", "updated_at"):
                if out.get(k) is not None:
                    e[k] = out[k]
        if mid in self.details and isinstance(self.details[mid].get("list_entry"), dict):
            self.details[mid]["list_entry"].update({k: v for k, v in out.items() if v is not None})
        return out
