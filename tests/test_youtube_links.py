"""YouTube links from other apps (server/youtube_links.py): which links Tubcal
takes and where they land, how the browser is started for the rest, and
switching the desktop's link handler on and off. That last part runs the real
xdg-mime against a throwaway home, never this machine's mimeapps.list."""

import json
import os
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from server import youtube_links as yl


@pytest.mark.parametrize("url, path", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "/youtube/open?v=dQw4w9WgXcQ"),
    ("https://youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s", "/youtube/open?v=dQw4w9WgXcQ&t=90"),
    ("https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL0123456789", "/youtube/open?v=dQw4w9WgXcQ"),
    ("http://youtu.be/dQw4w9WgXcQ?t=42", "/youtube/open?v=dQw4w9WgXcQ&t=42"),
    ("https://youtu.be/dQw4w9WgXcQ?si=abc", "/youtube/open?v=dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=2h", "/youtube/open?v=dQw4w9WgXcQ&t=7200"),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "/youtube/open?v=dQw4w9WgXcQ"),
    ("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share", "/youtube/open?v=dQw4w9WgXcQ"),
    ("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=10", "/youtube/open?v=dQw4w9WgXcQ&t=10"),
    ("https://music.youtube.com/watch?v=dQw4w9WgXcQ", "/youtube/open?v=dQw4w9WgXcQ"),
    ("https://www.youtube.com/", "/youtube"),
    ("https://www.youtube.com", "/youtube"),
    ("https://www.youtube.com/feed/subscriptions", "/youtube?v=latest"),
    ("https://www.youtube.com/feed/history", "/youtube/history"),
    ("https://www.youtube.com/results?search_query=lo+fi+beats", "/youtube?q=lo%20fi%20beats"),
    ("https://www.youtube.com/hashtag/cooking", "/youtube?q=%23cooking"),
    ("https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
     "/youtube/playlist/PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG"),
    ("https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw", "/youtube/c/UC_x5XG1OV2P6uZZ5FSM9Ttw"),
    ("https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/playlists",
     "/youtube/c/UC_x5XG1OV2P6uZZ5FSM9Ttw?tab=playlists"),
    ("https://www.youtube.com/@veritasium", "/youtube/open?channel=%40veritasium"),
    ("https://www.youtube.com/@veritasium/videos", "/youtube/open?channel=%40veritasium"),
    ("https://www.youtube.com/@%E3%81%82%E3%81%84", "/youtube/open?channel=%40%E3%81%82%E3%81%84"),
])
def test_links_tubcal_shows(url, path):
    assert yl.tubcal_path(url) == path


@pytest.mark.parametrize("url", [
    "https://example.org/watch?v=dQw4w9WgXcQ",
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/watch",
    "https://youtu.be/",
    "https://studio.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw",
    "https://music.youtube.com/",
    "https://www.youtube.com/account",
    "https://www.youtube.com/playlist?list=WL",
    "https://www.youtube.com/@veritasium/community",
    "https://www.youtube.com/c/somename",
    "https://www.youtube.com/redirect?q=https%3A%2F%2Fexample.org",
    "mailto:someone@example.org",
    "",
    None,
])
def test_links_left_to_the_browser(url):
    assert yl.tubcal_path(url) is None


def test_exec_lines_follow_the_desktop_entry_spec():
    entry = {"Exec": "/usr/lib/firefox/firefox %u", "Name": "Firefox"}
    assert yl.exec_argv(entry, "https://x.org") == ["/usr/lib/firefox/firefox", "https://x.org"]
    # no link: the field code goes, nothing takes its place
    assert yl.exec_argv(entry, None) == ["/usr/lib/firefox/firefox"]
    # no field code: the link goes last
    assert yl.exec_argv({"Exec": "chromium --new-window"}, "https://x.org") == ["chromium", "--new-window", "https://x.org"]
    flatpak = {"Exec": "/usr/bin/flatpak run --branch=stable --command=firefox --file-forwarding org.mozilla.firefox @@u %u @@",
               "Icon": "org.mozilla.firefox"}
    assert yl.exec_argv(flatpak, "https://x.org")[-3:] == ["@@u", "https://x.org", "@@"]
    odd = {"Exec": '"/opt/My Browser/run" %i --name=%c --x=100%% %U', "Icon": "mb", "Name": "My Browser"}
    assert yl.exec_argv(odd, "https://x.org") == [
        "/opt/My Browser/run", "--icon", "mb", "--name=My Browser", "--x=100%", "https://x.org"]


def test_our_exec_line_reads_back_the_same(tmp_path):
    conf = {"browser": {"name": "Firefox"}, "python": "/usr/bin/python3",
            "script": str(tmp_path / 'odd "dir" $x' / "open-link.py")}
    line = next(l for l in yl._desktop_file(conf).splitlines() if l.startswith("Exec="))
    entry = {"Exec": line[len("Exec="):]}
    assert yl.exec_argv(entry, "https://x.org") == ["/usr/bin/python3", "-I", conf["script"], "https://x.org"]


# ── the handler, run as the desktop runs it ──────────────────────────────────

class _Tubcal(BaseHTTPRequestHandler):
    modules = ["youtube"]

    def do_GET(self):
        body = json.dumps({"ok": True, "data": {"status": "ok", "modules": self.modules}}).encode()
        self.send_response(200 if self.path == "/api/health" else 404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


@pytest.fixture
def desktop(tmp_path, monkeypatch):
    """A throwaway desktop: its own XDG folders, a "browser" that writes down
    the links it's given, and no session to ask."""
    for name in ("config", "data", "sysdata", "sysconfig"):
        (tmp_path / name).mkdir()
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "data"))
    monkeypatch.setenv("XDG_DATA_DIRS", str(tmp_path / "sysdata"))
    monkeypatch.setenv("XDG_CONFIG_DIRS", str(tmp_path / "sysconfig"))
    monkeypatch.setenv("XDG_CURRENT_DESKTOP", "X-Generic")
    monkeypatch.setenv("DBUS_SESSION_BUS_ADDRESS", "disabled:")
    for var in ("DESKTOP_SESSION", "KDE_FULL_SESSION", "GNOME_DESKTOP_SESSION_ID", "DISPLAY", "WAYLAND_DISPLAY", "BROWSER"):
        monkeypatch.delenv(var, raising=False)
    log = tmp_path / "opened.txt"
    browser = tmp_path / "fakebrowser"
    browser.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" >> "{log}"\n')
    browser.chmod(0o755)
    apps = tmp_path / "sysdata" / "applications"
    apps.mkdir()
    (apps / "fakebrowser.desktop").write_text(
        f"[Desktop Entry]\nType=Application\nName=Fake Browser\nExec={browser} %u\n"
        "MimeType=x-scheme-handler/http;x-scheme-handler/https;text/html;\n")
    return tmp_path, log


def _wait_for(path, lines):
    import time
    for _ in range(100):
        if path.exists() and len(path.read_text().splitlines()) >= lines:
            return path.read_text().splitlines()
        time.sleep(0.05)
    return path.read_text().splitlines() if path.exists() else []


def test_the_handler_sends_youtube_to_tubcal_and_the_rest_on(desktop, tmp_path):
    home, log = desktop
    server = HTTPServer(("127.0.0.1", 0), _Tubcal)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    links = home / "links"
    links.mkdir()
    shutil.copyfile(yl.__file__, links / "open-link.py")
    (links / "links.json").write_text(json.dumps({
        "tubcal": base,
        "browser": {"id": "fakebrowser.desktop", "path": None, "name": "Fake Browser"},
    }))

    def run(url):
        python = yl._python()
        subprocess.run([python, "-I", str(links / "open-link.py"), url], check=True, env=os.environ.copy(), timeout=20)

    try:
        run("https://youtu.be/dQw4w9WgXcQ?t=5")
        assert _wait_for(log, 1) == [base + "/youtube/open?v=dQw4w9WgXcQ&t=5"]
        run("https://example.org/page?a=1")
        assert _wait_for(log, 2)[1] == "https://example.org/page?a=1"
        # a Tubcal without the Screening Room: YouTube goes to the browser as it is
        _Tubcal.modules = ["hackernews"]
        run("https://youtu.be/dQw4w9WgXcQ")
        assert _wait_for(log, 3)[2] == "https://youtu.be/dQw4w9WgXcQ"
    finally:
        _Tubcal.modules = ["youtube"]
        server.shutdown()
        server.server_close()
    # Tubcal not running: same
    run("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert _wait_for(log, 4)[3] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


@pytest.mark.skipif(not shutil.which("xdg-mime"), reason="needs xdg-utils")
def test_switching_the_desktop_link_handler(desktop, monkeypatch):
    home, _ = desktop
    if not yl.available()[0]:
        pytest.skip(yl.available()[1])
    subprocess.run(["xdg-mime", "default", "fakebrowser.desktop", *yl.SCHEMES], check=True)
    assert yl.default_for("x-scheme-handler/https") == "fakebrowser.desktop"
    assert yl.status() == {"available": True, "reason": None, "on": False, "lost": False, "browser": "Fake Browser"}

    st = yl.enable("http://127.0.0.1:5000/")
    assert st["on"] and st["browser"] == "Fake Browser"
    for mime in yl.SCHEMES:
        assert yl.default_for(mime) == yl.DESKTOP_ID
    conf = json.loads((home / "data" / "tubcal" / "links" / "links.json").read_text())
    assert conf["tubcal"] == "http://127.0.0.1:5000"
    assert conf["previous"] == {m: "fakebrowser.desktop" for m in yl.SCHEMES}
    script = home / "data" / "tubcal" / "links" / "open-link.py"
    assert script.read_text() == open(yl.__file__).read()
    # switching on again remembers the browser, not itself
    yl.enable("http://127.0.0.1:5000")
    conf = json.loads((home / "data" / "tubcal" / "links" / "links.json").read_text())
    assert conf["browser"]["id"] == "fakebrowser.desktop"

    # the port changed: a restart brings the handler along
    assert yl.refresh("http://127.0.0.1:5123")
    conf = json.loads((home / "data" / "tubcal" / "links" / "links.json").read_text())
    assert conf["tubcal"] == "http://127.0.0.1:5123"

    # a browser takes the links back by itself
    subprocess.run(["xdg-mime", "default", "fakebrowser.desktop", *yl.SCHEMES], check=True)
    assert yl.status()["lost"] is True

    yl.enable("http://127.0.0.1:5000")
    st = yl.disable()
    assert st["on"] is False and st["lost"] is False and st["browser"] == "Fake Browser"
    for mime in yl.SCHEMES:
        assert yl.default_for(mime) == "fakebrowser.desktop"
    assert not (home / "data" / "applications" / yl.DESKTOP_ID).exists()
    assert not (home / "data" / "tubcal" / "links").exists()
    assert yl.refresh("http://127.0.0.1:5000") is False


@pytest.mark.skipif(not (shutil.which("xdg-mime") and shutil.which("xdg-open")), reason="needs xdg-utils")
@pytest.mark.parametrize("opener", ["xdg-open", "gio"])
def test_apps_opening_links_reach_tubcal(desktop, monkeypatch, opener):
    """The way other apps open links: xdg-open (which reads Exec its own simple
    way) and GIO. A link Tubcal didn't get would land in $BROWSER, marked."""
    home, log = desktop
    if opener == "gio" and not shutil.which("gio"):
        pytest.skip("no gio")
    fallback = home / "fallback"
    fallback.write_text(f'#!/bin/sh\nprintf "FALLBACK %s\\n" "$1" >> "{log}"\n')
    fallback.chmod(0o755)
    monkeypatch.setenv("BROWSER", str(fallback))
    monkeypatch.setenv("DISPLAY", ":tubcal-test")  # xdg-open only reads handlers "with a display"
    server = HTTPServer(("127.0.0.1", 0), _Tubcal)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    subprocess.run(["xdg-mime", "default", "fakebrowser.desktop", *yl.SCHEMES], check=True)
    yl.enable(base)
    urls = ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?t=5", "https://example.org/x?y=1"]
    try:
        for url in urls:
            subprocess.run(["xdg-open", url] if opener == "xdg-open" else ["gio", "open", url],
                           check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        # gio doesn't wait for the handler, so the three can arrive in any order
        assert sorted(_wait_for(log, 3)) == sorted([
            base + "/youtube/open?v=dQw4w9WgXcQ", base + "/youtube/open?v=dQw4w9WgXcQ&t=5", "https://example.org/x?y=1"])
    finally:
        server.shutdown()
        server.server_close()
        yl.disable()


def test_without_a_browser_it_wont_switch_on(desktop):
    home, _ = desktop
    if not yl.available()[0]:
        pytest.skip(yl.available()[1])
    (home / "sysdata" / "applications" / "fakebrowser.desktop").unlink()
    with pytest.raises(yl.LinkError, match="no default browser"):
        yl.enable("http://127.0.0.1:5000")


def test_link_endpoints(client, monkeypatch):
    r = client.get("/api/youtube/link?url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ")
    assert r.get_json()["data"] == {"path": "/youtube/open?v=dQw4w9WgXcQ"}
    r = client.get("/api/youtube/link?url=https%3A%2F%2Fexample.org")
    assert r.get_json()["data"] == {"path": None}

    def refuse(url):
        raise yl.LinkError("nope")
    monkeypatch.setattr(yl, "enable", refuse)
    r = client.post("/api/youtube/links", json={"on": True})
    assert r.status_code == 409 and r.get_json()["error"] == "nope"
    monkeypatch.setattr(yl, "disable", lambda: {"on": False})
    assert client.post("/api/youtube/links", json={"on": False}).get_json()["data"] == {"on": False}


def test_the_handler_runs_on_an_old_python():
    """The desktop runs the copy with the system's python3, which can be older
    than the server's: it must at least compile for 3.8."""
    import ast
    src = open(yl.__file__).read()
    ast.parse(src, feature_version=(3, 8))
    assert "from ." not in src and "import server" not in src
