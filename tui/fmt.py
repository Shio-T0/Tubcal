"""Text in cells: durations, ages, counts, and titles cut to a width.

Titles from YouTube and Reddit carry emoji with variation selectors and ZWJ sequences
that terminals disagree on the width of, which breaks right-aligned columns. They're
normalised first; widths are then measured in cells (CJK counts 2).
"""

from __future__ import annotations

import re
import time
import unicodedata

from rich.cells import cell_len

_JOINERS = re.compile("[‍︎️⃣\U0001f3fb-\U0001f3ff\U000e0020-\U000e007f]")
_SPACES = re.compile(r"\s+")


def clean(text: str | None) -> str:
    """One line, no zero-width joiners or emoji variation selectors, no control chars."""
    text = _JOINERS.sub("", text or "")
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "C" or ch == " ")
    return _SPACES.sub(" ", text).strip()


def cut(text: str, width: int, ellipsis: str = "…") -> str:
    """`text` cut to at most `width` cells, with an ellipsis when cut."""
    if width <= 0:
        return ""
    if cell_len(text) <= width:
        return text
    out, used, room = [], 0, width - cell_len(ellipsis)
    for ch in text:
        w = cell_len(ch)
        if used + w > room:
            break
        out.append(ch)
        used += w
    return "".join(out).rstrip() + ellipsis


def pad(text: str, width: int, *, right: bool = False) -> str:
    """`text` cut or padded to exactly `width` cells."""
    text = cut(text, width)
    gap = " " * max(0, width - cell_len(text))
    return gap + text if right else text + gap


def duration(seconds: float | int | None) -> str:
    """41:10, 1:02:33; '' when unknown."""
    if seconds is None or seconds < 0:
        return ""
    s = int(round(seconds))
    h, rest = divmod(s, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def ago(ts: float | int | None, now: float | None = None) -> str:
    """Short age for rows: 3m, 5h, 2d, 3w, 4mo, 2y."""
    if not ts:
        return ""
    d = max(0, (now or time.time()) - float(ts))
    for unit, size in (("y", 31536000), ("mo", 2592000), ("w", 604800), ("d", 86400), ("h", 3600), ("m", 60)):
        if d >= size:
            return f"{int(d // size)}{unit}"
    return "now"


def ago_long(ts: float | int | None, now: float | None = None) -> str:
    """For the preview: '3 hours ago', 'yesterday'."""
    if not ts:
        return ""
    d = max(0, (now or time.time()) - float(ts))
    if d < 60:
        return "just now"
    for unit, size in (("year", 31536000), ("month", 2592000), ("week", 604800), ("day", 86400),
                       ("hour", 3600), ("minute", 60)):
        if d >= size:
            n = int(d // size)
            if unit == "day" and n == 1:
                return "yesterday"
            return f"{n} {unit}{'s' if n != 1 else ''} ago"
    return ""


def until(ts: float | int | None, now: float | None = None) -> str:
    """'in 2h 10m', 'in 3d 4h', 'now'."""
    if not ts:
        return ""
    d = float(ts) - (now or time.time())
    if d <= 0:
        return "now"
    days, rest = divmod(int(d), 86400)
    hours, rest = divmod(rest, 3600)
    mins = rest // 60
    if days:
        return f"in {days}d {hours}h"
    if hours:
        return f"in {hours}h {mins}m"
    return f"in {max(1, mins)}m"


def span(seconds: float | int | None) -> str:
    """A stretch of time to watch: 48m, 2h 48m, 3d 4h."""
    if not seconds or seconds < 60:
        return "0m" if seconds is not None else ""
    m = int(seconds // 60)
    d, m = divmod(m, 1440)
    h, m = divmod(m, 60)
    if d:
        return f"{d}d {h}h"
    if h:
        return f"{h}h {m:02d}m" if m else f"{h}h"
    return f"{m}m"


def compact(n: int | float | None) -> str:
    """1.2k, 34k, 4.1M."""
    if n is None:
        return ""
    n = float(n)
    for unit, size in (("B", 1e9), ("M", 1e6), ("k", 1e3)):
        if abs(n) >= size:
            v = n / size
            return (f"{v:.1f}".rstrip("0").rstrip(".") if v < 10 else f"{v:.0f}") + unit
    return f"{int(n)}"


def day_label(ts: float | int | None, now: float | None = None) -> str:
    """Group heading for a day: Today, Yesterday, Monday (this week), 12 Oct."""
    if not ts:
        return "Undated"
    now = now or time.time()
    t, n = time.localtime(float(ts)), time.localtime(now)
    days = (time.mktime(n[:3] + (0, 0, 0, 0, 0, -1)) - time.mktime(t[:3] + (0, 0, 0, 0, 0, -1))) / 86400
    days = round(days)
    if days == 0:
        return "Today"
    if days == 1:
        return "Yesterday"
    if days == -1:
        return "Tomorrow"
    if -7 < days < 7:
        return time.strftime("%A", t)
    if t.tm_year == n.tm_year:
        return time.strftime("%-d %b", t)
    return time.strftime("%-d %b %Y", t)


def slot(ts: float, now: float | None = None) -> str:
    """A guide's time column: 21:40, Tmrw 21:40, Thu 21:40, 17 Oct."""
    label = day_label(ts, now)
    if label == "Today":
        return clock(ts)
    if label == "Tomorrow":
        return f"Tmrw {clock(ts)}"
    if label in ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"):
        return f"{label[:3]} {clock(ts)}"
    return label


def clock(ts: float | None = None) -> str:
    return time.strftime("%H:%M", time.localtime(ts or time.time()))
