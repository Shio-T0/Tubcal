"""Pure-Python stand-in for the `Levenshtein` C extension (Android/Chaquopy only).

anipy_api's allanime provider — the anime stream resolver — does `import Levenshtein`
and calls `Levenshtein.ratio(a, b, processor=...)` to rank search results. The real
package is a native C extension that also pulls in `rapidfuzz`; neither has a Chaquopy
wheel, so on-device we shadow it with this tiny difflib-backed implementation. It sits
on the Python source path ahead of site-packages, so this file wins on Android while the
desktop keeps using the real library. Only `ratio`/`distance` are needed.
"""

import difflib


def ratio(a, b, *, processor=None, score_cutoff=None, **_kwargs):
    if processor is not None:
        a, b = processor(a), processor(b)
    return difflib.SequenceMatcher(None, a or "", b or "").ratio()


def distance(a, b, *, processor=None, **_kwargs):
    if processor is not None:
        a, b = processor(a), processor(b)
    a, b = a or "", b or ""
    if not a and not b:
        return 0
    return int(round((1 - ratio(a, b)) * max(len(a), len(b))))
