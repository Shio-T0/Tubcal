"""The episode tape: one cell per episode, so where you are reads at a glance.

    █ █ █ █ █ █ █ ▍ ░ ░ ░ · · ·
    1             8       12   14

█ watched · ▏…▉ the part of the next episode you've seen · ░ aired, not watched ·
· not aired yet. Two columns per episode while that fits, one after; a long show
packs several episodes into a cell (a cell is as far along as its episodes are).
Under it a faint ruler with the first, the next and the last episode numbers.
"""

from __future__ import annotations

import math

from rich.text import Text

from ..glyphs import Glyphs
from ..theme import Roles
from .paint import style


def tape(roles: Roles, glyphs: Glyphs, *, watched: int, aired: int, total: int | None,
         next_n: int, partial: float | None, width: int, hue: str = "blue") -> tuple[Text, Text]:
    n = max(total or 0, aired, watched, 1)
    if 2 * n - 1 <= width:
        per, step = 1, 2
    elif n <= width:
        per, step = 1, 1
    else:
        per, step = math.ceil(n / width), 1
    cells = math.ceil(n / per)
    t = Text(no_wrap=True)
    for c in range(cells):
        lo, hi = c * per + 1, min(n, (c + 1) * per)
        if hi <= watched:
            ch, role = glyphs.tape_watched, f"mark:{hue}"
        elif lo <= next_n <= hi and partial:
            eighths = glyphs.eighths
            ch, role = eighths[min(len(eighths) - 1, max(0, int(partial * len(eighths))))], f"mark:{hue}"
        elif lo <= watched:
            ch, role = glyphs.tape_watched, f"mark:{hue}"
        elif lo <= aired:
            ch, role = glyphs.tape_aired, "dim"
        else:
            ch, role = glyphs.tape_unaired, "faint"
        t.append(ch, style(roles, role))
        if step == 2 and c < cells - 1:
            t.append(" ")
    # the ruler: first, next, last (and a few round numbers when there's room)
    length = len(t.plain)
    ruler = [" "] * length

    def col(ep: int) -> int:
        return min(length - 1, ((ep - 1) // per) * step)

    marks = [1, n]
    if 1 < next_n <= n:
        marks.append(next_n)
    gap = 10 if step == 1 else 5
    marks += list(range(gap, n, gap))
    placed: list[tuple[int, int]] = []
    for ep in sorted(set(marks), key=lambda e: (e not in (1, n, next_n), e)):
        label = str(ep)
        at = col(ep)
        if ep == n:
            at = max(0, length - len(label))
        span = (at - 1, at + len(label) + 1)
        if at + len(label) > length or any(not (span[1] <= a or span[0] >= b) for a, b in placed):
            continue
        placed.append((at, at + len(label)))
        for i, ch in enumerate(label):
            ruler[at + i] = ch
    r = Text(no_wrap=True)
    for i, ch in enumerate(ruler):
        is_next = ch.isdigit() and 1 < next_n <= n and any(a <= i < b for a, b in placed
                                                            if str(next_n) == "".join(ruler[a:b]))
        r.append(ch, style(roles, f"hue:{hue}" if is_next else "faint"))
    return t, r
