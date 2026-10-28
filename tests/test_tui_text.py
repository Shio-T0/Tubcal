"""Text in cells (durations, ages, cutting by cell width) and the glyph table checked
against the font this desktop draws with."""

import shutil
import subprocess
from pathlib import Path

import pytest
from rich.cells import cell_len

from tui import fmt
from tui.glyphs import ASCII, NERD, UNICODE, Glyphs


def test_durations_and_counts():
    assert fmt.duration(2470) == "41:10"
    assert fmt.duration(3753) == "1:02:33"
    assert fmt.duration(None) == ""
    assert fmt.compact(1234) == "1.2k" and fmt.compact(34000) == "34k" and fmt.compact(4_100_000) == "4.1M"


def test_ages():
    now = 1_800_000_000
    assert fmt.ago(now - 30, now) == "now"
    assert fmt.ago(now - 3 * 3600, now) == "3h"
    assert fmt.ago(now - 2 * 86400, now) == "2d"
    assert fmt.ago_long(now - 3 * 3600, now) == "3 hours ago"
    assert fmt.until(now + 2 * 3600 + 600, now) == "in 2h 10m"
    assert fmt.span(48 * 60) == "48m" and fmt.span(168 * 60) == "2h 48m" and fmt.span(3 * 86400 + 4 * 3600) == "3d 4h"
    assert fmt.day_label(now, now) == "Today"
    assert fmt.day_label(now - 86400, now) == "Yesterday" and fmt.day_label(now + 86400, now) == "Tomorrow"
    assert fmt.day_label(now + 3 * 86400, now) not in ("Today", "Tomorrow")


def test_cut_by_cells():
    assert fmt.cut("葬送のフリーレン", 7) == "葬送の…"
    assert cell_len(fmt.cut("葬送のフリーレン", 7)) <= 7
    assert fmt.pad("abc", 5) == "abc  " and fmt.pad("abc", 5, right=True) == "  abc"
    assert fmt.cut("short", 10) == "short"


def test_titles_lose_joiners_and_variation_selectors():
    t = fmt.clean("Family 👨‍👩‍👧 trip️\n2026")
    assert "‍" not in t and "️" not in t and "\n" not in t


def test_every_set_has_every_glyph():
    for s in (NERD, ASCII):
        assert set(UNICODE) <= set(s) | {"pies"}
    assert Glyphs("ascii").partial(0.7) == "~"
    g = Glyphs("nerd")
    assert g.partial(0.0) != g.partial(0.99)


FONT = Path("/usr/share/fonts/TTF/JetBrainsMono-Regular.ttf")


def _charset(path: Path) -> set[int]:
    out = subprocess.run(["fc-query", "--format=%{charset}", str(path)], capture_output=True, text=True).stdout
    cps: set[int] = set()
    for part in out.split():
        a, _, b = part.partition("-")
        cps.update(range(int(a, 16), int(b or a, 16) + 1))
    return cps


@pytest.mark.skipif(not FONT.exists() or not shutil.which("fc-query"), reason="JetBrains Mono isn't installed here")
def test_the_unicode_glyphs_are_in_jetbrains_mono():
    """`▰▱◐◑★⏵⏸` aren't, which is why the table doesn't use them."""
    have = _charset(FONT)
    missing = {k: v for k, v in UNICODE.items() for ch in v if ord(ch) not in have and ch != " "}
    assert not missing, missing
