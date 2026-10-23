"""A long-running Tubcal tidies itself once a day.

`db.init_db()` prunes at startup, but an autostarted server can run for weeks
without a restart, and the cache table and the history only grow in between.
This thread repeats that tidy-up on a day's wall-clock interval. It naps in
short steps and compares wall-clock time, because a monotonic sleep stops
while a laptop is suspended, and the tidy-up should still come due after one
that slept through the night.
"""

import threading
import time

from . import config, db

_NAP = 3600
_started = False
_lock = threading.Lock()


def daily():
    """Everything the server does once a day. Each step is best-effort."""
    try:
        db.prune_old_data()
    except Exception:
        pass


def due(last, now, every=None):
    return now - last >= (every or config.HOUSEKEEPING_EVERY)


def start():
    """Start the daily thread (once per process; startup already did today's)."""
    global _started
    with _lock:
        if _started:
            return
        _started = True

    def run():
        last = time.time()
        while True:
            time.sleep(_NAP)
            now = time.time()
            if due(last, now):
                daily()
                last = now

    threading.Thread(target=run, name="tubcal-housekeeping", daemon=True).start()
