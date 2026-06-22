"""AniList GraphQL client.

Reads are cached (AniList caps at ~90 req/min); writes (mutations) are
user-initiated and run live with the user's bearer token. Everything goes through
the single POST endpoint at https://graphql.anilist.co. No SDK — plain requests via
httpc, mirroring the rest of Tubcal's sources.
"""

import datetime
import hashlib

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
studios(isMain: true) { nodes { id name } }
trailer { id site thumbnail }
nextAiringEpisode { episode airingAt }
"""


def _post(query, variables=None, token=None):
    """Run a GraphQL document. Raises RuntimeError on AniList-reported errors."""
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

def _trailer(tr):
    # Only YouTube/Dailymotion trailers are playable for us; keep the raw site.
    if not tr or not tr.get("id"):
        return None
    return {"id": tr["id"], "site": tr.get("site"), "thumbnail": tr.get("thumbnail")}


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
        # next episode to air (airing shows) — aired-so-far = next_episode - 1
        "next_episode": (m.get("nextAiringEpisode") or {}).get("episode"),
    }


def _norm_detail(m):
    base = norm_media(m)
    if not base:
        return None
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
        {"title": s.get("title"), "thumbnail": s.get("thumbnail"), "url": s.get("url"), "site": s.get("site")}
        for s in (m.get("streamingEpisodes") or [])
    ]
    entry = m.get("mediaListEntry")
    base["list_entry"] = (
        {"id": entry["id"], "status": entry.get("status"), "score": entry.get("score"),
         "progress": entry.get("progress")}
        if entry else None
    )
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


def search(q, page=1, per_page=30):
    query = (
        "query ($search:String,$page:Int,$perPage:Int){"
        " Page(page:$page,perPage:$perPage){ media(search:$search,type:ANIME,sort:SEARCH_MATCH){"
        + _MEDIA + "} } }"
    )

    def fetch():
        d = _post(query, {"search": q, "page": page, "perPage": per_page})
        return [norm_media(m) for m in (d.get("Page") or {}).get("media", [])]

    items, _ = cache.cached(f"anilist:search:{q.lower()}:{page}", config.TTL_ANILIST_SEARCH, fetch)
    return items


def browse(kind="trending", page=1, per_page=30):
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
        d = _post(query, variables)
        return [norm_media(m) for m in (d.get("Page") or {}).get("media", [])]

    items, _ = cache.cached(f"anilist:browse:{kind}:{page}", config.TTL_ANILIST_BROWSE, fetch)
    return items


def media(media_id, token=None):
    query = (
        "query ($id:Int){ Media(id:$id,type:ANIME){"
        + _MEDIA
        + " tags { name rank isMediaSpoiler }"
        + " relations { edges { relationType node {" + _MEDIA + "} } }"
        + " recommendations(sort:RATING_DESC,perPage:12){ nodes { rating mediaRecommendation {" + _MEDIA + "} } }"
        + " streamingEpisodes { title thumbnail url site }"
        + (" mediaListEntry { id status score progress }" if token else "")
        + "} }"
    )
    # mediaListEntry depends on the token, so don't share the cache across auth states.
    key = f"anilist:media:{media_id}:{'auth' if token else 'anon'}"

    def fetch():
        d = _post(query, {"id": media_id}, token=token)
        return _norm_detail(d.get("Media"))

    data, _ = cache.cached(key, config.TTL_ANILIST_MEDIA, fetch)
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
                    {"entry_id": e["id"], "status": e.get("status"), "score": e.get("score"),
                     "progress": e.get("progress"), "media": norm_media(e.get("media"))}
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


def save_list_entry(token, media_id, *, status=None, progress=None, score=None):
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
    query = (
        "mutation (" + ",".join(decl) + "){ SaveMediaListEntry(" + ",".join(args) + "){"
        " id status score progress } }"
    )
    d = _post(query, variables, token=token)
    _invalidate_user(token, media_id)
    return d.get("SaveMediaListEntry")


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


# ── discussions: forum threads + activity feed ───────────────────────────────

_USER = "user { id name avatar { large } }"


def _norm_user(u):
    u = u or {}
    return {"name": u.get("name"), "avatar": (u.get("avatar") or {}).get("large")}


def forum_threads(media_id=None, page=1, per_page=20):
    decl, args, variables = "$page:Int,$perPage:Int", "sort:[IS_STICKY,REPLIED_AT_DESC]", {"page": page, "perPage": per_page}
    if media_id:
        decl += ",$mid:Int"
        args += ",mediaCategoryId:$mid"
        variables["mid"] = media_id
    query = (
        "query (" + decl + "){ Page(page:$page,perPage:$perPage){ threads(" + args + "){"
        " id title replyCount viewCount repliedAt createdAt " + _USER + " } } }"
    )

    def fetch():
        d = _post(query, variables)
        return [
            {"id": t["id"], "title": t.get("title"), "replies": t.get("replyCount"),
             "views": t.get("viewCount"), "replied_at": t.get("repliedAt"),
             "created_at": t.get("createdAt"), "user": _norm_user(t.get("user"))}
            for t in (d.get("Page") or {}).get("threads", [])
        ]

    items, _ = cache.cached(f"anilist:threads:{media_id or 'all'}:{page}", config.TTL_ANILIST_THREADS, fetch)
    return items


def thread(thread_id, page=1, per_page=40):
    query = (
        "query ($id:Int,$page:Int,$perPage:Int){"
        " Thread(id:$id){ id title body(asHtml:false) replyCount viewCount createdAt " + _USER + " }"
        " Page(page:$page,perPage:$perPage){ threadComments(threadId:$id){"
        " id comment(asHtml:false) createdAt likeCount isLiked " + _USER + " } } }"
    )

    def fetch():
        d = _post(query, {"id": thread_id, "page": page, "perPage": per_page})
        th = d.get("Thread") or {}
        return {
            "thread": {"id": th.get("id"), "title": th.get("title"), "body": th.get("body"),
                       "created_at": th.get("createdAt"), "user": _norm_user(th.get("user"))},
            "comments": [
                {"id": c["id"], "comment": c.get("comment"), "created_at": c.get("createdAt"),
                 "likes": c.get("likeCount"), "liked": c.get("isLiked"), "user": _norm_user(c.get("user"))}
                for c in (d.get("Page") or {}).get("threadComments", [])
            ],
        }

    data, _ = cache.cached(f"anilist:thread:{thread_id}:{page}", 45, fetch)
    return data


def save_thread_comment(token, thread_id, text):
    d = _post("mutation ($id:Int,$c:String){ SaveThreadComment(threadId:$id, comment:$c){ id } }",
              {"id": thread_id, "c": text}, token=token)
    cache.invalidate(f"anilist:thread:{thread_id}")
    return d.get("SaveThreadComment")


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
        " ... on TextActivity { id type text(asHtml:false) createdAt likeCount isLiked replyCount " + _USER + " }"
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
