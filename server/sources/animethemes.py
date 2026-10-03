"""AnimeThemes (animethemes.moe) — a title's openings and endings, by AniList id.

AnimeThemes maps its catalogue to AniList through each anime's `resources`, so one
filtered request answers "what are this show's OPs and EDs" with no title search
and no key. Every theme ships a webm plus an audio-only Ogg/Opus rip on
a.animethemes.moe; the title page plays the opening from that file, straight from
AnimeThemes' own CDN (an <audio> element needs no proxy, and the files are small).

`parse_episodes` and `normalize` are pure and unit-tested (tests/test_animethemes.py).
"""

import re

from .. import cache, config, httpc

API = "https://api.animethemes.moe/anime"
SITE = "https://animethemes.moe/anime"
_INCLUDE = "animethemes.song.artists,animethemes.animethemeentries.videos.audio"
_TYPE_ORDER = {"OP": 0, "ED": 1}
_RANGE = re.compile(r"\s*(\d+)\s*(?:-\s*(\d*)\s*)?")


def parse_episodes(spec):
    """AnimeThemes' free-text episode span → [[first, last], …], last None when the
    span is still open ("14-" on an airing show). '1-12', '1000', '1-4, 6' all
    occur; anything unreadable is skipped rather than guessed at."""
    out = []
    for part in (spec or "").split(","):
        m = _RANGE.fullmatch(part)
        if not m:
            continue
        lo = int(m.group(1))
        if m.group(2) is None:
            hi = lo
        else:
            hi = int(m.group(2)) if m.group(2) else None
        out.append([lo, hi])
    return out


def normalize(anime):
    """One AnimeThemes anime → its playable themes, openings first then endings,
    each in broadcast order. A theme is kept only if some video of it carries an
    audio rip; its first such entry supplies the episode span (later entries are
    alternate cuts — a v2 for the finale, a recap — of the same song)."""
    out = []
    for t in (anime or {}).get("animethemes") or []:
        audio = entry = None
        for e in t.get("animethemeentries") or []:
            for v in e.get("videos") or []:
                link = (v.get("audio") or {}).get("link") or ""
                if link.startswith("https://"):
                    audio, entry = link, e
                    break
            if audio:
                break
        if not audio:
            continue
        song = t.get("song") or {}
        out.append({
            "slug": t.get("slug"),
            "type": t.get("type"),
            "sequence": t.get("sequence") or 1,
            "title": song.get("title"),
            "artists": [a["name"] for a in song.get("artists") or [] if a.get("name")],
            "episodes": entry.get("episodes"),
            "ranges": parse_episodes(entry.get("episodes")),
            "spoiler": bool(entry.get("spoiler")),
            "nsfw": bool(entry.get("nsfw")),
            "audio": audio,
        })
    out.sort(key=lambda x: (_TYPE_ORDER.get(x["type"], 2), x["sequence"]))
    return out


def themes(anilist_id):
    """{themes: [...], page: AnimeThemes URL or None} for one AniList id, cached a
    day — a briefly cached empty answer, since an airing show's opening is often
    added a few days after its premiere."""
    anilist_id = int(anilist_id)

    def fetch():
        r = httpc.get(
            API,
            params={
                "filter[has]": "resources",
                "filter[site]": "AniList",
                "filter[external_id]": str(anilist_id),
                "include": _INCLUDE,
            },
            headers={"Accept": "application/json"},
            anonymous=True,
        )
        found = r.json().get("anime") or []
        anime = found[0] if found else None
        items = normalize(anime)
        payload = {
            "themes": items,
            "page": f"{SITE}/{anime['slug']}" if anime and anime.get("slug") else None,
        }
        return payload, (config.TTL_ANIMETHEMES if items else config.TTL_ANIMETHEMES_EMPTY)

    return cache.cached_dynamic(f"animethemes:{anilist_id}", fetch)
