#!/usr/bin/env python3
"""Tubcal for Android, room by room: each room the phone can have is a split APK
of its own beside the core APK, so a room left off a phone isn't on it at all.
`tubcal phone` installs the core APK with the splits of the rooms you pick.

  tools/rooms.py python --python PY
      Each room's Python into app/build/generated/room-python/<id>/: its server
      files and the phone's own Python files that are its (modules.ini `paths`),
      and its pip packages (`phone_pip`), installed with PY's pip as pure-Python
      wheels for the phone's Python 3.11 (a package built for this computer's
      processor would fail on the phone, so none can come in).

  tools/rooms.py apks APK
      A split APK per room beside APK, the core one, in app/build/outputs/rooms/:
      room_<id>.apk holds room-python/<id> as assets/rooms/<id>/ and the room's
      share of the phone UI (app/build/generated/phone-rooms/<id>/web, which
      phone/rooms.mjs set aside) as assets/web/. Same package, version and
      signing key (the debug keystore) as APK, which Android requires of a split.

Gradle runs both (app/build.gradle.kts). On the phone, TubcalService copies each
installed room's assets out and android_main.py puts them on Python's path.
"""

import argparse
import configparser
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ANDROID = Path(__file__).resolve().parent.parent
REPO = ANDROID.parent
APP = ANDROID / "app"
GEN = APP / "build" / "generated"
ROOM_PY = GEN / "room-python"
ROOM_WEB = GEN / "phone-rooms"
PIP_CACHE = APP / "build" / "room-pip"
OUT = APP / "build" / "outputs" / "rooms"
PHONE_PY = "android/app/src/main/python/"
SDK = Path(os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or Path.home() / "Android" / "Sdk")
KEYSTORE = Path.home() / ".android" / "debug.keystore"


def manifest():
    """The rooms the phone can have: {id: {"paths": [...], "phone_pip": [...]}}."""
    cp = configparser.ConfigParser(delimiters=("=",), interpolation=None)
    cp.read(REPO / "modules.ini", encoding="utf-8")
    out = {}
    for sec in cp.sections():
        if not cp.has_option(sec, "name") or cp.get(sec, "phone", fallback="").strip().lower() == "no":
            continue
        out[sec] = {k: cp.get(sec, k, fallback="").split() for k in ("paths", "phone_pip")}
    return out


def _copy(src, dest):
    if src.is_dir():
        shutil.copytree(src, dest, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)


def _pip(python, room, pkgs):
    """The room's pip packages, installed once per package list (kept in
    app/build/room-pip/<id>)."""
    target = PIP_CACHE / room
    stamp = target / ".tubcal-pip"
    want = " ".join(sorted(pkgs))
    if stamp.is_file() and stamp.read_text() == want:
        return target
    shutil.rmtree(target, ignore_errors=True)
    subprocess.run(
        [python, "-m", "pip", "install", "--target", str(target), "--python-version", "3.11",
         "--implementation", "py", "--abi", "none", "--platform", "any", "--only-binary=:all:",
         "--no-compile", "--disable-pip-version-check", "--quiet", *pkgs],
        check=True,
    )
    for extra in ("bin", "share"):  # console scripts and man pages: nothing the app runs
        shutil.rmtree(target / extra, ignore_errors=True)
    stamp.write_text(want)
    return target


def cmd_python(args):
    rooms = manifest()
    for room, m in rooms.items():
        dest = ROOM_PY / room
        shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True)
        for p in m["paths"]:
            if p.startswith("server/"):
                _copy(REPO / p, dest / p)
            elif p.startswith(PHONE_PY):
                _copy(REPO / p, dest / p[len(PHONE_PY):])
        if m["phone_pip"]:
            _copy(_pip(args.python, room, m["phone_pip"]), dest)
            (dest / ".tubcal-pip").unlink(missing_ok=True)
        print(f"rooms: {room}: {sum(1 for f in dest.rglob('*') if f.is_file())} Python files")
    return 0


def _norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def _base_dists(variant):
    """The distributions the core APK has already (Chaquopy's pip output)."""
    names = set()
    for d in (APP / "build" / "python" / "pip" / variant).glob("*/*.dist-info"):
        names.add(_norm(d.name.rsplit("-", 1)[0]))
    return names


def _prune(tree, base):
    """Drop from a room what the core APK already holds (the core's copy wins)."""
    for dist in list(tree.glob("*.dist-info")):
        if _norm(dist.name.rsplit("-", 1)[0]) not in base:
            continue
        record = dist / "RECORD"
        for line in record.read_text().splitlines() if record.is_file() else []:
            f = tree / line.split(",", 1)[0]
            if f.is_file():
                f.unlink()
        shutil.rmtree(dist, ignore_errors=True)


def _tool(name):
    tools = sorted((SDK / "build-tools").glob("*/"), key=lambda p: [int(x) for x in re.findall(r"\d+", p.name)])
    if not tools or not (tools[-1] / name).exists():
        sys.exit(f"rooms: no {name} under {SDK / 'build-tools'}")
    return str(tools[-1] / name)


def _badging(apk):
    out = subprocess.run([_tool("aapt2"), "dump", "badging", str(apk)], check=True, capture_output=True, text=True).stdout
    pick = lambda pat: (re.search(pat, out) or sys.exit(f"rooms: can't read {pat} from {apk}")).group(1)  # noqa: E731
    return {
        "package": pick(r"package: name='([^']+)'"),
        "code": pick(r"versionCode='(\d+)'"),
        "name": pick(r"versionName='([^']+)'"),
        "min_sdk": pick(r"(?:minSdkVersion|sdkVersion):'(\d+)'"),
        "target_sdk": pick(r"targetSdkVersion:'(\d+)'"),
    }


def _android_jar():
    jars = sorted((SDK / "platforms").glob("android-*/android.jar"))
    if not jars:
        sys.exit(f"rooms: no android.jar under {SDK / 'platforms'}")
    return str(jars[0])


MANIFEST_XML = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="{package}" split="room_{room}" android:isFeatureSplit="true">
    <application android:hasCode="false" />
</manifest>
"""


def cmd_apks(args):
    base = Path(args.apk)
    info = _badging(base)
    base_dists = _base_dists(args.variant)
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    for room in manifest():
        with tempfile.TemporaryDirectory(prefix=f"tubcal-room-{room}-") as tmp:
            tmp = Path(tmp)
            assets = tmp / "assets"
            if (ROOM_PY / room).is_dir():
                _copy(ROOM_PY / room, assets / "rooms" / room)
                _prune(assets / "rooms" / room, base_dists)
            if (ROOM_WEB / room / "web").is_dir():
                _copy(ROOM_WEB / room / "web", assets / "web")
            if not assets.is_dir():
                continue
            (tmp / "AndroidManifest.xml").write_text(MANIFEST_XML.format(package=info["package"], room=room))
            unsigned, aligned, apk = tmp / "unsigned.apk", tmp / "aligned.apk", OUT / f"room_{room}.apk"
            subprocess.run([
                _tool("aapt2"), "link", "-o", str(unsigned), "--manifest", str(tmp / "AndroidManifest.xml"),
                "-I", _android_jar(), "-A", str(assets), "--min-sdk-version", info["min_sdk"],
                "--target-sdk-version", info["target_sdk"], "--version-code", info["code"],
                "--version-name", info["name"],
            ], check=True)
            subprocess.run([_tool("zipalign"), "-f", "-p", "4", str(unsigned), str(aligned)], check=True)
            subprocess.run([
                _tool("apksigner"), "sign", "--ks", str(args.keystore), "--ks-pass", "pass:android",
                "--ks-key-alias", "androiddebugkey", "--key-pass", "pass:android",
                "--min-sdk-version", info["min_sdk"], "--v4-signing-enabled", "false", "--out", str(apk), str(aligned),
            ], check=True)
            print(f"rooms: room_{room}.apk {apk.stat().st_size // 1024} KB "
                  f"sha256 {hashlib.sha256(apk.read_bytes()).hexdigest()[:12]}…")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("python", help="gather each room's Python")
    p.add_argument("--python", default=sys.executable, help="the Python whose pip installs the rooms' packages")
    p.set_defaults(func=cmd_python)
    a = sub.add_parser("apks", help="a split APK per room beside the core APK")
    a.add_argument("apk", help="the core APK")
    a.add_argument("--variant", default="debug")
    a.add_argument("--keystore", default=str(KEYSTORE))
    a.set_defaults(func=cmd_apks)
    args = ap.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
