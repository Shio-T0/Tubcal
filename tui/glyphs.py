"""The glyphs the interface draws, in three sets: Nerd Font, plain Unicode, ASCII.

Every glyph here is checked against JetBrains Mono (the font this desktop uses) by
tests/test_tui_glyphs.py, except the Nerd Font icons, which only appear where a cell of
overflow is harmless (the tabline, statusline and winbars) and always with a space
after them. `▰▱◐◑★⏵⏸` are deliberately absent: the font doesn't have them.
"""

from __future__ import annotations

import os

UNICODE = {
    # row signs
    "new": "•", "watched": "✓", "live": "●", "upcoming": "◌", "saved": "◆", "queued": "≡",
    "error": "✗", "partial_lo": "◔", "partial_hi": "◕", "folded": "▸",
    # bars
    "bar_on": "━", "bar_half": "╸", "bar_off": "─",
    "heat": "▁▂▃▄▅▆▇█", "eighths": "▏▎▍▌▋▊▉█",
    "tape_watched": "█", "tape_aired": "░", "tape_unaired": "·",
    "levels": "·░▒▓█",   # a contribution calendar's days, from none to busiest
    # chrome
    "select": "▎", "rule_v": "│", "rule_v_on": "┃", "rule_h": "─", "rule_double": "═",
    "playing": "▶", "paused": "‖", "web": "↗", "prompt": "❯", "dot": "·",
    "block_l": "", "block_r": "",
    "private": "", "radio": "", "sleep": "",
}

NERD = dict(UNICODE)
NERD.update({
    "block_l": "\ue0b6", "block_r": "\ue0b4",  # rounded powerline ends
    "saved": "󰃀", "error": "󰗖", "private": "󰗹 ", "radio": "󰐹 ", "sleep": "󰽥 ",
    # pie slices in eighths for a part-watched video (Nerd Font, U+F0A9E–F0AA4)
    "pies": "\U000F0A9E\U000F0A9F\U000F0AA0\U000F0AA1\U000F0AA2\U000F0AA3\U000F0AA4",
})

ASCII = {
    "new": "*", "watched": "v", "live": "@", "upcoming": "o", "saved": "s", "queued": "#",
    "error": "!", "partial_lo": "~", "partial_hi": "~", "folded": ">",
    "bar_on": "=", "bar_half": "-", "bar_off": "-",
    "heat": "._-=+*#@", "eighths": "........", "tape_watched": "#", "tape_aired": ":",
    "tape_unaired": ".", "levels": ".-+*#", "select": "|", "rule_v": "|", "rule_v_on": "|", "rule_h": "-",
    "rule_double": "=", "playing": ">", "paused": "=", "web": "^", "prompt": ">", "dot": "-",
    "block_l": "", "block_r": "", "private": "", "radio": "", "sleep": "",
}

SETS = {"nerd": NERD, "unicode": UNICODE, "ascii": ASCII}


class Glyphs:
    def __init__(self, kind: str = "unicode"):
        self.kind = kind if kind in SETS else "unicode"
        self._g = SETS[self.kind]

    def __getattr__(self, name: str) -> str:
        try:
            return self._g[name]
        except KeyError:
            return UNICODE.get(name, "?")

    def partial(self, fraction: float) -> str:
        """The sign for a part-watched item."""
        if self.kind == "nerd" and "pies" in self._g:
            pies = self._g["pies"]
            return pies[min(len(pies) - 1, max(0, int(fraction * len(pies))))]
        return self._g["partial_hi"] if fraction >= 0.5 else self._g["partial_lo"]


def choose(setting: str | None = None) -> Glyphs:
    """`icons` from config: nerd | unicode | ascii | auto. Auto picks Nerd Font when the
    locale is UTF-8 (the font can't be detected from inside the terminal; `icons =
    "unicode"` in the config turns the icons off)."""
    setting = (setting or "auto").lower()
    if setting in SETS:
        return Glyphs(setting)
    lang = (os.environ.get("LC_ALL") or os.environ.get("LC_CTYPE") or os.environ.get("LANG") or "").lower()
    if "utf-8" not in lang and "utf8" not in lang:
        return Glyphs("ascii")
    return Glyphs("nerd")
