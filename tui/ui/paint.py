"""Role names → Rich styles, for whatever surface a piece of text sits on.

Rooms describe text as (text, role) pairs — "fg", "dim", "faint", "rule",
"hue:red", "mark:yellow", with "+bold" / "+italic" appended — and the widgets turn
them into styles here. Dim and faint text get the tone solved for the surface
underneath (a selection band is lighter than the page), so they stay readable there.
"""

from __future__ import annotations

from rich.style import Style
from rich.text import Text

from ..theme import Roles

Span = tuple[str, str]  # (text, role)

_ON = {None: "", "surface": "_s", "surface2": "_s2"}


def style(roles: Roles, role: str, surface: str | None = None) -> Style:
    base, *mods = role.split("+")
    bold, italic, underline = "bold" in mods, "italic" in mods, "underline" in mods
    bg = roles.color(surface) if (surface and roles.truecolor) else None
    if base.startswith(("hue:", "mark:")):
        kind, name = base.split(":", 1)
        col = roles.hue(name, mark=kind == "mark") if roles.truecolor else (name if name != "dispatch" else "red")
        return Style(color=col, bgcolor=bg, bold=bold, italic=italic, underline=underline)
    if base == "fg" or not roles.truecolor:
        # ANSI fallback: no tones, only the terminal's own fg and bold
        return Style(bgcolor=bg, bold=bold, italic=italic, underline=underline)
    key = base + _ON.get(surface, "") if base in ("dim", "faint") else base
    return Style(color=roles.color(key) or roles.color(base), bgcolor=bg, bold=bold, italic=italic,
                 underline=underline)


def text(roles: Roles, spans: list[Span], surface: str | None = None) -> Text:
    t = Text(no_wrap=True, overflow="crop")
    for s, role in spans:
        t.append(s, style(roles, role, surface))
    return t
