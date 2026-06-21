"""Desktop notifications: ping the user ~10 minutes before a subscribed channel
goes live, via `notify-send` (no-op if it isn't installed). Best-effort, local."""

import shutil
import subprocess
import threading
import time

from . import db

LEAD_SECONDS = 600   # notify 10 minutes before the scheduled start
POLL_SECONDS = 90    # how often to re-check upcoming streams


def _notify(item):
    exe = shutil.which("notify-send")
    if not exe:
        return
    source = item.get("source") or "A channel"
    title = "Tubcal — going live soon"
    body = f"{source} goes live in ~10 min:\n{item.get('title') or ''}"
    try:
        subprocess.run([exe, "-a", "Tubcal", title, body], timeout=10)
    except Exception:
        pass


def _loop():
    from .sources import youtube

    time.sleep(30)  # let startup warm-up + the first page load settle first
    notified = set()  # video ids already pinged (cleared once they're in the past)
    while True:
        try:
            if db.get_setting("notify_live", True):
                ids = [s["source_id"] for s in db.list_subscriptions("youtube")]
                if ids:
                    now = time.time()
                    items = youtube.get_live_and_upcoming(ids).get("items", [])
                    upcoming_ids = set()
                    for item in items:
                        e = item.get("extra") or {}
                        if e.get("live_status") != "is_upcoming":
                            continue
                        vid = e.get("video_id")
                        sched = e.get("scheduled_at") or 0
                        if not vid:
                            continue
                        upcoming_ids.add(vid)
                        if vid not in notified and 0 < sched - now <= LEAD_SECONDS:
                            _notify(item)
                            notified.add(vid)
                    # Drop ids no longer upcoming so a re-scheduled stream can ping again.
                    notified &= upcoming_ids
        except Exception:
            pass
        time.sleep(POLL_SECONDS)


def start():
    """Spawn the background notifier thread (only if notify-send exists)."""
    if not shutil.which("notify-send"):
        return
    threading.Thread(target=_loop, daemon=True, name="tubcal-notifier").start()
