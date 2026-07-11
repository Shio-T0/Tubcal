"""Keep the anime scraper (anipy-api) current, automatically.

allanime periodically changes its site crypto/protocol; when it does, anime
resolution breaks until a new ``anipy-api`` release ships the fix. Rather than
require a manual ``uv add`` every time, this checks PyPI on startup and upgrades
anipy-api in place when a newer version exists — so the latest scraper fixes are
picked up the next time Tubcal starts, with no intervention.

Design notes:
- Best-effort and fully offline-safe. Any failure (no network, PyPI down, uv/pip
  missing, read-only site-packages) is logged and skipped so Tubcal always
  starts and never hangs on the network.
- Called *before* anipy is first imported (it's imported lazily on the first
  anime request), so an in-place upgrade is seen by the running process.
- Opt out with ``TUBCAL_AUTO_UPDATE=0``.
"""

import json
import os
import subprocess
import sys
import urllib.request
from importlib import metadata

_PKG = "anipy-api"
_PYPI_URL = f"https://pypi.org/pypi/{_PKG}/json"


def _log(msg):
    print(f"  [updater] {msg}")


def _version_tuple(v):
    """Tolerant numeric version tuple: '3.8.14' -> (3, 8, 14). Non-numeric or
    pre-release suffixes are reduced to their leading digits, which is enough to
    compare normal point releases without pulling in packaging."""
    out = []
    for part in str(v).split("."):
        digits = "".join(ch for ch in part if ch.isdigit())
        out.append(int(digits) if digits else 0)
    return tuple(out)


def _installed_version():
    try:
        return metadata.version(_PKG)
    except Exception:
        return None


def _latest_version(timeout=4):
    with urllib.request.urlopen(_PYPI_URL, timeout=timeout) as resp:
        return json.load(resp)["info"]["version"]


def _upgrade(timeout=180):
    """Upgrade anipy-api in this interpreter's environment. Prefer uv (this
    project is uv-managed); fall back to pip. Returns True on success."""
    candidates = [
        ["uv", "pip", "install", "--python", sys.executable, "--upgrade", _PKG],
        [sys.executable, "-m", "pip", "install", "--upgrade", _PKG],
    ]
    for cmd in candidates:
        try:
            subprocess.run(
                cmd,
                check=True,
                timeout=timeout,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except Exception:
            continue
    return False


def check_and_update():
    """If a newer anipy-api is on PyPI, upgrade it in place. Safe to call
    unconditionally at startup; returns the version now installed (or None)."""
    if os.environ.get("TUBCAL_AUTO_UPDATE", "1") == "0":
        return _installed_version()

    current = _installed_version()
    try:
        latest = _latest_version()
    except Exception as exc:
        _log(f"anipy-api update check skipped ({exc})")
        return current

    if current and _version_tuple(latest) <= _version_tuple(current):
        return current  # already current — the common case, near-instant

    _log(f"upgrading anipy-api {current} -> {latest} …")
    if _upgrade():
        new = _installed_version()
        _log(f"anipy-api now {new}")
        return new
    _log(f"upgrade to {latest} failed; staying on {current}")
    return current
