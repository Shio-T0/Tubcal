"""The terminal's saved-item kinds match lib/saveable.js."""

import re
from pathlib import Path

from tui.saved import KINDS, channel_of, kind_of

JS = Path(__file__).resolve().parents[1] / "frontend/src/lib/saveable.js"


def test_the_kinds_table_matches_the_web():
    block = JS.read_text().split("export const KINDS = {", 1)[1].split("};", 1)[0]
    web = {k: (label, None if ch == "null" else ch.strip("'"))
           for k, label, ch in re.findall(r"(\w+):\s*\{ label: '([^']+)', one: '[^']+', channel: ('\w+'|null) \}", block)}
    assert web and KINDS == web
    assert list(KINDS) == list(web)  # same order on the page


def test_kind_and_channel():
    assert kind_of({"platform": "youtube"}) == "video"
    assert kind_of({"platform": "github", "extra": {"type": "pull"}}) == "pull"
    assert kind_of({"platform": "anime", "extra": {"kind": "anime"}}) == "anime"
    assert kind_of({"platform": "weird"}) == "link"
    assert channel_of({"platform": "hackernews"}) == "social"
    assert channel_of({"extra": {"kind": "page"}, "url": "/github/r/o/n"}) == "coding"
    assert channel_of({"extra": {"kind": "page"}, "url": "/settings"}) is None
