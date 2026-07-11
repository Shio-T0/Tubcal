"""Episode-source adapter.

Resolves an anime's episode list and playable streams directly with
``anipy_api`` — the same scraper Shou uses — so nothing external needs to run
(no Consumet/meta aggregator). anipy searches a provider (allanime / animekai)
by *title*, so we map the AniList id to its title via ``anilist.media`` first,
then pick the best-matching entry.

The two public functions keep the exact shapes the player + proxy expect:

    info(anilist_id) -> {"episodes": [{key, number, title, image}], "total": int}
    watch(key)       -> {"sources":   [{url, quality, isM3U8}],
                         "subtitles": [{url, lang}],
                         "headers":   {"Referer": ...}}

The stream URLs anipy returns are still proxied through Tubcal's own endpoints,
so the browser only ever talks to localhost. Pluggable by design: swap these two
functions for a local-files or torrent adapter later without touching the player.
"""

import base64
import json

from .. import cache, config, db
from . import anilist

# anipy's real providers. A leftover Consumet provider name in settings (e.g.
# "gogoanime") isn't one of these, so we ignore it and fall back to the defaults.
_VALID_PROVIDERS = ("allanime", "animekai")


def _anipy():
    """Import anipy_api on demand. It's a desktop-only dependency (it pulls in
    python-mpv → libmpv, pycryptodomex, etc.), so keeping the import lazy lets this
    module load on minimal runtimes — notably the Android/Chaquopy build, where
    anime streaming isn't available and these calls just surface a clean error."""
    from anipy_api.provider import LanguageTypeEnum, get_provider
    return get_provider, LanguageTypeEnum


def _ratio(a, b):
    """Title similarity 0–100. Prefer rapidfuzz; fall back to stdlib difflib so a
    runtime without rapidfuzz (e.g. Android) still works."""
    try:
        from rapidfuzz import fuzz
        return fuzz.WRatio(a, b)
    except Exception:
        import difflib
        return difflib.SequenceMatcher(None, a, b).ratio() * 100


def _providers():
    """Provider order to try: the configured one first (if anipy supports it),
    then the rest as fallbacks — mirroring Shou's allanime→animekai chain."""
    pref = (db.get_setting("anime_provider") or config.ANIME_PROVIDER or "").strip()
    order = [pref] if pref in _VALID_PROVIDERS else []
    for p in _VALID_PROVIDERS:
        if p not in order:
            order.append(p)
    return order


def _encode_key(provider, identifier, episode, lang, anilist_id=None):
    """Opaque, URL-safe handle carrying everything watch() needs to re-resolve a
    single episode without another search. The AniList id is included so the
    desktop fallback (weeb_fallback) can re-find the title on another source if
    the primary scraper can't produce a stream."""
    payload = {"p": provider, "i": identifier, "e": episode, "l": lang, "aid": anilist_id}
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()


def _decode_key(key):
    d = json.loads(base64.urlsafe_b64decode(key.encode()).decode())
    return d["p"], d["i"], d["e"], d.get("l", "sub"), d.get("aid")


def _titles(anilist_id):
    """Candidate search titles for an AniList id — romaji first (providers match
    it best), then english, then native."""
    m = anilist.media(anilist_id)
    if not m:
        return []
    out = []
    for key in ("title_romaji", "title", "title_native"):
        v = (m.get(key) or "").strip()
        if v and v not in out:
            out.append(v)
    return out


def _best_match(results, titles):
    """Pick the search result whose name best matches any known title."""
    best, best_score = None, -1.0
    for r in results:
        score = max((_ratio(t.lower(), (r.name or "").lower()) for t in titles), default=0)
        if score > best_score:
            best, best_score = r, score
    if best_score >= 60:
        return best
    return results[0] if results else None


def _resolve_episodes(titles, anilist_id=None):
    """Search each provider in turn until one yields a matching entry with
    episodes; return the {episodes, total} payload."""
    get_provider, LanguageTypeEnum = _anipy()
    for provider in _providers():
        try:
            prov = get_provider(provider)
        except Exception:
            continue
        results = None
        for title in titles:
            try:
                results = prov.get_search(title)
            except Exception:
                results = None
            if results:
                break
        if not results:
            continue
        match = _best_match(results, titles)
        if not match:
            continue
        lang = LanguageTypeEnum.SUB if LanguageTypeEnum.SUB in match.languages else LanguageTypeEnum.DUB
        try:
            eps = prov.get_episodes(match.identifier, lang)
        except Exception:
            eps = []
        if not eps:
            continue
        episodes = [
            {
                "key": _encode_key(provider, match.identifier, ep, lang.value, anilist_id),
                "number": ep,
                "title": f"Episode {ep}",
                "image": None,
            }
            for ep in eps
        ]
        return {"episodes": episodes, "total": len(episodes)}
    raise RuntimeError("no playable episodes found for this title on any source")


def info(anilist_id):
    """Episode list for an AniList id, resolved through anipy and cached."""
    titles = _titles(anilist_id)
    if not titles:
        raise RuntimeError("could not resolve a title for this anime")
    data, _ = cache.cached(
        f"anime:info:{anilist_id}", config.TTL_ANIME_EPISODES,
        lambda: _resolve_episodes(titles, anilist_id),
    )
    return data


def watch(key):
    """Resolve playable sources + subtitles for one episode key.

    Returns {sources:[{url,quality,isM3U8}], subtitles:[{url,lang}],
    headers:{Referer}} — the aggregator shape the proxy already forwards.

    Tries the primary scraper (anipy) first; if it can't produce a stream — e.g.
    allanime rotated its crypto and no anipy release handles it yet — falls back
    to weeb_fallback (desktop-only). Raises only when both come up empty.
    """
    provider, identifier, episode, lang, anilist_id = _decode_key(key)
    want_dub = lang == "dub"

    streams = None
    try:
        get_provider, LanguageTypeEnum = _anipy()
        prov = get_provider(provider)
        lang_enum = LanguageTypeEnum.DUB if want_dub else LanguageTypeEnum.SUB
        streams = prov.get_video(identifier, episode, lang_enum)
    except Exception:
        streams = None
    if streams:
        return _format_anipy(streams)

    fallback = _fallback_watch(anilist_id, episode, want_dub)
    if fallback and fallback.get("sources"):
        return fallback

    raise RuntimeError("no playable source for this episode")


def _format_anipy(streams):
    """Shape anipy's ProviderStream list into the watch() payload."""
    streams = sorted(streams, key=lambda s: s.resolution or 0, reverse=True)
    referer = next((s.referrer for s in streams if s.referrer), None)
    sources = [
        {
            "url": s.url,
            "quality": f"{s.resolution}p" if s.resolution else "auto",
            "isM3U8": ".m3u8" in (s.url or "").lower(),
        }
        for s in streams
        if s.url
    ]
    subtitles = []
    for s in streams:
        if s.subtitle:
            for code, sub in s.subtitle.items():
                url = getattr(sub, "url", None)
                if url:
                    subtitles.append({"url": url, "lang": getattr(sub, "lang", None) or code})
            break
    headers = {"Referer": referer} if referer else {}
    return {"sources": sources, "subtitles": subtitles, "headers": headers}


def _fallback_watch(anilist_id, episode, want_dub):
    """Second source (weeb-cli's aniworld). Returns a watch() payload or None.
    Guarded so a runtime without weeb-cli available just skips it."""
    if not anilist_id:
        return None
    try:
        from . import weeb_fallback
    except Exception:
        return None
    titles = _titles(anilist_id)
    if not titles:
        return None
    try:
        return weeb_fallback.resolve(titles, episode, want_dub)
    except Exception:
        return None
