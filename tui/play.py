"""`python -m tui play <link>` — play a YouTube link in mpv through Tubcal, without the
interface: the same player, so history and resume points are kept as usual (not with
--private). Returns when mpv finishes or you press Ctrl+C.
"""

from __future__ import annotations

import sys
import threading
import time

from .api import Api, ApiError, seg, server_port
from .bootstrap import REPO
from .media.player import Player


def play_cli(words: list[str], *, private: bool = False) -> int:
    if not words:
        print("usage: tubcal tui play <youtube link>", file=sys.stderr)
        return 2
    url = words[0] if "://" in words[0] else "https://" + words[0]
    api = Api(f"http://127.0.0.1:{server_port(REPO)}", private=private)
    if api.health() is None:
        print("The Tubcal server isn't running (tubcal start).", file=sys.stderr)
        return 1
    try:
        path = (api.get("/youtube/link", url=url) or {}).get("path") or ""
    except ApiError as e:
        print(e, file=sys.stderr)
        return 1
    if not path.startswith("/youtube/open?v="):
        print("Not a YouTube video link Tubcal can play.", file=sys.stderr)
        return 1
    vid = path.split("v=", 1)[1].split("&", 1)[0]
    item = {"id": f"yt:{vid}", "platform": "youtube", "url": f"https://www.youtube.com/watch?v={vid}",
            "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg", "extra": {"video_id": vid}}
    try:
        meta = api.get(f"/youtube/video/{seg(vid)}", timeout=60) or {}
        item.update(title=meta.get("title") or url, source=meta.get("author") or "")
        item["extra"]["channel_id"] = meta.get("channel_id")
        if meta.get("live_status") == "is_live":
            item["extra"]["live_status"] = "is_live"
    except ApiError:
        item["title"] = url
    try:
        settings = api.get("/settings") or {}
    except ApiError:
        settings = {}
    done = threading.Event()
    started = threading.Event()

    def notify(text: str, level: str) -> None:
        print(text, file=sys.stderr)
        if level == "error":
            done.set()

    def changed() -> None:
        if player.now.active:
            started.set()
        elif started.is_set() and not player.now.active and not player.now.loading:
            done.set()

    player = Player(api, notify=notify, changed=changed, settings=settings)
    player.load_progress()
    print(f"▶ {item['title']}" + ("  (private: not recorded)" if private else ""))
    player.play(item)
    try:
        while not done.wait(0.5):
            if started.is_set() and not player.mpv.alive:
                break
    except KeyboardInterrupt:
        pass
    player.shutdown()
    time.sleep(0.2)
    return 0
