"""Modules (modules.ini): the rooms an install can leave out.

A left-out module has none of its files on disk, so these keep the seams honest:
the manifest names real files, nothing outside a module imports its files
directly (server: at module level; frontend: statically — `import()` is the way
in, see frontend/src/lib/modules.js), and a server without a module neither
serves nor imports it."""

import ast
import json
import re
from pathlib import Path

import pytest

from server import config, modules

ROOT = config.BASE_DIR
MANIFEST = modules.read_manifest()


def owner_of(rel):
    """The module that owns a repo-relative path, or None (the core)."""
    for mid, m in MANIFEST.items():
        for p in m["paths"]:
            if rel == p or (p.endswith("/") and rel.startswith(p)):
                return mid
    return None


def may_import(importer, target):
    """Can a file owned by `importer` import one owned by `target` directly?"""
    return target is None or target == importer or (
        importer is not None and target in MANIFEST[importer]["needs"])


# ── the manifest ──────────────────────────────────────────────────────────────

def test_every_path_in_the_manifest_exists():
    missing = [p for m in MANIFEST.values() for p in m["paths"] if not (ROOT / p).exists()]
    assert not missing, f"modules.ini names files that aren't there: {missing}"


def test_no_path_belongs_to_two_modules():
    seen = {}
    for mid, m in MANIFEST.items():
        for p in m["paths"]:
            assert p not in seen, f"{p} is in both {seen[p]} and {mid}"
            seen[p] = mid
    # nor one inside another module's folder
    for p, mid in seen.items():
        for q, other in seen.items():
            if q != p and q.endswith("/") and p.startswith(q) and other != mid:
                pytest.fail(f"{p} ({mid}) sits inside {q} ({other})")


def test_needs_and_channels_name_real_things():
    for mid, m in MANIFEST.items():
        assert m["channel"] in ("social", "coding", "video"), mid
        assert all(n in MANIFEST for n in m["needs"]), mid
        assert m["name"] and m["about"], mid


def test_every_room_is_a_module():
    rooms = (ROOT / "frontend/src/lib/rooms.js").read_text()
    ids = set(re.findall(r"\{ id: '(\w+)',\s*label:", rooms))
    assert ids == set(MANIFEST), "lib/rooms.js rooms (and pages) and modules.ini disagree"
    # a module that isn't a room is a page of one (ALL_PAGES), and needs that room
    pages = dict(re.findall(r"\{ id: '(\w+)',[^}]*room: '(\w+)'", rooms))
    for page, room in pages.items():
        assert room in MANIFEST[page]["needs"], page
    assert set(config.ROOM_IDS) | {"anime"} | set(pages) == set(MANIFEST)
    from server.api import MODULE_BLUEPRINTS
    assert set(MODULE_BLUEPRINTS) == set(MANIFEST)
    # and each channel's rooms are the modules of that channel
    for ch, room_list in re.findall(r"\{ id: '(\w+)', key: '\w', .*?rooms: \[([^\]]*)\]", rooms):
        listed = re.findall(r"'(\w+)'", room_list)
        assert sorted(listed) == sorted(m for m in MANIFEST if MANIFEST[m]["channel"] == ch and m not in pages), ch


def test_the_extras_and_groups_exist_in_pyproject():
    import tomllib
    py = tomllib.loads((ROOT / "pyproject.toml").read_text())
    extras = set(py["project"].get("optional-dependencies", {}))
    groups = set(py.get("dependency-groups", {}))
    for mid, m in MANIFEST.items():
        assert set(m["extras"]) <= extras, mid
        assert set(m["groups"]) <= groups, mid
    # a group a module installs is one a plain `uv sync` installs for developers too
    defaults = set(py["tool"]["uv"].get("default-groups", []))
    assert {g for m in MANIFEST.values() for g in m["groups"]} <= defaults


def test_the_installer_carries_the_manifest(tmp_path):
    """install.sh holds a copy of modules.ini without the paths (for installs
    piped from curl); it must say the same as the real one."""
    text = (ROOT / "install.sh").read_text()
    block = re.search(r"<<'MODULES_INI'\n(.*?)\nMODULES_INI\n", text, re.S)
    assert block, "install.sh has no embedded MODULES_INI heredoc"
    copy = tmp_path / "copy.ini"
    copy.write_text(block.group(1))
    carried = modules.read_manifest(copy)
    without_paths = lambda man: {k: {kk: vv for kk, vv in v.items() if kk != "paths"} for k, v in man.items()}  # noqa: E731
    assert without_paths(carried) == without_paths(MANIFEST)


# ── the seams: server ─────────────────────────────────────────────────────────

def _module_level_imports(tree):
    """Import nodes that run when the file is imported (not inside a function)."""
    out = []

    def walk(node):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                continue
            if isinstance(child, (ast.Import, ast.ImportFrom)):
                out.append(child)
            walk(child)

    walk(tree)
    return out


def _py_targets(rel, node):
    """Repo-relative files an import node may load."""
    if isinstance(node, ast.Import):
        bases = [a.name.split(".") for a in node.names]
        names = [[]] * len(bases)
    else:
        if node.level:
            pkg = Path(rel).parent.parts[: len(Path(rel).parent.parts) - (node.level - 1)]
            base = list(pkg) + (node.module.split(".") if node.module else [])
        else:
            base = node.module.split(".")
        bases = [base] * len(node.names)
        names = [[a.name] for a in node.names]
    out = []
    for base, name in zip(bases, names):
        for parts in (base + name, base):
            for cand in ("/".join(parts) + ".py", "/".join(parts) + "/__init__.py"):
                if (ROOT / cand).is_file():
                    out.append(cand)
                    break
            else:
                continue
            break
    return out


def test_the_server_imports_a_module_only_where_it_may():
    bad = []
    files = [p for p in (ROOT / "server").rglob("*.py")] + [ROOT / "main.py"]
    for f in files:
        rel = f.relative_to(ROOT).as_posix()
        mine = owner_of(rel)
        for node in _module_level_imports(ast.parse(f.read_text())):
            for target in _py_targets(rel, node):
                if not may_import(mine, owner_of(target)):
                    bad.append(f"{rel}:{node.lineno} imports {target} ({owner_of(target)})")
    assert not bad, "import it inside the function, behind modules.has():\n" + "\n".join(bad)


# ── the seams: the terminal client ───────────────────────────────────────────

def test_the_terminal_imports_a_room_only_where_it_may():
    """tui/ reaches a room's screen only through importlib (tui.rooms.load_screen),
    and never the server's code at all: it's a client of the API like the browser."""
    bad = []
    for f in (ROOT / "tui").rglob("*.py"):
        rel = f.relative_to(ROOT).as_posix()
        mine = owner_of(rel)
        for node in _module_level_imports(ast.parse(f.read_text())):
            for target in _py_targets(rel, node):
                if target.startswith("server/") or target == "main.py":
                    bad.append(f"{rel}:{node.lineno} imports the server ({target})")
                elif not may_import(mine, owner_of(target)):
                    bad.append(f"{rel}:{node.lineno} imports {target} ({owner_of(target)})")
    assert not bad, "\n".join(bad)


def test_the_terminal_has_the_webs_rooms():
    """Same ids, channels and order as frontend/src/lib/rooms.js, so the numbers match."""
    from tui.rooms import ALL_ROOMS, CHANNELS
    js = (ROOT / "frontend/src/lib/rooms.js").read_text()
    web_channels = {cid: ids.replace("'", "").replace(" ", "").split(",")
                    for cid, ids in re.findall(r"\{ id: '(\w+)', key: '\w', label: '\w+', color: [^,]+, rooms: \[([^\]]*)\]", js)}
    assert {cid: ids for cid, _label, _key, ids in CHANNELS} == web_channels
    room_ids = {r.id for r in ALL_ROOMS}
    rooms_block = js.split("export const ALL_ROOMS", 1)[1].split("];", 1)[0]
    assert room_ids == set(re.findall(r"\{ id: '(\w+)',\s*label:", rooms_block)) | {"anime"}
    for room in ALL_ROOMS:
        if room.built:
            assert (ROOT / "tui" / "rooms" / room.id / "__init__.py").exists(), room.id
            assert any(p == f"tui/rooms/{room.id}/" for p in MANIFEST[room.id]["paths"]), room.id


# ── the seams: frontend ───────────────────────────────────────────────────────

STATIC_IMPORT = re.compile(
    r"""^\s*(?:import|export)\s(?:[^'"]*?\sfrom\s)?['"](\.[^'"]+)['"]""", re.M)


def _resolve_js(src, spec):
    t = (src.parent / spec).resolve()
    for ext in ("", ".js", ".jsx", "/index.js", "/index.jsx"):
        cand = Path(str(t) + ext)
        if cand.is_file():
            return cand.relative_to(ROOT).as_posix()
    return t.relative_to(ROOT).as_posix()


def test_the_frontend_reaches_a_module_only_through_import():
    bad = []
    src = ROOT / "frontend/src"
    for f in list(src.rglob("*.js")) + list(src.rglob("*.jsx")):
        rel = f.relative_to(ROOT).as_posix()
        mine = owner_of(rel)
        for spec in STATIC_IMPORT.findall(f.read_text()):
            target = _resolve_js(f, spec)
            if not may_import(mine, owner_of(target)):
                bad.append(f"{rel} imports {target} ({owner_of(target)})")
    assert not bad, "load it with moduleLazy / import() (lib/modules.js):\n" + "\n".join(bad)


# ── a server with some modules left out ───────────────────────────────────────

def test_needs_are_closed_over():
    man = {
        "youtube": {"needs": []},
        "archive": {"needs": ["youtube"]},
        "wire": {"needs": []},
    }
    everything = lambda m: True  # noqa: E731
    assert modules.resolve(man, {"archive", "wire"}, everything) == {"wire"}
    assert modules.resolve(man, {"archive", "youtube"}, everything) == {"archive", "youtube"}
    assert modules.resolve(man, {"archive", "youtube"}, lambda m: m is not man["youtube"]) == frozenset()


@pytest.fixture
def only(monkeypatch, tmp_path):
    """A client for an app built with only the named modules."""
    def make(*ids):
        monkeypatch.setenv("TUBCAL_MODULES", ",".join(ids))
        modules.reload()
        monkeypatch.setattr(config, "DATA_DIR", tmp_path)
        monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
        dist = tmp_path / "dist"
        dist.mkdir(exist_ok=True)
        (dist / "index.html").write_text('<html data-theme="dark"><head></head><body id="root"></body></html>')
        monkeypatch.setattr(config, "FRONTEND_DIST", dist)
        from server import create_app, db
        db.init_db()
        return create_app().test_client()
    yield make
    monkeypatch.delenv("TUBCAL_MODULES", raising=False)
    modules.reload()


def test_a_left_out_module_has_no_routes(only):
    c = only("hackernews", "archive")  # the Archive without the Screening Room it needs
    assert modules.installed() == ["hackernews"]
    assert c.get("/api/health").get_json()["data"]["modules"] == ["hackernews"]
    for path in ("/api/youtube/live", "/api/anime/lists", "/api/brain/status", "/api/edition/latest",
                 "/api/github/account", "/api/dev/languages", "/api/editor/status", "/api/feed/reddit"):
        r = c.get(path)
        assert r.status_code == 404 and r.get_json()["ok"] is False, path
    assert c.get("/api/hackernews/item/abc").status_code == 404  # an installed room's routes are there
    r = c.post("/api/subscriptions", json={"platform": "youtube", "input": "@x"})
    assert r.status_code == 404 and "tubcal add youtube" in r.get_json()["error"]


def test_by_topic_is_a_module_of_its_own(only):
    c = only("hackernews")  # the Wire without By topic
    assert c.get("/api/hackernews/topics").status_code == 404
    c = only("topics")  # By topic without the Wire it needs
    assert modules.installed() == [] and c.get("/api/hackernews/topics").status_code == 404
    c = only("hackernews", "topics")
    assert modules.installed() == ["hackernews", "topics"]
    assert c.get("/api/hackernews/topics").status_code == 200
    from server import db
    assert "topics" not in db.note_modules(["hackernews", "topics"], chosen=True)  # not a room


def test_the_page_learns_which_modules_the_server_has(only):
    c = only("edition", "reddit")
    html = c.get("/").get_data(as_text=True)
    stamp = re.search(r"window.__TUBCAL_MODULES__=(\[.*?\])", html)
    assert stamp and json.loads(stamp.group(1)) == ["edition", "reddit"]


def test_search_and_the_mix_skip_left_out_rooms(only, monkeypatch):
    c = only("hackernews")
    from server.sources import hackernews
    monkeypatch.setattr(hackernews, "search", lambda q: {"items": [{"id": "hn:1"}]})
    data = c.get("/api/search/all?q=x").get_json()["data"]
    assert data["hackernews"] == [{"id": "hn:1"}] and data["youtube"] == data["github"] == []


def test_an_added_module_switches_its_room_on(only):
    only("hackernews", "edition")
    from server import db
    # a database meeting modules for the first time keeps the rooms it had
    db.set_setting("active_rooms", ["hackernews"])
    db.delete_setting("_modules_seen")
    assert db.note_modules(["hackernews", "edition"]) == []
    assert db.get_setting("active_rooms") == ["hackernews"]
    # `tubcal add github`: the next start switches it on
    assert db.note_modules(["hackernews", "edition", "github"]) == ["github"]
    assert db.get_setting("active_rooms") == ["hackernews", "github"]
    # removing one leaves the setting alone; adding it back switches it on again
    db.set_setting("active_rooms", ["hackernews"])
    assert db.note_modules(["hackernews", "edition"]) == []
    assert db.note_modules(["hackernews", "edition", "github"]) == ["github"]


def test_a_new_database_switches_on_every_room_chosen(only):
    only("github", "hackernews")
    from server import db
    assert db.note_modules(["github", "hackernews"], chosen=True) == ["github", "hackernews"]
    assert "github" in db.get_setting("active_rooms")


def test_a_new_database_without_a_choice_keeps_the_defaults(only):
    only("github", "hackernews")
    from server import db
    assert db.note_modules(["github", "hackernews"], chosen=False) == []
    assert "github" not in db.get_setting("active_rooms")  # GitHub ships off
    assert db.note_modules(["github", "hackernews", "edition"]) == ["edition"]  # later additions still count


# ── the phone ─────────────────────────────────────────────────────────────────
#
# The Android app packs modules.ini inside server/ (no checkout there) and
# imports its files from the APK. Each room is a split APK of its own beside the
# core one (android/tools/rooms.py); android_main.py puts the installed rooms'
# files on the import path, so a room is there exactly when its split is.

def _android_main():
    import importlib.util
    path = ROOT / "android/app/src/main/python/android_main.py"
    spec = importlib.util.spec_from_file_location("android_main", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_phone_app_has_every_room_but_those_marked_off():
    phoneless = sorted(m for m, row in MANIFEST.items() if not modules.on_phone(row))
    assert phoneless == ["editor", "topics"]  # the Composing Room; By topic needs 3D objects
    for mid in phoneless:
        assert mid not in {n for row in MANIFEST.values() if modules.on_phone(row) for n in row["needs"]}


def test_a_packed_manifest_counts_importable_files(monkeypatch):
    """No modules.ini on disk: the copy inside the server package, and a module is
    there when its server files import (Chaquopy reads them from the APK)."""
    text = (ROOT / "modules.ini").read_text()
    monkeypatch.setattr(modules, "MANIFEST", ROOT / "nowhere" / "modules.ini")
    monkeypatch.setattr(modules.pkgutil, "get_data", lambda pkg, name: text.encode() if (pkg, name) == ("server", "modules.ini") else None)
    monkeypatch.setattr(modules, "_present", lambda m: False)  # nothing "on disk"
    monkeypatch.setenv("TUBCAL_MODULES", "hackernews,edition,youtube")
    modules.reload()
    try:
        assert modules.known() == list(MANIFEST)
        assert modules.installed() == ["edition", "hackernews", "youtube"]
        # a module whose files don't import isn't there
        assert not modules._importable({"paths": ["server/api/not_a_file.py"]})
        assert modules._importable(MANIFEST["editor"])  # a package folder: server/editor/
    finally:
        monkeypatch.delenv("TUBCAL_MODULES")
        modules.reload()


def test_without_any_manifest_everything_is_here(monkeypatch):
    monkeypatch.setattr(modules, "MANIFEST", ROOT / "nowhere" / "modules.ini")
    monkeypatch.setattr(modules, "_packed_manifest", lambda: None)
    modules.reload()
    try:
        assert modules.has("youtube") and modules.installed() == [] and modules.known() == []
    finally:
        modules.reload()


def test_the_phone_loads_the_rooms_installed(tmp_path, monkeypatch):
    """A room's split puts its files in rooms/<id>/ (TubcalService copies them
    there): its packages join sys.path, its server files the server packages."""
    import sys
    import server.api
    am = _android_main()
    room = tmp_path / "rooms" / "zzroom"
    (room / "server" / "api").mkdir(parents=True)
    (room / "server" / "api" / "zz_room_api.py").write_text("ANSWER = 42\n")
    (room / "zzroompkg").mkdir()
    (room / "zzroompkg" / "__init__.py").write_text("NAME = 'zz'\n")
    monkeypatch.setattr(sys, "path", list(sys.path))
    for pkg in ("server", "server.api"):
        monkeypatch.setattr(sys.modules[pkg], "__path__", list(sys.modules[pkg].__path__))
    try:
        assert am.add_rooms(tmp_path / "rooms") == ["zzroom"]
        import importlib
        assert importlib.import_module("server.api.zz_room_api").ANSWER == 42
        assert importlib.import_module("zzroompkg").NAME == "zz"
        assert am.add_rooms(None) == []  # no rooms folder: the core alone
    finally:
        for name in ("server.api.zz_room_api", "zzroompkg"):
            sys.modules.pop(name, None)


def _resolve_phone_js(src, spec):
    if spec.startswith("@pc/"):
        return _resolve_js(ROOT / "frontend/src/x.js", "./" + spec[4:])
    return _resolve_js(src, spec)


PHONE_IMPORT = re.compile(
    r"""^\s*(?:import|export)\s(?:[^'"]*?\sfrom\s)?['"]((?:\.|@pc/)[^'"]+)['"]""", re.M)


def test_the_phone_app_reaches_a_room_only_through_import():
    """As on the desktop: a room's files are in its split APK, so nothing outside
    the room imports them statically (phone/rooms.mjs fails the build too)."""
    bad = []
    src = ROOT / "android/phone/src"
    for f in list(src.rglob("*.js")) + list(src.rglob("*.jsx")):
        rel = f.relative_to(ROOT).as_posix()
        mine = owner_of(rel)
        for spec in PHONE_IMPORT.findall(f.read_text()):
            target = _resolve_phone_js(f, spec)
            if not may_import(mine, owner_of(target)):
                bad.append(f"{rel} imports {target} ({owner_of(target)})")
    assert not bad, "load it with moduleLazy / import() (@pc/lib/modules.js):\n" + "\n".join(bad)


def test_a_room_takes_its_python_packages_to_the_phone():
    """phone_pip names what a room's split carries; the core APK's pip list
    (app/build.gradle.kts) has none of them."""
    gradle = (ROOT / "android/app/build.gradle.kts").read_text()
    core = set(re.findall(r'install\("([^"]+)"\)', gradle))
    assert {"flask", "requests"} <= core
    for mid, m in MANIFEST.items():
        assert not set(m["phone_pip"]) & core, mid
    assert MANIFEST["youtube"]["phone_pip"] == ["yt-dlp"]


def test_the_phone_build_splits_the_rooms_out():
    cfg = (ROOT / "android/phone/vite.config.js").read_text()
    assert "modules({" in cfg and "rooms({" in cfg  # every phone room built, then set aside
    gradle = (ROOT / "android/app/build.gradle.kts").read_text()
    assert re.search(r'from\(File\(tubcalRoot, "modules\.ini"\)\) \{ into\("server"\) \}', gradle)
    assert 'exclude(roomExcludes("server/"))' in gradle  # the core APK has no room's files
    assert "finalizedBy(assembleRooms)" in gradle


def test_a_phone_says_how_to_add_a_room_from_the_computer(only, monkeypatch):
    c = only("hackernews")
    monkeypatch.setattr(modules, "ADD_COMMAND", "tubcal phone add")
    r = c.post("/api/subscriptions", json={"platform": "youtube", "input": "@x"})
    assert "tubcal phone add youtube" in r.get_json()["error"]
