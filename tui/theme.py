"""Colours from the terminal's own palette.

The terminal tells us its foreground, background and 16 colours (`terminal.probe`, or
`xrdb` for st). Every tone the interface needs is worked out from those: each one is
solved for a contrast target against the surface it sits on, instead of a fixed mix,
because a fixed mix that reads well on one rice is unreadable on the next (dim text at
45 % is 3.4:1 on Everforest and under 3:1 on a light rice).

Without a palette (the terminal didn't answer, or NO_COLOR) the roles fall back to the
terminal's named colours, reverse video and bold, so nothing depends on guessed RGB.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field

from rich.color import Color
from rich.style import Style

RGB = tuple[int, int, int]

ANSI_NAMES = ("black", "red", "green", "yellow", "blue", "magenta", "cyan", "white")

# Contrast targets (WCAG ratios against the surface underneath).
TEXT, MARK, FAINT, RULE = 4.5, 3.0, 3.0, 1.6
SURFACE, SURFACE2 = 1.15, 1.28

# Which terminal hue each room, channel and mode takes. Rooms differ inside a channel.
ROOM_HUES = {
    "edition": "cyan", "hackernews": "yellow", "reddit": "dispatch",
    "editor": "green", "dev": "cyan", "github": "magenta",
    "youtube": "red", "anime": "blue", "archive": "magenta",
    "home": "blue", "saved": "blue", "settings": "blue",
}
CHANNEL_HUES = {"social": "yellow", "coding": "green", "video": "red"}
# The hues a name can take (a channel, a subreddit, a site, a person): `source_hue`.
SOURCE_HUES = ("red", "green", "yellow", "blue", "magenta", "cyan")
MODE_HUES = {
    "NORMAL": "blue", "INSERT": "green", "VISUAL": "magenta",
    "COMMAND": "yellow", "SEARCH": "yellow", "FIND": "yellow",
}


# ── colour maths ──────────────────────────────────────────────────────────────

def parse_hex(text: str) -> RGB | None:
    """'#2d353b', '2d353b' or an X11 'rgb:2d2d/3535/3b3b' reply → (r, g, b)."""
    text = (text or "").strip()
    if text.startswith("rgb:"):
        try:
            parts = text[4:].split("/")
            return tuple(int(p, 16) * 255 // (16 ** len(p) - 1) for p in parts[:3])  # type: ignore[return-value]
        except (ValueError, ZeroDivisionError):
            return None
    text = text.lstrip("#")
    if len(text) == 3:
        text = "".join(c * 2 for c in text)
    if len(text) != 6:
        return None
    try:
        return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)
    except ValueError:
        return None


def to_hex(c: RGB) -> str:
    return "#%02x%02x%02x" % c


def _lin(v: float) -> float:
    v /= 255
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def luminance(c: RGB) -> float:
    r, g, b = (_lin(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: RGB, b: RGB) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def mix(a: RGB, b: RGB, t: float) -> RGB:
    """t=0 → a, t=1 → b (sRGB; good enough for neutrals)."""
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))  # type: ignore[return-value]


def _oklab(c: RGB) -> tuple[float, float, float]:
    r, g, b = (_lin(x) for x in c)
    l_ = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m_ = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s_ = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def _from_oklab(L: float, a: float, b: float) -> RGB:
    l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )

    def enc(v: float) -> int:
        v = max(0.0, min(1.0, v))
        v = 12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
        return round(v * 255)

    return enc(rgb[0]), enc(rgb[1]), enc(rgb[2])


def mix_oklab(a: RGB, b: RGB, t: float) -> RGB:
    """A perceptual blend, for hues (red↔yellow gives an orange, not mud)."""
    pa, pb = _oklab(a), _oklab(b)
    return _from_oklab(*(x + (y - x) * t for x, y in zip(pa, pb)))


def solve_toward(base: RGB, toward: RGB, target: float) -> RGB:
    """The colour nearest `base` on the way to `toward` whose contrast with `base`
    reaches `target`. If even `toward` can't reach it, `toward`."""
    if contrast(base, toward) <= target:
        return toward
    lo, hi = 0.0, 1.0
    for _ in range(24):
        mid = (lo + hi) / 2
        if contrast(base, mix(base, toward, mid)) >= target:
            hi = mid
        else:
            lo = mid
    return mix(base, toward, hi)


def lift_hue(hue: RGB, bg: RGB, fg: RGB, target: float) -> RGB:
    """A hue readable on `bg`: as it is when it passes, else its OKLab lightness moved
    toward the foreground's (chroma and hue kept) until it does."""
    if contrast(hue, bg) >= target:
        return hue
    L, a, b = _oklab(hue)
    Lf = _oklab(fg)[0]
    best = hue
    for i in range(1, 41):
        cand = _from_oklab(L + (Lf - L) * i / 40, a, b)
        best = cand
        if contrast(cand, bg) >= target:
            return cand
    return best


# ── the palette and its roles ────────────────────────────────────────────────

@dataclass
class Palette:
    """What the terminal said about its colours. `ansi` has 16 entries."""

    fg: RGB
    bg: RGB
    ansi: list[RGB]
    source: str = "osc"  # osc | xrdb

    def digest(self) -> str:
        raw = ",".join(to_hex(c) for c in (self.fg, self.bg, *self.ansi))
        return hashlib.sha1(raw.encode()).hexdigest()[:12]

    @property
    def dark(self) -> bool:
        return luminance(self.bg) < luminance(self.fg)


@dataclass
class Roles:
    """Every colour the interface uses, as Rich styles, plus their hex values for
    `:checkhealth`. With `palette=None` they are ANSI fallbacks."""

    palette: Palette | None
    hex: dict[str, str] = field(default_factory=dict)
    ratios: dict[str, float] = field(default_factory=dict)
    _hue: dict[str, Color] = field(default_factory=dict)
    _mark: dict[str, Color] = field(default_factory=dict)
    # a hue's tinted surfaces (as light as `surface` / `surface2`, so every text tone
    # solved for those reads the same on them) and its tinted rule
    _wash: dict[str, Color] = field(default_factory=dict)
    _wash2: dict[str, Color] = field(default_factory=dict)
    _rule: dict[str, Color] = field(default_factory=dict)
    _c: dict[str, Color | None] = field(default_factory=dict)

    @property
    def truecolor(self) -> bool:
        return self.palette is not None

    def color(self, role: str) -> Color | None:
        """fg, dim, faint, rule, surface, surface2, dim_s, dim_s2 (dim on a surface)…"""
        return self._c.get(role)

    def hue(self, name: str, *, mark: bool = False) -> Color:
        """A room/mode hue: 'red', 'dispatch', … readable as text (or as a mark)."""
        table = self._mark if mark else self._hue
        return table.get(name) or Color.parse(name if name in ANSI_NAMES else "default")

    def tint(self, kind: str, name: str) -> Color | None:
        """A hue's `wash`, `wash2` (tinted surfaces) or `rule`; None without a palette."""
        return {"wash": self._wash, "wash2": self._wash2, "rule": self._rule}[kind].get(name)

    def room(self, room_id: str, *, mark: bool = False) -> Color:
        return self.hue(ROOM_HUES.get(room_id, "blue"), mark=mark)

    def style(self, role: str = "fg", *, bold=False, italic=False, underline=False,
              bgcolor: str | None = None) -> Style:
        col = self._c.get(role) if role != "fg" else None
        if not self.truecolor:
            # ANSI only: no dim text (colour8 is unreadable on many rices), no surfaces
            col = None
        bg = self._c.get(bgcolor) if (bgcolor and self.truecolor) else None
        return Style(color=col, bgcolor=bg, bold=bold, italic=italic, underline=underline)

    def block(self, hue: str) -> Style:
        """A lualine-style block: the hue as background, the terminal's bg as text."""
        if not self.truecolor:
            return Style(color=hue if hue in ANSI_NAMES else "blue", reverse=True, bold=True)
        return Style(color=self._c["bg"], bgcolor=self.hue(hue, mark=True), bold=True)


def _ansi_hues(p: Palette) -> dict[str, RGB]:
    # bright variants are tried when the normal one is too dark (index + 8)
    out = {n: p.ansi[i] for i, n in enumerate(ANSI_NAMES)}
    out["dispatch"] = mix_oklab(p.ansi[1], p.ansi[3], 0.5)
    return out


def solve(palette: Palette | None) -> Roles:
    """Work out every role from a palette (or the ANSI fallback for None)."""
    roles = Roles(palette=palette)
    if palette is None:
        roles._c = {"fg": None, "bg": None}
        return roles
    fg, bg = palette.fg, palette.bg
    surface = solve_toward(bg, fg, SURFACE)
    surface2 = solve_toward(bg, fg, SURFACE2)
    rule = solve_toward(bg, fg, RULE)
    c: dict[str, RGB] = {
        "fg": fg, "bg": bg, "surface": surface, "surface2": surface2, "rule": rule,
        # text tones, solved again on each surface they sit on
        "dim": solve_toward(bg, fg, TEXT), "faint": solve_toward(bg, fg, FAINT),
        "dim_s": solve_toward(surface, fg, TEXT), "faint_s": solve_toward(surface, fg, FAINT),
        "dim_s2": solve_toward(surface2, fg, TEXT), "faint_s2": solve_toward(surface2, fg, FAINT),
    }
    # On a low-contrast foreground dim ends up close to fg; it stays at its target anyway
    # (readable beats distinct), and bold carries the hierarchy there.
    roles._c = {k: Color.from_rgb(*v) for k, v in c.items()}
    roles.hex = {k: to_hex(v) for k, v in c.items()}
    roles.ratios = {k: round(contrast(v, bg), 2) for k, v in c.items() if k != "bg"}
    hues = _ansi_hues(palette)
    for name, rgb in hues.items():
        bright = palette.ansi[ANSI_NAMES.index(name) + 8] if name in ANSI_NAMES else rgb
        text = rgb if contrast(rgb, bg) >= TEXT else (
            bright if contrast(bright, bg) >= TEXT else lift_hue(rgb, bg, fg, TEXT))
        mark = rgb if contrast(rgb, bg) >= MARK else lift_hue(rgb, bg, fg, MARK)
        roles._hue[name] = Color.from_rgb(*text)
        roles._mark[name] = Color.from_rgb(*mark)
        roles._wash[name] = Color.from_rgb(*solve_toward(bg, text, SURFACE))
        roles._wash2[name] = Color.from_rgb(*solve_toward(bg, text, SURFACE2))
        roles._rule[name] = Color.from_rgb(*solve_toward(bg, text, RULE))
        roles.hex[f"hue.{name}"] = to_hex(text)
        roles.ratios[f"hue.{name}"] = round(contrast(text, bg), 2)
    return roles


def source_hue(name: str) -> str:
    """A steady hue for a name: the same channel, subreddit or site is always the same
    colour, wherever it shows. (The name is written beside it, so colour is never the
    only way to tell two apart.)"""
    h = hashlib.sha1((name or "").strip().lower().encode()).digest()
    return SOURCE_HUES[int.from_bytes(h[:8], "big") % len(SOURCE_HUES)]


def textual_variables(roles: Roles) -> dict[str, str]:
    """CSS variables for the few Textual-styled widgets (floats, the command line)."""
    if not roles.truecolor:
        return {"tc-fg": "ansi_default", "tc-dim": "ansi_default", "tc-rule": "ansi_bright_black",
                "tc-surface": "ansi_default", "tc-accent": "ansi_blue", "tc-key": "ansi_yellow"}
    h = roles.hex
    return {
        "tc-fg": h["fg"], "tc-dim": h["dim"], "tc-faint": h["faint"], "tc-rule": h["rule"],
        "tc-surface": h["surface"], "tc-surface2": h["surface2"],
        "tc-accent": h["hue.blue"], "tc-key": h["hue.yellow"],
    }


def gamma_ok(roles: Roles) -> list[str]:
    """Roles that missed their target (for `:checkhealth`)."""
    if not roles.truecolor:
        return []
    want = {"dim": TEXT, "faint": FAINT, "rule": RULE}
    return [k for k, t in want.items() if roles.ratios.get(k, 99) + 1e-6 < t and not math.isclose(roles.ratios[k], t)]
