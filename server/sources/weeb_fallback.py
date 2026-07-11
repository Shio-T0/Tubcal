"""Desktop-only anime stream fallback via weeb-cli.

When the primary scraper (anipy / allanime) can't resolve a stream — e.g.
allanime rotates its site crypto and no anipy release handles it yet — we fall
back to weeb-cli's ``aniworld`` provider, which carries EngSub / EngDub HLS
streams from an entirely different source. Because two independent sites rarely
break on the same day, this keeps anime playable through allanime outages.

Scope: weeb-cli pulls native deps (curl_cffi, lxml) that have no Chaquopy
wheels, so this path is **desktop-only** — on the Android build the import
simply fails and the fallback is skipped (anime there waits for the anipy fix
the auto-updater pulls). The import is lazy and fully guarded, so Tubcal runs
fine whether or not weeb-cli is installed.

The return shape matches ``anime_source.watch()`` exactly:
    {"sources": [{"url", "quality", "isM3U8"}], "subtitles": [...], "headers": {...}}
so the player + proxy consume it with no special-casing.
"""

import difflib
import re

# aniworld carries English sub/dub HLS (Vidmoly / VOE) that Tubcal's HLS proxy
# can forward. Other weeb-cli providers that resolve today (docchi, weeb) point
# at gdrive / cda.pl / vk embeds the proxy can't handle, so we stick to aniworld.
_PROVIDERS = ["aniworld"]


def available():
    """True if weeb-cli can be imported here (i.e. we're on the desktop build)."""
    return _sdk() is not None


def _sdk():
    try:
        from weeb_cli.sdk import WeebSDK
    except Exception:
        return None
    try:
        return WeebSDK(headless=True)
    except Exception:
        return None


def _ratio(a, b):
    return difflib.SequenceMatcher(None, (a or "").lower(), (b or "").lower()).ratio()


def _best(results, titles):
    """The search result whose title best matches any candidate title."""
    best, score = None, -1.0
    for r in results:
        s = max((_ratio(t, r.title) for t in titles), default=0.0)
        if s > score:
            best, score = r, s
    if score >= 0.5:
        return best
    return results[0] if results else None


def _rank(quality, want_dub):
    """Sort key over a stream's quality tag: put the wanted English track first,
    English ahead of other languages."""
    q = (quality or "").lower()
    order = ["engdub", "dub", "engsub", "sub"] if want_dub else ["engsub", "sub", "engdub", "dub"]
    for i, tag in enumerate(order):
        if tag in q:
            return i
    return len(order)


def _label(quality, server):
    """A short, URL-safe quality/itag label (it lands in an /hls/<key>/<itag>
    path), kept distinct per server so multiple hosts don't collide."""
    base = re.sub(r"[^A-Za-z0-9]", "", quality or "") or "auto"
    srv = re.sub(r"[^A-Za-z0-9]", "", server or "")
    return (base + srv)[:24] or "auto"


def resolve(titles, episode_number, want_dub=False):
    """Resolve one episode's streams via weeb-cli, or None if unavailable / no
    match. ``titles`` is the candidate title list (romaji / english / native)."""
    sdk = _sdk()
    if not sdk or not titles:
        return None
    target = str(episode_number)
    for provider in _PROVIDERS:
        for title in titles:
            try:
                results = sdk.search(title, provider=provider)
            except Exception:
                results = []
            match = _best(results, titles) if results else None
            if not match:
                continue
            try:
                eps = sdk.get_episodes(match.id, provider=provider)
            except Exception:
                eps = []
            ep = next((e for e in eps if str(e.number) == target), None)
            if not ep:
                continue
            try:
                links = [l for l in sdk.get_streams(match.id, ep.id, provider=provider) if l.url]
            except Exception:
                links = []
            if not links:
                continue
            links.sort(key=lambda l: _rank(l.quality, want_dub))
            sources, referer = [], None
            for l in links[:3]:
                headers = dict(l.headers or {})
                referer = referer or headers.get("Referer") or headers.get("referer")
                sources.append({
                    "url": l.url,
                    "quality": _label(l.quality, l.server),
                    "isM3U8": ".m3u8" in l.url.lower(),
                })
            if sources:
                return {
                    "sources": sources,
                    "subtitles": [],  # aniworld tracks are hardsubbed
                    "headers": {"Referer": referer} if referer else {},
                }
    return None
