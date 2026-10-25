"""Which of Tubcal's modules this copy has.

modules.ini (the repo root) lists the rooms an install can leave out and the
files each one owns. A module is here when

  - it's chosen: TUBCAL_MODULES, a comma list the `tubcal` launcher sets from the
    install record (unset = every module),
  - its server files are on disk (install.sh leaves an unchosen module's files out
    of the checkout), and
  - every module it `needs` is here too.

The Android app has no checkout: its build packs a copy of modules.ini inside
this package, and Chaquopy imports the files straight from the APK, so there a
module's files count as here when they can be imported. Each room is a split
APK there, which `tubcal phone` installs or not, and android_main.py puts the
installed ones on the import path. Without any manifest at all everything is here.

    from server import modules
    if modules.has("youtube"): ...

The core only touches a module's code behind such a check, and imports it inside
the function that needs it, so a missing file is never imported.
"""

import configparser
import importlib.util
import os
import pkgutil
import threading

from . import config

MANIFEST = config.BASE_DIR / "modules.ini"

# What a page or error tells you to type to add a room back. The phone app
# (android_main.py) says `tubcal phone add`.
ADD_COMMAND = "tubcal add"

_lock = threading.Lock()
_state = None  # (manifest dict, frozenset of installed ids)


def read_manifest(path=MANIFEST):
    """{id: {name, channel, about, needs, paths, ...}} in file order, or None
    when there's no manifest. List-valued keys come back as lists."""
    if not path.is_file():
        return None
    return parse_manifest(path.read_text(encoding="utf-8"))


def parse_manifest(text):
    """read_manifest for the manifest's text."""
    cp = configparser.ConfigParser(delimiters=("=",), interpolation=None)
    cp.read_string(text)
    out = {}
    for sec in cp.sections():
        if not cp.has_option(sec, "name"):
            continue  # [elsewhere]: not a module
        row = dict(cp.items(sec))
        for key in ("aliases", "needs", "extras", "groups", "tools", "packages", "phone_pip", "paths"):
            row[key] = row.get(key, "").split()
        row["id"] = sec
        out[sec] = row
    return out


def _chosen(manifest):
    raw = os.environ.get("TUBCAL_MODULES")
    if raw is None:
        return set(manifest)
    return {m for m in raw.replace(",", " ").split() if m in manifest}


def _present(module):
    """Are the module's server files on disk? (Its frontend files are the
    build's business: frontend/src/build/modules.mjs checks those.)"""
    paths = [p for p in module["paths"] if p.startswith("server/")]
    return all((config.BASE_DIR / p).exists() for p in paths)


def _packed_manifest():
    """The copy of modules.ini the Android build packs inside this package (no
    file on disk there to read), or None."""
    try:
        data = pkgutil.get_data(__package__, "modules.ini")
    except (OSError, ValueError):
        return None
    return parse_manifest(data.decode("utf-8")) if data else None


def _importable(module):
    """_present for files packed into the app rather than on disk: can each of
    the module's server files (server/api/edition.py, server/editor/) be imported?"""
    for p in module["paths"]:
        if not p.startswith("server/"):
            continue
        name = p.rstrip("/").removesuffix(".py").replace("/", ".")
        try:
            if importlib.util.find_spec(name) is None:
                return False
        except ImportError:
            return False
    return True


def resolve(manifest, chosen, present=_present):
    """The installed set: chosen and present, minus anything whose needs aren't."""
    on = {m for m in chosen if m in manifest and present(manifest[m])}
    changed = True
    while changed:
        changed = False
        for m in sorted(on):
            if any(n not in on for n in manifest[m]["needs"]):
                on.discard(m)
                changed = True
    return frozenset(on)


def _load():
    global _state
    with _lock:
        if _state is None:
            manifest, present = read_manifest(MANIFEST), _present
            if manifest is None:
                manifest, present = _packed_manifest(), _importable
            installed = None if manifest is None else resolve(manifest, _chosen(manifest), present)
            _state = (manifest, installed)
        return _state


def reload():
    """Forget the cached answer (tests change TUBCAL_MODULES)."""
    global _state
    with _lock:
        _state = None


def manifest():
    return _load()[0] or {}


def installed():
    """The ids of the modules here, in manifest order. With no manifest: []."""
    man, on = _load()
    if man is None:
        return []
    return [m for m in man if m in on]


def chosen_explicitly():
    """Did someone pick the modules (TUBCAL_MODULES), rather than take all there are?"""
    return os.environ.get("TUBCAL_MODULES") is not None


def has(module_id):
    """Is this module here? Unknown ids are a programming error."""
    man, on = _load()
    if man is None:
        return True
    if module_id not in man:
        raise ValueError(f"no module called {module_id!r} in modules.ini")
    return module_id in on


def known():
    """Every module id the manifest lists (installed or not)."""
    return list(manifest())


def on_phone(module):
    """Can the Android app have this module? (modules.ini `phone = no`: no.)"""
    return module.get("phone", "").strip().lower() != "no"


def add_hint(module_id):
    """How to add a left-out module back, for a message: `tubcal add youtube`."""
    return f"{ADD_COMMAND} {module_id}"
