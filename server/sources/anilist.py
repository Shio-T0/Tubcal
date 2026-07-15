"""AniList GraphQL client.

Reads are cached (AniList caps at ~90 req/min); writes (mutations) are
user-initiated and run live with the user's bearer token. Everything goes through
the single POST endpoint at https://graphql.anilist.co. No SDK — plain requests via
httpc, mirroring the rest of Tubcal's sources.
"""

import datetime
import hashlib
import re

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
season
seasonYear
startDate { year month day }
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


def _post(query, variables=None, token=None):
    """Run a GraphQL document. Raises RuntimeError on AniList-reported errors."""
    if token is None:
        token = _fallback_token()
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        resp = httpc.post(GQL, headers=headers, json={"query": query, "variables": variables or {}}, timeout=20)
        body = resp.json()
    except requests.HTTPError as e:
        # AniList puts the real reason in the JSON body even on 400/4xx — surface it.
        r = e.response
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


def _norm_entry(e):
    """The viewer's own list entry (score is in their chosen format). Null when
    not connected or not on their list — so cards can show *your* rating too.
    The repeat/notes/date fields are only requested on the detail page; they stay
    None on the lighter card queries."""
    if not e:
        return None
    return {
        "id": e.get("id"), "status": e.get("status"),
        "score": e.get("score"), "progress": e.get("progress"),
        "repeat": e.get("repeat"), "notes": e.get("notes"),
        "started_at": _fuzzy_date(e.get("startedAt")),
        "completed_at": _fuzzy_date(e.get("completedAt")),
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
        "season": m.get("season"),
        "year": m.get("seasonYear"),
        "studios": [s["name"] for s in ((m.get("studios") or {}).get("nodes") or [])],
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
        {"rating": n.get("rating"), "media": norm_media(n.get("mediaRecommendation"))}
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


def _current_season():
    mo = datetime.datetime.now(datetime.timezone.utc).month
    season = ("WINTER", "SPRING", "SUMMER", "FALL")[(mo % 12) // 3]
    return season, datetime.datetime.now(datetime.timezone.utc).year


# ── reads ────────────────────────────────────────────────────────────────────

def viewer(token):
    """The signed-in AniList user (id/name/avatar). Cached per token."""
    key = "anilist:viewer:" + hashlib.sha1(token.encode()).hexdigest()[:12]

    def fetch():
        d = _post(
            "query { Viewer { id name avatar { large } siteUrl "
            "mediaListOptions { scoreFormat } } }",
            token=token,
        )
        v = d.get("Viewer") or {}
        v["score_format"] = (v.get("mediaListOptions") or {}).get("scoreFormat") or "POINT_10"
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
            " options { titleLanguage displayAdultContent airingNotifications profileColor }"
            " mediaListOptions { scoreFormat } } }",
            token=token,
        )
        v = d.get("Viewer") or {}
        o = v.get("options") or {}
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
    if not args:
        return None
    q = "mutation (" + ",".join(decl) + "){ UpdateUser(" + ",".join(args) + "){ id } }"
    d = _post(q, variables, token=token)
    cache.invalidate("anilist:settings:")
    cache.invalidate("anilist:viewer:")
    cache.invalidate("anilist:user:")
    return d.get("UpdateUser")


def search(q, page=1, per_page=30, token=None):
    query = (
        "query ($search:String,$page:Int,$perPage:Int){"
        " Page(page:$page,perPage:$perPage){ media(search:$search,type:ANIME,sort:SEARCH_MATCH){"
        + _MEDIA + "} } }"
    )

    def fetch():
        d = _post(query, {"search": q, "page": page, "perPage": per_page}, token=token)
        return [norm_media(m) for m in (d.get("Page") or {}).get("media", [])]

    # mediaListEntry depends on the token, so split the cache by auth state.
    auth = "auth" if token else "anon"
    items, _ = cache.cached(f"anilist:search:{auth}:{q.lower()}:{page}", config.TTL_ANILIST_SEARCH, fetch)
    return items


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
        " Page(page:$page,perPage:$perPage){ media(" + season_filter + "type:ANIME,sort:$sort){"
        + _MEDIA + "} } }"
    )

    def fetch():
        d = _post(query, variables, token=token)
        return [norm_media(m) for m in (d.get("Page") or {}).get("media", [])]

    auth = "auth" if token else "anon"
    items, _ = cache.cached(f"anilist:browse:{auth}:{kind}:{page}", config.TTL_ANILIST_BROWSE, fetch)
    return items


def media(media_id, token=None):
    query = (
        "query ($id:Int){ Media(id:$id,type:ANIME){"
        + _MEDIA
        + " isFavourite"
        + " mediaListEntry { id repeat notes startedAt { year month day }"
          " completedAt { year month day } }"
        + " tags { name rank isMediaSpoiler }"
        # ROLE first so mains lead; 24 is a full programme without a second page.
        + " characters(sort:[ROLE,RELEVANCE,ID],perPage:24) { edges { role"
          " node { id name { userPreferred native } image { large } favourites }"
          " voiceActorRoles(sort:[RELEVANCE,ID]) { roleNotes dubGroup"
          " voiceActor { id name { userPreferred native } image { large }"
          " languageV2 favourites } } } }"
        + " relations { edges { relationType node {" + _MEDIA + "} } }"
        + " recommendations(sort:RATING_DESC,perPage:12){ nodes { rating mediaRecommendation {" + _MEDIA + "} } }"
        + " streamingEpisodes { title thumbnail url site }"
        + " externalLinks { url site type language color icon }"
        + "} }"
    )
    # mediaListEntry depends on the token, so don't share the cache across auth states.
    key = f"anilist:media:{media_id}:{'auth' if token else 'anon'}"

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
    years = s.get("yearsActive") or []
    return {
        "id": s.get("id"),
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
        " yearsActive favourites siteUrl"
        " dateOfBirth { year month day } dateOfDeath { year month day }"
        " description(asHtml:false)"
        " characterMedia(sort:[POPULARITY_DESC],perPage:30){ edges { characterRole"
        " node {" + _MEDIA + "}"
        " characters { id name { userPreferred native } image { large } favourites } } }"
        "} }"
    )

    def fetch():
        d = _post(query, {"id": staff_id}, token=token)
        return _norm_staff(d.get("Staff"))

    data, _ = cache.cached(f"anilist:staff:{staff_id}", config.TTL_ANILIST_STAFF, fetch)
    return data


def user_lists(token):
    """The signed-in user's anime MediaListCollection, grouped by list."""
    vid = viewer(token)["id"]
    query = (
        "query ($userId:Int){ MediaListCollection(userId:$userId,type:ANIME){"
        " lists { name isCustomList status entries {"
        " id status score progress updatedAt media {" + _MEDIA + "} } } } }"
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


def save_list_entry(token, media_id, *, status=None, progress=None, score=None,
                    repeat=None, notes=None, started_at=None, completed_at=None):
    """Create/update the user's list entry for a media. Only sends the given fields."""
    decl = ["$mediaId:Int"]
    args = ["mediaId:$mediaId"]
    variables = {"mediaId": media_id}
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
        " id status score progress repeat } }"
    )
    d = _post(query, variables, token=token)
    _invalidate_user(token, media_id)
    return d.get("SaveMediaListEntry")


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
    query = (
        "mutation ($m:Int,$r:Int,$rating:RecommendationRating){"
        " SaveRecommendation(mediaId:$m, mediaRecommendationId:$r, rating:$rating){ id rating } }"
    )
    d = _post(query, {"m": media_id, "r": recommend_id, "rating": rating}, token=token)
    cache.invalidate(f"anilist:media:{media_id}:")
    return d.get("SaveRecommendation")


def toggle_favourite(token, media_id):
    """Add/remove an anime from the viewer's AniList favourites (it's a toggle)."""
    d = _post(
        "mutation ($id:Int){ ToggleFavourite(animeId:$id){"
        " anime { nodes { id } } } }",
        {"id": media_id}, token=token,
    )
    cache.invalidate(f"anilist:media:{media_id}:")
    cache.invalidate("anilist:user:")  # favourites shown on profiles
    fav = d.get("ToggleFavourite") or {}
    ids = [n.get("id") for n in ((fav.get("anime") or {}).get("nodes") or [])]
    return {"is_favourite": media_id in ids}


# ── discussions: forum threads + activity feed ───────────────────────────────

_USER = "user { id name avatar { large } }"

# A thread is treated as spoilery if its title carries a spoiler marker or names a
# specific episode ("Episode 12 …") — best-effort, deterministic, no AI needed.
_SPOILER_RE = re.compile(r"spoiler|~!|\bepisode\s*\d+\b", re.I)


def _norm_user(u):
    u = u or {}
    return {"id": u.get("id"), "name": u.get("name"), "avatar": (u.get("avatar") or {}).get("large")}


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
    t = re.sub(r"img\d*\(.*?\)", "", t, flags=re.I)           # drop image tokens
    t = re.sub(r"(youtube|webm|video)\(.*?\)", "", t, flags=re.I)
    t = re.sub(r"https?://\S+", "", t)                        # drop bare urls
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)            # [text](url) -> text
    t = re.sub(r"[#>*_~`]", "", t)                            # strip md punctuation
    t = re.sub(r"\s+", " ", t).strip()
    if not t:
        return None
    return (t[:n].rstrip() + "…") if len(t) > n else t


def forum_threads(category_id=None, media_id=None, search=None, spoiler=None, page=1, per_page=20):
    """Forum threads, optionally scoped to an AniList category, a specific anime
    (mediaCategory = the sub-category), and/or a text search. `spoiler` filters the
    list to 'safe' (hide spoilery) or 'only' (spoilery only)."""
    decl = ["$page:Int", "$perPage:Int"]
    args = ["sort:[IS_STICKY,REPLIED_AT_DESC]"]
    variables = {"page": page, "perPage": per_page}
    if category_id:
        decl.append("$cat:Int"); args.append("categoryId:$cat"); variables["cat"] = int(category_id)
    if media_id:
        decl.append("$mid:Int"); args.append("mediaCategoryId:$mid"); variables["mid"] = int(media_id)
    if search:
        decl.append("$q:String"); args.append("search:$q"); variables["q"] = search
    query = (
        "query (" + ",".join(decl) + "){ Page(page:$page,perPage:$perPage){ threads(" + ",".join(args) + "){"
        " id title body(asHtml:false) replyCount viewCount repliedAt createdAt isSticky isLocked"
        " categories { id name }"
        " mediaCategories { id title { romaji english } coverImage { large } } "
        + _USER + " } } }"
    )

    def fetch():
        d = _post(query, variables)
        out = []
        for t in (d.get("Page") or {}).get("threads", []):
            out.append({
                "id": t["id"], "title": t.get("title"), "snippet": _snippet(t.get("body")),
                "replies": t.get("replyCount"), "views": t.get("viewCount"),
                "replied_at": t.get("repliedAt"), "created_at": t.get("createdAt"),
                "sticky": bool(t.get("isSticky")), "locked": bool(t.get("isLocked")),
                "categories": [{"id": c["id"], "name": c["name"]} for c in (t.get("categories") or [])],
                "media": _first_media_category(t.get("mediaCategories")),
                "spoiler": bool(_SPOILER_RE.search(t.get("title") or "")),
                "user": _norm_user(t.get("user")),
            })
        if spoiler == "safe":
            out = [x for x in out if not x["spoiler"]]
        elif spoiler == "only":
            out = [x for x in out if x["spoiler"]]
        return out

    key = (f"anilist:threads:{category_id or 'all'}:{media_id or '-'}:"
           f"{(search or '').lower()}:{spoiler or '-'}:{page}")
    items, _ = cache.cached(key, config.TTL_ANILIST_THREADS, fetch)
    return items


def thread(thread_id, page=1, per_page=40):
    query = (
        "query ($id:Int,$page:Int,$perPage:Int){"
        " Thread(id:$id){ id title body(asHtml:true) replyCount viewCount likeCount isLiked"
        " isSticky isLocked createdAt repliedAt categories { id name }"
        " mediaCategories { id title { romaji english } coverImage { large } } " + _USER + " }"
        " Page(page:$page,perPage:$perPage){ threadComments(threadId:$id){"
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
                "categories": [{"id": c["id"], "name": c["name"]} for c in (th.get("categories") or [])],
                "media": _first_media_category(th.get("mediaCategories")),
                "user": _norm_user(th.get("user")),
            },
            "comments": [_norm_comment(c) for c in (d.get("Page") or {}).get("threadComments", [])],
        }

    data, _ = cache.cached(f"anilist:thread:{thread_id}:{page}", 45, fetch)
    return data


def user_profile(name):
    """A public AniList user's profile: bio, anime stats, top genres, favorites."""
    query = (
        "query ($n:String){ User(name:$n){ id name siteUrl createdAt donatorTier bannerImage"
        " about(asHtml:false) avatar { large } options { profileColor }"
        " statistics { anime { count episodesWatched minutesWatched meanScore"
        " genres { genre count } } }"
        " favourites { anime { nodes { id title { romaji english } coverImage { large } } } } } }"
    )

    def fetch():
        d = _post(query, {"n": name})
        u = d.get("User")
        if not u:
            return None
        a = (u.get("statistics") or {}).get("anime") or {}
        genres = sorted(
            (a.get("genres") or []), key=lambda g: -(g.get("count") or 0))[:6]
        favs = ((u.get("favourites") or {}).get("anime") or {}).get("nodes") or []
        return {
            "id": u["id"], "name": u.get("name"), "avatar": (u.get("avatar") or {}).get("large"),
            "banner": u.get("bannerImage"), "color": (u.get("options") or {}).get("profileColor"),
            "about": u.get("about"), "site_url": u.get("siteUrl"), "created_at": u.get("createdAt"),
            "donator": u.get("donatorTier") or 0,
            "stats": {
                "count": a.get("count") or 0, "episodes": a.get("episodesWatched") or 0,
                "minutes": a.get("minutesWatched") or 0, "mean_score": a.get("meanScore") or 0,
                "genres": [{"genre": g["genre"], "count": g["count"]} for g in genres],
            },
            "favourites": [
                {"id": n["id"],
                 "title": (n.get("title") or {}).get("english") or (n.get("title") or {}).get("romaji"),
                 "cover": (n.get("coverImage") or {}).get("large")}
                for n in favs[:12]
            ],
        }

    data, _ = cache.cached(f"anilist:user:{name.lower()}", 600, fetch)
    return data


def save_thread_comment(token, thread_id, text, parent_id=None):
    """Post a comment on a thread, or a reply to a comment when parent_id is given."""
    decl = ["$id:Int", "$c:String"]
    args = ["threadId:$id", "comment:$c"]
    variables = {"id": thread_id, "c": text}
    if parent_id:
        decl.append("$p:Int"); args.append("parentCommentId:$p"); variables["p"] = int(parent_id)
    d = _post(
        "mutation (" + ",".join(decl) + "){ SaveThreadComment(" + ",".join(args) + "){ id } }",
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
        base["media"] = {"id": m.get("id"), "title": title.get("english") or title.get("romaji"),
                         "cover": (m.get("coverImage") or {}).get("large")}
    return base


def activity_feed(media_id=None, page=1, per_page=25):
    decl, filt, variables = "$page:Int,$perPage:Int", "sort:ID_DESC", {"page": page, "perPage": per_page}
    if media_id:
        decl += ",$mid:Int"
        filt += ",mediaId:$mid"
        variables["mid"] = media_id
    query = (
        "query (" + decl + "){ Page(page:$page,perPage:$perPage){ activities(" + filt + "){"
        " __typename"
        " ... on TextActivity { id type text(asHtml:true) createdAt likeCount isLiked replyCount " + _USER + " }"
        " ... on ListActivity { id type status progress createdAt likeCount isLiked replyCount " + _USER
        + " media { id title { romaji english } coverImage { large } } }"
        " } } }"
    )

    def fetch():
        d = _post(query, variables)
        return [_norm_activity(a) for a in (d.get("Page") or {}).get("activities", []) if a and a.get("__typename") in ("TextActivity", "ListActivity")]

    items, _ = cache.cached(f"anilist:activity:{media_id or 'global'}:{page}", 45, fetch)
    return items


def activity_replies(activity_id):
    query = (
        "query ($id:Int){ Page(perPage:40){ activityReplies(activityId:$id){"
        " id text(asHtml:false) createdAt likeCount isLiked " + _USER + " } } }"
    )

    def fetch():
        d = _post(query, {"id": activity_id})
        return [
            {"id": r["id"], "text": r.get("text"), "created_at": r.get("createdAt"),
             "likes": r.get("likeCount"), "liked": r.get("isLiked"), "user": _norm_user(r.get("user"))}
            for r in (d.get("Page") or {}).get("activityReplies", [])
        ]

    data, _ = cache.cached(f"anilist:areplies:{activity_id}", 30, fetch)
    return data


def save_text_activity(token, text):
    d = _post("mutation ($t:String){ SaveTextActivity(text:$t){ id } }", {"t": text}, token=token)
    cache.invalidate("anilist:activity:global")
    return d.get("SaveTextActivity")


def save_activity_reply(token, activity_id, text):
    d = _post("mutation ($id:Int,$t:String){ SaveActivityReply(activityId:$id, text:$t){ id } }",
              {"id": activity_id, "t": text}, token=token)
    cache.invalidate(f"anilist:areplies:{activity_id}")
    return d.get("SaveActivityReply")


def toggle_like(token, like_id, like_type):
    d = _post("mutation ($id:Int,$t:LikeableType){ ToggleLikeV2(id:$id, type:$t){ __typename } }",
              {"id": like_id, "t": like_type}, token=token)
    return d.get("ToggleLikeV2")
