#!/usr/bin/env python3
"""YouTube links opened anywhere on this computer, played in Tubcal.

With Settings → Playback → "Open YouTube links here" on, Tubcal is the desktop's
handler for http and https links (x-scheme-handler/http and /https in
mimeapps.list, which xdg-open, GIO, Electron apps and the desktop portal all
follow). Every web link another app opens then comes through `main()`:

  - a YouTube link Tubcal can show (`tubcal_path`) opens that place in Tubcal,
    in the browser that was the default before;
  - any other link, and a YouTube link while Tubcal isn't running (or has no
    Screening Room), goes to that browser unchanged.

Links clicked inside the browser never leave it, so they aren't affected.

This file is also the handler itself. `enable()` copies it, unchanged, to
~/.local/share/tubcal/links/open-link.py and the desktop runs that copy with
the system's python3 for every link. So it must stay standard library only,
must not import the server package, and must run on an older Python than the
server's. `refresh()` (at every server start) keeps the copy current;
`disable()` hands the links back, and `python3 open-link.py --off` does the
same from the uninstaller.

The phone does this in its own way (android/app: an activity-alias the Settings
switch turns on); it only asks the server for `tubcal_path`.
"""

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from urllib.parse import parse_qs, quote, unquote, urlsplit

DESKTOP_ID = "tubcal-links.desktop"
SCHEMES = ("x-scheme-handler/http", "x-scheme-handler/https")


class LinkError(Exception):
    """Why the links couldn't be switched, in a sentence fit to show."""


# ── which YouTube links Tubcal shows, and where ──────────────────────────────

_VIDEO = re.compile(r"^[A-Za-z0-9_-]{11}$")
_LIST = re.compile(r"^[A-Za-z0-9_-]{10,}$")
_CHANNEL = re.compile(r"^UC[A-Za-z0-9_-]{22}$")
_STAMP = re.compile(r"^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$")
# Hosts a video link can be on; the rest of a site's pages only on the first two.
_YOUTUBE = ("youtube.com", "m.youtube.com")
_VIDEO_HOSTS = _YOUTUBE + ("music.youtube.com", "youtube-nocookie.com")
# A channel's own tabs that Tubcal's channel page covers.
_CHANNEL_TABS = ("", "featured", "videos", "streams", "shorts", "playlists")


def _seconds(raw):
    m = _STAMP.match(raw or "")
    if not raw or not m:
        return None
    return int(m.group(1) or 0) * 3600 + int(m.group(2) or 0) * 60 + int(m.group(3) or 0)


def tubcal_path(url):
    """The address in Tubcal (a path) for a YouTube link it can show, else None.

    Videos (watch, youtu.be, shorts, live, embed) open in the player at their
    start time, playlists and channels on their pages, a search as a search;
    an @handle needs a lookup, which the page does (`/youtube/open?channel=`)."""
    try:
        u = urlsplit((url or "").strip())
        host = (u.hostname or "").lower()
    except ValueError:
        return None
    if u.scheme not in ("http", "https"):
        return None
    if host.startswith("www."):
        host = host[4:]
    query = parse_qs(u.query)

    def arg(key):
        return (query.get(key) or [""])[0].strip()

    parts = [p for p in u.path.split("/") if p]
    video = None
    if host == "youtu.be":
        video = parts[0] if len(parts) == 1 else ""
    elif host in _VIDEO_HOSTS:
        if parts == ["watch"]:
            video = arg("v")
        elif len(parts) == 2 and parts[0] in ("shorts", "live", "embed", "v"):
            video = parts[1]
    if video is not None:
        if not _VIDEO.match(video):
            return None
        start = _seconds(arg("t") or arg("start") or (parse_qs(u.fragment).get("t") or [""])[0])
        return "/youtube/open?v=" + video + ("&t=%d" % start if start else "")

    if host not in _YOUTUBE:
        return None
    if not parts:
        return "/youtube"
    if parts == ["feed", "subscriptions"]:
        return "/youtube?v=latest"
    if parts == ["feed", "history"]:
        return "/youtube/history"
    if parts == ["results"]:
        words = arg("search_query") or arg("q")
        return "/youtube?q=" + quote(words) if words else "/youtube"
    if len(parts) == 2 and parts[0] == "hashtag":
        return "/youtube?q=" + quote("#" + unquote(parts[1]))
    if parts == ["playlist"]:
        lst = arg("list")
        # Watch later and Liked are an account's own; Tubcal has no account there.
        return "/youtube/playlist/" + lst if _LIST.match(lst) and lst not in ("WL", "LL") else None
    tab = parts[2] if len(parts) == 3 else ""
    if parts[0] == "channel" and len(parts) in (2, 3) and _CHANNEL.match(parts[1]) and tab in _CHANNEL_TABS:
        return "/youtube/c/" + parts[1] + ("?tab=playlists" if tab == "playlists" else "")
    tab = parts[1] if len(parts) == 2 else ""
    if parts[0].startswith("@") and len(parts) <= 2 and tab in _CHANNEL_TABS:
        handle = unquote(parts[0])
        return "/youtube/open?channel=" + quote(handle) if len(handle) > 1 else None
    return None


# ── where things are ─────────────────────────────────────────────────────────

def _data_home():
    return os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")


def _paths():
    home = os.path.join(_data_home(), "tubcal", "links")
    return {
        "home": home,
        "script": os.path.join(home, "open-link.py"),
        "conf": os.path.join(home, "links.json"),
        "desktop": os.path.join(_data_home(), "applications", DESKTOP_ID),
    }


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _write(path, text, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".new"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def _remove(path):
    try:
        os.remove(path)
    except OSError:
        pass


# ── desktop entries ──────────────────────────────────────────────────────────

def _app_dirs():
    dirs = [_data_home()]
    dirs += [d for d in (os.environ.get("XDG_DATA_DIRS") or "/usr/local/share:/usr/share").split(":") if d]
    # Flatpak and Snap browsers, when the session didn't put their folders on XDG_DATA_DIRS
    dirs += [os.path.join(_data_home(), "flatpak", "exports", "share"), "/var/lib/flatpak/exports/share",
             "/var/lib/snapd/desktop"]
    return [os.path.join(d, "applications") for d in dirs]


def find_desktop(desktop_id):
    """The file of a desktop entry, by its id (firefox.desktop), or None."""
    if not desktop_id or "/" in desktop_id:
        return None
    for d in _app_dirs():
        path = os.path.join(d, desktop_id)
        if os.path.isfile(path):
            return path
    return None


def read_entry(path):
    """The [Desktop Entry] keys of a .desktop file (locale variants included as
    their own keys), or None when it has no Exec."""
    entry, inside = {}, False
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if line.startswith("["):
                    inside = line == "[Desktop Entry]"
                elif inside and "=" in line and not line.startswith("#"):
                    key, value = line.split("=", 1)
                    entry.setdefault(key.strip(), value.strip())
    except OSError:
        return None
    return entry if entry.get("Exec") else None


_ESCAPES = {"s": " ", "n": "\n", "t": "\t", "r": "\r", "\\": "\\"}


def _split_exec(raw):
    """An Exec value's words: split on blanks, with "double quotes" inside
    which \\" \\` \\$ and \\\\ stand for themselves. None when a quote is left open."""
    words, word, started, quoted, i = [], [], False, False, 0
    while i < len(raw):
        c = raw[i]
        if c == "\\" and i + 1 < len(raw) and (not quoted or raw[i + 1] in '"`$\\'):
            word.append(raw[i + 1])
            started, i = True, i + 2
            continue
        if c == '"':
            quoted, started = not quoted, True
        elif c in " \t\n" and not quoted:
            if started:
                words.append("".join(word))
            word, started = [], False
        else:
            word.append(c)
            started = True
        i += 1
    if quoted:
        return None
    if started:
        words.append("".join(word))
    return words


def exec_argv(entry, url=None, path=None):
    """The command a desktop entry runs to open `url`, by the Desktop Entry
    spec's rules for Exec: the string escapes, then the quoting, then the
    field codes (%u %U %f %F take the link; with none, it goes last)."""
    raw = re.sub(r"\\(.)", lambda m: _ESCAPES.get(m.group(1), "\\" + m.group(1)), entry.get("Exec", ""))
    words = _split_exec(raw)
    if words is None:
        return None
    argv, placed = [], False
    for word in words:
        if word in ("%u", "%U", "%f", "%F"):
            if url and not placed:
                argv.append(url)
            placed = True
        elif word == "%i":
            if entry.get("Icon"):
                argv += ["--icon", entry["Icon"]]
        elif re.fullmatch(r"%[a-zA-Z]", word):
            if word == "%c":
                argv.append(entry.get("Name", ""))
            elif word == "%k" and path:
                argv.append(path)
        else:
            def code(m):
                nonlocal placed
                c = m.group(1)
                if c == "%":
                    return "%"
                if c in "uUfF":
                    placed = True
                    return url or ""
                return {"c": entry.get("Name", ""), "k": path or ""}.get(c, "")
            argv.append(re.sub(r"%(.)", code, word))
    if url and not placed:
        argv.append(url)
    return argv or None


def _quote_exec(arg):
    """One argument for an Exec line. Quoted only when it has to be: xdg-open's
    own reader (generic desktops: bspwm, i3, sway…) splits on blanks and takes
    quotes literally, so a quoted "/usr/bin/python3" is a program it can't find
    and it opens the link in $BROWSER instead."""
    if re.fullmatch(r"[A-Za-z0-9_@%+=:,./-]+", arg):
        return arg.replace("%", "%%")
    quoted = '"' + re.sub(r'(["`$\\])', r"\\\1", arg) + '"'
    return quoted.replace("\\", "\\\\").replace("%", "%%")


def _python():
    """The system's python3 for the handler, rather than the server's venv: the
    handler has to outlive a moved checkout or a rebuilt venv."""
    for c in ("/usr/bin/python3", "/usr/local/bin/python3", shutil.which("python3", path=os.defpath)):
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return getattr(sys, "_base_executable", None) or sys.executable


def _desktop_file(conf):
    browser = conf["browser"]["name"]
    return "\n".join([
        "[Desktop Entry]",
        "Type=Application",
        "Name=Tubcal links",
        "Comment=Opens YouTube links in Tubcal and every other link in " + browser,
        "Exec=" + " ".join(_quote_exec(a) for a in (conf["python"], "-I", conf["script"])) + " %u",
        "Icon=tubcal",
        "Terminal=false",
        "NoDisplay=true",
        "StartupNotify=false",
        "MimeType=" + "".join(m + ";" for m in SCHEMES),
        "",
    ])


# ── the desktop's defaults ───────────────────────────────────────────────────

def available():
    """(True, None), or (False, why) where Tubcal can't become the link handler."""
    if not sys.platform.startswith("linux") or hasattr(sys, "getandroidapilevel"):
        return False, "This works on a Linux desktop."
    if not shutil.which("xdg-mime"):
        return False, "This needs xdg-mime, from your distribution's xdg-utils package."
    return True, None


def _xdg(*args):
    try:
        r = subprocess.run(["xdg-mime"] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           universal_newlines=True, timeout=15)
    except (OSError, subprocess.SubprocessError) as e:
        raise LinkError("xdg-mime didn't run: %s" % e)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def default_for(mime):
    """The desktop id that opens `mime` now ('' when none)."""
    try:
        _, out, _ = _xdg("query", "default", mime)
    except LinkError:
        return ""
    return out.split(";")[0].strip()


def _set_default(desktop_id, mimes):
    code, _, why = _xdg("default", desktop_id, *mimes)
    if code != 0:
        raise LinkError("xdg-mime couldn't set %s: %s" % (desktop_id, why or "exit %d" % code))


def _refresh_menu_cache():
    tool = shutil.which("update-desktop-database")
    if tool:
        try:
            subprocess.run([tool, "-q", os.path.join(_data_home(), "applications")],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        except (OSError, subprocess.SubprocessError):
            pass


def _name_of(desktop_id):
    path = find_desktop(desktop_id)
    entry = read_entry(path) if path else None
    name = (entry or {}).get("Name")
    return name or re.sub(r"\.desktop$", "", desktop_id)


def status():
    """{available, reason, on, lost, browser}: `on` while Tubcal is the
    handler; `lost` when it was switched on and something else (a browser's
    "make me the default") has taken the links since; `browser` is where the
    other links go (while on) or where every link goes (while off)."""
    ok, why = available()
    if not ok:
        return {"available": False, "reason": why, "on": False, "lost": False, "browser": None}
    conf = _load(_paths()["conf"])
    current = default_for("x-scheme-handler/https")
    on = current == DESKTOP_ID
    if on:
        browser = ((conf or {}).get("browser") or {}).get("name")
    else:
        browser = _name_of(current) if current else None
    return {"available": True, "reason": None, "on": on, "lost": bool(conf) and not on, "browser": browser}


def _write_handler(conf, p):
    with open(os.path.abspath(__file__), encoding="utf-8") as f:
        source = f.read()
    _write(p["script"], source, 0o755)
    _write(p["conf"], json.dumps(conf, indent=2) + "\n")
    _write(p["desktop"], _desktop_file(conf))


def enable(tubcal_url):
    """Make Tubcal the desktop's handler for web links. The browser that had
    them is remembered, gets every link that isn't for Tubcal, and gets them
    all back from `disable()`."""
    ok, why = available()
    if not ok:
        raise LinkError(why)
    p = _paths()
    old = _load(p["conf"]) or {}
    previous = dict(old.get("previous") or {})
    for mime in SCHEMES:
        current = default_for(mime)
        if current and current != DESKTOP_ID:
            previous[mime] = current
    browser = previous.get("x-scheme-handler/https") or previous.get("x-scheme-handler/http") or default_for("text/html")
    if not browser or browser == DESKTOP_ID:
        raise LinkError("There's no default browser to send the other links to. Set one first, then switch this on.")
    path = find_desktop(browser)
    entry = read_entry(path) if path else None
    if not entry:
        raise LinkError("The default browser's menu entry (%s) can't be found, so links couldn't go on to it." % browser)
    conf = {
        "tubcal": tubcal_url.rstrip("/"),
        "browser": {"id": browser, "path": path, "name": entry.get("Name") or browser},
        "previous": previous,
        "python": _python(),
        "script": p["script"],
    }
    _write_handler(conf, p)
    _refresh_menu_cache()
    try:
        _set_default(DESKTOP_ID, SCHEMES)
    except LinkError:
        _undo_files(p)
        raise
    if default_for("x-scheme-handler/https") != DESKTOP_ID:
        _undo_files(p)
        raise LinkError("The desktop kept its old default for links. Another mimeapps.list may be overriding "
                        "~/.config/mimeapps.list (some desktops read their own, like gnome-mimeapps.list).")
    return status()


def _undo_files(p):
    for f in (p["desktop"], p["script"], p["conf"]):
        _remove(f)
    try:
        os.rmdir(p["home"])
    except OSError:
        pass
    _refresh_menu_cache()


def disable():
    """Give the links back to the browser that had them, and remove the handler."""
    p = _paths()
    conf = _load(p["conf"]) or {}
    if available()[0]:
        previous = conf.get("previous") or {}
        fallback = previous.get("x-scheme-handler/https") or (conf.get("browser") or {}).get("id")
        for mime in SCHEMES:
            back = previous.get(mime) or fallback
            if back and default_for(mime) == DESKTOP_ID:
                _set_default(back, [mime])
    _undo_files(p)
    return status()


def refresh(tubcal_url):
    """At server start: bring an installed handler up to date (this file's
    code, the port, the python). Changes nothing while it's off."""
    p = _paths()
    conf = _load(p["conf"])
    if not conf or not os.path.isfile(p["desktop"]):
        return False
    conf["tubcal"] = tubcal_url.rstrip("/")
    conf["python"] = _python()
    conf["script"] = p["script"]
    _write_handler(conf, p)
    return True


# ── the handler: one link, from whichever app opened it ─────────────────────

def _tubcal_up(base):
    """Is Tubcal answering, with its Screening Room? (No proxy: it's this machine.)"""
    from urllib.request import ProxyHandler, build_opener
    try:
        with build_opener(ProxyHandler({})).open(base + "/api/health", timeout=1.5) as r:
            data = (json.loads(r.read().decode("utf-8")) or {}).get("data") or {}
    except Exception:
        return False
    mods = data.get("modules")
    return data.get("status") == "ok" and (not mods or "youtube" in mods)


# Openers that would hand the link straight back to this handler.
_LOOPS = ("xdg-open", "gio", "gvfs-open", "kde-open", "kde-open5", "exo-open", "sensible-browser", "open-link.py")


def _browser_argv(browser, url):
    for path in (find_desktop(browser.get("id")), browser.get("path")):
        entry = read_entry(path) if path else None
        if entry and browser.get("id") != DESKTOP_ID and "open-link.py" not in entry["Exec"]:
            argv = exec_argv(entry, url, path)
            if argv:
                return argv
    for cmd in (os.environ.get("BROWSER") or "").split(":"):
        if cmd.strip() and os.path.basename(cmd.split()[0]) not in _LOOPS and shutil.which(cmd.split()[0]):
            if "%s" in cmd:
                return shlex.split(cmd.replace("%s", url or ""))
            return shlex.split(cmd) + ([url] if url else [])
    return None


def _say(text):
    if shutil.which("notify-send"):
        subprocess.call(["notify-send", "-a", "Tubcal", "Tubcal", text],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        sys.stderr.write(text + "\n")


def handle(url, conf):
    """Open one link: Tubcal's place for it, else the link itself, in the browser."""
    target = url
    base = conf.get("tubcal")
    path = tubcal_path(url) if base else None
    if path and _tubcal_up(base):
        target = base + path
    browser = conf.get("browser") or {}
    argv = _browser_argv(browser, target)
    if not argv:
        _say("Couldn't find %s to open %s. Settings → Playback in Tubcal can hand links back to it."
             % (browser.get("name") or "your browser", url or "a link"))
        return False
    try:
        subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True, close_fds=True)
    except OSError as e:
        _say("Couldn't start %s: %s" % (argv[0], e))
        return False
    return True


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ["--off"]:
        try:
            disable()
        except LinkError as e:
            sys.stderr.write("%s\n" % e)
            return 1
        return 0
    conf = _load(os.path.join(os.path.dirname(os.path.abspath(__file__)), "links.json")) or {}
    urls = [a for a in args if not a.startswith("-")] or [None]
    return 0 if all([handle(u, conf) for u in urls]) else 1


if __name__ == "__main__":
    sys.exit(main())
