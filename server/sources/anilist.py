"""AniList GraphQL client.

Reads are cached (AniList caps at ~90 req/min); writes (mutations) are
user-initiated and run live with the user's bearer token. Everything goes through
the single POST endpoint at https://graphql.anilist.co. No SDK — plain requests via
httpc, mirroring the rest of Tubcal's sources.
"""

import datetime
import hashlib
import re
import time

import requests

from .. import cache, config, httpc

GQL = config.ANILIST_GQL

# Shared media selection — kept small but enough to drive a card + detail header.
_MEDIA = """
id
idMal
type
title { romaji english native }
coverImage { large extraLarge color }
bannerImage
description(asHtml: false)
format
status
episodes
duration
genres
averageScore
popularity
favourites
season
seasonYear
startDate { year month day }
endDate { year month day }
source(version: 3)
countryOfOrigin
isAdult
studios(isMain: true) { nodes { id name } }
trailer { id site thumbnail }
nextAiringEpisode { episode airingAt }
mediaListEntry { id status score progress }
"""


def _fallback_token():
    """AniList now rejects *unauthenticated* GraphQL with a 403 ("API temporarily
    disabled"), so when a read passes no token, fall back to the connected
    account's token if there is one. Lazy import avoids an api↔sources cycle."""
    try:
        from ..api.oauth import get_valid_token
        return get_valid_token("anilist")
    except Exception:
        return None


# AniList's own view of our per-minute budget, read off every response's headers.
# A 429 starts a cooldown during which calls fail fast (so callers fall back to
# stale cache at once instead of queueing more rejected requests), and the
# background fan-outs — sequel radar, franchise walk — check `_budget()` between
# batches and stop early rather than spend the budget the rest of the room needs.
_rate = {"cooldown_until": 0.0, "remaining": None, "at": 0.0}


def _budget(min_left=8):
    """Room for more background requests right now? An unknown or minute-old
    reading counts as room (the window has rolled over since)."""
    now = time.time()
    if now < _rate["cooldown_until"]:
        return False
    rem = _rate["remaining"]
    return rem is None or now - _rate["at"] > 60 or rem > min_left


def _note_rate(headers):
    try:
        _rate["remaining"] = int(headers.get("X-RateLimit-Remaining"))
        _rate["at"] = time.time()
    except (TypeError, ValueError):
        pass


def _post(query, variables=None, token=None):
    """Run a GraphQL document. Raises RuntimeError on AniList-reported errors."""
    wait = _rate["cooldown_until"] - time.time()
    if wait > 0:
        raise RuntimeError(f"AniList is rate-limiting us — try again in {int(wait) + 1}s")
    if token is None:
        token = _fallback_token()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        resp = httpc.post(GQL, headers=headers, json={"query": query, "variables": variables or {}}, timeout=20)
        _note_rate(resp.headers)
        body = resp.json()
    except requests.HTTPError as e:
        # AniList puts the real reason in the JSON body even on 400/4xx — surface it.
        r = e.response
        if r is not None and r.status_code == 429:
            try:
                retry = int(r.headers.get("Retry-After") or 60)
            except ValueError:
                retry = 60
            _rate["cooldown_until"] = time.time() + min(max(retry, 1), 120)
            _rate["remaining"], _rate["at"] = 0, time.time()
            raise RuntimeError(f"AniList is rate-limiting us — try again in {retry}s")
        detail = None
        try:
            detail = (r.json().get("errors") or [{}])[0].get("message")
        except Exception:
            detail = (r.text or "")[:200] if r is not None else None
        raise RuntimeError(detail or f"AniList HTTP {getattr(r, 'status_code', '?')}")
    if body.get("errors"):
        raise RuntimeError(body["errors"][0].get("message", "AniList error"))
    return body.get("data") or {}


# ── normalizers ────────────────────────────────────────────────────────────────

_EP_NUM_RE = re.compile(r"episode\s+(\d+)", re.I)


def _ep_num(title):
    """Best-effort episode number from an AniList streamingEpisode title
    ("Episode 12 - …") so a per-episode official link can be matched to the
    aggregator's episode list. None when it can't be parsed."""
    m = _EP_NUM_RE.search(title or "")
    return int(m.group(1)) if m else None


def _trailer(tr):
    # Only YouTube/Dailymotion trailers are playable for us; keep the raw site.
    if not tr or not tr.get("id"):
        return None
    return {"id": tr["id"], "site": tr.get("site"), "thumbnail": tr.get("thumbnail")}


def _fuzzy_date(d):
    """AniList FuzzyDate {year,month,day} → ISO 'YYYY-MM-DD' (or None)."""
    if not d or not d.get("year"):
        return None
    return "%04d-%02d-%02d" % (d["year"], d.get("month") or 1, d.get("day") or 1)


def _custom_lists(raw):
    """MediaList.customLists(asArray:true) → the names this entry is filed under.
    AniList hands back every custom list with an `enabled` flag; only the enabled
    ones are memberships. Tolerates the object form ({name: bool}) too."""
    if isinstance(raw, dict):
        return [k for k, v in raw.items() if v]
    return [c.get("name") for c in (raw or []) if isinstance(c, dict) and c.get("enabled")]


def _norm_entry(e):
    """The viewer's own list entry (score is in their chosen format). Null when
    not connected or not on their list — so cards can show *your* rating too.
    The repeat/notes/date/privacy fields are only requested on the detail page and
    in mutation echoes; they stay None on the lighter card queries."""
    if not e:
        return None
    return {
        "id": e.get("id"), "status": e.get("status"),
        "score": e.get("score"), "progress": e.get("progress"),
        "repeat": e.get("repeat"), "notes": e.get("notes"),
        "started_at": _fuzzy_date(e.get("startedAt")),
        "completed_at": _fuzzy_date(e.get("completedAt")),
        "private": e.get("private"),
        "hidden": e.get("hiddenFromStatusLists"),
        "custom_lists": _custom_lists(e.get("customLists")) if "customLists" in e else None,
        # {category: score} when the viewer uses advanced scoring, else None
        "advanced_scores": e.get("advancedScores") or None,
    }


def norm_media(m):
    """AniList Media → a flat card dict the frontend renders everywhere."""
    if not m:
        return None
    t = m.get("title") or {}
    cover = m.get("coverImage") or {}
    return {
        "id": m["id"],
        "id_mal": m.get("idMal"),
        "type": m.get("type"),
        "title": t.get("english") or t.get("romaji") or t.get("native") or "Untitled",
        "title_romaji": t.get("romaji"),
        "title_native": t.get("native"),
        "cover": cover.get("large"),
        "cover_xl": cover.get("extraLarge") or cover.get("large"),
        "color": cover.get("color"),
        "banner": m.get("bannerImage"),
        "description": m.get("description"),
        "format": m.get("format"),
        "status": m.get("status"),
        "episodes": m.get("episodes"),
        "duration": m.get("duration"),
        "genres": m.get("genres") or [],
        "score": m.get("averageScore"),
        "popularity": m.get("popularity"),
        "favourites": m.get("favourites"),
        "season": m.get("season"),
        "year": m.get("seasonYear"),
        "start_date": _fuzzy_date(m.get("startDate")),
        "end_date": _fuzzy_date(m.get("endDate")),
        "source": m.get("source"),
        "country": m.get("countryOfOrigin"),
        "adult": bool(m.get("isAdult")),
        "studios": [s["name"] for s in ((m.get("studios") or {}).get("nodes") or [])],
        # the same main studios with ids, so a studio name can open its page
        "studio_refs": [
            {"id": s["id"], "name": s["name"]}
            for s in ((m.get("studios") or {}).get("nodes") or []) if s.get("id")
        ],
        "trailer": _trailer(m.get("trailer")),
        # next episode to air (airing shows) — aired-so-far = next_episode - 1.
        # next_airing_at is a unix-seconds timestamp the cards count down to.
        "next_episode": (m.get("nextAiringEpisode") or {}).get("episode"),
        "next_airing_at": (m.get("nextAiringEpisode") or {}).get("airingAt"),
        # whether an unaired title has a scheduled date yet (announced vs TBA)
        "start_year": (m.get("startDate") or {}).get("year"),
        # the viewer's own list entry (status/score/progress), when connected
        "list_entry": _norm_entry(m.get("mediaListEntry")),
    }


def _norm_characters(block):
    """Character edges → a flat cast list, each with every credited voice actor.

    AniList hangs one edge per character, carrying that character's voice actors
    across *all* dubs at once (Luffy alone has Japanese, English and two Italian
    VAs), so the language rides on each voice and the client offers the switch.

    On names: `userPreferred` honours the connected account's own AniList
    name-order setting, which is why it can read "Luffy D. Monkey" rather than
    "Monkey D. Luffy". There is no fixing that here — AniList stores the given
    name in `first` for Japanese and Western characters alike ("Eren"/"Yeager"),
    so reversing would only break the other half. The native name carries the
    true order, so the client shows it alongside.
    """
    out = []
    for e in ((block or {}).get("edges") or []):
        n = e.get("node") or {}
        if not n.get("id"):
            continue
        nm = n.get("name") or {}
        voices = []
        for r in (e.get("voiceActorRoles") or []):
            va = r.get("voiceActor") or {}
            if not va.get("id"):
                continue
            vn = va.get("name") or {}
            voices.append({
                "id": va["id"],
                "name": vn.get("userPreferred") or vn.get("full"),
                "native": vn.get("native"),
                "image": (va.get("image") or {}).get("large"),
                "language": va.get("languageV2"),
                "favourites": va.get("favourites"),
                # "Young", "eps 299-319" — the texture that makes a cast list read.
                "notes": r.get("roleNotes"),
                "dub_group": r.get("dubGroup"),
            })
        out.append({
            "id": n["id"],
            "name": nm.get("userPreferred") or nm.get("full"),
            "native": nm.get("native"),
            "image": (n.get("image") or {}).get("large"),
            "role": e.get("role"),
            "favourites": n.get("favourites"),
            "voices": voices,
        })
    return out


def _norm_detail(m):
    base = norm_media(m)
    if not base:
        return None
    base["characters"] = _norm_characters(m.get("characters"))
    base["tags"] = [
        {"name": t["name"], "rank": t.get("rank")}
        for t in (m.get("tags") or [])
        if not t.get("isMediaSpoiler")
    ]
    base["relations"] = [
        {"relation": e.get("relationType"), "media": norm_media(e.get("node"))}
        for e in ((m.get("relations") or {}).get("edges") or [])
        if e.get("node")
    ]
    base["recommendations"] = [
        {"id": n.get("id"), "rating": n.get("rating"),
         # the viewer's own vote on this pairing (RATE_UP / RATE_DOWN / NO_RATING)
         "user_rating": n.get("userRating"),
         "media": norm_media(n.get("mediaRecommendation"))}
        for n in ((m.get("recommendations") or {}).get("nodes") or [])
        if n.get("mediaRecommendation")
    ]
    base["streaming"] = [
        {"title": s.get("title"), "thumbnail": s.get("thumbnail"), "url": s.get("url"),
         "site": s.get("site"), "number": _ep_num(s.get("title"))}
        for s in (m.get("streamingEpisodes") or [])
    ]
    # Series-level official streaming pages (Crunchyroll, etc.) — for deep-link launch.
    base["external_links"] = [
        {"site": l.get("site"), "url": l.get("url"), "color": l.get("color"),
         "icon": l.get("icon"), "language": l.get("language")}
        for l in (m.get("externalLinks") or [])
        if l.get("type") == "STREAMING" and l.get("url")
    ]
    # list_entry comes from norm_media() (shared mediaListEntry selection).
    base["is_favourite"] = bool(m.get("isFavourite"))
    nxt = m.get("nextAiringEpisode")
    base["next_airing"] = {"episode": nxt["episode"], "airing_at": nxt["airingAt"]} if nxt else None
    return base


SEASONS = ("WINTER", "SPRING", "SUMMER", "FALL")


def _current_season(now=None):
    """AniList's own season for a moment: Dec–Feb is WINTER, and December already
    belongs to the *next* year's winter (Dec 2026 airs as Winter 2027)."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    season = SEASONS[(now.month % 12) // 3]
    return season, now.year + (1 if now.month == 12 else 0)


def _prev_season(season, year):
    i = SEASONS.index(season)
    return (SEASONS[i - 1], year - 1) if i == 0 else (SEASONS[i - 1], year)


def _season_start(season, year):
    """First day of a season as a FuzzyDateInt (YYYYMMDD)."""
    return {
        "WINTER": (year - 1) * 10000 + 1201,
        "SPRING": year * 10000 + 301,
        "SUMMER": year * 10000 + 601,
        "FALL": year * 10000 + 901,
    }[season]


# ── reads ────────────────────────────────────────────────────────────────────

def viewer(token):
    """The signed-in AniList user (id/name/avatar). Cached per token."""
    key = "anilist:viewer:v2:" + hashlib.sha1(token.encode()).hexdigest()[:12]

    def fetch():
        d = _post(
            "query { Viewer { id name avatar { large } siteUrl donatorTier options { profileColor } "
            "mediaListOptions { scoreFormat animeList { customLists"
            " advancedScoring advancedScoringEnabled } } } }",
            token=token,
        )
        v = d.get("Viewer") or {}
        # the same face everywhere: flat avatar url + ring colour, as _norm_user draws people
        v["avatar_url"] = (v.get("avatar") or {}).get("large")
        v["color"] = (v.get("options") or {}).get("profileColor")
        v["donator"] = v.get("donatorTier") or 0
        opts = v.get("mediaListOptions") or {}
        al = opts.get("animeList") or {}
        v["score_format"] = opts.get("scoreFormat") or "POINT_10"
        v["custom_lists"] = [c for c in (al.get("customLists") or []) if c]
        # Only surfaced when switched on: the list editor then scores per category.
        v["advanced_scoring"] = (
            [c for c in (al.get("advancedScoring") or []) if c]
            if al.get("advancedScoringEnabled") else []
        )
        return v

    v, _ = cache.cached(key, 3600, fetch)
    return v


def viewer_settings(token):
    """The signed-in user's editable account settings (drives the profile studio)."""
    key = "anilist:settings:" + hashlib.sha1(token.encode()).hexdigest()[:12]

    def fetch():
        d = _post(
            "query { Viewer { id name siteUrl about(asHtml:false) bannerImage"
            " avatar { large }"
            " options { titleLanguage displayAdultContent airingNotifications profileColor"
            " staffNameLanguage restrictMessagesToFollowing activityMergeTime"
            " notificationOptions { type enabled } disabledListActivity { type disabled } }"
            " mediaListOptions { scoreFormat animeList { customLists advancedScoring"
            " advancedScoringEnabled splitCompletedSectionByFormat } } } }",
            token=token,
        )
        v = d.get("Viewer") or {}
        o = v.get("options") or {}
        al = (v.get("mediaListOptions") or {}).get("animeList") or {}
        return {
            "id": v.get("id"),
            "name": v.get("name"),
            "site_url": v.get("siteUrl"),
            "avatar": (v.get("avatar") or {}).get("large"),
            "banner": v.get("bannerImage"),
            "about": v.get("about"),
            "score_format": (v.get("mediaListOptions") or {}).get("scoreFormat") or "POINT_10",
            "title_language": o.get("titleLanguage"),
            "profile_color": o.get("profileColor"),
            "adult_content": o.get("displayAdultContent"),
            "airing_notifications": o.get("airingNotifications"),
            # How people's names are ordered everywhere (fixes "Luffy D. Monkey").
            "staff_name_language": o.get("staffNameLanguage"),
            "restrict_messages": o.get("restrictMessagesToFollowing"),
            "activity_merge_time": o.get("activityMergeTime"),
            "notification_options": [
                {"type": n.get("type"), "enabled": bool(n.get("enabled"))}
                for n in (o.get("notificationOptions") or []) if n.get("type")
            ],
            "disabled_list_activity": [
                {"type": n.get("type"), "disabled": bool(n.get("disabled"))}
                for n in (o.get("disabledListActivity") or []) if n.get("type")
            ],
            "custom_lists": [c for c in (al.get("customLists") or []) if c],
            "advanced_scoring": [c for c in (al.get("advancedScoring") or []) if c],
            "advanced_scoring_enabled": bool(al.get("advancedScoringEnabled")),
            "split_completed": bool(al.get("splitCompletedSectionByFormat")),
        }

    data, _ = cache.cached(key, 300, fetch)
    return data


# GraphQL type + argument name for each editable field exposed by the studio.
_USER_FIELDS = {
    "about": ("String", "about"),
    "score_format": ("ScoreFormat", "scoreFormat"),
    "title_language": ("UserTitleLanguage", "titleLanguage"),
    "profile_color": ("String", "profileColor"),
    "adult_content": ("Boolean", "displayAdultContent"),
    "airing_notifications": ("Boolean", "airingNotifications"),
    "staff_name_language": ("UserStaffNameLanguage", "staffNameLanguage"),
    "restrict_messages": ("Boolean", "restrictMessagesToFollowing"),
    "activity_merge_time": ("Int", "activityMergeTime"),
    "notification_options": ("[NotificationOptionInput]", "notificationOptions"),
    "disabled_list_activity": ("[ListActivityOptionInput]", "disabledListActivity"),
}

# The anime-list options ride in one MediaListOptionsInput; each studio field maps
# onto one of its keys. Only the keys actually sent are included in the input.
_LIST_OPTION_FIELDS = {
    "custom_lists": "customLists",
    "advanced_scoring": "advancedScoring",
    "advanced_scoring_enabled": "advancedScoringEnabled",
    "split_completed": "splitCompletedSectionByFormat",
}


def update_user(token, **fields):
    """Mutate the signed-in user's AniList account settings (only given fields)."""
    decl, args, variables = [], [], {}
    for k, v in fields.items():
        if k not in _USER_FIELDS or v is None:
            continue
        gqlt, gqlname = _USER_FIELDS[k]
        decl.append(f"${k}:{gqlt}")
        args.append(f"{gqlname}:${k}")
        variables[k] = v
    list_opts = {
        gql: fields[k] for k, gql in _LIST_OPTION_FIELDS.items() if fields.get(k) is not None
    }
    if list_opts:
        decl.append("$animeListOptions:MediaListOptionsInput")
        args.append("animeListOptions:$animeListOptions")
        variables["animeListOptions"] = list_opts
    if not args:
        return None
    q = "mutation (" + ",".join(decl) + "){ UpdateUser(" + ",".join(args) + "){ id } }"
    d = _post(q, variables, token=token)
    cache.invalidate("anilist:settings:")
    cache.invalidate("anilist:viewer:")
    cache.invalidate("anilist:user:")
    if list_opts:
        cache.invalidate("anilist:lists:")  # custom lists are list groups
    return d.get("UpdateUser")


def delete_custom_list(token, name):
    """Remove one custom anime list. Its entries stay on their status lists."""
    d = _post(
        "mutation ($n:String){ DeleteCustomList(customList:$n, type:ANIME){ deleted } }",
        {"n": name}, token=token,
    )
    for p in ("anilist:settings:", "anilist:viewer:", "anilist:lists:"):
        cache.invalidate(p)
    return d.get("DeleteCustomList")


def _page_payload(pg, ttl_full):
    """Normalize a Page{pageInfo,media} block into the client's paginated shape
    {items, has_next}, paired with the TTL it should cache under.

    An empty page gets a deliberately short TTL: a blank result is almost always a
    transient rate-limit or hiccup rather than the truth, and caching it for the
    full window would strand a genre shelf empty for half an hour (which is exactly
    what "only 6 titles and nothing more loads" looked like). `has_next` comes
    straight from AniList's pageInfo, so the client knows when to stop scrolling."""
    items = [norm_media(m) for m in (pg.get("media") or [])]
    payload = {"items": items, "has_next": bool((pg.get("pageInfo") or {}).get("hasNextPage"))}
    return payload, (ttl_full if items else config.TTL_ANILIST_EMPTY)


def search(q, page=1, per_page=30, token=None):
    query = (
        "query ($search:String,$page:Int,$perPage:Int){"
        " Page(page:$page,perPage:$perPage){ pageInfo{ hasNextPage }"
        " media(search:$search,type:ANIME,sort:SEARCH_MATCH){"
        + _MEDIA + "} } }"
    )

    def fetch():
        d = _post(query, {"search": q, "page": page, "perPage": per_page}, token=token)
        return _page_payload(d.get("Page") or {}, config.TTL_ANILIST_SEARCH)

    # mediaListEntry depends on the token, so split the cache by auth state.
    auth = "auth" if token else "anon"
    return cache.cached_dynamic(f"anilist:search:{auth}:{q.lower()}:{page}", fetch)


def browse(kind="trending", page=1, per_page=30, token=None):
    sort = {
        "trending": "TRENDING_DESC",
        "popular": "POPULARITY_DESC",
        "top": "SCORE_DESC",
        "seasonal": "POPULARITY_DESC",
    }.get(kind, "TRENDING_DESC")
    variables = {"page": page, "perPage": per_page, "sort": [sort]}
    season_filter = ""
    season_decl = ""
    if kind == "seasonal":
        season, year = _current_season()
        variables["season"], variables["seasonYear"] = season, year
        season_filter = "season:$season, seasonYear:$seasonYear,"
        season_decl = ",$season:MediaSeason,$seasonYear:Int"  # AniList rejects unused vars
    query = (
        "query ($page:Int,$perPage:Int,$sort:[MediaSort]" + season_decl + "){"
        " Page(page:$page,perPage:$perPage){ pageInfo{ hasNextPage }"
        " media(" + season_filter + "type:ANIME,sort:$sort){"
        + _MEDIA + "} } }"
    )

    def fetch():
        d = _post(query, variables, token=token)
        return _page_payload(d.get("Page") or {}, config.TTL_ANILIST_BROWSE)

    auth = "auth" if token else "anon"
    return cache.cached_dynamic(f"anilist:browse:{auth}:{kind}:{page}", fetch)


# The sort dials the discover picker offers, keyed by the value the client sends.
# POPULARITY leads because a genre/tag browse is "show me the well-loved ones";
# the rest cover the other honest questions a filtered shelf gets asked.
_DISCOVER_SORTS = {
    "popular": "POPULARITY_DESC",
    "trending": "TRENDING_DESC",
    "score": "SCORE_DESC",
    "newest": "START_DATE_DESC",
    "oldest": "START_DATE",
    "title": "TITLE_ROMAJI",
}


def genre_collection():
    """AniList's full genre list + tag vocabulary, for the discover picker.

    Two collections in one round-trip. Tags carry a category (so the picker can
    group them the way AniList's own filters do) and a description (shown on hover
    — the sort of thing that answers "what does 'Iyashikei' even mean" without a
    detour). Adult-only genres/tags are dropped here so the comfy home picker never
    surfaces them; the discover query is SFW-only to match.
    """

    def fetch():
        d = _post(
            "query { GenreCollection"
            " MediaTagCollection { name description category isAdult }"
            " ExternalLinkSourceCollection(type:STREAMING, mediaType:ANIME)"
            " { id site icon color language isDisabled } }"
        )
        genres = [g for g in (d.get("GenreCollection") or []) if g and g != "Hentai"]
        # Streaming services, merged by site: AniList keeps one source per region
        # ("Crunchyroll", "Crunchyroll (Brazil)"…), but "streams on Crunchyroll" is
        # one question, so each chip carries every regional id it stands for.
        services = {}
        for s in d.get("ExternalLinkSourceCollection") or []:
            if not s or not s.get("id") or s.get("isDisabled"):
                continue
            row = services.setdefault(s["site"], {
                "site": s["site"], "ids": [], "icon": s.get("icon"),
                "color": s.get("color"), "languages": [],
            })
            row["ids"].append(s["id"])
            if s.get("language") and s["language"] not in row["languages"]:
                row["languages"].append(s["language"])
            row["icon"] = row["icon"] or s.get("icon")
            row["color"] = row["color"] or s.get("color")
        tags = [
            {
                "name": t["name"],
                "description": t.get("description"),
                "category": t.get("category") or "Other",
            }
            for t in (d.get("MediaTagCollection") or [])
            if t and t.get("name") and not t.get("isAdult")
        ]
        # Group tags by category, categories alphabetized and tags within each kept
        # in AniList's own order (already relevance-sorted). The picker renders these
        # as collapsible sections, so the shape is done here, once, cached.
        cats = {}
        for t in tags:
            cats.setdefault(t["category"], []).append(t)
        grouped = [
            {"category": c, "tags": cats[c]}
            for c in sorted(cats, key=lambda c: (c.lower()))
        ]
        return {
            "genres": genres, "tags": tags, "tag_groups": grouped,
            "services": sorted(services.values(), key=lambda r: r["site"].lower()),
        }

    # v2: the payload gained `services`; a day-old v1 row must not shadow it.
    data, _ = cache.cached("anilist:genres:v2", config.TTL_ANILIST_GENRES, fetch)
    return data


_FORMATS = {"TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC"}
_STATUSES = {"FINISHED", "RELEASING", "NOT_YET_RELEASED", "CANCELLED", "HIATUS"}
_SOURCES = {
    "ORIGINAL", "MANGA", "LIGHT_NOVEL", "VISUAL_NOVEL", "VIDEO_GAME", "OTHER", "NOVEL",
    "DOUJINSHI", "ANIME", "WEB_NOVEL", "LIVE_ACTION", "GAME", "COMIC",
    "MULTIMEDIA_PROJECT", "PICTURE_BOOK",
}
_COUNTRIES = {"JP", "CN", "KR", "TW"}


def _int_or_none(v):
    try:
        return int(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def build_media_filter(f):
    """Turn the finder's filter dict into GraphQL (decl, args, variables) pieces.

    Pure, so the whole mapping is unit-tested. Every value is validated against
    AniList's own enums (an unknown enum fails the *entire* query), numbers are
    coerced, and inclusive UI ranges become AniList's strict `_greater`/`_lesser`
    by stepping one past each end. Years go through FuzzyDateInt (YYYYMMDD): a
    date with an unknown month is stored as YYYY0000, which the stepped bounds
    still catch.
    """
    f = f or {}
    decl, args, v = [], [], {}

    def add(name, gql_type, arg, value):
        decl.append(f"${name}:{gql_type}")
        args.append(f"{arg}:${name}")
        v[name] = value

    def enum_list(key, allowed):
        return [x for x in (f.get(key) or []) if x in allowed]

    for key, arg in (("genres", "genre_in"), ("exclude_genres", "genre_not_in")):
        vals = [x for x in (f.get(key) or []) if x]
        if vals:
            add(key, "[String]", arg, vals)
    for key, arg in (("tags", "tag_in"), ("exclude_tags", "tag_not_in")):
        vals = [x for x in (f.get(key) or []) if x]
        if vals:
            add(key, "[String]", arg, vals)
    if f.get("tags") and _int_or_none(f.get("min_tag_rank")):
        add("minTagRank", "Int", "minimumTagRank", _int_or_none(f["min_tag_rank"]))

    formats = enum_list("formats", _FORMATS)
    if formats:
        add("formats", "[MediaFormat]", "format_in", formats)
    statuses = enum_list("statuses", _STATUSES)
    if statuses:
        add("statuses", "[MediaStatus]", "status_in", statuses)
    sources = enum_list("sources", _SOURCES)
    if sources:
        add("sources", "[MediaSource]", "source_in", sources)
    if f.get("country") in _COUNTRIES:
        add("country", "CountryCode", "countryOfOrigin", f["country"])

    season = f.get("season")
    year = _int_or_none(f.get("year"))
    if season in SEASONS:
        add("season", "MediaSeason", "season", season)
    if year:
        add("seasonYear", "Int", "seasonYear", year)
    y_from, y_to = _int_or_none(f.get("year_from")), _int_or_none(f.get("year_to"))
    if y_from:
        add("startAfter", "FuzzyDateInt", "startDate_greater", (y_from - 1) * 10000 + 9999)
    if y_to:
        add("startBefore", "FuzzyDateInt", "startDate_lesser", (y_to + 1) * 10000)

    score_min = _int_or_none(f.get("score_min"))
    if score_min:
        add("scoreMin", "Int", "averageScore_greater", score_min - 1)
    ep_min, ep_max = _int_or_none(f.get("episodes_min")), _int_or_none(f.get("episodes_max"))
    if ep_min:
        add("epMin", "Int", "episodes_greater", ep_min - 1)
    if ep_max:
        add("epMax", "Int", "episodes_lesser", ep_max + 1)
    dur_min, dur_max = _int_or_none(f.get("duration_min")), _int_or_none(f.get("duration_max"))
    if dur_min:
        add("durMin", "Int", "duration_greater", dur_min - 1)
    if dur_max:
        add("durMax", "Int", "duration_lesser", dur_max + 1)

    services = [i for i in (_int_or_none(x) for x in (f.get("services") or [])) if i]
    if services:
        add("services", "[Int]", "licensedById_in", services)
    if f.get("on_list") in (True, False):
        add("onList", "Boolean", "onList", f["on_list"])
    return decl, args, v


def filter_signature(f):
    """A stable cache-key fragment for a filter dict (sets sorted, empties dropped)."""
    parts = []
    for k in sorted(f or {}):
        val = f[k]
        if val in (None, "", [], ()):
            continue
        if isinstance(val, (list, tuple, set)):
            val = ",".join(sorted(str(x) for x in val))
        parts.append(f"{k}={str(val).lower()}")
    return "|".join(parts)


def discover(genres=None, tags=None, sort="popular", search=None,
             page=1, per_page=30, token=None, filters=None):
    """Browse anime filtered by any mix of AniList's media filters and a text query.

    Genres and tags are ANDed by AniList (genre_in + tag_in narrow together), which
    is the intuitive reading of picking several: "slice-of-life *and* iyashikei",
    not "either". `isAdult:false` keeps the shelf SFW to match the picker. When a
    search term rides along, we still honour the chosen sort unless it's the default
    popularity dial, in which case relevance (SEARCH_MATCH) wins — a typed query
    wants its best match first. `filters` carries everything else the finder offers
    (see build_media_filter).
    """
    f = dict(filters or {})
    f["genres"] = [g for g in (genres or f.get("genres") or []) if g]
    f["tags"] = [t for t in (tags or f.get("tags") or []) if t]
    search = (search or "").strip() or None
    sort_key = "SEARCH_MATCH" if (search and sort == "popular") else _DISCOVER_SORTS.get(sort, "POPULARITY_DESC")

    decl = ["$page:Int", "$perPage:Int", "$sort:[MediaSort]"]
    args = ["type:ANIME", "isAdult:false", "sort:$sort"]
    variables = {"page": page, "perPage": per_page, "sort": [sort_key]}
    fd, fa, fv = build_media_filter(f)
    decl += fd
    args += fa
    variables.update(fv)
    if search:
        decl.append("$search:String"); args.append("search:$search"); variables["search"] = search
    query = (
        "query (" + ",".join(decl) + "){"
        " Page(page:$page,perPage:$perPage){ pageInfo{ hasNextPage }"
        " media(" + ",".join(args) + "){"
        + _MEDIA + "} } }"
    )

    def fetch():
        d = _post(query, variables, token=token)
        return _page_payload(d.get("Page") or {}, config.TTL_ANILIST_BROWSE)

    auth = "auth" if token else "anon"
    ck = filter_signature(f) + f"|s:{sort}|q:{(search or '').lower()}|p:{page}"
    return cache.cached_dynamic(f"anilist:discover:{auth}:{ck}", fetch)


def media(media_id, token=None):
    query = (
        "query ($id:Int){ Media(id:$id,type:ANIME){"
        + _MEDIA
        + " isFavourite"
        + " mediaListEntry { id repeat notes startedAt { year month day }"
          " completedAt { year month day } private hiddenFromStatusLists"
          " customLists(asArray:true) advancedScores }"
        + " tags { name rank isMediaSpoiler }"
        # ROLE first so mains lead; 24 is a full programme without a second page.
        + " characters(sort:[ROLE,RELEVANCE,ID],perPage:24) { edges { role"
          " node { id name { userPreferred native } image { large } favourites }"
          " voiceActorRoles(sort:[RELEVANCE,ID]) { roleNotes dubGroup"
          " voiceActor { id name { userPreferred native } image { large }"
          " languageV2 favourites } } } }"
        + " relations { edges { relationType node {" + _MEDIA + "} } }"
        + " recommendations(sort:RATING_DESC,perPage:12){ nodes { id rating userRating"
          " mediaRecommendation {" + _MEDIA + "} } }"
        + " streamingEpisodes { title thumbnail url site }"
        + " externalLinks { url site type language color icon }"
        + "} }"
    )
    # mediaListEntry depends on the token, so don't share the cache across auth states.
    # The trailing v2 retires rows cached before the payload gained recommendation
    # votes and list privacy; the `anilist:media:{id}:` prefix still invalidates it.
    key = f"anilist:media:{media_id}:{'auth' if token else 'anon'}:v2"

    def fetch():
        d = _post(query, {"id": media_id}, token=token)
        return _norm_detail(d.get("Media"))

    data, _ = cache.cached(key, config.TTL_ANILIST_MEDIA, fetch)
    return data


def _fuzzy_year(d):
    """AniList FuzzyDate → (year, month, day) with None where unknown. A birthday
    is very often day+month with no year, which is a fact worth keeping, not a
    reason to throw the date away."""
    if not d or not any(d.get(k) for k in ("year", "month", "day")):
        return None
    return {"year": d.get("year"), "month": d.get("month"), "day": d.get("day")}


def _norm_staff(s):
    """AniList Staff → the voice actor dossier.

    `characterMedia` is the useful edge for a seiyuu: it yields one entry per
    (show, role) with the characters they voiced in it, which is what a filmography
    actually is. `staffMedia` would give production credits instead.
    """
    if not s:
        return None
    nm = s.get("name") or {}
    roles = []
    for e in ((s.get("characterMedia") or {}).get("edges") or []):
        media = norm_media(e.get("node"))
        if not media:
            continue
        roles.append({
            "role": e.get("characterRole"),
            "media": media,
            "characters": [
                {
                    "id": c.get("id"),
                    "name": (c.get("name") or {}).get("userPreferred"),
                    "native": (c.get("name") or {}).get("native"),
                    "image": (c.get("image") or {}).get("large"),
                    "favourites": c.get("favourites"),
                }
                for c in (e.get("characters") or []) if c
            ],
        })
    # Production credits: one row per show, every hat worn on it gathered together
    # ("Director", "Storyboard (eps 1, 12)") — a staff edge arrives per role.
    credits, by_media = [], {}
    for e in ((s.get("staffMedia") or {}).get("edges") or []):
        media = norm_media(e.get("node"))
        if not media or media.get("adult"):
            continue
        row = by_media.get(media["id"])
        if row is None:
            row = by_media[media["id"]] = {"media": media, "roles": []}
            credits.append(row)
        if e.get("staffRole") and e["staffRole"] not in row["roles"]:
            row["roles"].append(e["staffRole"])
    years = s.get("yearsActive") or []
    return {
        "id": s.get("id"),
        "is_favourite": bool(s.get("isFavourite")),
        "credits": credits,
        "name": nm.get("userPreferred") or nm.get("full"),
        "native": nm.get("native"),
        # AniList stores these comma-joined inside one string often enough that
        # the client splits defensively; keep whatever came back.
        "aliases": [a for a in (nm.get("alternative") or []) if a],
        "image": (s.get("image") or {}).get("large"),
        "description": s.get("description"),
        "language": s.get("languageV2"),
        "occupations": s.get("primaryOccupations") or [],
        "gender": s.get("gender"),
        "age": s.get("age"),
        "home_town": s.get("homeTown"),
        "blood_type": s.get("bloodType"),
        "birth": _fuzzy_year(s.get("dateOfBirth")),
        "death": _fuzzy_year(s.get("dateOfDeath")),
        # [start] while still working, [start, end] once they've stopped.
        "years_active": {"start": years[0] if years else None,
                         "end": years[1] if len(years) > 1 else None},
        "favourites": s.get("favourites"),
        "site_url": s.get("siteUrl"),
        "roles": roles,
    }


def staff(staff_id, token=None):
    """One voice actor / staff member, with their voiced filmography."""
    query = (
        "query ($id:Int){ Staff(id:$id){"
        " id name { userPreferred native alternative } image { large }"
        " languageV2 primaryOccupations gender age homeTown bloodType"
        " yearsActive favourites siteUrl isFavourite"
        " dateOfBirth { year month day } dateOfDeath { year month day }"
        " description(asHtml:false)"
        " characterMedia(sort:[POPULARITY_DESC],perPage:30){ edges { characterRole"
        " node {" + _MEDIA + "}"
        " characters { id name { userPreferred native } image { large } favourites } } }"
        " staffMedia(sort:[POPULARITY_DESC], type:ANIME, perPage:40){ edges { staffRole"
        " node {" + _MEDIA + "} } }"
        "} }"
    )

    def fetch():
        d = _post(query, {"id": staff_id}, token=token)
        return _norm_staff(d.get("Staff"))

    data, _ = cache.cached(f"anilist:staff:v2:{staff_id}", config.TTL_ANILIST_STAFF, fetch)
    return data


def user_lists(token):
    """The signed-in user's anime MediaListCollection, grouped by list."""
    vid = viewer(token)["id"]
    query = (
        "query ($userId:Int){ MediaListCollection(userId:$userId,type:ANIME){"
        " lists { name isCustomList status entries {"
        " id status score progress updatedAt createdAt repeat notes private"
        " hiddenFromStatusLists customLists(asArray:true)"
        " startedAt { year month day } completedAt { year month day }"
        # Two fixed-scale copies of the score: 100-point for the maths (stats,
        # comparisons) and 10-point for a MyAnimeList-compatible export.
        " score100: score(format:POINT_100) score10: score(format:POINT_10)"
        " media {" + _MEDIA + "} } } } }"
    )

    def fetch():
        d = _post(query, {"userId": vid}, token=token)
        out = []
        for lst in (d.get("MediaListCollection") or {}).get("lists", []):
            out.append({
                "name": lst.get("name"),
                "status": lst.get("status"),
                "custom": lst.get("isCustomList"),
                "entries": [
                    # updated_at is AniList's own "entry last touched" stamp (epoch
                    # seconds) — the closest thing to "when did I last watch this",
                    # since progress bumps (including Tubcal's auto-mark) write it.
                    {"entry_id": e["id"], "status": e.get("status"), "score": e.get("score"),
                     "progress": e.get("progress"), "updated_at": e.get("updatedAt"),
                     "created_at": e.get("createdAt"), "repeat": e.get("repeat") or 0,
                     "notes": e.get("notes"), "private": bool(e.get("private")),
                     "hidden": bool(e.get("hiddenFromStatusLists")),
                     "custom_lists": _custom_lists(e.get("customLists")),
                     "started_at": _fuzzy_date(e.get("startedAt")),
                     "completed_at": _fuzzy_date(e.get("completedAt")),
                     "score_100": e.get("score100") or 0, "score_10": e.get("score10") or 0,
                     "media": norm_media(e.get("media"))}
                    for e in lst.get("entries", []) if e.get("media")
                ],
            })
        return out

    items, _ = cache.cached(f"anilist:lists:{vid}", config.TTL_ANILIST_LIST, fetch)
    return items


# ── writes (mutations) ───────────────────────────────────────────────────────

def _invalidate_user(token, media_id=None):
    """Drop the caches a write makes stale so the next read reflects it."""
    try:
        cache.invalidate(f"anilist:lists:{viewer(token)['id']}")
    except Exception:
        pass
    if media_id is not None:
        cache.invalidate(f"anilist:media:{media_id}:")


def _date_input(s):
    """ISO 'YYYY-MM-DD' (or '') → AniList FuzzyDateInput dict; '' clears the date."""
    if s == "" or s is None:
        return {"year": None, "month": None, "day": None}
    y, m, d = (s.split("-") + ["1", "1"])[:3]
    return {"year": int(y), "month": int(m), "day": int(d)}


_ENTRY_ECHO = (
    " id status score progress repeat notes private hiddenFromStatusLists"
    " customLists(asArray:true) advancedScores"
    " startedAt { year month day } completedAt { year month day }"
)


def advanced_score_list(scores, categories):
    """{category: score} → the positional [Float] SaveMediaListEntry wants, in the
    viewer's own category order. A category left unscored goes as 0 (AniList's
    own "not set"), so a partial edit never shifts the others out of place."""
    scores = scores or {}
    out = []
    for c in categories or []:
        try:
            out.append(float(scores.get(c) or 0))
        except (TypeError, ValueError):
            out.append(0.0)
    return out


def save_list_entry(token, media_id, *, status=None, progress=None, score=None,
                    repeat=None, notes=None, started_at=None, completed_at=None,
                    private=None, hidden=None, custom_lists=None, advanced_scores=None):
    """Create/update the user's list entry for a media. Only sends the given fields.

    Returns the stored entry in the same normalized shape the detail page reads,
    so the client overlay can merge AniList's verdict verbatim."""
    decl = ["$mediaId:Int"]
    args = ["mediaId:$mediaId"]
    variables = {"mediaId": media_id}
    if private is not None:
        decl.append("$private:Boolean"); args.append("private:$private"); variables["private"] = bool(private)
    if hidden is not None:
        decl.append("$hidden:Boolean"); args.append("hiddenFromStatusLists:$hidden")
        variables["hidden"] = bool(hidden)
    if custom_lists is not None:
        decl.append("$customLists:[String]"); args.append("customLists:$customLists")
        variables["customLists"] = [c for c in custom_lists if c]
    if advanced_scores is not None:
        cats = viewer(token).get("advanced_scoring") or []
        if cats:
            decl.append("$adv:[Float]"); args.append("advancedScores:$adv")
            variables["adv"] = advanced_score_list(advanced_scores, cats)
    if status is not None:
        decl.append("$status:MediaListStatus"); args.append("status:$status"); variables["status"] = status
    if progress is not None:
        decl.append("$progress:Int"); args.append("progress:$progress"); variables["progress"] = int(progress)
    if score is not None:
        decl.append("$score:Float"); args.append("score:$score"); variables["score"] = float(score)
    if repeat is not None:
        decl.append("$repeat:Int"); args.append("repeat:$repeat"); variables["repeat"] = int(repeat)
    if notes is not None:
        decl.append("$notes:String"); args.append("notes:$notes"); variables["notes"] = notes
    if started_at is not None:
        decl.append("$startedAt:FuzzyDateInput"); args.append("startedAt:$startedAt")
        variables["startedAt"] = _date_input(started_at)
    if completed_at is not None:
        decl.append("$completedAt:FuzzyDateInput"); args.append("completedAt:$completedAt")
        variables["completedAt"] = _date_input(completed_at)
    query = (
        "mutation (" + ",".join(decl) + "){ SaveMediaListEntry(" + ",".join(args) + "){"
        + _ENTRY_ECHO + " } }"
    )
    d = _post(query, variables, token=token)
    _invalidate_user(token, media_id)
    return _norm_entry(d.get("SaveMediaListEntry"))


_BULK_FIELDS = {
    "status": ("MediaListStatus", "status"),
    "private": ("Boolean", "private"),
    "hidden": ("Boolean", "hiddenFromStatusLists"),
    "score": ("Float", "score"),
}


def bulk_update(token, entry_ids, **fields):
    """One mutation for many entries (UpdateMediaListEntries) — the list's bulk
    editor. Only status / score / privacy flags are offered: AniList's batch
    mutation has no custom-list argument, and progress in bulk is meaningless."""
    ids = [int(i) for i in entry_ids or [] if i]
    if not ids:
        return []
    decl, args, variables = ["$ids:[Int]"], ["ids:$ids"], {"ids": ids}
    for k, v in fields.items():
        if k not in _BULK_FIELDS or v is None:
            continue
        gqlt, gqlname = _BULK_FIELDS[k]
        decl.append(f"${k}:{gqlt}")
        args.append(f"{gqlname}:${k}")
        variables[k] = v
    if len(args) == 1:
        return []
    d = _post(
        "mutation (" + ",".join(decl) + "){ UpdateMediaListEntries(" + ",".join(args) + "){"
        " id mediaId status score private hiddenFromStatusLists } }",
        variables, token=token,
    )
    _invalidate_user(token)
    return d.get("UpdateMediaListEntries") or []


def bulk_delete(token, entry_ids):
    """Delete several entries. AniList has no batch delete, so it's one mutation
    each — sequential, and the count actually removed is returned."""
    n = 0
    for i in entry_ids or []:
        d = _post("mutation ($id:Int){ DeleteMediaListEntry(id:$id){ deleted } }",
                  {"id": int(i)}, token=token)
        n += 1 if (d.get("DeleteMediaListEntry") or {}).get("deleted") else 0
    _invalidate_user(token)
    return n


def mark_episode_watched(token, media_id, episode, total=None):
    """Advance the viewer's AniList progress for `media_id` to `episode`, never
    lowering it. Flips the entry to COMPLETED on the final episode, otherwise
    CURRENT. Returns the updated entry, or None if nothing changed / not connected.
    """
    if not token or not media_id or not episode:
        return None
    ep = int(float(episode))
    if ep <= 0:
        return None
    d = _post(
        "query($id:Int){ Media(id:$id){ episodes mediaListEntry { progress status } } }",
        {"id": int(media_id)}, token=token,
    )
    media = d.get("Media") or {}
    entry = media.get("mediaListEntry") or {}
    if ep <= (entry.get("progress") or 0):
        return None  # never lower an existing (or equal) progress
    if total is None:
        total = media.get("episodes")
    status = "COMPLETED" if (total and ep >= total) else "CURRENT"
    return save_list_entry(token, int(media_id), status=status, progress=ep)


def delete_list_entry(token, entry_id):
    d = _post("mutation ($id:Int){ DeleteMediaListEntry(id:$id){ deleted } }", {"id": entry_id}, token=token)
    _invalidate_user(token)
    return d.get("DeleteMediaListEntry")


def _genre_candidates(genres, per_page=40):
    query = (
        "query ($genres:[String],$perPage:Int){ Page(perPage:$perPage){"
        " media(type:ANIME, genre_in:$genres, sort:[POPULARITY_DESC]){" + _MEDIA + "} } }"
    )

    def fetch():
        d = _post(query, {"genres": genres, "perPage": per_page})
        return [norm_media(m) for m in (d.get("Page") or {}).get("media", [])]

    items, _ = cache.cached("anilist:genrecand:" + ",".join(sorted(genres)), config.TTL_ANILIST_BROWSE, fetch)
    return items


def related_for_channel(token, limit=30):
    """Trailers for anime *related* to what you've watched — the Anime Channel.

    Blends three signals, weighted toward AniList's own graph: recommendations from
    your highest-scored titles (×3, scaled by rec rating), their direct relations
    (×2), and titles sharing your most-watched genres (×1). Already-listed titles are
    dropped; only entries with a YouTube trailer survive (they're what we can play).
    """
    vid = viewer(token)["id"]

    def build():
        lists = user_lists(token)
        watched, seeds, genre_count = set(), [], {}
        for g in lists:
            for e in g.get("entries", []):
                m = e["media"]
                watched.add(m["id"])
                for gn in (m.get("genres") or []):
                    genre_count[gn] = genre_count.get(gn, 0) + 1
                if g.get("status") in ("COMPLETED", "CURRENT", "REPEATING"):
                    seeds.append((m["id"], e.get("score") or 0))
        seeds.sort(key=lambda x: -x[1])
        anchors = [s[0] for s in seeds[:8]]
        top_genres = [g for g, _ in sorted(genre_count.items(), key=lambda x: -x[1])[:4]]

        scored = {}

        def add(m, pts):
            if not m or m["id"] in watched:
                return
            tr = m.get("trailer")
            if not tr or tr.get("site") != "youtube":
                return
            row = scored.get(m["id"])
            if row:
                row["score"] += pts
            else:
                scored[m["id"]] = {"media": m, "score": pts}

        for aid in anchors:
            try:
                d = media(aid)  # cached anon detail (relations + recommendations)
            except Exception:
                continue
            for r in d.get("recommendations") or []:
                add(r.get("media"), 3 * (1 + (r.get("rating") or 0) / 50))
            for r in d.get("relations") or []:
                add(r.get("media"), 2)
        if top_genres:
            try:
                for m in _genre_candidates(top_genres):
                    add(m, 1)
            except Exception:
                pass

        ranked = sorted(scored.values(), key=lambda x: -x["score"])
        return [r["media"] for r in ranked]

    items, _ = cache.cached(f"anilist:channel:{vid}", 900, build)
    return items[:limit]


def save_recommendation(token, media_id, recommend_id, rating="RATE_UP"):
    """Vote on (or create) the pairing "if you liked media_id, watch recommend_id".
    RATE_UP / RATE_DOWN cast a vote; NO_RATING withdraws yours."""
    if rating not in ("RATE_UP", "RATE_DOWN", "NO_RATING"):
        raise ValueError("rating must be RATE_UP, RATE_DOWN or NO_RATING")
    query = (
        "mutation ($m:Int,$r:Int,$rating:RecommendationRating){"
        " SaveRecommendation(mediaId:$m, mediaRecommendationId:$r, rating:$rating){ id rating userRating } }"
    )
    d = _post(query, {"m": media_id, "r": recommend_id, "rating": rating}, token=token)
    cache.invalidate(f"anilist:media:{media_id}:")
    cache.invalidate("anilist:recs:")
    rec = d.get("SaveRecommendation") or {}
    return {"id": rec.get("id"), "rating": rec.get("rating") or 0, "user_rating": rec.get("userRating")}


# ToggleFavourite's argument and the root query that reads the result back, per
# kind of thing you can favourite — plus the cache prefix its page lives under.
_FAVOURITABLE = {
    "anime": ("animeId", "Media", "anilist:media:{id}:"),
    "character": ("characterId", "Character", "anilist:character:{id}"),
    "staff": ("staffId", "Staff", "anilist:staff:v2:{id}"),
    "studio": ("studioId", "Studio", "anilist:studio:{id}:"),
}


def toggle_favourite(token, kind, entity_id):
    """Add/remove an anime, character, staff member or studio from the viewer's
    AniList favourites (it's a toggle), then read `isFavourite` back.

    The mutation returns the *first page* of each favourites list, so checking
    membership there misreports once someone has more favourites than fit on it;
    one extra read gives the truth."""
    if kind not in _FAVOURITABLE:
        raise ValueError(f"can't favourite a {kind}")
    arg, root, prefix = _FAVOURITABLE[kind]
    _post(
        f"mutation ($id:Int){{ ToggleFavourite({arg}:$id){{ anime {{ pageInfo {{ total }} }} }} }}",
        {"id": entity_id}, token=token,
    )
    cache.invalidate(prefix.format(id=entity_id))
    cache.invalidate("anilist:user:")  # favourites shown on profiles
    d = _post(f"query ($id:Int){{ {root}(id:$id){{ isFavourite favourites }} }}",
              {"id": entity_id}, token=token)
    row = d.get(root) or {}
    return {"is_favourite": bool(row.get("isFavourite")), "favourites": row.get("favourites")}


# ── discussions: forum threads + activity feed ───────────────────────────────

# Everyone in the social rooms is drawn with their own profile colour as the
# avatar ring and a mark for supporters, so the fragment carries both.
_PERSON = "id name avatar { large } donatorTier options { profileColor }"
_USER = "user { " + _PERSON + " }"

# A thread is treated as spoilery if its title carries a spoiler marker or names a
# specific episode ("Episode 12 …") — best-effort, deterministic, no AI needed.
_SPOILER_RE = re.compile(r"spoiler|~!|\bepisode\s*\d+\b", re.I)


def _norm_user(u):
    u = u or {}
    return {"id": u.get("id"), "name": u.get("name"), "avatar": (u.get("avatar") or {}).get("large"),
            "color": (u.get("options") or {}).get("profileColor"), "donator": u.get("donatorTier") or 0}


def _norm_comment(cm):
    """A thread comment + its nested replies. AniList serializes childComments as a
    JSON tree that mirrors the parent's field selection, so one query carries the
    whole tree with content — we just recurse into it."""
    return {
        "id": cm.get("id"),
        "comment": cm.get("comment"),
        "created_at": cm.get("createdAt"),
        "likes": cm.get("likeCount"),
        "liked": cm.get("isLiked"),
        "user": _norm_user(cm.get("user")),
        "children": [_norm_comment(ch) for ch in (cm.get("childComments") or [])],
    }


def _first_media_category(mcs):
    """The anime a thread is filed under (its sub-category), if any."""
    for m in mcs or []:
        t = m.get("title") or {}
        return {"id": m.get("id"), "title": t.get("english") or t.get("romaji"),
                "cover": (m.get("coverImage") or {}).get("large")}
    return None


def _snippet(body, n=200):
    """A plain-text preview of a thread body: spoilers, media tokens and markup
    stripped so the list never leaks a spoiler or shows raw markdown."""
    if not body:
        return None
    t = re.sub(r"~!.*?!~", "", body, flags=re.S)            # drop spoiler blocks
    t = re.sub(r"<[^>]*>", " ", t)                            # raw HTML some posts carry
    t = re.sub(r"img\d*\(.*?\)", "", t, flags=re.I)           # drop image tokens
    t = re.sub(r"(youtube|webm|video)\(.*?\)", "", t, flags=re.I)
    t = re.sub(r"https?://\S+", "", t)                        # drop bare urls
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)            # [text](url) -> text
    t = re.sub(r"[#>*_~`]", "", t)                            # strip md punctuation
    t = re.sub(r"\s+", " ", t).strip()
    if not t:
        return None
    return (t[:n].rstrip() + "…") if len(t) > n else t


# The forum's order dial, as AniList ThreadSort lists.
THREAD_SORTS = {
    "active": "[IS_STICKY,REPLIED_AT_DESC]",
    "new": "[ID_DESC]",
    "replies": "[REPLY_COUNT_DESC]",
    "views": "[VIEW_COUNT_DESC]",
}


def forum_threads(category_id=None, media_id=None, search=None, spoiler=None, page=1, per_page=20,
                  subscribed=False, sort="active"):
    """Forum threads, optionally scoped to an AniList category, a specific anime
    (mediaCategory = the sub-category), and/or a text search. `spoiler` filters the
    list to 'safe' (hide spoilery) or 'only' (spoilery only). `subscribed` narrows
    to threads the viewer follows (needs the connected account). Returns
    {items, has_next}; each row carries who replied last, so the list can say
    "Kai replied 3h ago" rather than just a time."""
    decl = ["$page:Int", "$perPage:Int"]
    args = [f"sort:{THREAD_SORTS.get(sort, THREAD_SORTS['active'])}"]
    variables = {"page": page, "perPage": per_page}
    if subscribed:
        args.append("subscribed:true")
    if category_id:
        decl.append("$cat:Int"); args.append("categoryId:$cat"); variables["cat"] = int(category_id)
    if media_id:
        decl.append("$mid:Int"); args.append("mediaCategoryId:$mid"); variables["mid"] = int(media_id)
    if search:
        decl.append("$q:String"); args.append("search:$q"); variables["q"] = search
    query = (
        "query (" + ",".join(decl) + "){ Page(page:$page,perPage:$perPage){ pageInfo { hasNextPage }"
        " threads(" + ",".join(args) + "){"
        " id title body(asHtml:false) replyCount viewCount likeCount isLiked isSubscribed"
        " repliedAt createdAt isSticky isLocked"
        " categories { id name }"
        " mediaCategories { id title { romaji english } coverImage { large } } "
        + _USER + " replyUser { " + _PERSON + " } } } }"
    )

    def fetch():
        d = _post(query, variables)
        pg = d.get("Page") or {}
        out = []
        for t in pg.get("threads") or []:
            out.append({
                "id": t["id"], "title": t.get("title"), "snippet": _snippet(t.get("body")),
                "replies": t.get("replyCount"), "views": t.get("viewCount"),
                "replied_at": t.get("repliedAt"), "created_at": t.get("createdAt"),
                "sticky": bool(t.get("isSticky")), "locked": bool(t.get("isLocked")),
                "categories": [{"id": c["id"], "name": c["name"]} for c in (t.get("categories") or [])],
                "media": _first_media_category(t.get("mediaCategories")),
                "spoiler": bool(_SPOILER_RE.search(t.get("title") or "")),
                "likes": t.get("likeCount") or 0, "liked": bool(t.get("isLiked")),
                "subscribed": bool(t.get("isSubscribed")),
                "user": _norm_user(t.get("user")),
                "reply_user": _norm_user(t["replyUser"]) if t.get("replyUser") else None,
            })
        if spoiler == "safe":
            out = [x for x in out if not x["spoiler"]]
        elif spoiler == "only":
            out = [x for x in out if x["spoiler"]]
        return {"items": out, "has_next": bool((pg.get("pageInfo") or {}).get("hasNextPage"))}

    key = (f"anilist:threads:{category_id or 'all'}:{media_id or '-'}:"
           f"{(search or '').lower()}:{spoiler or '-'}:{'sub' if subscribed else '-'}:{sort}:{page}:v3")
    data, _ = cache.cached(key, config.TTL_ANILIST_THREADS, fetch)
    return data


def thread(thread_id, page=1, per_page=40):
    query = (
        "query ($id:Int,$page:Int,$perPage:Int){"
        " Thread(id:$id){ id title body(asHtml:true) replyCount viewCount likeCount isLiked"
        " isSticky isLocked isSubscribed siteUrl createdAt repliedAt categories { id name }"
        " mediaCategories { id title { romaji english } coverImage { large } } " + _USER
        + " replyUser { " + _PERSON + " } }"
        " Page(page:$page,perPage:$perPage){ pageInfo { hasNextPage total }"
        " threadComments(threadId:$id){"
        " id comment(asHtml:true) createdAt likeCount isLiked " + _USER + " childComments } } }"
    )

    def fetch():
        d = _post(query, {"id": thread_id, "page": page, "perPage": per_page})
        th = d.get("Thread") or {}
        return {
            "thread": {
                "id": th.get("id"), "title": th.get("title"), "body": th.get("body"),
                "created_at": th.get("createdAt"), "replies": th.get("replyCount"),
                "views": th.get("viewCount"), "likes": th.get("likeCount"), "liked": th.get("isLiked"),
                "sticky": bool(th.get("isSticky")), "locked": bool(th.get("isLocked")),
                "subscribed": bool(th.get("isSubscribed")), "site_url": th.get("siteUrl"),
                "categories": [{"id": c["id"], "name": c["name"]} for c in (th.get("categories") or [])],
                "media": _first_media_category(th.get("mediaCategories")),
                "user": _norm_user(th.get("user")),
                "reply_user": _norm_user(th["replyUser"]) if th.get("replyUser") else None,
                "replied_at": th.get("repliedAt"),
            },
            "comments": [_norm_comment(c) for c in (d.get("Page") or {}).get("threadComments", [])],
            "has_next": bool(((d.get("Page") or {}).get("pageInfo") or {}).get("hasNextPage")),
            "page": page,
        }

    data, _ = cache.cached(f"anilist:thread:{thread_id}:{page}:v3", 45, fetch)
    return data


def user_profile(name):
    """A public AniList user's profile: bio, anime stats, top genres, favorites."""
    query = (
        "query ($n:String){ User(name:$n){ id name siteUrl createdAt donatorTier donatorBadge bannerImage"
        " isFollowing isFollower previousNames { name }"
        " about(asHtml:false) aboutHtml: about(asHtml:true) avatar { large } options { profileColor }"
        " statistics { anime { count episodesWatched minutesWatched meanScore standardDeviation"
        " genres { genre count }"
        " statuses { status count } formats { format count } } }"
        " favourites {"
        " anime(perPage:12) { nodes { id title { romaji english } coverImage { large } } }"
        " characters(perPage:12) { nodes { id name { userPreferred } image { large } } }"
        " staff(perPage:12) { nodes { id name { userPreferred } image { large } } }"
        " studios(perPage:12) { nodes { id name } } } } }"
    )

    def fetch():
        d = _post(query, {"n": name})
        u = d.get("User")
        if not u:
            return None
        a = (u.get("statistics") or {}).get("anime") or {}
        genres = sorted(
            (a.get("genres") or []), key=lambda g: -(g.get("count") or 0))[:6]
        fav = u.get("favourites") or {}

        def nodes(k):
            return ((fav.get(k) or {}).get("nodes") or [])

        # Follow counts need the id, so they're a second (small) read. Non-fatal:
        # a profile without its counts is still a profile.
        counts = {}
        try:
            cd = _post(
                "query ($id:Int!){ a: Page(perPage:1){ pageInfo { total } following(userId:$id){ id } }"
                " b: Page(perPage:1){ pageInfo { total } followers(userId:$id){ id } } }",
                {"id": u["id"]},
            )
            counts = {"following": ((cd.get("a") or {}).get("pageInfo") or {}).get("total"),
                      "followers": ((cd.get("b") or {}).get("pageInfo") or {}).get("total")}
        except Exception:
            pass
        return {
            "id": u["id"], "name": u.get("name"), "avatar": (u.get("avatar") or {}).get("large"),
            "banner": u.get("bannerImage"), "color": (u.get("options") or {}).get("profileColor"),
            "about": u.get("about"), "about_html": u.get("aboutHtml"),
            "site_url": u.get("siteUrl"), "created_at": u.get("createdAt"),
            "donator": u.get("donatorTier") or 0, "donator_badge": u.get("donatorBadge"),
            "previous_names": [x["name"] for x in (u.get("previousNames") or []) if x and x.get("name")],
            "following_count": counts.get("following"), "followers_count": counts.get("followers"),
            "is_following": bool(u.get("isFollowing")), "is_follower": bool(u.get("isFollower")),
            "stats": {
                "count": a.get("count") or 0, "episodes": a.get("episodesWatched") or 0,
                "minutes": a.get("minutesWatched") or 0, "mean_score": a.get("meanScore") or 0,
                "std_dev": a.get("standardDeviation") or 0,
                "genres": [{"genre": g["genre"], "count": g["count"]} for g in genres],
                "statuses": [{"status": s["status"], "count": s["count"]}
                             for s in (a.get("statuses") or []) if s.get("status")],
                "formats": [{"format": s["format"], "count": s["count"]}
                            for s in (a.get("formats") or []) if s.get("format")],
            },
            "favourites": [
                {"id": n["id"],
                 "title": (n.get("title") or {}).get("english") or (n.get("title") or {}).get("romaji"),
                 "cover": (n.get("coverImage") or {}).get("large")}
                for n in nodes("anime")
            ],
            "favourite_characters": [
                {"id": n["id"], "name": (n.get("name") or {}).get("userPreferred"),
                 "image": (n.get("image") or {}).get("large")}
                for n in nodes("characters")
            ],
            "favourite_staff": [
                {"id": n["id"], "name": (n.get("name") or {}).get("userPreferred"),
                 "image": (n.get("image") or {}).get("large")}
                for n in nodes("staff")
            ],
            "favourite_studios": [{"id": n["id"], "name": n.get("name")} for n in nodes("studios")],
        }

    data, _ = cache.cached(f"anilist:user:v3:{name.lower()}", 600, fetch)
    return data


def _user_stats(u):
    a = ((u.get("statistics") or {}).get("anime") or {})
    return {"count": a.get("count") or 0, "mean": a.get("meanScore") or 0,
            "days": round((a.get("minutesWatched") or 0) / 1440, 1)}


def user_card(name):
    """A light read for the hover card that follows a username around the Social
    rooms: who they are, a line of numbers, and whether you follow each other."""
    query = (
        "query ($n:String){ User(name:$n){ id name bannerImage donatorTier isFollowing isFollower"
        " createdAt avatar { large } options { profileColor }"
        " statistics { anime { count meanScore minutesWatched } } } }"
    )

    def fetch():
        u = _post(query, {"n": name}).get("User")
        if not u:
            return None
        return {
            "id": u["id"], "name": u.get("name"), "avatar": (u.get("avatar") or {}).get("large"),
            "banner": u.get("bannerImage"), "color": (u.get("options") or {}).get("profileColor"),
            "donator": u.get("donatorTier") or 0, "created_at": u.get("createdAt"),
            "is_following": bool(u.get("isFollowing")), "is_follower": bool(u.get("isFollower")),
            "stats": _user_stats(u),
        }

    data, _ = cache.cached(f"anilist:user:card:{name.lower()}", 600, fetch)
    return data


def save_thread_comment(token, thread_id, text, parent_id=None):
    """Post a comment on a thread, or a reply to a comment when parent_id is given."""
    decl = ["$id:Int", "$c:String"]
    args = ["threadId:$id", "comment:$c"]
    variables = {"id": thread_id, "c": text}
    if parent_id:
        decl.append("$p:Int"); args.append("parentCommentId:$p"); variables["p"] = int(parent_id)
    d = _post(
        "mutation (" + ",".join(decl) + "){ SaveThreadComment(" + ",".join(args) + "){ id comment(asHtml:true) createdAt } }",
        variables, token=token,
    )
    cache.invalidate(f"anilist:thread:{thread_id}")
    return d.get("SaveThreadComment")


def media_card(media_id):
    """Minimal media info for an inline AniList link preview (anime or manga)."""
    query = ("query ($id:Int){ Media(id:$id){ id type format seasonYear"
             " coverImage { large } title { romaji english } } }")

    def fetch():
        m = _post(query, {"id": media_id}).get("Media")
        if not m:
            return None
        t = m.get("title") or {}
        return {"id": m["id"], "type": m.get("type"), "format": m.get("format"),
                "year": m.get("seasonYear"), "cover": (m.get("coverImage") or {}).get("large"),
                "title": t.get("english") or t.get("romaji")}

    data, _ = cache.cached(f"anilist:mediacard:{media_id}", 3600, fetch)
    return data


def _norm_activity(a):
    t = a.get("__typename")
    base = {
        "id": a.get("id"), "kind": t, "created_at": a.get("createdAt"),
        "likes": a.get("likeCount"), "liked": a.get("isLiked"),
        "replies": a.get("replyCount"), "user": _norm_user(a.get("user")),
    }
    if t == "TextActivity":
        base["text"] = a.get("text")
    elif t == "ListActivity":
        m = a.get("media") or {}
        title = (m.get("title") or {})
        base["status"] = a.get("status")
        base["progress"] = a.get("progress")
        base["media"] = {"id": m.get("id"), "type": m.get("type"),
                         "title": title.get("english") or title.get("romaji"),
                         "cover": (m.get("coverImage") or {}).get("large")}
    elif t == "MessageActivity":
        base["text"] = a.get("message")
        base["user"] = _norm_user(a.get("messenger"))
        base["recipient"] = _norm_user(a.get("recipient"))
        base["private"] = bool(a.get("isPrivate"))
    return base


# Which slice of the stream: status posts only, watching updates only, or
# "conversations" (posts plus any list update someone replied to — AniList's own
# default for its global feed, which otherwise drowns in bare progress bumps).
# This is the Anime room, so manga list updates never make the cut; a person's own
# stream (their profile) also carries the messages left on it.
ACTIVITY_KINDS = {
    "text": "type:TEXT",
    "list": "type_in:[ANIME_LIST]",
    "talk": "hasRepliesOrTypeText:true",
}


def _activity_filter(kind, own=False):
    types = "[TEXT,ANIME_LIST,MESSAGE]" if own else "[TEXT,ANIME_LIST]"
    if kind in ("text", "list"):
        return ACTIVITY_KINDS[kind]
    if kind == "talk":
        return ACTIVITY_KINDS["talk"] + ",type_in:" + types
    return "type_in:" + types


def activity_feed(media_id=None, page=1, per_page=25, following=False, user_id=None, kind=None):
    """The activity stream: global, one title's, the people you follow (`following`,
    needs the connected account), or one user's own (`user_id`, incl. messages),
    optionally narrowed by `kind` (see ACTIVITY_KINDS). Returns {items, has_next}."""
    decl, filt, variables = "$page:Int,$perPage:Int", "sort:ID_DESC", {"page": page, "perPage": per_page}
    filt += "," + _activity_filter(kind, own=bool(user_id))
    if media_id:
        decl += ",$mid:Int"
        filt += ",mediaId:$mid"
        variables["mid"] = media_id
    if following:
        filt += ",isFollowing:true"
    if user_id:
        decl += ",$uid:Int"
        filt += ",userId:$uid"
        variables["uid"] = int(user_id)
    query = (
        "query (" + decl + "){ Page(page:$page,perPage:$perPage){ pageInfo { hasNextPage }"
        " activities(" + filt + "){"
        " __typename"
        " ... on TextActivity { id type text(asHtml:true) createdAt likeCount isLiked replyCount " + _USER + " }"
        " ... on ListActivity { id type status progress createdAt likeCount isLiked replyCount " + _USER
        + " media { id type title { romaji english } coverImage { large } } }"
        " ... on MessageActivity { id type message(asHtml:true) createdAt likeCount isLiked replyCount"
        " isPrivate messenger { " + _PERSON + " } recipient { " + _PERSON + " } }"
        " } } }"
    )
    kinds = ("TextActivity", "ListActivity", "MessageActivity") if user_id else ("TextActivity", "ListActivity")

    def fetch():
        pg = _post(query, variables).get("Page") or {}
        return {
            "items": [_norm_activity(a) for a in pg.get("activities") or []
                      if a and a.get("__typename") in kinds],
            "has_next": bool((pg.get("pageInfo") or {}).get("hasNextPage")),
        }

    scope = media_id or ("following" if following else f"user{user_id}" if user_id else "global")
    data, _ = cache.cached(f"anilist:activity:{scope}:{kind or 'all'}:{page}:v4", 45, fetch)
    return data


def activity(activity_id):
    """One activity (a status, a list update or a profile message) — what an inbox
    notification points at, opened in place with its conversation."""
    query = (
        "query ($id:Int){ Activity(id:$id){ __typename"
        " ... on TextActivity { id type text(asHtml:true) createdAt likeCount isLiked replyCount " + _USER + " }"
        " ... on ListActivity { id type status progress createdAt likeCount isLiked replyCount " + _USER
        + " media { id type title { romaji english } coverImage { large } } }"
        " ... on MessageActivity { id type message(asHtml:true) createdAt likeCount isLiked replyCount"
        " isPrivate messenger { " + _PERSON + " } recipient { " + _PERSON + " } } } }"
    )

    def fetch():
        a = _post(query, {"id": int(activity_id)}).get("Activity")
        return _norm_activity(a) if a else None

    data, _ = cache.cached(f"anilist:activity:one:{activity_id}", 45, fetch)
    return data


def activity_replies(activity_id):
    query = (
        "query ($id:Int){ Page(perPage:40){ activityReplies(activityId:$id){"
        " id text(asHtml:true) createdAt likeCount isLiked " + _USER + " } } }"
    )

    def fetch():
        d = _post(query, {"id": activity_id})
        return [
            {"id": r["id"], "text": r.get("text"), "created_at": r.get("createdAt"),
             "likes": r.get("likeCount"), "liked": r.get("isLiked"), "user": _norm_user(r.get("user"))}
            for r in (d.get("Page") or {}).get("activityReplies", [])
        ]

    data, _ = cache.cached(f"anilist:areplies:{activity_id}:v2", 30, fetch)
    return data


def save_text_activity(token, text):
    d = _post("mutation ($t:String){ SaveTextActivity(text:$t){ id text(asHtml:true) createdAt } }", {"t": text}, token=token)
    cache.invalidate("anilist:activity:")
    return d.get("SaveTextActivity")


def delete_activity(token, activity_id):
    """Delete one of the viewer's own activities (a status, a list update, a message)."""
    d = _post("mutation ($id:Int){ DeleteActivity(id:$id){ deleted } }", {"id": activity_id}, token=token)
    cache.invalidate("anilist:activity:")
    return d.get("DeleteActivity")


def send_message(token, recipient_id, text, private=False):
    """Post a message on someone's profile (SaveMessageActivity)."""
    d = _post(
        "mutation ($r:Int,$m:String,$p:Boolean){ SaveMessageActivity(recipientId:$r, message:$m, private:$p){ id message(asHtml:true) createdAt } }",
        {"r": int(recipient_id), "m": text, "p": bool(private)}, token=token,
    )
    cache.invalidate("anilist:activity:")
    return d.get("SaveMessageActivity")


def delete_thread_comment(token, comment_id, thread_id=None):
    """Delete one of the viewer's own forum comments."""
    d = _post("mutation ($id:Int){ DeleteThreadComment(id:$id){ deleted } }", {"id": int(comment_id)}, token=token)
    cache.invalidate(f"anilist:thread:{thread_id}:" if thread_id else "anilist:thread:")
    cache.invalidate("anilist:threads:")
    return d.get("DeleteThreadComment")


def delete_activity_reply(token, reply_id, activity_id=None):
    """Delete one of the viewer's own replies on an activity."""
    d = _post("mutation ($id:Int){ DeleteActivityReply(id:$id){ deleted } }", {"id": int(reply_id)}, token=token)
    cache.invalidate(f"anilist:areplies:{activity_id}" if activity_id else "anilist:areplies:")
    cache.invalidate("anilist:activity:")
    return d.get("DeleteActivityReply")


def save_activity_reply(token, activity_id, text):
    d = _post("mutation ($id:Int,$t:String){ SaveActivityReply(activityId:$id, text:$t){ id text(asHtml:true) createdAt } }",
              {"id": activity_id, "t": text}, token=token)
    cache.invalidate(f"anilist:areplies:{activity_id}")
    return d.get("SaveActivityReply")


def toggle_like(token, like_id, like_type):
    d = _post("mutation ($id:Int,$t:LikeableType){ ToggleLikeV2(id:$id, type:$t){ __typename } }",
              {"id": like_id, "t": like_type}, token=token)
    return d.get("ToggleLikeV2")


def save_thread(token, title, body, category_ids=None, media_ids=None):
    """Start a forum thread, filed under categories and (optionally) anime."""
    decl, args = ["$t:String", "$b:String"], ["title:$t", "body:$b"]
    variables = {"t": title, "b": body}
    cats = [int(c) for c in category_ids or [] if c]
    mids = [int(m) for m in media_ids or [] if m]
    if cats:
        decl.append("$c:[Int]"); args.append("categories:$c"); variables["c"] = cats
    if mids:
        decl.append("$m:[Int]"); args.append("mediaCategories:$m"); variables["m"] = mids
    d = _post("mutation (" + ",".join(decl) + "){ SaveThread(" + ",".join(args) + "){ id } }",
              variables, token=token)
    cache.invalidate("anilist:threads:")
    return d.get("SaveThread")


def toggle_thread_subscription(token, thread_id, subscribe):
    d = _post(
        "mutation ($id:Int,$s:Boolean){ ToggleThreadSubscription(threadId:$id, subscribe:$s){ id isSubscribed } }",
        {"id": int(thread_id), "s": bool(subscribe)}, token=token,
    )
    cache.invalidate(f"anilist:thread:{thread_id}:")
    cache.invalidate("anilist:threads:")
    return {"subscribed": bool((d.get("ToggleThreadSubscription") or {}).get("isSubscribed"))}


# ── the airing timetable ─────────────────────────────────────────────────────

_SCHEDULE_MAX_PAGES = 12


def airing_schedule(start, end, token=None):
    """Every episode airing in [start, end) — unix seconds — in air-time order.

    A busy week is ~300 slots over ~6 pages. A page that fails after the first ends
    the walk with what arrived and is cached only briefly (flagged `partial`), so a
    rate-limit hiccup heals on the next look instead of leaving half a week drawn
    for half an hour."""
    start, end = int(start), int(end)
    query = (
        "query ($start:Int,$end:Int,$page:Int){ Page(page:$page,perPage:50){"
        " pageInfo{ hasNextPage }"
        " airingSchedules(airingAt_greater:$start, airingAt_lesser:$end, sort:[TIME]){"
        " id airingAt episode media {" + _MEDIA + "} } } }"
    )

    def fetch():
        out, partial = [], False
        for page in range(1, _SCHEDULE_MAX_PAGES + 1):
            if page > 1 and not _budget(min_left=4):
                partial = True
                break
            try:
                # airingAt_greater is strict; step back one so `start` itself counts
                d = _post(query, {"start": start - 1, "end": end, "page": page}, token=token)
            except Exception:
                if page == 1:
                    raise
                partial = True
                break
            pg = d.get("Page") or {}
            for s in pg.get("airingSchedules") or []:
                m = norm_media(s.get("media"))
                if not m or m.get("adult"):
                    continue
                out.append({"id": s["id"], "airing_at": s["airingAt"], "episode": s["episode"], "media": m})
            if not (pg.get("pageInfo") or {}).get("hasNextPage"):
                break
        ttl = config.TTL_ANILIST_EMPTY if (partial or not out) else config.TTL_ANILIST_SCHEDULE
        return {"items": out, "partial": partial}, ttl

    auth = "auth" if token else "anon"
    return cache.cached_dynamic(f"anilist:schedule:{auth}:{start}:{end}", fetch)


# ── the season chart ─────────────────────────────────────────────────────────

_CHART_EXTRA = " hashtag externalLinks { site url type icon color language }"


def _norm_chart(m):
    """A season-chart card: the usual media dict plus the show's hashtag and the
    services it streams on (the chart's "where do I watch this" row)."""
    base = norm_media(m)
    if not base:
        return None
    base["hashtag"] = m.get("hashtag")
    base["streams"] = [
        {"site": l.get("site"), "url": l.get("url"), "icon": l.get("icon"),
         "color": l.get("color"), "language": l.get("language")}
        for l in (m.get("externalLinks") or [])
        if l.get("type") == "STREAMING" and l.get("url")
    ]
    return base


def _all_pages(query, variables, token, max_pages, norm):
    out = []
    for page in range(1, max_pages + 1):
        d = _post(query, {**variables, "page": page}, token=token)
        pg = d.get("Page") or {}
        out.extend(x for x in (norm(m) for m in pg.get("media") or []) if x)
        if not (pg.get("pageInfo") or {}).get("hasNextPage"):
            break
    return out


def season_chart(season, year, token=None):
    """One season's whole lineup, AniChart-style, plus its leftovers.

    Leftovers are TV/ONA shows still airing that began in the two seasons before
    this one — the split-cour carry-overs. Long-runners (a 1999 show still on air)
    aren't a season's leftovers, and without the lower bound they drown the shelf.
    Only meaningful for the season on air *now*, so only computed for it."""
    season = season if season in SEASONS else _current_season()[0]
    year = int(year)
    sel = _MEDIA + _CHART_EXTRA
    q_main = (
        "query ($season:MediaSeason,$year:Int,$page:Int){ Page(page:$page,perPage:50){"
        " pageInfo{ hasNextPage }"
        " media(season:$season, seasonYear:$year, type:ANIME, isAdult:false, sort:[POPULARITY_DESC]){"
        + sel + "} } }"
    )
    q_left = (
        "query ($after:FuzzyDateInt,$before:FuzzyDateInt,$page:Int){ Page(page:$page,perPage:50){"
        " pageInfo{ hasNextPage }"
        " media(type:ANIME, isAdult:false, status:RELEASING, startDate_greater:$after,"
        " startDate_lesser:$before, format_in:[TV, TV_SHORT, ONA], sort:[POPULARITY_DESC]){"
        + sel + "} } }"
    )
    is_current = (season, year) == _current_season()

    def fetch():
        items = _all_pages(q_main, {"season": season, "year": year}, token, 8, _norm_chart)
        leftovers = []
        if is_current:
            back2 = _prev_season(*_prev_season(season, year))
            try:
                leftovers = _all_pages(
                    q_left, {"after": _season_start(*back2) - 1, "before": _season_start(season, year)},
                    token, 1, _norm_chart)
            except Exception:
                leftovers = []  # the lineup matters more than its carry-overs
        payload = {"season": season, "year": year, "current": is_current,
                   "items": items, "leftovers": leftovers}
        return payload, (config.TTL_ANILIST_BROWSE if items else config.TTL_ANILIST_EMPTY)

    auth = "auth" if token else "anon"
    return cache.cached_dynamic(f"anilist:season:{auth}:{season}:{year}", fetch)


# ── detail extras (below the fold) ───────────────────────────────────────────

def media_extras(media_id):
    """Everything the detail page shows below its header, in a second request.

    Kept apart from media() on purpose: AniList scores query complexity, and cast +
    relations + recommendations + all of this in one document courts its limit.
    Split, the header paints from the first call while these fill in, and a failure
    here never costs the page its header."""
    query = (
        "query ($id:Int){ Media(id:$id){ id"
        " synonyms hashtag siteUrl meanScore trending favourites isLicensed"
        " source(version:3) countryOfOrigin"
        " startDate { year month day } endDate { year month day }"
        " rankings { rank type format year season allTime context }"
        " stats { scoreDistribution { score amount } statusDistribution { status amount } }"
        " studios { edges { isMain node { id name isAnimationStudio } } }"
        " staff(sort:[RELEVANCE,ID], perPage:25){ edges { role"
        " node { id name { userPreferred native } image { large } } } }"
        " airingSchedule(notYetAired:true, perPage:12){ nodes { episode airingAt } }"
        " trends(sort:[DATE_DESC], perPage:60){ nodes { date trending averageScore popularity inProgress episode } }"
        " reviews(sort:[RATING_DESC], perPage:6){ nodes { id summary score rating ratingAmount createdAt"
        " user { id name avatar { large } } } }"
        " externalLinks { site url type icon color language notes }"
        " } }"
    )

    def fetch():
        m = _post(query, {"id": media_id}).get("Media")
        if not m:
            return None
        stats = m.get("stats") or {}
        staff = []
        for e in ((m.get("staff") or {}).get("edges") or []):
            n = e.get("node") or {}
            if not n.get("id"):
                continue
            nm = n.get("name") or {}
            staff.append({"id": n["id"], "name": nm.get("userPreferred"), "native": nm.get("native"),
                          "image": (n.get("image") or {}).get("large"), "role": e.get("role")})
        return {
            "id": m["id"],
            "synonyms": [s for s in (m.get("synonyms") or []) if s],
            "hashtag": m.get("hashtag"),
            "site_url": m.get("siteUrl"),
            "mean_score": m.get("meanScore"),
            "trending": m.get("trending"),
            "favourites": m.get("favourites"),
            "licensed": m.get("isLicensed"),
            "source": m.get("source"),
            "country": m.get("countryOfOrigin"),
            "start": _fuzzy_year(m.get("startDate")),
            "end": _fuzzy_year(m.get("endDate")),
            "rankings": [
                {"rank": r.get("rank"), "type": r.get("type"), "context": r.get("context"),
                 "year": r.get("year"), "season": r.get("season"),
                 "all_time": bool(r.get("allTime")), "format": r.get("format")}
                for r in (m.get("rankings") or []) if r
            ],
            "score_dist": sorted(
                ({"score": s["score"], "amount": s.get("amount") or 0}
                 for s in (stats.get("scoreDistribution") or []) if s.get("score") is not None),
                key=lambda s: s["score"]),
            "status_dist": [
                {"status": s["status"], "amount": s.get("amount") or 0}
                for s in (stats.get("statusDistribution") or []) if s.get("status")],
            "studios": [
                {"id": (e.get("node") or {}).get("id"), "name": (e.get("node") or {}).get("name"),
                 "main": bool(e.get("isMain")),
                 "animation": bool((e.get("node") or {}).get("isAnimationStudio"))}
                for e in ((m.get("studios") or {}).get("edges") or []) if (e.get("node") or {}).get("id")
            ],
            "staff": staff,
            "schedule": [
                {"episode": n.get("episode"), "airing_at": n.get("airingAt")}
                for n in ((m.get("airingSchedule") or {}).get("nodes") or []) if n
            ],
            # oldest → newest, so a chart reads left to right
            "trends": sorted(
                ({"date": n["date"], "trending": n.get("trending"), "score": n.get("averageScore"),
                  "popularity": n.get("popularity"), "watching": n.get("inProgress"),
                  "episode": n.get("episode")}
                 for n in ((m.get("trends") or {}).get("nodes") or []) if n and n.get("date")),
                key=lambda t: t["date"]),
            "reviews": [
                {"id": r["id"], "summary": r.get("summary"), "score": r.get("score"),
                 "rating": r.get("rating") or 0, "rating_amount": r.get("ratingAmount") or 0,
                 "created_at": r.get("createdAt"), "user": _norm_user(r.get("user"))}
                for r in ((m.get("reviews") or {}).get("nodes") or []) if r
            ],
            "links": [
                {"site": l.get("site"), "url": l.get("url"), "type": l.get("type"),
                 "icon": l.get("icon"), "color": l.get("color"),
                 "language": l.get("language"), "notes": l.get("notes")}
                for l in (m.get("externalLinks") or []) if l.get("url")
            ],
        }

    data, _ = cache.cached(f"anilist:extras:{media_id}", config.TTL_ANILIST_MEDIA, fetch)
    return data


# ── relations: the franchise walk + the sequel radar ─────────────────────────

_REL_NODE = (
    "id type format status episodes duration isAdult"
    " title { romaji english native } coverImage { large color }"
    " startDate { year month day } season seasonYear"
    " nextAiringEpisode { episode airingAt }"
)
_REL_CHUNK = 25


def _norm_rel_node(n):
    """A lightweight media dict for relation walks (no description/studios/list)."""
    if not n or not n.get("id"):
        return None
    t = n.get("title") or {}
    sd = n.get("startDate") or {}
    cover = n.get("coverImage") or {}
    nxt = n.get("nextAiringEpisode") or {}
    return {
        "id": n["id"], "type": n.get("type"), "format": n.get("format"),
        "status": n.get("status"), "episodes": n.get("episodes"),
        "duration": n.get("duration"), "adult": bool(n.get("isAdult")),
        "title": t.get("english") or t.get("romaji") or t.get("native") or "Untitled",
        "title_romaji": t.get("romaji"),
        "cover": cover.get("large"), "color": cover.get("color"),
        "start": [sd.get("year"), sd.get("month"), sd.get("day")],
        "year": n.get("seasonYear") or sd.get("year"), "season": n.get("season"),
        "next_episode": nxt.get("episode"), "next_airing_at": nxt.get("airingAt"),
    }


def relations_batch(ids):
    """{media_id: {"self": node, "edges": [{relation, media}]}} for every id that
    exists. Each title's edges are cached on their own for half a day and the misses
    are fetched `id_in` 25 at a time — the sequel radar and the watch-order guide
    both walk this, so a franchise explored once is instant from any of its entries.

    A chunk failing after the first stops the walk with what arrived (the rest
    simply stays uncached), so one rate-limit doesn't throw away a good batch."""
    keys = {f"anilist:rel:{int(i)}": int(i) for i in ids if i}
    query = (
        "query ($ids:[Int]){ Page(perPage:" + str(_REL_CHUNK) + "){ media(id_in:$ids){ " + _REL_NODE
        + " relations { edges { relationType(version:2) node { " + _REL_NODE + " } } } } } }"
    )

    def fetch_missing(missing):
        mids = [keys[k] for k in missing]
        out = {}
        for i in range(0, len(mids), _REL_CHUNK):
            if i and not _budget():
                break  # leave the rest for a later visit; what's fetched is kept
            try:
                d = _post(query, {"ids": mids[i:i + _REL_CHUNK]})
            except Exception:
                if i == 0:
                    raise
                break
            for m in (d.get("Page") or {}).get("media") or []:
                out[f"anilist:rel:{m['id']}"] = {
                    "self": _norm_rel_node(m),
                    "edges": [
                        {"relation": e.get("relationType"), "media": _norm_rel_node(e.get("node"))}
                        for e in ((m.get("relations") or {}).get("edges") or []) if e.get("node")
                    ],
                }
        return out

    got = cache.cached_many(list(keys), config.TTL_ANILIST_RELATIONS, fetch_missing)
    return {keys[k]: v for k, v in got.items()}


# Relation edges that keep you inside one franchise. CHARACTER (crossover cameos)
# and OTHER (music videos, commercials) are left out: following them turns one
# series into half the medium. ADAPTATION/SOURCE point at manga.
_FRANCHISE_EDGES = {
    "PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE",
    "SUMMARY", "COMPILATION", "CONTAINS",
}
_MAINLINE_FORMATS = {"TV", "TV_SHORT", "ONA", "MOVIE"}


def _start_key(node):
    y, m, d = (list(node.get("start") or []) + [None, None, None])[:3]
    return (y or 9999, m or 13, d or 32, node.get("id") or 0)


def _franchise_kind(relations):
    """Label an off-main-line entry by how the franchise points at it."""
    if relations & {"SUMMARY", "COMPILATION"}:
        return "recap"
    if "ALTERNATIVE" in relations:
        return "alternative"
    if "SPIN_OFF" in relations:
        return "spin-off"
    return "side"


def build_franchise(root_id, graph):
    """Order a franchise into a watch guide. Pure — `graph` is {id: {"self",
    "edges"}} as relations_batch returns it, for whatever the walk reached.

    The *main line* is the biggest cluster of TV/ONA/movie entries joined by
    SEQUEL/PREQUEL edges (most episodes wins; ties go to the cluster holding the
    root), so opening an OVA still finds the series it hangs off. Everything else is
    labelled by how the franchise points at it: recap, alternative version, spin-off
    or side story. Release order throughout — what most watch guides settle on, and
    the only order the data can actually back."""
    nodes, incoming = {}, {}
    for mid, rec in graph.items():
        if rec.get("self"):
            nodes[mid] = rec["self"]
    for mid, rec in graph.items():
        for e in rec.get("edges") or []:
            n = e.get("media")
            if (not n or n.get("type") != "ANIME" or n.get("adult")
                    or e.get("relation") not in _FRANCHISE_EDGES):
                continue
            nodes.setdefault(n["id"], n)
            incoming.setdefault(n["id"], set()).add(e["relation"])
    if root_id not in nodes:
        return []

    adj = {i: set() for i, n in nodes.items() if n.get("format") in _MAINLINE_FORMATS}
    for mid, rec in graph.items():
        if mid not in adj:
            continue
        for e in rec.get("edges") or []:
            n = e.get("media")
            if n and e.get("relation") in ("SEQUEL", "PREQUEL") and n["id"] in adj:
                adj[mid].add(n["id"])
                adj[n["id"]].add(mid)
    comps, seen = [], set()
    for i in adj:
        if i in seen:
            continue
        comp, stack = set(), [i]
        while stack:
            x = stack.pop()
            if x not in comp:
                comp.add(x)
                stack.extend(adj[x] - comp)
        seen |= comp
        comps.append(comp)
    main = max(
        comps,
        key=lambda c: (sum(nodes[x].get("episodes") or 1 for x in c), root_id in c, len(c)),
    ) if comps else {root_id}

    to_root = {}
    for e in (graph.get(root_id) or {}).get("edges") or []:
        if e.get("media"):
            to_root.setdefault(e["media"]["id"], e.get("relation"))

    items = []
    for mid, n in nodes.items():
        if mid in main:
            kind = "main"
        elif n.get("format") == "MUSIC":
            kind = "extra"
        else:
            kind = _franchise_kind(incoming.get(mid, set()))
        items.append({**n, "kind": kind, "is_root": mid == root_id, "relation": to_root.get(mid)})
    items.sort(key=_start_key)
    return items


def franchise(media_id, max_nodes=60, max_depth=8):
    """Walk a title's franchise breadth-first (one batched request per ring) and
    return it ordered as a watch guide. `truncated` says the walk hit its caps —
    the guide is still right about everything it shows."""
    media_id = int(media_id)
    graph, seen, frontier = {}, {media_id}, [media_id]
    truncated = False
    for _ in range(max_depth):
        if not frontier:
            break
        batch = relations_batch(frontier)
        nxt = []
        for mid in frontier:
            rec = batch.get(mid)
            if not rec:
                continue
            graph[mid] = rec
            for e in rec["edges"]:
                n = e.get("media")
                if (not n or n.get("type") != "ANIME" or n.get("adult")
                        or e.get("relation") not in _FRANCHISE_EDGES or n["id"] in seen):
                    continue
                if len(seen) >= max_nodes:
                    truncated = True
                    continue
                seen.add(n["id"])
                nxt.append(n["id"])
        frontier = nxt
    if frontier:
        truncated = True
    return {"root": media_id, "items": build_franchise(media_id, graph), "truncated": truncated}


# Which relations count as "what's next" for the radar, and what to call them.
_RADAR_RELATIONS = {"SEQUEL": "sequel", "SIDE_STORY": "side", "SPIN_OFF": "spin-off"}
_RADAR_MAX_SEEDS = 300


def find_sequels(seed_media, rels, listed):
    """Pure: from finished titles and their relation edges, what comes next that
    isn't on your list at all — grouped by where it stands.

    `seed_media` are the finished titles (dicts with id/title/cover), `rels` is
    relations_batch output, `listed` every media id already on the list (any
    status — something you're *planning* isn't news)."""
    found = {}
    for sm in seed_media:
        rec = rels.get(sm["id"])
        if not rec:
            continue
        for e in rec.get("edges") or []:
            kind = _RADAR_RELATIONS.get(e.get("relation"))
            n = e.get("media")
            if (not kind or not n or n.get("type") != "ANIME" or n.get("adult")
                    or n["id"] in listed or n.get("format") == "MUSIC"
                    or n.get("status") == "CANCELLED"):
                continue
            row = found.get(n["id"])
            if row is None:
                row = found[n["id"]] = {"media": n, "kind": kind, "after": []}
            elif kind == "sequel":
                row["kind"] = "sequel"  # a sequel of anything outranks a side-story label
            if len(row["after"]) < 3 and all(a["id"] != sm["id"] for a in row["after"]):
                row["after"].append({"id": sm["id"], "title": sm.get("title"), "cover": sm.get("cover")})

    out_now, coming, paused = [], [], []
    for row in found.values():
        st = row["media"].get("status")
        if st in ("FINISHED", "RELEASING"):
            out_now.append(row)
        elif st == "NOT_YET_RELEASED":
            coming.append(row)
        else:
            paused.append(row)  # HIATUS
    # Out now: sequels before side stories, newest first. Coming: soonest first
    # (a scheduled next episode beats a bare start date; unknown dates last).
    out_now.sort(key=lambda r: (r["kind"] != "sequel", tuple(-(x or 0) for x in _start_key(r["media"])[:3])))
    coming.sort(key=lambda r: (r["kind"] != "sequel", r["media"].get("next_airing_at") or 1e12,
                               _start_key(r["media"])))
    return {"out_now": out_now, "coming": coming, "paused": paused}


# ── the curtain call: what the screen after a finished series needs ──────────

_SEQUEL_SKIP_FORMATS = {"MUSIC"}


def pick_sequel(edges, seen=()):
    """Pure: from one title's relation edges, the SEQUEL that carries the story on
    — an anime that isn't adult, a music video, cancelled, or already walked.
    Main-line formats (TV, TV short, ONA, movie) beat OVAs and specials; among
    those the earliest start wins. None when the story stops here."""
    cands = []
    for e in edges or []:
        n = e.get("media")
        if (e.get("relation") != "SEQUEL" or not n or n.get("type") != "ANIME" or n.get("adult")
                or n.get("format") in _SEQUEL_SKIP_FORMATS or n.get("status") == "CANCELLED"
                or n["id"] in seen):
            continue
        cands.append(n)
    if not cands:
        return None
    cands.sort(key=lambda n: (n.get("format") not in _MAINLINE_FORMATS, _start_key(n)))
    return cands[0]


def sequel_chain(media_id, limit=3):
    """The next `limit` entries of the story after `media_id`, following SEQUEL
    links one hop at a time through relations_batch (cached per title, so a walk
    done once is free after). Stops early when AniList's budget runs low."""
    chain, seen, cur = [], {int(media_id)}, int(media_id)
    for step in range(limit):
        if step and not _budget():
            break
        rec = relations_batch([cur]).get(cur)
        nxt = pick_sequel((rec or {}).get("edges"), seen)
        if not nxt:
            break
        chain.append(nxt)
        seen.add(nxt["id"])
        cur = nxt["id"]
    return chain


def match_episode_thread(threads, episode):
    """Pure: the thread among `threads` (newest first) that discusses `episode` —
    AniList's release threads read "[Spoilers] Title - Episode 12 Discussion". A
    title naming the episode wins over one that merely says "Episode 12" somewhere
    else in a longer number ("Episode 120")."""
    if not episode:
        return None
    pat = re.compile(rf"\bep(?:isode)?\.?\s*0*{int(episode)}(?!\d)", re.I)
    hits = [t for t in threads or [] if pat.search(t.get("title") or "")]
    if not hits:
        return None
    hits.sort(key=lambda t: ("discussion" not in (t.get("title") or "").lower(), -(t.get("replyCount") or 0)))
    return hits[0]


def episode_thread(media_id, episode):
    """The forum thread for one episode of a title (its release discussion), or
    None. Cached; a miss is kept only briefly, since threads appear as it airs."""
    query = (
        "query ($m:Int,$q:String,$cat:Int){ Page(perPage:25){ threads(mediaCategoryId:$m, categoryId:$cat,"
        " search:$q, sort:[CREATED_AT_DESC]){ id title replyCount viewCount createdAt repliedAt isLocked } } }"
    )

    def fetch():
        found = None
        for cat, q in ((5, None), (None, f"Episode {episode}")):
            variables = {"m": int(media_id)}
            if cat:
                variables["cat"] = cat
            if q:
                variables["q"] = q
            rows = ((_post(query, variables).get("Page") or {}).get("threads")) or []
            found = match_episode_thread(rows, episode)
            if found:
                break
        if not found:
            return None, config.TTL_ANILIST_EMPTY
        return {
            "id": found["id"], "title": (found.get("title") or "").strip(), "replies": found.get("replyCount") or 0,
            "views": found.get("viewCount") or 0, "created_at": found.get("createdAt"),
            "replied_at": found.get("repliedAt"), "locked": bool(found.get("isLocked")),
            "spoiler": bool(_SPOILER_RE.search(found.get("title") or "")),
        }, config.TTL_ANILIST_THREADS

    return cache.cached_dynamic(f"anilist:epthread:{int(media_id)}:{int(episode)}", fetch)


def finale(token, media_id):
    """Everything the curtain-call screen shows once you've finished a title: the
    title and your entry, your score format, the last episode's discussion, and
    what comes next in the story (up to three sequels, each with where it sits on
    your list). Mostly cache hits — media(), viewer() and user_lists() are shared
    with the rest of the room, relation walks are cached per title."""
    m = media(media_id, token=token)
    if not m:
        return None
    score_format = viewer(token).get("score_format") or "POINT_10"
    entry = m.get("list_entry") or {}
    last_ep = m.get("episodes") or entry.get("progress")
    try:
        thread_row = episode_thread(media_id, last_ep) if last_ep else None
    except Exception:
        thread_row = None
    try:
        chain = sequel_chain(media_id)
    except Exception:
        chain = []
    on_list = {}
    if chain:
        try:
            for lst in user_lists(token):
                for e in lst.get("entries") or []:
                    mid = (e.get("media") or {}).get("id")
                    if mid and not lst.get("custom"):
                        on_list[mid] = {"status": e.get("status"), "progress": e.get("progress"),
                                        "entry_id": e.get("entry_id")}
        except Exception:
            pass
    keep = ("id", "title", "title_romaji", "title_native", "cover", "cover_xl", "color", "banner",
            "format", "status", "episodes", "duration", "genres", "score", "season", "year",
            "start_date", "end_date", "studios", "list_entry")
    return {
        "media": {k: m.get(k) for k in keep},
        "score_format": score_format,
        "episode": last_ep,
        "thread": thread_row,
        "sequels": [{**n, "list": on_list.get(n["id"])} for n in chain],
    }


def sequel_radar(token, max_seeds=_RADAR_MAX_SEEDS):
    """Sequels, side stories and spin-offs of everything you've finished that
    aren't on your list yet — the most-requested thing AniList doesn't do itself.
    Seeds are your completed/rewatching titles, most recently touched first, capped
    so a vast list costs a bounded number of (cached) requests."""
    lists = user_lists(token)
    listed, seeds = set(), {}
    for g in lists:
        for e in g.get("entries") or []:
            m = e["media"]
            listed.add(m["id"])
            if e.get("status") in ("COMPLETED", "REPEATING"):
                prev = seeds.get(m["id"])
                if prev is None or (e.get("updated_at") or 0) > prev[0]:
                    seeds[m["id"]] = (e.get("updated_at") or 0, m)
    ordered = [m for _, m in sorted(seeds.values(), key=lambda x: -x[0])][:max_seeds]
    rels = relations_batch([m["id"] for m in ordered])
    return {**find_sequels(ordered, rels, listed), "scanned": len(rels), "finished": len(seeds)}


# ── characters, studios, people search ───────────────────────────────────────

def character(char_id, token=None):
    """A character's page: vitals, bio, and every anime they appear in with the
    voices that played them there (all dubs — the client offers the switch)."""
    query = (
        "query ($id:Int){ Character(id:$id){ id"
        " name { userPreferred native full alternative alternativeSpoiler }"
        " image { large } description(asHtml:false) gender age bloodType"
        " dateOfBirth { year month day } favourites isFavourite siteUrl"
        " media(sort:[POPULARITY_DESC], type:ANIME, perPage:40){ edges { characterRole"
        " voiceActorRoles(sort:[RELEVANCE,ID]){ roleNotes dubGroup"
        " voiceActor { id name { userPreferred native } image { large } languageV2 } }"
        " node {" + _MEDIA + "} } } } }"
    )

    def fetch():
        c = _post(query, {"id": char_id}, token=token).get("Character")
        if not c:
            return None
        nm = c.get("name") or {}
        apps = []
        for e in ((c.get("media") or {}).get("edges") or []):
            media = norm_media(e.get("node"))
            if not media or media.get("adult"):
                continue
            voices = []
            for r in e.get("voiceActorRoles") or []:
                va = r.get("voiceActor") or {}
                if not va.get("id"):
                    continue
                vn = va.get("name") or {}
                voices.append({
                    "id": va["id"], "name": vn.get("userPreferred"), "native": vn.get("native"),
                    "image": (va.get("image") or {}).get("large"), "language": va.get("languageV2"),
                    "notes": r.get("roleNotes"), "dub_group": r.get("dubGroup"),
                })
            apps.append({"role": e.get("characterRole"), "media": media, "voices": voices})
        return {
            "id": c["id"],
            "name": nm.get("userPreferred") or nm.get("full"),
            "native": nm.get("native"),
            "aliases": [a for a in (nm.get("alternative") or []) if a],
            # names that give the plot away; the client keeps them behind a reveal
            "spoiler_aliases": [a for a in (nm.get("alternativeSpoiler") or []) if a],
            "image": (c.get("image") or {}).get("large"),
            "description": c.get("description"),
            "gender": c.get("gender"),
            "age": c.get("age"),
            "blood_type": c.get("bloodType"),
            "birth": _fuzzy_year(c.get("dateOfBirth")),
            "favourites": c.get("favourites"),
            "is_favourite": bool(c.get("isFavourite")),
            "site_url": c.get("siteUrl"),
            "appearances": apps,
        }

    data, _ = cache.cached(f"anilist:character:{char_id}", config.TTL_ANILIST_PEOPLE, fetch)
    return data


_STUDIO_SORTS = {"newest": "START_DATE_DESC", "popular": "POPULARITY_DESC", "score": "SCORE_DESC"}


def studio(studio_id, page=1, main_only=False, sort="newest", token=None):
    """A studio and one page of its filmography. `main_only` keeps the shows it
    actually animated (it's also credited as producer on plenty it didn't)."""
    margs = f"sort:[{_STUDIO_SORTS.get(sort, 'START_DATE_DESC')}], page:$page, perPage:40"
    if main_only:
        margs += ", isMain:true"
    query = (
        "query ($id:Int,$page:Int){ Studio(id:$id){ id name isAnimationStudio favourites"
        " isFavourite siteUrl"
        " media(" + margs + "){ pageInfo { hasNextPage total }"
        " edges { isMainStudio node {" + _MEDIA + "} } } } }"
    )

    def fetch():
        st = _post(query, {"id": studio_id, "page": page}, token=token).get("Studio")
        if not st:
            return None
        conn = st.get("media") or {}
        items = []
        for e in conn.get("edges") or []:
            m = norm_media(e.get("node"))
            if m and not m.get("adult"):
                items.append({**m, "main": bool(e.get("isMainStudio"))})
        return {
            "studio": {
                "id": st["id"], "name": st.get("name"),
                "animation": bool(st.get("isAnimationStudio")),
                "favourites": st.get("favourites"), "is_favourite": bool(st.get("isFavourite")),
                "site_url": st.get("siteUrl"),
                "total": (conn.get("pageInfo") or {}).get("total"),
            },
            "items": items,
            "has_next": bool((conn.get("pageInfo") or {}).get("hasNextPage")),
        }

    key = f"anilist:studio:{studio_id}:{page}:{'main' if main_only else 'all'}:{sort}"
    data, _ = cache.cached(key, config.TTL_ANILIST_PEOPLE, fetch)
    return data


# One entry per searchable kind: Page field, its sort enum, the order to use with
# no query (None = a query is required), and the selection.
_PEOPLE = {
    "characters": (
        "characters", "CharacterSort", "FAVOURITES_DESC",
        "id name { userPreferred native } image { large } favourites"
        " media(perPage:1, sort:[POPULARITY_DESC]){ nodes { id type title { romaji english } } }"),
    "staff": (
        "staff", "StaffSort", "FAVOURITES_DESC",
        "id name { userPreferred native } image { large } favourites primaryOccupations languageV2"),
    "studios": (
        "studios", "StudioSort", "FAVOURITES_DESC",
        "id name isAnimationStudio favourites"
        " media(isMain:true, sort:[POPULARITY_DESC], perPage:4){ nodes { id isAdult"
        " title { romaji english } coverImage { large color } } }"),
    "users": (
        "users", "UserSort", None,
        "id name avatar { large } bannerImage options { profileColor } donatorTier isFollowing isFollower"
        " statistics { anime { count meanScore minutesWatched } }"),
}


def _norm_person(kind, r):
    if not r or not r.get("id"):
        return None
    if kind == "users":
        return {"id": r["id"], "name": r.get("name"), "avatar": (r.get("avatar") or {}).get("large"),
                "banner": r.get("bannerImage"), "color": (r.get("options") or {}).get("profileColor"),
                "donator": r.get("donatorTier") or 0, "stats": _user_stats(r),
                "is_following": bool(r.get("isFollowing")), "is_follower": bool(r.get("isFollower"))}
    if kind == "studios":
        works = []
        for n in ((r.get("media") or {}).get("nodes") or []):
            if not n or n.get("isAdult"):
                continue
            t = n.get("title") or {}
            works.append({"id": n["id"], "title": t.get("english") or t.get("romaji"),
                          "cover": (n.get("coverImage") or {}).get("large"),
                          "color": (n.get("coverImage") or {}).get("color")})
        return {"id": r["id"], "name": r.get("name"), "animation": bool(r.get("isAnimationStudio")),
                "favourites": r.get("favourites"), "works": works}
    nm = r.get("name") or {}
    out = {"id": r["id"], "name": nm.get("userPreferred"), "native": nm.get("native"),
           "image": (r.get("image") or {}).get("large"), "favourites": r.get("favourites")}
    if kind == "characters":
        first = ((r.get("media") or {}).get("nodes") or [None])[0] or {}
        t = first.get("title") or {}
        out["from"] = ({"id": first.get("id"), "type": first.get("type"),
                        "title": t.get("english") or t.get("romaji")} if first.get("id") else None)
    else:
        out["occupations"] = r.get("primaryOccupations") or []
        out["language"] = r.get("languageV2")
    return out


def people(kind, q=None, page=1, per_page=30):
    """Search (or, with no query, the most-favourited of) characters, staff,
    studios or users — the finder's non-anime modes and the hall-of-fame shelves."""
    if kind not in _PEOPLE:
        raise ValueError(f"unknown kind {kind!r}")
    field, sort_t, default_sort, sel = _PEOPLE[kind]
    q = (q or "").strip() or None
    if not q and not default_sort:
        return {"items": [], "has_next": False}
    decl = ["$page:Int", "$perPage:Int", f"$sort:[{sort_t}]"]
    args = ["sort:$sort"]
    variables = {"page": page, "perPage": per_page, "sort": ["SEARCH_MATCH" if q else default_sort]}
    if q:
        decl.append("$search:String"); args.append("search:$search"); variables["search"] = q
    query = (
        "query (" + ",".join(decl) + "){ Page(page:$page,perPage:$perPage){ pageInfo { hasNextPage } "
        + field + "(" + ",".join(args) + "){ " + sel + " } } }"
    )

    def fetch():
        pg = _post(query, variables).get("Page") or {}
        items = [x for x in (_norm_person(kind, r) for r in pg.get(field) or []) if x]
        payload = {"items": items, "has_next": bool((pg.get("pageInfo") or {}).get("hasNextPage"))}
        ttl = (config.TTL_ANILIST_SEARCH if q else config.TTL_ANILIST_PEOPLE) if items else config.TTL_ANILIST_EMPTY
        return payload, ttl

    return cache.cached_dynamic(f"anilist:people:{kind}:{(q or '').lower()}:{page}:v2", fetch)


def birthdays():
    """Characters and people whose birthday is today (AniList's day), most loved first."""
    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    query = (
        "query { chars: Page(perPage:24){ characters(isBirthday:true, sort:[FAVOURITES_DESC]){ "
        + _PEOPLE["characters"][3] + " } }"
        " folks: Page(perPage:24){ staff(isBirthday:true, sort:[FAVOURITES_DESC]){ "
        + _PEOPLE["staff"][3] + " age } } }"
    )

    def fetch():
        d = _post(query)
        chars = [_norm_person("characters", c) for c in ((d.get("chars") or {}).get("characters") or [])]
        folks = []
        for s in ((d.get("folks") or {}).get("staff") or []):
            p = _norm_person("staff", s)
            if p:
                folks.append({**p, "age": s.get("age")})
        return {"date": today, "characters": [c for c in chars if c], "staff": folks}

    data, _ = cache.cached(f"anilist:birthdays:{today}", 3 * 3600, fetch)
    return data


# ── reviews ──────────────────────────────────────────────────────────────────

_REVIEW_CARD = (
    "id summary score rating ratingAmount userRating createdAt"
    " " + _USER +
    " media { id type format seasonYear title { romaji english native }"
    " coverImage { large extraLarge color } bannerImage }"
)
_REVIEW_SORTS = {"recent": "ID_DESC", "top": "RATING_DESC", "score": "SCORE_DESC"}
REVIEW_SUMMARY_MIN, REVIEW_SUMMARY_MAX = 20, 120
REVIEW_BODY_MIN = 2200


def _norm_review(r):
    m = r.get("media") or {}
    t = m.get("title") or {}
    cover = m.get("coverImage") or {}
    return {
        "id": r["id"], "summary": r.get("summary"), "score": r.get("score"),
        "rating": r.get("rating") or 0, "rating_amount": r.get("ratingAmount") or 0,
        "user_rating": r.get("userRating"), "created_at": r.get("createdAt"),
        "user": _norm_user(r.get("user")),
        "media": {
            "id": m.get("id"), "type": m.get("type"), "format": m.get("format"),
            "year": m.get("seasonYear"),
            "title": t.get("english") or t.get("romaji") or t.get("native"),
            "cover": cover.get("large"), "cover_xl": cover.get("extraLarge"),
            "color": cover.get("color"), "banner": m.get("bannerImage"),
        },
    }


def reviews(page=1, media_id=None, sort="recent", per_page=12):
    decl = ["$page:Int", "$perPage:Int", "$sort:[ReviewSort]"]
    args = ["mediaType:ANIME", "sort:$sort"]
    variables = {"page": page, "perPage": per_page, "sort": [_REVIEW_SORTS.get(sort, "ID_DESC")]}
    if media_id:
        decl.append("$mid:Int"); args.append("mediaId:$mid"); variables["mid"] = int(media_id)
    query = (
        "query (" + ",".join(decl) + "){ Page(page:$page,perPage:$perPage){ pageInfo { hasNextPage }"
        " reviews(" + ",".join(args) + "){ " + _REVIEW_CARD + " } } }"
    )

    def fetch():
        pg = _post(query, variables).get("Page") or {}
        items = [_norm_review(r) for r in pg.get("reviews") or [] if r]
        payload = {"items": items, "has_next": bool((pg.get("pageInfo") or {}).get("hasNextPage"))}
        return payload, (config.TTL_ANILIST_REVIEWS if items else config.TTL_ANILIST_EMPTY)

    return cache.cached_dynamic(f"anilist:reviews:{media_id or 'all'}:{sort}:{page}", fetch)


def review(review_id):
    query = ("query ($id:Int){ Review(id:$id){ " + _REVIEW_CARD
             + " body(asHtml:true) private siteUrl updatedAt } }")

    def fetch():
        r = _post(query, {"id": review_id}).get("Review")
        if not r:
            return None
        return {**_norm_review(r), "body": r.get("body"), "private": bool(r.get("private")),
                "site_url": r.get("siteUrl"), "updated_at": r.get("updatedAt")}

    data, _ = cache.cached(f"anilist:review:{review_id}", 300, fetch)
    return data


def rate_review(token, review_id, rating):
    """Thumb a review up or down (UP_VOTE / DOWN_VOTE), or withdraw (NO_VOTE)."""
    if rating not in ("UP_VOTE", "DOWN_VOTE", "NO_VOTE"):
        raise ValueError("rating must be UP_VOTE, DOWN_VOTE or NO_VOTE")
    d = _post(
        "mutation ($id:Int,$r:ReviewRating){ RateReview(reviewId:$id, rating:$r){"
        " id rating ratingAmount userRating } }",
        {"id": int(review_id), "r": rating}, token=token,
    )
    cache.invalidate(f"anilist:review:{review_id}")
    cache.invalidate("anilist:reviews:")
    r = d.get("RateReview") or {}
    return {"id": r.get("id"), "rating": r.get("rating") or 0,
            "rating_amount": r.get("ratingAmount") or 0, "user_rating": r.get("userRating")}


def validate_review(summary, body, score):
    """AniList's own review rules, checked before we spend a request on them."""
    problems = []
    s, b = (summary or "").strip(), (body or "").strip()
    if not REVIEW_SUMMARY_MIN <= len(s) <= REVIEW_SUMMARY_MAX:
        problems.append(f"The summary needs {REVIEW_SUMMARY_MIN}–{REVIEW_SUMMARY_MAX} characters "
                        f"(it has {len(s)}).")
    if len(b) < REVIEW_BODY_MIN:
        problems.append(f"The review needs at least {REVIEW_BODY_MIN} characters (it has {len(b)}).")
    try:
        sc = int(score)
    except (TypeError, ValueError):
        sc = -1
    if not 0 <= sc <= 100:
        problems.append("The score must be a whole number from 0 to 100.")
    return problems


def my_review(token, media_id):
    """The viewer's own review of a title (markdown source, for editing), or None.
    Uncached: the editor wants the truth, and this is only read on open."""
    uid = viewer(token)["id"]
    d = _post(
        "query ($m:Int,$u:Int){ Page(perPage:1){ reviews(mediaId:$m, userId:$u){"
        " id summary body(asHtml:false) score private } } }",
        {"m": int(media_id), "u": uid}, token=token,
    )
    rows = (d.get("Page") or {}).get("reviews") or []
    if not rows:
        return None
    r = rows[0]
    return {"id": r["id"], "summary": r.get("summary"), "body": r.get("body"),
            "score": r.get("score"), "private": bool(r.get("private"))}


def save_review(token, media_id, summary, body, score, private=False, review_id=None):
    problems = validate_review(summary, body, score)
    if problems:
        raise ValueError(" ".join(problems))
    decl = ["$m:Int", "$s:String", "$b:String", "$sc:Int", "$p:Boolean"]
    args = ["mediaId:$m", "summary:$s", "body:$b", "score:$sc", "private:$p"]
    variables = {"m": int(media_id), "s": summary.strip(), "b": body.strip(),
                 "sc": int(score), "p": bool(private)}
    if review_id:
        decl.append("$id:Int"); args.append("id:$id"); variables["id"] = int(review_id)
    d = _post("mutation (" + ",".join(decl) + "){ SaveReview(" + ",".join(args) + "){ id } }",
              variables, token=token)
    cache.invalidate("anilist:reviews:")
    cache.invalidate("anilist:review:")
    cache.invalidate(f"anilist:extras:{media_id}")
    return d.get("SaveReview")


def delete_review(token, review_id, media_id=None):
    d = _post("mutation ($id:Int){ DeleteReview(id:$id){ deleted } }", {"id": int(review_id)}, token=token)
    cache.invalidate("anilist:reviews:")
    cache.invalidate("anilist:review:")
    if media_id:
        cache.invalidate(f"anilist:extras:{media_id}")
    return d.get("DeleteReview")


_MD_MEMO = {}  # text hash → html; a small in-process memo, never persisted (drafts aren't cache rows)


def render_markdown(text):
    """AniList's own markdown renderer — the composer's preview shows exactly what
    AniList will publish (its dialect: ~!spoilers!~, img(), youtube()…). Memoised
    in memory so toggling back to an earlier draft costs no request."""
    key = hashlib.sha1((text or "").encode()).hexdigest()
    if key in _MD_MEMO:
        return _MD_MEMO[key]
    d = _post("query ($md:String!){ Markdown(markdown:$md){ html } }", {"md": text or ""})
    html = (d.get("Markdown") or {}).get("html") or ""
    if len(_MD_MEMO) >= 64:
        _MD_MEMO.pop(next(iter(_MD_MEMO)))
    _MD_MEMO[key] = html
    return html


# ── community recommendations feed ───────────────────────────────────────────

# A card-sized media selection for feeds that carry two titles per row: enough for
# a poster, a caption and your list status, at a fraction of _MEDIA's weight.
_CARD = (
    "id type isAdult format episodes seasonYear averageScore popularity genres"
    " title { romaji english native } coverImage { large extraLarge color } bannerImage"
    " description(asHtml:false) nextAiringEpisode { episode airingAt }"
    " mediaListEntry { id status score progress }"
)


def recommendations_feed(page=1, on_list=False, per_page=None, token=None):
    """The newest "if you liked X, watch Y" pairings site-wide — or, `on_list`, only
    those whose X is on your list (AniList's personal recommendations feed).

    The site-wide feed is mostly *manga* pairings (there's no type filter), so it
    reads a deeper page of lighter cards to leave a shelf's worth of anime."""
    per_page = per_page or (18 if on_list else 50)
    args = ["sort:[ID_DESC]"] + (["onList:true"] if on_list else [])
    query = (
        "query ($page:Int,$perPage:Int){ Page(page:$page,perPage:$perPage){ pageInfo { hasNextPage }"
        " recommendations(" + ",".join(args) + "){ id rating userRating user { id name avatar { large } }"
        " media {" + _CARD + "} mediaRecommendation {" + _CARD + "} } } }"
    )

    def fetch():
        pg = _post(query, {"page": page, "perPage": per_page}, token=token).get("Page") or {}
        items = []
        for r in pg.get("recommendations") or []:
            a, b = norm_media(r.get("media")), norm_media(r.get("mediaRecommendation"))
            # manga pairings share the feed; this room is anime-only
            if not a or not b or "ANIME" != a.get("type") or "ANIME" != b.get("type"):
                continue
            if a.get("adult") or b.get("adult"):
                continue
            items.append({"id": r["id"], "rating": r.get("rating") or 0,
                          "user_rating": r.get("userRating"),
                          "user": _norm_user(r.get("user")) if r.get("user") else None,
                          "media": a, "recommendation": b})
        payload = {"items": items, "has_next": bool((pg.get("pageInfo") or {}).get("hasNextPage"))}
        return payload, (config.TTL_ANILIST_REVIEWS if items else config.TTL_ANILIST_EMPTY)

    auth = "auth" if token else "anon"
    return cache.cached_dynamic(f"anilist:recs:{auth}:{'list' if on_list else 'all'}:{page}", fetch)


# ── notifications ────────────────────────────────────────────────────────────

NOTIFICATION_GROUPS = {
    "airing": ["AIRING"],
    "activity": ["ACTIVITY_MESSAGE", "ACTIVITY_REPLY", "ACTIVITY_MENTION", "ACTIVITY_LIKE",
                 "ACTIVITY_REPLY_LIKE", "ACTIVITY_REPLY_SUBSCRIBED"],
    "forum": ["THREAD_COMMENT_MENTION", "THREAD_SUBSCRIBED", "THREAD_COMMENT_REPLY",
              "THREAD_LIKE", "THREAD_COMMENT_LIKE"],
    "follows": ["FOLLOWING"],
    "media": ["RELATED_MEDIA_ADDITION", "MEDIA_DATA_CHANGE", "MEDIA_MERGE", "MEDIA_DELETION"],
}
_NOTIF_GROUP_OF = {t: g for g, ts in NOTIFICATION_GROUPS.items() for t in ts}

_N_USER = " " + _USER
_N_MEDIA = " media { id type title { romaji english } coverImage { large color } }"
_N_THREAD = " thread { id title }"
_N_BASE = " id type context createdAt"
_NOTIFICATION_SELECTION = (
    " __typename"
    " ... on AiringNotification { id type episode contexts createdAt" + _N_MEDIA + " }"
    " ... on FollowingNotification {" + _N_BASE + _N_USER + " }"
    + "".join(
        f" ... on {t} {{" + _N_BASE + " activityId" + _N_USER + " }"
        for t in ("ActivityMessageNotification", "ActivityMentionNotification",
                  "ActivityReplyNotification", "ActivityReplySubscribedNotification",
                  "ActivityLikeNotification", "ActivityReplyLikeNotification")
    )
    + "".join(
        f" ... on {t} {{" + _N_BASE + _N_THREAD + _N_USER + " }"
        for t in ("ThreadCommentMentionNotification", "ThreadCommentReplyNotification",
                  "ThreadCommentSubscribedNotification", "ThreadCommentLikeNotification",
                  "ThreadLikeNotification")
    )
    + " ... on RelatedMediaAdditionNotification {" + _N_BASE + _N_MEDIA + " }"
    " ... on MediaDataChangeNotification {" + _N_BASE + " reason" + _N_MEDIA + " }"
    " ... on MediaMergeNotification {" + _N_BASE + " reason deletedMediaTitles" + _N_MEDIA + " }"
    " ... on MediaDeletionNotification {" + _N_BASE + " reason deletedMediaTitle }"
)


def _interleave(contexts, values):
    """AniList airing notifications arrive as fragments around the values:
    contexts ["Episode ", " of ", " aired."] + values [12, "Frieren"]."""
    out = []
    for i, c in enumerate(contexts or []):
        out.append(c or "")
        if i < len(values):
            out.append(str(values[i]))
    return "".join(out).strip()


def norm_notification(n):
    """One NotificationUnion member → a flat row. Pure (unit-tested): `text` is set
    where AniList's wording needs assembling; otherwise the client renders
    "<actor> <context>" with the actor as a link."""
    t = n.get("type")
    media = None
    if n.get("media"):
        mt = n["media"].get("title") or {}
        media = {"id": n["media"].get("id"), "type": n["media"].get("type"),
                 "title": mt.get("english") or mt.get("romaji"),
                 "cover": (n["media"].get("coverImage") or {}).get("large"),
                 "color": (n["media"].get("coverImage") or {}).get("color")}
    thread = n.get("thread")
    out = {
        "id": n.get("id"), "type": t, "group": _NOTIF_GROUP_OF.get(t, "other"),
        "created_at": n.get("createdAt"),
        "user": _norm_user(n["user"]) if n.get("user") else None,
        "media": media,
        "thread": {"id": thread.get("id"), "title": thread.get("title")} if thread else None,
        "activity_id": n.get("activityId"),
        "context": n.get("context"),
        "reason": n.get("reason"),
        "episode": n.get("episode"),
        "text": None,
    }
    title = (media or {}).get("title") or "a show"
    if t == "AIRING":
        out["text"] = (_interleave(n.get("contexts"), [n.get("episode"), title])
                       or f"Episode {n.get('episode')} of {title} aired.")
    elif t == "MEDIA_DELETION":
        out["text"] = f"{n.get('deletedMediaTitle') or 'A title'}{n.get('context') or ' was deleted from the site.'}"
    elif t == "MEDIA_MERGE":
        merged = ", ".join(n.get("deletedMediaTitles") or []) or "A title"
        out["text"] = f"{merged}{n.get('context') or ' was merged into '}{title}"
    return out


def notifications(token, page=1, group=None, reset=False, per_page=25):
    """The viewer's inbox. `reset` marks everything read (AniList has no per-item
    read state — only an unread count that a reset zeroes). Uncached."""
    decl, args, variables = ["$page:Int", "$perPage:Int"], [], {"page": page, "perPage": per_page}
    types = NOTIFICATION_GROUPS.get(group)
    if types:
        decl.append("$types:[NotificationType]"); args.append("type_in:$types"); variables["types"] = types
    if reset:
        args.append("resetNotificationCount:true")
    query = (
        "query (" + ",".join(decl) + "){ Page(page:$page,perPage:$perPage){ pageInfo { hasNextPage }"
        " notifications" + (("(" + ",".join(args) + ")") if args else "") + "{"
        + _NOTIFICATION_SELECTION + " } } }"
    )
    pg = _post(query, variables, token=token).get("Page") or {}
    cache.invalidate("anilist:unread:")
    return {
        "items": [norm_notification(n) for n in pg.get("notifications") or [] if n and n.get("id")],
        "has_next": bool((pg.get("pageInfo") or {}).get("hasNextPage")),
    }


def unread_count(token):
    """How many notifications arrived since the inbox was last opened."""
    key = "anilist:unread:" + hashlib.sha1(token.encode()).hexdigest()[:12]

    def fetch():
        return (_post("query { Viewer { unreadNotificationCount } }", token=token).get("Viewer") or {}) \
            .get("unreadNotificationCount") or 0

    n, _ = cache.cached(key, 30, fetch)
    return n


# ── following ────────────────────────────────────────────────────────────────

def toggle_follow(token, user_id):
    d = _post("mutation ($id:Int){ ToggleFollow(userId:$id){ id name isFollowing isFollower } }",
              {"id": int(user_id)}, token=token)
    for p in ("anilist:user:", "anilist:follows:", "anilist:activity:following"):
        cache.invalidate(p)
    u = d.get("ToggleFollow") or {}
    return {"id": u.get("id"), "is_following": bool(u.get("isFollowing")),
            "is_follower": bool(u.get("isFollower"))}


def follows(user_id, which="following", page=1):
    """Who a user follows, or who follows them."""
    field = "followers" if which == "followers" else "following"
    query = (
        "query ($id:Int!,$page:Int){ Page(page:$page,perPage:50){ pageInfo { hasNextPage total }"
        " " + field + "(userId:$id, sort:[USERNAME]){ id name avatar { large } bannerImage donatorTier"
        " isFollowing isFollower options { profileColor }"
        " statistics { anime { count meanScore minutesWatched } } } } }"
    )

    def fetch():
        pg = _post(query, {"id": int(user_id), "page": page}).get("Page") or {}
        return {
            "items": [
                {**_norm_user(u), "is_following": bool(u.get("isFollowing")),
                 "is_follower": bool(u.get("isFollower")),
                 "color": (u.get("options") or {}).get("profileColor"),
                 "banner": u.get("bannerImage"), "donator": u.get("donatorTier") or 0,
                 "stats": _user_stats(u)}
                for u in pg.get(field) or [] if u
            ],
            "has_next": bool((pg.get("pageInfo") or {}).get("hasNextPage")),
            "total": (pg.get("pageInfo") or {}).get("total"),
        }

    data, _ = cache.cached(f"anilist:follows:{field}:{user_id}:{page}:v2", config.TTL_ANILIST_SOCIAL, fetch)
    return data


# ── statistics, computed from the list itself ────────────────────────────────
#
# AniList's own statistics are generated lazily and some accounts never get them
# (they come back empty), so the ledger is computed here from the list — which is
# always there and always current. AniList's precomputed voice-actor/staff tallies
# are still asked for, since those need data a list query can't cheaply carry.

_STATS_Q = (
    "query ($userId:Int){ MediaListCollection(userId:$userId,type:ANIME){"
    " lists { entries { status progress repeat updatedAt"
    " score100: score(format:POINT_100)"
    " startedAt { year month day } completedAt { year month day }"
    " media { id isAdult title { romaji english native } coverImage { large color } format"
    " episodes duration genres averageScore popularity seasonYear startDate { year month day }"
    " source(version:3) countryOfOrigin studios(isMain:true){ nodes { id name } }"
    " tags { name rank isMediaSpoiler } nextAiringEpisode { episode } } } } }"
    " Viewer { statistics { anime {"
    " voiceActors(limit:10, sort:[COUNT_DESC]) { count meanScore"
    " voiceActor { id name { userPreferred } image { large } } }"
    " staff(limit:10, sort:[COUNT_DESC]) { count meanScore"
    " staff { id name { userPreferred } image { large } primaryOccupations } } } } } }"
)

_LENGTH_BUCKETS = [(1, 1, "1"), (2, 6, "2–6"), (7, 16, "7–16"), (17, 28, "17–28"),
                   (29, 55, "29–55"), (56, 100, "56–100"), (101, 10 ** 9, "101+")]


def _mean(xs):
    return round(sum(xs) / len(xs), 1) if xs else None


def _std(xs):
    if len(xs) < 2:
        return None
    mu = sum(xs) / len(xs)
    return round((sum((x - mu) ** 2 for x in xs) / len(xs)) ** 0.5, 1)


def _ymd(iso):
    try:
        y, m, d = (int(x) for x in (iso or "").split("-"))
        return y, m, d
    except ValueError:
        return None


def _light(m):
    return {k: m.get(k) for k in ("id", "title", "cover", "color", "format", "episodes", "year", "score")}


def _entry_watch(e):
    """(minutes, episodes) actually watched for an entry, rewatches included.
    Unknown durations fall back to a TV slot (24m) or a feature (90m)."""
    m = e["media"]
    dur = m.get("duration") or (90 if m.get("format") == "MOVIE" else 24)
    eps = (e.get("progress") or 0) + (e.get("repeat") or 0) * (m.get("episodes") or 0)
    return eps * dur, eps


def compute_stats(entries, now=None, stall_days=45):
    """The whole ledger from list entries (pure; the heart of the Stats tab).

    `entries`: [{status, progress, repeat, score (0–100, 0 = unscored),
    updated_at, started_at, completed_at (ISO), media: {id, title, cover, color,
    format, episodes, duration, genres, score (community), year, source, country,
    studios [{id,name}], tags [names], next_episode}}]."""
    now = now or time.time()
    uniq = {}
    for e in entries:
        uniq.setdefault(e["media"]["id"], e)  # a title on several custom lists counts once
    es = list(uniq.values())
    seen = [e for e in es if e.get("status") != "PLANNING"]
    planning = [e for e in es if e.get("status") == "PLANNING"]
    scored = [e for e in es if (e.get("score") or 0) > 0]

    watch = {e["media"]["id"]: _entry_watch(e) for e in seen}
    minutes = sum(w[0] for w in watch.values())
    episodes = sum(w[1] for w in watch.values())

    def tally(key_fn, pool=seen):
        g = {}
        for e in pool:
            for k in key_fn(e):
                if k is None:
                    continue
                row = g.setdefault(k, {"count": 0, "scores": [], "minutes": 0})
                row["count"] += 1
                if e.get("score"):
                    row["scores"].append(e["score"])
                row["minutes"] += watch.get(e["media"]["id"], (0, 0))[0]
        return g

    def rows(g, label, limit=None, order="count"):
        out = [{label: k, "count": v["count"], "mean": _mean(v["scores"]), "minutes": v["minutes"]}
               for k, v in g.items()]
        if order == "key":
            out.sort(key=lambda r: r[label])
        else:
            out.sort(key=lambda r: (-r["count"], -(r["mean"] or 0), str(r[label])))
        return out[:limit] if limit else out

    def length_bucket(e):
        n = e["media"].get("episodes")
        if not n:
            return [None]
        return [next(label for lo, hi, label in _LENGTH_BUCKETS if lo <= n <= hi)]

    # the backlog: known episode counts, else what's aired, else a 12-episode guess
    backlog_min, backlog_guessed = 0, 0
    for e in planning:
        m = e["media"]
        eps = m.get("episodes") or ((m.get("next_episode") or 1) - 1)
        if not eps:
            eps, backlog_guessed = 12, backlog_guessed + 1
        backlog_min += eps * (m.get("duration") or (90 if m.get("format") == "MOVIE" else 24))

    score_buckets = {b: 0 for b in range(10, 101, 10)}
    for e in scored:
        score_buckets[min(100, max(10, -(-int(e["score"]) // 10) * 10))] += 1

    status_counts = {}
    for e in es:
        status_counts[e.get("status")] = status_counts.get(e.get("status"), 0) + 1
    finished = status_counts.get("COMPLETED", 0)
    dropped = status_counts.get("DROPPED", 0)

    # the year in review, keyed by the year a title was *completed*
    years = {}
    for e in seen:
        done = _ymd(e.get("completed_at"))
        if not done or e.get("status") not in ("COMPLETED", "REPEATING"):
            continue
        y = years.setdefault(done[0], {"completed": 0, "minutes": 0, "months": [0] * 12,
                                       "genres": {}, "titles": []})
        y["completed"] += 1
        y["minutes"] += watch.get(e["media"]["id"], (0, 0))[0]
        y["months"][done[1] - 1] += 1
        for gname in e["media"].get("genres") or []:
            y["genres"][gname] = y["genres"].get(gname, 0) + 1
        y["titles"].append((done, e))
    wrapped = {}
    for yr, y in years.items():
        titles = sorted(y["titles"], key=lambda t: t[0])
        best = sorted(titles, key=lambda t: (-(t[1].get("score") or 0), -(t[1]["media"].get("score") or 0)))
        wrapped[str(yr)] = {
            "completed": y["completed"],
            "minutes": y["minutes"],
            "months": y["months"],
            "genres": [g for g, _ in sorted(y["genres"].items(), key=lambda kv: -kv[1])[:5]],
            "best": [{**_light(t[1]["media"]), "mine": t[1].get("score") or 0} for t in best[:6]],
            "first": {**_light(titles[0][1]["media"]), "date": titles[0][1].get("completed_at")},
            "last": {**_light(titles[-1][1]["media"]), "date": titles[-1][1].get("completed_at")},
        }

    takes = []
    for e in scored:
        crowd = e["media"].get("score")
        if crowd:
            takes.append({"media": _light(e["media"]), "mine": e["score"], "crowd": crowd,
                          "diff": e["score"] - crowd})
    higher = sorted((t for t in takes if t["diff"] >= 10), key=lambda t: -t["diff"])[:8]
    lower = sorted((t for t in takes if t["diff"] <= -10), key=lambda t: t["diff"])[:8]

    cutoff = now - stall_days * 86400
    stalled = sorted(
        (e for e in es if e.get("status") in ("CURRENT", "REPEATING")
         and e.get("updated_at") and e["updated_at"] < cutoff),
        key=lambda e: e["updated_at"],
    )[:12]

    scores = [e["score"] for e in scored]
    by_length = {r["length"]: r for r in rows(tally(length_bucket), "length")}
    return {
        "totals": {
            "titles": len(es), "watched": len(seen), "episodes": episodes, "minutes": minutes,
            "days": round(minutes / 1440, 1), "mean_score": _mean(scores), "std_dev": _std(scores),
            "scored": len(scored), "completed": finished, "planning": len(planning),
            "backlog_minutes": backlog_min, "backlog_guessed": backlog_guessed,
            "rewatches": sum(e.get("repeat") or 0 for e in seen),
            # of the shows you've *ended* (finished or dropped), how many you finished
            "completion_rate": round(100 * finished / (finished + dropped)) if finished + dropped else None,
        },
        "statuses": [{"status": k, "count": v} for k, v in sorted(status_counts.items(), key=lambda kv: -kv[1]) if k],
        "formats": rows(tally(lambda e: [e["media"].get("format")]), "format"),
        "scores": [{"score": k, "count": v} for k, v in score_buckets.items()],
        # every bucket present, empty ones included, so the chart's axis is fixed
        "lengths": [by_length.get(label, {"length": label, "count": 0, "mean": None, "minutes": 0})
                    for _, _, label in _LENGTH_BUCKETS],
        "genres": rows(tally(lambda e: e["media"].get("genres") or []), "genre", 18),
        "tags": rows(tally(lambda e: e["media"].get("tags") or []), "tag", 20),
        "studios": rows(tally(lambda e: [s["name"] for s in e["media"].get("studios") or []]), "studio", 12),
        "release_years": rows(tally(lambda e: [e["media"].get("year")]), "year", order="key"),
        "countries": rows(tally(lambda e: [e["media"].get("country")]), "country"),
        "sources": rows(tally(lambda e: [e["media"].get("source")]), "source"),
        "wrapped": wrapped,
        "hot_takes": {"higher": higher, "lower": lower},
        "stalled": [{"media": _light(e["media"]), "progress": e.get("progress") or 0,
                     "updated_at": e["updated_at"], "status": e.get("status")} for e in stalled],
    }


def _stats_entry(e):
    m = e.get("media") or {}
    t = m.get("title") or {}
    sd = m.get("startDate") or {}
    return {
        "status": e.get("status"), "progress": e.get("progress") or 0, "repeat": e.get("repeat") or 0,
        "score": e.get("score100") or 0, "updated_at": e.get("updatedAt"),
        "started_at": _fuzzy_date(e.get("startedAt")),
        "completed_at": _fuzzy_date(e.get("completedAt")),
        "media": {
            "id": m.get("id"),
            "title": t.get("english") or t.get("romaji") or t.get("native") or "Untitled",
            "cover": (m.get("coverImage") or {}).get("large"),
            "color": (m.get("coverImage") or {}).get("color"),
            "format": m.get("format"), "episodes": m.get("episodes"), "duration": m.get("duration"),
            "genres": m.get("genres") or [], "score": m.get("averageScore"),
            "year": m.get("seasonYear") or sd.get("year"),
            "source": m.get("source"), "country": m.get("countryOfOrigin"),
            "studios": ((m.get("studios") or {}).get("nodes") or []),
            "tags": [x["name"] for x in (m.get("tags") or [])
                     if x and (x.get("rank") or 0) >= 60 and not x.get("isMediaSpoiler")],
            "next_episode": (m.get("nextAiringEpisode") or {}).get("episode"),
        },
    }


def list_stats(token):
    vid = viewer(token)["id"]

    def fetch():
        d = _post(_STATS_Q, {"userId": vid}, token=token)
        entries = [
            _stats_entry(e)
            for lst in ((d.get("MediaListCollection") or {}).get("lists") or [])
            for e in (lst.get("entries") or [])
            if e.get("media") and not (e["media"].get("isAdult"))
        ]
        out = compute_stats(entries)
        st = (((d.get("Viewer") or {}).get("statistics") or {}).get("anime") or {})
        out["voice_actors"] = [
            {"id": (r.get("voiceActor") or {}).get("id"),
             "name": ((r.get("voiceActor") or {}).get("name") or {}).get("userPreferred"),
             "image": ((r.get("voiceActor") or {}).get("image") or {}).get("large"),
             "count": r.get("count"), "mean": r.get("meanScore")}
            for r in (st.get("voiceActors") or []) if (r.get("voiceActor") or {}).get("id")
        ]
        out["staff"] = [
            {"id": (r.get("staff") or {}).get("id"),
             "name": ((r.get("staff") or {}).get("name") or {}).get("userPreferred"),
             "image": ((r.get("staff") or {}).get("image") or {}).get("large"),
             "role": ", ".join(((r.get("staff") or {}).get("primaryOccupations") or [])[:2]),
             "count": r.get("count"), "mean": r.get("meanScore")}
            for r in (st.get("staff") or []) if (r.get("staff") or {}).get("id")
        ]
        return out

    # Under the lists prefix on purpose: any list edit (_invalidate_user) drops it.
    data, _ = cache.cached(f"anilist:lists:{vid}:stats", config.TTL_ANILIST_STATS, fetch)
    return data


# ── taste compatibility ──────────────────────────────────────────────────────

def _pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if not sxx or not syy:
        return None
    return sxy / (sxx * syy) ** 0.5


def compare_lists(mine, theirs):
    """Pure: how two lists line up. Both are {media_id: {status, score (0–100),
    media}}. Affinity is the Pearson correlation of the scores you both gave —
    MyAnimeList's "affinity", the number people already know — and genre overlap is
    the cosine of what each of you actually watches."""
    def watched(d):
        return {k for k, v in d.items() if v.get("status") != "PLANNING"}

    ms, ts = watched(mine), watched(theirs)
    shared = ms & ts
    pairs = [(k, mine[k]["score"], theirs[k]["score"]) for k in shared
             if mine[k].get("score") and theirs[k].get("score")]
    r = _pearson([p[1] for p in pairs], [p[2] for p in pairs])

    def genre_vec(d, ids):
        v = {}
        for k in ids:
            for g in d[k]["media"].get("genres") or []:
                v[g] = v.get(g, 0) + 1
        return v

    gm, gt = genre_vec(mine, ms), genre_vec(theirs, ts)
    dot = sum(gm[g] * gt.get(g, 0) for g in gm)
    norm = (sum(x * x for x in gm.values()) ** 0.5) * (sum(x * x for x in gt.values()) ** 0.5)
    both_genres = sorted(set(gm) & set(gt), key=lambda g: -(gm[g] + gt[g]))[:6]

    def media_of(k):
        return mine.get(k, theirs.get(k))["media"]

    def picks(src, other_all, other_seen):
        rows = [
            {"media": v["media"], "score": v["score"], "planned": k in other_all and k not in other_seen}
            for k, v in src.items()
            if v.get("status") != "PLANNING" and (v.get("score") or 0) >= 75 and k not in other_seen
        ]
        rows.sort(key=lambda x: (-x["score"], -(x["media"].get("score") or 0)))
        return rows[:12]

    return {
        "affinity": round(r * 100) if r is not None else None,
        "pairs": len(pairs),
        "shared": len(shared),
        "mine_count": len(ms),
        "their_count": len(ts),
        "mean_diff": _mean([abs(a - b) for _, a, b in pairs]),
        "genre_similarity": round(100 * dot / norm) if norm else None,
        "shared_genres": both_genres,
        "disagreements": [
            {"media": media_of(k), "mine": a, "theirs": b, "diff": a - b}
            for k, a, b in sorted(pairs, key=lambda p: -abs(p[1] - p[2]))[:6] if a != b
        ],
        "shared_loves": [
            {"media": media_of(k), "mine": a, "theirs": b}
            for k, a, b in sorted((p for p in pairs if p[1] >= 80 and p[2] >= 80),
                                  key=lambda p: -(p[1] + p[2]))[:8]
        ],
        "their_picks": picks(theirs, mine, ms),
        "my_picks": picks(mine, theirs, ts),
    }


def _score_map(token, user_id=None, user_name=None):
    arg, decl, val = (("userId:$u", "$u:Int", int(user_id)) if user_id
                      else ("userName:$u", "$u:String", user_name))
    q = (
        "query (" + decl + "){ MediaListCollection(" + arg + ", type:ANIME){"
        " user { id name avatar { large } options { profileColor } }"
        " lists { entries { status score100: score(format:POINT_100)"
        " media { id isAdult title { romaji english } coverImage { large color }"
        " genres averageScore format seasonYear episodes } } } } }"
    )
    coll = _post(q, {"u": val}, token=token).get("MediaListCollection") or {}
    out = {}
    for lst in coll.get("lists") or []:
        for e in lst.get("entries") or []:
            m = e.get("media") or {}
            if not m.get("id") or m.get("isAdult"):
                continue
            t = m.get("title") or {}
            out.setdefault(m["id"], {
                "status": e.get("status"), "score": e.get("score100") or 0,
                "media": {"id": m["id"], "title": t.get("english") or t.get("romaji"),
                          "cover": (m.get("coverImage") or {}).get("large"),
                          "color": (m.get("coverImage") or {}).get("color"),
                          "genres": m.get("genres") or [], "score": m.get("averageScore"),
                          "format": m.get("format"), "year": m.get("seasonYear"),
                          "episodes": m.get("episodes")},
            })
    u = coll.get("user") or {}
    who = {"id": u.get("id"), "name": u.get("name"), "avatar": (u.get("avatar") or {}).get("large"),
           "color": (u.get("options") or {}).get("profileColor")}
    return who, out


def compare_with(token, name):
    me = viewer(token)

    def fetch():
        me_who, mine = _score_map(token, user_id=me["id"])
        them_who, theirs = _score_map(token, user_name=name)
        return {"me": me_who, "them": them_who, **compare_lists(mine, theirs)}

    data, _ = cache.cached(f"anilist:compare:{me['id']}:{name.lower()}", config.TTL_ANILIST_STATS, fetch)
    return data
