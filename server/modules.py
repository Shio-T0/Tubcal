"""Which of Tubcal's modules this copy has.

modules.ini (the repo root) lists the rooms an install can leave out and the
files each one owns. A module is here when

  - it's chosen: TUBCAL_MODULES, a comma list the `tubcal` launcher sets from the
    install record (unset = every module),
  - its server files are on disk (install.sh leaves an unchosen module's files out
    of the checkout), and
  - every module it `needs` is here too.

Without modules.ini (the Android build packs server/ alone) everything is here.

    from server import modules
    if modules.has("youtube"): ...

The core only touches a module's code behind such a check, and imports it inside
the function that needs it, so a missing file is never imported.
"""

import configparser
import os
import threading

from . import config

MANIFEST = config.BASE_DIR / "modules.ini"

_lock = threading.Lock()
_state = None  # (manifest dict, frozenset of installed ids)


def read_manifest(path=MANIFEST):
    """{id: {name, channel, about, needs, paths, ...}} in file order, or None
    when there's no manifest. List-valued keys come back as lists."""
    if not path.is_file():
        return None
    cp = configparser.ConfigParser(delimiters=("=",), interpolation=None)
    cp.read(path, encoding="utf-8")
    out = {}
    for sec in cp.sections():
        if not cp.has_option(sec, "name"):
            continue  # [elsewhere]: not a module
        row = dict(cp.items(sec))
        for key in ("aliases", "needs", "extras", "groups", "tools", "packages", "paths"):
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
            manifest = read_manifest()
            installed = None if manifest is None else resolve(manifest, _chosen(manifest))
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
