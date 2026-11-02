"""Other people's words never reach the terminal as escape sequences
(tui/safetext.py), and the terminal hands only web addresses to a browser."""

import pytest
from rich.console import Console
from rich.text import Text

from tui import links, safetext

# OSC 52 (write the clipboard), OSC 8 (a link that lies), CSI, the C1 CSI byte, BEL
EVIL = "title\x1b]52;c;Y3VybCBldmlsIHwgc2gK\x07\x1b]8;;https://evil/\x1b\\link\x1b]8;;\x1b\\\x1b[2J\x9b31m"


def test_plain_drops_every_control_but_tab_and_newline():
    assert safetext.plain("a\tb\nc\x1b\x07\x7f\x9b\x00d") == "a\tb\ncd"


def test_rich_and_textual_text_lose_escapes_once_hardened():
    from textual.content import Content

    safetext.harden()
    for made in (Text(EVIL), Text().append(EVIL), Content(EVIL)):
        assert "\x1b" not in made.plain and "\x9b" not in made.plain and "\x07" not in made.plain
        assert made.plain.startswith("title")
    console = Console(force_terminal=True, color_system="truecolor", width=200)
    with console.capture() as cap:
        console.print(Text(EVIL, style="bold"))
    out = cap.get()
    # what's left of them is printable text; the only escapes are Rich's own colours
    assert "\x1b]" not in out and "\x1b[2J" not in out and "\x9b" not in out and "\x07" not in out
    assert out.startswith("\x1b[1mtitle]52;")


def test_the_app_hardens_on_import():
    import tui.app  # noqa: F401
    from rich import control

    assert 0x1B in control._CONTROL_STRIP_TRANSLATE


@pytest.mark.parametrize("url, ok", [
    ("https://example.com/x", True),
    ("http://127.0.0.1:5000/youtube", True),
    ("mailto:someone@example.com", True),
    ("--gpu-launcher=sh -c evil", False),   # an option to Chromium that runs a command
    ("-new-instance", False),
    ("file:///etc/passwd", False),
    ("javascript:alert(1)", False),
    ("steam://run/1", False),
    ("https://", False),
])
def test_only_web_addresses_go_to_the_browser(url, ok):
    assert links.web(url) is ok


def test_open_url_refuses_anything_else(monkeypatch):
    started = []
    monkeypatch.setattr(links.subprocess, "Popen", lambda argv, **kw: started.append(argv))
    assert links.open_url("--gpu-launcher=sh -c evil", "firefox") is not None
    assert started == []
    assert links.open_url("https://example.com/", "firefox") is None
    assert started == [["firefox", "https://example.com/"]]
