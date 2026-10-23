"""A long-running Tubcal looks after itself once a day.

`db.init_db()` prunes at startup, but an autostarted server can run for weeks
without a restart, and the cache table and the history only grow in between.
This thread repeats that tidy-up on a day's wall-clock interval, and takes the
day's snapshot of the database (server/snapshots.py) whenever one is due: soon
after startup, then on the first wake of each new day. It naps in short steps
and compares wall-clock time, because a monotonic sleep stops while a laptop is
suspended, and both should still come due after one that slept through the
night.
"""

import threading
import time

from . import config, db, snapshots

_NAP = 3600
_FIRST = 120  # let startup's own work settle before the first snapshot
_started = False
_lock = threading.Lock()


def daily():
    """The once-a-day tidy-up. Best-effort."""
    try:
        db.prune_old_data()
    except Exception:
        pass


def snapshot_if_due():
    try:
        snapshots.daily()
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
        time.sleep(_FIRST)
        while True:
            snapshot_if_due()
            time.sleep(_NAP)
            now = time.time()
            if due(last, now):
                daily()
                last = now

    threading.Thread(target=run, name="tubcal-housekeeping", daemon=True).start()
