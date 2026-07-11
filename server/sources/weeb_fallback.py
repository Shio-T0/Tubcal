"""Anime stream fallback via weeb-cli's aniworld provider.

When the primary scraper (anipy / allanime) can't resolve a stream — e.g.
allanime rotates its site crypto and no anipy release handles it yet — we fall
back to weeb-cli's ``aniworld`` provider, which carries EngSub / EngDub HLS
streams from an entirely different source. Because two independent sites rarely
break on the same day, this keeps anime playable through allanime outages.

Runs on both builds. Desktop uses the pip-installed weeb-cli; the Android build
vendors a minimal aniworld subtree into app/src/main/python/weeb_cli (the
aniworld path needs only requests + bs4, both already present — its heavy deps,
curl_cffi/lxml, live only in providers we don't use). We instantiate the
provider class directly (see _provider) instead of using weeb-cli's registry,
whose filesystem discovery doesn't work under Chaquopy. The import is lazy and
fully guarded, so Tubcal runs fine whether or not weeb-cli is present.

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
    """True if a weeb-cli provider can be instantiated here."""
    return any(_provider(p) is not None for p in _PROVIDERS)


# Provider name -> its class. We instantiate the provider class directly rather
# than going through weeb-cli's registry/SDK: the registry discovers providers by
# scanning the providers directory with pkgutil.iter_modules, which finds nothing
# under Chaquopy (Android), where modules are served from the APK asset zip and
# aren't listed on disk until imported. A direct import both sidesteps discovery
# and (via the module's @register_provider decorator) is harmless on desktop.
def _provider(name):
    try:
        if name == "aniworld":
            from weeb_cli.providers.de.aniworld import AniWorldProvider
            return AniWorldProvider()
    except Exception:
        return None
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


def _fix_aniworld_lang(provider, quality):
    """Correct a weeb-cli aniworld language mislabel.

    AniWorld's data-lang-key is 1=GerDub, 2=EngSub ("mit Untertitel Englisch"),
    3=GerSub ("mit Untertitel Deutsch"), but weeb-cli 3.0.0 hardcodes
    {1:GerDub, 2:GerSub, 3:EngSub} — keys 2 and 3 swapped. The net effect is that
    its EngSub/GerSub labels are inverted, so what it calls "EngSub" is really
    German-subbed. Undo the swap so our English-first ranking picks the genuine
    English track. weeb-cli is a pinned dep, so this holds until we bump it and
    re-check (tracked against version 3.0.0)."""
    if provider != "aniworld" or not quality:
        return quality
    if "EngSub" in quality:
        return quality.replace("EngSub", "GerSub")
    if "GerSub" in quality:
        return quality.replace("GerSub", "EngSub")
    return quality


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
    if not titles:
        return None
    target = str(episode_number)
    for provider in _PROVIDERS:
        prov = _provider(provider)
        if not prov:
            continue
        for title in titles:
            try:
                results = prov.search(title)
            except Exception:
                results = []
            match = _best(results, titles) if results else None
            if not match:
                continue
            try:
                eps = prov.get_episodes(match.id)
            except Exception:
                eps = []
            ep = next((e for e in eps if str(e.number) == target), None)
            if not ep:
                continue
            try:
                links = [l for l in prov.get_streams(match.id, ep.id) if l.url]
            except Exception:
                links = []
            if not links:
                continue
            # Correct weeb-cli's language mislabel before ranking/labelling.
            tagged = [(_fix_aniworld_lang(provider, l.quality), l) for l in links]
            tagged.sort(key=lambda t: _rank(t[0], want_dub))
            sources, referer = [], None
            for quality, l in tagged[:3]:
                headers = dict(l.headers or {})
                referer = referer or headers.get("Referer") or headers.get("referer")
                sources.append({
                    "url": l.url,
                    "quality": _label(quality, l.server),
                    "isM3U8": ".m3u8" in l.url.lower(),
                })
            if sources:
                return {
                    "sources": sources,
                    "subtitles": [],  # aniworld tracks are hardsubbed
                    "headers": {"Referer": referer} if referer else {},
                }
    return None
