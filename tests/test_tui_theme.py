"""The terminal's colours: every role is solved for its contrast target from whatever
palette the terminal reports, dark or light, and the ANSI fallback needs none."""

import pytest

from tui import terminal
from tui.theme import (FAINT, MARK, RULE, SURFACE, SURFACE2, TEXT, Palette, contrast, parse_hex,
                       solve, to_hex)


def pal(fg, bg, colors):
    c = [parse_hex(x) for x in colors.split()]
    return Palette(fg=parse_hex(fg), bg=parse_hex(bg), ansi=c + c if len(c) == 8 else c)


PALETTES = {
    "everforest": pal("#d3c6aa", "#2d353b", "#475258 #e67e80 #a7c080 #dbbc7f #7fbbb3 #d699b6 #83c092 #d3c6aa"),
    "macchiato": pal("#cad3f5", "#24273a", "#494d64 #ed8796 #a6da95 #eed49f #8aadf4 #f5bde6 #8bd5ca #b8c0e0"),
    "gruvbox": pal("#fbf1c7", "#282828", "#a89984 #cc241d #98971a #d79921 #458588 #b16286 #689d6a #ebdbb2"),
    "latte": pal("#4c4f69", "#eff1f5", "#5c5f77 #d20f39 #40a02b #df8e1d #1e66f5 #ea76cb #179299 #acb0be"),
    # a light rice whose yellow is 2:1 on its background
    "aline": pal("#575279", "#faf4ed", "#f2e9e1 #b4637a #286983 #ea9d34 #56949f #907aa9 #d7827e #575279"),
}


@pytest.mark.parametrize("name", PALETTES)
def test_roles_meet_their_targets(name):
    p = PALETTES[name]
    r = solve(p)
    bg = p.bg
    ratio = lambda key: contrast(parse_hex(r.hex[key]), bg)  # noqa: E731
    assert ratio("dim") >= TEXT - 0.01
    assert ratio("faint") >= FAINT - 0.01
    assert ratio("rule") >= RULE - 0.01
    assert SURFACE - 0.01 <= ratio("surface") < SURFACE2
    assert ratio("surface2") >= SURFACE2 - 0.01
    # dim and faint are solved again on the surfaces they sit on
    for surf in ("surface", "surface2"):
        under = parse_hex(r.hex[surf])
        assert contrast(parse_hex(r.hex[f"dim_{surf[0]}{'2' if surf.endswith('2') else ''}"]), under) >= TEXT - 0.01
    # every hue is readable as text
    for hue in ("red", "green", "yellow", "blue", "magenta", "cyan", "dispatch"):
        assert r.ratios[f"hue.{hue}"] >= TEXT - 0.05, hue


def test_dim_is_as_quiet_as_its_target_allows():
    """Solved, not fixed: dim sits just at 4.5:1, not at some mix that's far brighter."""
    r = solve(PALETTES["everforest"])
    assert 4.5 <= r.ratios["dim"] < 4.8


def test_a_low_contrast_hue_is_lifted_keeping_its_hue():
    r = solve(PALETTES["aline"])
    lifted = parse_hex(r.hex["hue.yellow"])
    assert contrast(lifted, PALETTES["aline"].bg) >= MARK
    assert lifted[0] > lifted[2]  # still a warm colour, not a grey


def test_the_ansi_fallback_uses_no_guessed_rgb():
    r = solve(None)
    assert not r.truecolor
    assert r.style("dim").color is None
    assert r.block("blue").reverse


def test_x11_replies_and_hex_parse():
    assert parse_hex("rgb:2d2d/3535/3b3b") == (0x2D, 0x35, 0x3B)
    assert parse_hex("rgb:f/0/8") == (255, 0, 136)
    assert parse_hex("#abc") == (0xAA, 0xBB, 0xCC)
    assert parse_hex("nonsense") is None
    assert to_hex((45, 53, 59)) == "#2d353b"


def test_a_terminal_reply_burst_is_read():
    buf = b"\x1b]10;rgb:d3d3/c6c6/aaaa\x1b\\\x1b]11;rgb:2d2d/3535/3b3b\x07"
    buf += b"".join(f"\x1b]4;{i};rgb:4747/5252/5858\x1b\\".encode() for i in range(16))
    buf += b"\x1b_Gi=31;OK\x1b\\\x1b[?62;4c"
    colours, kitty, sixel = terminal._parse(buf)
    p = terminal.palette_from(colours)
    assert p.fg == (0xD3, 0xC6, 0xAA) and p.bg == (0x2D, 0x35, 0x3B) and len(p.ansi) == 16
    assert kitty and sixel


def test_xrdb_palette(monkeypatch):
    out = "*background:\t#2d353b\n*foreground:\t#d3c6aa\nst.font:\tJetBrains\n" + \
        "".join(f"*color{i}:\t#47525{i % 10}\n" for i in range(16)) + "st.background:\t#000000\n"

    class Done:
        stdout = out

    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.setattr(terminal.shutil, "which", lambda n: "/usr/bin/xrdb")
    monkeypatch.setattr(terminal.subprocess, "run", lambda *a, **k: Done())
    p = terminal.xrdb_palette()
    assert p.source == "xrdb"
    assert p.bg == (0, 0, 0)  # st.* wins over *
    assert p.fg == (0xD3, 0xC6, 0xAA)


def test_truecolor_is_declared_for_kitty_terminals(monkeypatch):
    monkeypatch.delenv("COLORTERM", raising=False)
    monkeypatch.delenv("NO_COLOR", raising=False)
    terminal.prepare_env(terminal.TermInfo(palette=None, kitty=True, term="xterm"))
    import os
    assert os.environ["COLORTERM"] == "truecolor"


@pytest.mark.parametrize("name", list(PALETTES))
def test_a_hues_tinted_band_reads_like_the_grey_one(name):
    """A selection band tinted with a room's hue is as light as `surface2` (and the
    unselected one as `surface`), so the text tones solved for those read on it too."""
    p = PALETTES[name]
    r = solve(p)
    bg = p.bg
    for hue in ("red", "green", "yellow", "blue", "magenta", "cyan", "dispatch"):
        for kind, surf in (("wash", "surface"), ("wash2", "surface2")):
            wash = parse_hex(r.tint(kind, hue).get_truecolor().hex)
            assert contrast(wash, bg) == pytest.approx(contrast(parse_hex(r.hex[surf]), bg), abs=0.03)
            suffix = "_s2" if kind == "wash2" else "_s"
            assert contrast(parse_hex(r.hex[f"dim{suffix}"]), wash) >= TEXT - 0.1
            assert contrast(parse_hex(r.hex[f"faint{suffix}"]), wash) >= MARK - 0.1
        assert contrast(parse_hex(r.tint("rule", hue).get_truecolor().hex), bg) >= RULE - 0.02


def test_a_name_keeps_its_hue_and_names_spread_over_all_of_them():
    from collections import Counter

    from tui.theme import SOURCE_HUES, source_hue
    assert source_hue("Ado") == source_hue(" ado ")
    spread = Counter(source_hue(f"channel {i}") for i in range(600))
    assert set(spread) == set(SOURCE_HUES) and min(spread.values()) > 60
