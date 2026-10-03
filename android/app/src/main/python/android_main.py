"""Android entrypoint for the embedded Tubcal server.

Chaquopy runs CPython in-process inside the APK. Kotlin calls `start()` on a
background thread, passing writable on-device paths; we point the existing Flask
app at them and run it bound to localhost, which the app's WebView then loads.

`server/` is the desktop package from the repo root, unmodified: Gradle copies
it (and main.py, as desktop_main.py) into the build each time (app/build.gradle.kts →
syncDesktopPython). The only Android-specific bits live here:

  1. paths come from the OS instead of the repo dir (data, the phone UI's build);
  2. yt-dlp runs as the bundled library — ytdlp_shim hands youtube.py a `yt-dlp`
     "binary" that runs in-process, so its subprocess calls work unchanged;
  3. the same background jobs as the desktop's main.py (cache warm-up, avatar
     backfill, the Edition's daily build, the Archive worker when its wheels
     exist) — taken from desktop_main.py, the desktop entrypoint synced alongside;
     the notify-send notifier no-ops here (the Kotlin service posts native
     notifications instead), and the anipy self-updater is skipped (an APK can't
     pip-install; anipy is vendored, see app/src/main/python/anipy_api/NOTICE).
"""

import os
import threading
from pathlib import Path

_started = threading.Event()


def start(data_dir, web_dir, port=5000):
    """Boot the Flask server (blocking — call me on a background thread)."""
    from server import config

    config.DATA_DIR = Path(data_dir)
    config.DB_PATH = config.DATA_DIR / "tubcal.db"
    config.BRAIN_DIR = config.DATA_DIR / "brain"
    config.FRONTEND_DIST = Path(web_dir)
    config.HOST = "127.0.0.1"
    config.PORT = int(port)
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)

    # weeb-cli (the anime fallback) computes Path.home()/.weeb-cli at import time;
    # Chaquopy may leave HOME unset.
    os.environ.setdefault("HOME", str(config.DATA_DIR))
    (config.DATA_DIR / ".weeb-cli").mkdir(parents=True, exist_ok=True)

    import ytdlp_shim

    ytdlp_shim.install()

    from server import brain, create_app, db

    db.init_db()
    app = create_app()
    _background(brain)
    _started.set()
    # threaded so range requests / the streaming proxy can overlap; no reloader
    # (it forks + installs signal handlers, neither of which works under Chaquopy).
    app.run(
        host=config.HOST,
        port=config.PORT,
        debug=False,
        threaded=True,
        use_reloader=False,
    )


def _background(brain):
    """What the desktop's main() starts besides the server. Each piece is
    best-effort: a phone that's offline at launch still gets its app."""
    try:
        import desktop_main

        desktop_main._warm_caches()
        desktop_main._backfill_avatars()
    except Exception:
        pass
    for job in (brain.start, brain.edition.start):
        try:
            job()
        except Exception:
            pass


def wait_until_started(timeout=30):
    """Block until the Flask app has been constructed (just before serving)."""
    return _started.wait(timeout)
