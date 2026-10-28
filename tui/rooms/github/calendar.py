"""Your contributions, under the GitHub room's list: a column a week (Sunday on top, as
on GitHub), as many weeks as the column has room for, each day a shade from nothing
(`·`) to your busiest (`█`), so the levels read without colour. Above it, the year's
total and how many days in a row you've contributed.

    me · 1,204 contributions in the last year · 9 days in a row
        Aug     Sep       Oct
    Mon · ░ ▒ █ · ░ ░ ▓ …
"""

from __future__ import annotations

import datetime as dt

from ...ui.paint import Span

HUE = "magenta"
LABEL = 4          # "Mon "
ROWS = 9           # the heading, the months, seven days


def _day(s: str) -> dt.date | None:
    try:
        return dt.date.fromisoformat(s)
    except (TypeError, ValueError):
        return None


def weeks_of(days: list[dict], weeks: int) -> list[list[dict | None]]:
    """The last `weeks` week columns, Sunday first; None for the days after the last one."""
    by_date = {d["date"]: d for d in days if _day(d.get("date"))}
    if not by_date or weeks < 1:
        return []
    end = max(_day(d) for d in by_date)
    first = end - dt.timedelta(days=(end.weekday() + 1) % 7) - dt.timedelta(weeks=weeks - 1)
    cols = []
    for w in range(weeks):
        col: list[dict | None] = []
        for k in range(7):
            day = first + dt.timedelta(days=w * 7 + k)
            iso = day.isoformat()
            col.append(None if day > end else by_date.get(iso) or {"date": iso, "count": 0, "level": 0})
        cols.append(col)
    return cols


def streak(days: list[dict]) -> int:
    """Days in a row with a contribution, up to the last day (or the one before it, when
    the last day has none yet: today isn't over)."""
    counts = [d.get("count") or 0 for d in sorted((d for d in days if _day(d.get("date"))), key=lambda d: d["date"])]
    if counts and not counts[-1]:
        counts.pop()
    n = 0
    for c in reversed(counts):
        if not c:
            break
        n += 1
    return n


def lines(data: dict, login: str, width: int, levels: str, dot: str) -> list[list[Span]]:
    """The heading, the month row and the seven day rows, each a list of (text, role)."""
    days = data.get("days") or []
    total = data.get("total") or sum(d.get("count") or 0 for d in days)
    run = streak(days)
    head: list[Span] = [(login, f"hue:{HUE}+bold"),
                        (f" {dot} {total:,} contribution{'s' if total != 1 else ''} in the last year", "dim")]
    if run > 1:
        head.append((f" {dot} {run} days in a row", "dim"))
    cols = weeks_of(days, max(1, min(53, (width - LABEL) // 2)))
    if not cols:
        return [head, [("No contributions to show.", "faint")]]
    months: list[Span] = [(" " * LABEL, "fg")]
    used, last = LABEL, None
    firsts = [_day(next(d for d in col if d)["date"]) for col in cols]
    for w, day in enumerate(firsts):
        x = LABEL + 2 * w
        # the left edge's month gets no label when it's only a sliver there
        sliver = w == 0 and any(d.month != day.month for d in firsts[1:3])
        if day.month != last and x >= used and not sliver:
            label = day.strftime("%b")
            months.append((" " * (x - used) + label, "dim"))
            used = x + len(label)
        last = day.month
    out = [head, months]
    for k in range(7):
        row: list[Span] = [({1: "Mon ", 3: "Wed ", 5: "Fri "}.get(k, " " * LABEL), "faint")]
        for col in cols:
            d = col[k]
            if d is None:
                row.append(("  ", "fg"))
                continue
            lv = max(0, min(4, int(d.get("level") or 0)))
            row.append((levels[lv] + " ", "faint" if lv == 0 else f"mark:{HUE}"))
        out.append(row)
    return out
