"""Text from the internet can't talk to the terminal.

Titles, comments, bios and transcripts are other people's words, and a string
can carry escape sequences: ESC ]52 writes the clipboard (st and kitty honour
it), ESC ]8 makes a link that says one thing and opens another, ESC ]0 retitles
the window, and C1 codes do the same in one byte. Rich and Textual drop only
BEL, BS, VT, FF and CR from the text they're given, so `harden()` widens their
own tables, once, to every C0 control but tab and newline, DEL and the C1 range.
Every Text and Content then goes through it at no extra cost (the same
str.translate either way). What Tubcal itself sends the terminal (colours,
pictures, the probe) is made of segments and escape codes, never text, so it
isn't touched.

`plain(s)` is the same for a string printed outside Textual (`tubcal play`).
"""

from __future__ import annotations

_KEEP = {9, 10}  # tab, newline
CONTROL = [c for c in (*range(0x00, 0x20), 0x7F, *range(0x80, 0xA0)) if c not in _KEEP]
_TABLE = {c: None for c in CONTROL}


def plain(text: str) -> str:
    return text.translate(_TABLE)


def harden() -> None:
    """Extend Rich's and Textual's control-code tables in place (their functions
    take them as a default argument, so the dicts themselves are what they read)."""
    from rich import control as rich_control
    from textual import content as textual_content

    for table in (rich_control._CONTROL_STRIP_TRANSLATE, textual_content._CONTROL_STRIP_TRANSLATE):
        table.update(_TABLE)
