"""Role names → Rich styles, for whatever surface a piece of text sits on.

Rooms describe text as (text, role) pairs — "fg", "dim", "faint", "rule",
"hue:red", "mark:yellow", "rule:red" (a rule tinted with the hue), with "+bold" /
"+italic" appended — and the widgets turn them into styles here. Dim and faint text get
the tone solved for the surface underneath (a selection band is lighter than the page),
so they stay readable there. A surface is "surface", "surface2", or a hue's tinted
"wash:red" / "wash2:red", which are as light as those two.

`who(name)` gives a name (a channel, a subreddit, a site) its own steady hue, and
`LOOK` holds the spacing (tui.toml `spacing`), set once by the app at start.
"""

from __future__ import annotations

from rich.style import Style
from rich.text import Text

from ..theme import Roles, source_hue

Span = tuple[str, str]  # (text, role)

_ON = {None: "", "surface": "_s", "surface2": "_s2"}

# comfy: room around things (a line between list items, padding, a line under the
# tabline and the winbars); compact: as dense as it gets.
LOOK = {"comfy": True}


def comfy() -> bool:
    return LOOK["comfy"]


def who(name: str, mods: str = "") -> str:
    """The role for a name in its own steady hue: "hue:green", plus "+bold" etc."""
    return f"hue:{source_hue(name)}{mods}"


def _surface(roles: Roles, surface: str | None):
    """(background, the suffix of the text tones solved for it)."""
    if not surface:
        return None, ""
    if surface.startswith(("wash:", "wash2:")):
        kind, name = surface.split(":", 1)
        return (roles.tint(kind, name) if roles.truecolor else None), ("_s2" if kind == "wash2" else "_s")
    return (roles.color(surface) if roles.truecolor else None), _ON.get(surface, "")


def style(roles: Roles, role: str, surface: str | None = None) -> Style:
    base, *mods = role.split("+")
    bold, italic, underline = "bold" in mods, "italic" in mods, "underline" in mods
    bg, suffix = _surface(roles, surface)
    if base.startswith(("hue:", "mark:")):
        kind, name = base.split(":", 1)
        col = roles.hue(name, mark=kind == "mark") if roles.truecolor else (name if name != "dispatch" else "red")
        return Style(color=col, bgcolor=bg, bold=bold, italic=italic, underline=underline)
    if base.startswith("rule:"):
        col = roles.tint("rule", base[5:]) if roles.truecolor else None
        return Style(color=col, bgcolor=bg, bold=bold, italic=italic, underline=underline)
    if base == "fg" or not roles.truecolor:
        # ANSI fallback: no tones, only the terminal's own fg and bold
        return Style(bgcolor=bg, bold=bold, italic=italic, underline=underline)
    key = base + suffix if base in ("dim", "faint") else base
    return Style(color=roles.color(key) or roles.color(base), bgcolor=bg, bold=bold, italic=italic,
                 underline=underline)


def text(roles: Roles, spans: list[Span], surface: str | None = None) -> Text:
    t = Text(no_wrap=True, overflow="crop")
    for s, role in spans:
        t.append(s, style(roles, role, surface))
    return t
