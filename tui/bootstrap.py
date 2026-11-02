"""Make sure the Tubcal server is up, without making the first paint wait for it.

The launcher (`tubcal start`) is used when it's installed: it gives the server the
install's choices (the rooms, whether there's a web interface). From a checkout, `main.py`
is started detached the way the login autostart does it, behind the same
`pgrep -f Tubcal/main.py` guard so the two never race for the port. Its output goes to
the launcher's log, created 0600.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def state_dir() -> Path:
    base = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state")
    d = base / "tubcal"
    d.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(d, 0o700)
    except OSError:
        pass
    return d


def log_path() -> Path:
    return state_dir() / "tubcal.log"


def _already_starting() -> bool:
    try:
        r = subprocess.run(["pgrep", "-f", "Tubcal/main.py"], capture_output=True, timeout=2)
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def launcher() -> str | None:
    """The `tubcal` launcher: the one that started us (`tubcal tui` says), else one on
    PATH, else where the installer puts it (~/.local/bin isn't always on PATH)."""
    bin_dir = os.environ.get("TUBCAL_BIN_DIR") or str(Path.home() / ".local" / "bin")
    for cand in (os.environ.get("TUBCAL_LAUNCHER"), shutil.which("tubcal"), os.path.join(bin_dir, "tubcal")):
        if cand and os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def start_server() -> str:
    """Start the server in the background. Returns how, for the status line."""
    tubcal = launcher()
    if tubcal:
        subprocess.Popen([tubcal, "start"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
        return "tubcal start"
    if _already_starting():
        return "already starting"
    main = REPO / "main.py"
    if not main.exists():
        return "no server to start"
    log = log_path()
    fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.chmod(log, 0o600)
    subprocess.Popen([sys.executable, str(main)], cwd=REPO, stdin=subprocess.DEVNULL,
                     stdout=fd, stderr=fd, start_new_session=True)
    os.close(fd)
    return f"main.py (log: {log})"
