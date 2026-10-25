"""Android entrypoint for the embedded Tubcal server.

Chaquopy runs CPython in-process inside the APK. Kotlin calls `start()` on a
background thread, passing writable on-device paths; we point the existing Flask
app at them and run it bound to localhost, which the app's WebView then loads.

`server/` is the desktop package from the repo root, unmodified: Gradle copies
its core (and main.py, as desktop_main.py) into the build each time
(app/build.gradle.kts → syncDesktopPython). The only Android-specific bits live here:

  1. paths come from the OS instead of the repo dir (data, the phone UI's build);
  2. yt-dlp runs as a library (in the Screening Room's split APK) — ytdlp_shim
     hands youtube.py a `yt-dlp` "binary" that runs in-process, so its
     subprocess calls work unchanged;
  3. each room is a split APK of its own (tools/rooms.py), which `tubcal phone`
     installs or not: TubcalService copies the installed rooms' Python to
     rooms_dir/<id>/, and add_rooms() puts it on the import path, so a room is
     here exactly when its split is (server/modules.py finds its files);
  4. the same background jobs as the desktop's main.py (cache warm-up, avatar
     backfill, the Edition's daily build, the Archive worker when its wheels
     exist), each only with its room — taken from desktop_main.py, the desktop
     entrypoint synced alongside; the notify-send notifier no-ops here (the
     Kotlin service posts native notifications instead), and the anipy
     self-updater is skipped (an APK can't pip-install; anipy is vendored, see
     app/src/main/python/anipy_api/NOTICE).
"""

import os
import threading
from pathlib import Path

_started = threading.Event()


def add_rooms(rooms_dir):
    """Put the rooms installed as split APKs on Python's path: rooms_dir/<id>/
    holds a room's server files (server/api/…, server/sources/…) beside its own
    packages (yt_dlp, bs4, anipy_api…). The packages go on sys.path; the server
    files join the core's packages (server, server.api, …) as more folders of
    theirs, which is how `import server.api.anime` finds them. → the room ids."""
    import importlib
    import sys

    rooms = sorted(p for p in Path(rooms_dir).iterdir() if p.is_dir()) if rooms_dir else []
    for room in rooms:
        sys.path.append(str(room))
        srv = room / "server"
        folders = [srv, *sorted(d for d in srv.rglob("*") if d.is_dir() and d.name != "__pycache__")] if srv.is_dir() else []
        for folder in folders:
            name = ".".join(("server", *folder.relative_to(srv).parts))
            try:
                pkg = importlib.import_module(name)
            except ImportError:
                continue
            if str(folder) not in pkg.__path__:
                pkg.__path__.append(str(folder))
    return [r.name for r in rooms]


def start(data_dir, web_dir, port=5000, rooms_dir=None):
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

    from server import brain, create_app, db, modules

    add_rooms(rooms_dir)
    modules.ADD_COMMAND = "tubcal phone add"
    modules.reload()

    if modules.has("youtube"):  # the Screening Room's yt-dlp, as on the desktop
        import ytdlp_shim

        ytdlp_shim.install()

    db.init_db()
    # the rooms on the phone are the ones `tubcal phone` was asked for
    db.note_modules(modules.installed(), chosen=True)
    app = create_app()
    _background(brain, modules)
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


def _background(brain, modules):
    """What the desktop's main() starts besides the server, for the rooms this
    phone has. Each piece is best-effort: a phone that's offline at launch still
    gets its app."""
    if modules.has("youtube"):
        try:
            import desktop_main

            desktop_main._warm_caches()
            desktop_main._backfill_avatars()
        except Exception:
            pass
    from server import housekeeping

    # brain.start: the Archive's worker and the Edition's press, each if it's here
    for job in (brain.start, housekeeping.start):
        try:
            job()
        except Exception:
            pass


def wait_until_started(timeout=30):
    """Block until the Flask app has been constructed (just before serving)."""
    return _started.wait(timeout)
