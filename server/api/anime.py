"""The Anime room — the whole of AniList, plus the local episode proxy.

Reads work without a connected account where AniList allows it (the optional token
only enriches them with your own list status); anything personal or any write
needs the connected account and answers 401 without it.
"""

import base64
import re
import time
from functools import wraps
from urllib.parse import urljoin

from flask import Blueprint, Response, request, stream_with_context

from . import err, ok
from .oauth import get_valid_token
from .. import cache, config, httpc
from ..sources import anilist, anime_source

anime_bp = Blueprint("anime", __name__, url_prefix="/api/anime")


def _token():
    """The AniList bearer token if connected, else None (reads degrade gracefully)."""
    try:
        return get_valid_token("anilist")
    except LookupError:
        return None


def guarded(label):
    """Map a view's failures onto the API's shape: a ValueError is the caller's
    mistake (400), anything else is AniList's (502)."""
    def deco(view):
        @wraps(view)
        def wrapper(*a, **kw):
            try:
                return view(*a, **kw)
            except ValueError as e:
                return err(str(e), 400)
            except Exception as e:
                return err(f"AniList {label} failed: {e}", 502)
        return wrapper
    return deco


def authed(label):
    """Like guarded(), for views that need the connected account: the token is
    passed as the first argument, and not being connected is a 401."""
    def deco(view):
        @wraps(view)
        def wrapper(*a, **kw):
            try:
                token = get_valid_token("anilist")
            except LookupError as e:
                return err(str(e), 401)
            return guarded(label)(view)(token, *a, **kw)
        return wrapper
    return deco


def _body():
    return request.get_json(force=True, silent=True) or {}


def _page():
    return max(1, request.args.get("page", default=1, type=int) or 1)


@anime_bp.get("/search")
def search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return ok({"items": []})
    page = int(request.args.get("page") or 1)
    try:
        return ok(anilist.search(q, page=page, token=_token()))
    except Exception as e:
        return err(f"AniList search failed: {e}", 502)


@anime_bp.get("/browse")
def browse():
    kind = request.args.get("kind") or "trending"
    page = int(request.args.get("page") or 1)
    try:
        return ok({**anilist.browse(kind, page=page, token=_token()), "kind": kind})
    except Exception as e:
        return err(f"AniList browse failed: {e}", 502)


@anime_bp.get("/genres")
def genres():
    """The genre list + tag vocabulary that drives the discover picker."""
    try:
        return ok(anilist.genre_collection())
    except Exception as e:
        return err(f"AniList genres failed: {e}", 502)


def _csv(name):
    raw = request.args.get(name) or ""
    return [x.strip() for x in raw.split(",") if x.strip()]


@anime_bp.get("/discover")
def discover():
    """Browse filtered by any mix of AniList's media filters, a sort dial and a
    text query. Parameter names match anilist.build_media_filter's keys."""
    genre_list = _csv("genres")
    tag_list = _csv("tags")
    sort = request.args.get("sort") or "popular"
    q = (request.args.get("q") or "").strip() or None
    page = int(request.args.get("page") or 1)
    a = request.args
    filters = {
        "formats": _csv("formats"), "statuses": _csv("statuses"), "sources": _csv("sources"),
        "services": _csv("services"), "exclude_genres": _csv("xg"), "exclude_tags": _csv("xt"),
        "country": a.get("country") or None, "season": a.get("season") or None,
        "year": a.get("year") or None, "year_from": a.get("year_from") or None,
        "year_to": a.get("year_to") or None, "score_min": a.get("score_min") or None,
        "episodes_min": a.get("episodes_min") or None, "episodes_max": a.get("episodes_max") or None,
        "duration_min": a.get("duration_min") or None, "duration_max": a.get("duration_max") or None,
        "min_tag_rank": a.get("min_tag_rank") or None,
        "on_list": {"1": True, "0": False}.get(a.get("on_list")),
    }
    # Nothing selected and no query is just the trending wall — let /browse own that
    # so a stray /discover call doesn't fan out into an unfiltered fetch.
    if not genre_list and not tag_list and not q and not anilist.filter_signature(filters):
        return ok({"items": [], "empty": True})
    try:
        data = anilist.discover(
            genres=genre_list, tags=tag_list, sort=sort, search=q,
            page=page, token=_token(), filters=filters)
        return ok({**data, "genres": genre_list, "tags": tag_list, "sort": sort})
    except Exception as e:
        return err(f"AniList discover failed: {e}", 502)


@anime_bp.get("/media/<int:media_id>")
def media(media_id):
    try:
        data = anilist.media(media_id, token=_token())
        if not data:
            return err("not found", 404)
        return ok(data)
    except Exception as e:
        return err(f"AniList media failed: {e}", 502)


@anime_bp.get("/staff/<int:staff_id>")
def staff(staff_id):
    try:
        data = anilist.staff(staff_id, token=_token())
        if not data:
            return err("not found", 404)
        return ok(data)
    except Exception as e:
        return err(f"AniList staff failed: {e}", 502)


@anime_bp.get("/lists")
def lists():
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    try:
        return ok({"lists": anilist.user_lists(token), "viewer": anilist.viewer(token)})
    except Exception as e:
        return err(f"AniList lists failed: {e}", 502)


@anime_bp.get("/me")
def me():
    """The signed-in viewer (incl. score format) — drives the list controls."""
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    try:
        return ok(anilist.viewer(token))
    except Exception as e:
        return err(f"AniList viewer failed: {e}", 502)


@anime_bp.get("/settings")
def get_settings():
    """Editable AniList account settings for the active profile studio."""
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    try:
        return ok(anilist.viewer_settings(token))
    except Exception as e:
        return err(f"AniList settings failed: {e}", 502)


@anime_bp.post("/settings")
def set_settings():
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    body = request.get_json(force=True, silent=True) or {}
    allowed = {
        k: body[k]
        for k in ("about", "score_format", "title_language", "profile_color",
                  "adult_content", "airing_notifications", "staff_name_language",
                  "restrict_messages", "activity_merge_time", "notification_options",
                  "disabled_list_activity", "custom_lists", "advanced_scoring",
                  "advanced_scoring_enabled", "split_completed")
        if k in body
    }
    if not allowed:
        return err("nothing to update")
    try:
        anilist.update_user(token, **allowed)
        return ok(anilist.viewer_settings(token))
    except Exception as e:
        return err(f"AniList update failed: {e}", 502)


@anime_bp.post("/list")
def set_list():
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    body = request.get_json(force=True, silent=True) or {}
    media_id = body.get("media_id")
    if not media_id:
        return err("media_id required")
    fields = {
        k: body[k]
        for k in ("status", "progress", "score", "repeat", "notes",
                  "started_at", "completed_at", "private", "hidden",
                  "custom_lists", "advanced_scores")
        if k in body
    }
    if not fields:
        return err("nothing to update")
    try:
        return ok(anilist.save_list_entry(token, int(media_id), **fields))
    except Exception as e:
        return err(f"AniList update failed: {e}", 502)


@anime_bp.delete("/list/<int:entry_id>")
def del_list(entry_id):
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    try:
        return ok(anilist.delete_list_entry(token, entry_id))
    except Exception as e:
        return err(f"AniList remove failed: {e}", 502)


@anime_bp.post("/recommend")
def recommend():
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    body = request.get_json(force=True, silent=True) or {}
    media_id, rec_id = body.get("media_id"), body.get("recommend_id")
    if not media_id or not rec_id:
        return err("media_id and recommend_id required")
    try:
        return ok(anilist.save_recommendation(
            token, int(media_id), int(rec_id), body.get("rating") or "RATE_UP"))
    except ValueError as e:
        return err(str(e), 400)
    except Exception as e:
        return err(f"AniList recommend failed: {e}", 502)


@anime_bp.post("/favourite")
@authed("favourite")
def favourite(token):
    """Toggle a favourite: {kind: anime|character|staff|studio, id} — or the older
    {media_id} shape, which means an anime."""
    body = _body()
    kind = body.get("kind") or "anime"
    entity_id = body.get("id") or body.get("media_id")
    if not entity_id:
        raise ValueError("id required")
    return ok(anilist.toggle_favourite(token, kind, int(entity_id)))


# ── discussions: forum threads + activity feed ───────────────────────────────

@anime_bp.get("/threads")
def threads():
    media_id = request.args.get("media_id", type=int)
    category = request.args.get("category", type=int)
    q = (request.args.get("q") or "").strip() or None
    spoiler = request.args.get("spoiler") or None
    page = int(request.args.get("page") or 1)
    subscribed = request.args.get("subscribed") == "1"
    sort = request.args.get("sort") or "active"
    if sort not in anilist.THREAD_SORTS:
        return err("unknown sort")
    if subscribed and not _token():
        return err("Connect AniList to see the threads you follow.", 401)
    try:
        return ok(anilist.forum_threads(
            category_id=category, media_id=media_id, search=q, spoiler=spoiler, page=page,
            subscribed=subscribed, sort=sort))
    except Exception as e:
        return err(f"AniList threads failed: {e}", 502)


@anime_bp.get("/user/<name>/card")
@guarded("user card")
def user_card(name):
    data = anilist.user_card(name)
    return ok(data) if data else err("user not found", 404)


@anime_bp.get("/user/<name>")
def user(name):
    try:
        prof = anilist.user_profile(name)
        if not prof:
            return err("user not found", 404)
        return ok(prof)
    except Exception as e:
        return err(f"AniList user failed: {e}", 502)


@anime_bp.get("/thread/<int:thread_id>")
def thread(thread_id):
    try:
        return ok(anilist.thread(thread_id, page=_page()))
    except Exception as e:
        return err(f"AniList thread failed: {e}", 502)


@anime_bp.post("/thread/<int:thread_id>/comment")
def thread_comment(thread_id):
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    body = request.get_json(force=True, silent=True) or {}
    text = (body.get("text") or "").strip()
    if not text:
        return err("comment text required")
    try:
        return ok(anilist.save_thread_comment(token, thread_id, text, parent_id=body.get("parent_id")))
    except Exception as e:
        return err(f"AniList comment failed: {e}", 502)


@anime_bp.get("/media_card/<int:media_id>")
def media_card(media_id):
    try:
        card = anilist.media_card(media_id)
        if not card:
            return err("not found", 404)
        return ok(card)
    except Exception as e:
        return err(f"AniList media card failed: {e}", 502)


@anime_bp.get("/activity")
def activity():
    media_id = request.args.get("media_id", type=int)
    user_id = request.args.get("user_id", type=int)
    following = request.args.get("following") == "1"
    kind = request.args.get("kind") or None
    page = int(request.args.get("page") or 1)
    if kind and kind not in anilist.ACTIVITY_KINDS:
        return err("unknown kind")
    if following and not _token():
        return err("Connect AniList to see the people you follow.", 401)
    try:
        return ok(anilist.activity_feed(
            media_id=media_id, page=page, following=following, user_id=user_id, kind=kind))
    except Exception as e:
        return err(f"AniList activity failed: {e}", 502)


@anime_bp.get("/activity/<int:activity_id>")
@guarded("activity")
def one_activity(activity_id):
    data = anilist.activity(activity_id)
    return ok(data) if data else err("not found", 404)


@anime_bp.delete("/activity/<int:activity_id>")
@authed("delete activity")
def delete_activity(token, activity_id):
    return ok(anilist.delete_activity(token, activity_id))


@anime_bp.delete("/thread/<int:thread_id>/comment/<int:comment_id>")
@authed("delete comment")
def delete_thread_comment(token, thread_id, comment_id):
    return ok(anilist.delete_thread_comment(token, comment_id, thread_id))


@anime_bp.delete("/activity/<int:activity_id>/reply/<int:reply_id>")
@authed("delete reply")
def delete_activity_reply(token, activity_id, reply_id):
    return ok(anilist.delete_activity_reply(token, reply_id, activity_id))


@anime_bp.post("/message")
@authed("message")
def message(token):
    body = _body()
    text = (body.get("text") or "").strip()
    if not body.get("recipient_id") or not text:
        raise ValueError("recipient_id and text required")
    return ok(anilist.send_message(token, int(body["recipient_id"]), text, bool(body.get("private"))))


@anime_bp.get("/activity/<int:activity_id>/replies")
def activity_replies(activity_id):
    try:
        return ok({"items": anilist.activity_replies(activity_id)})
    except Exception as e:
        return err(f"AniList replies failed: {e}", 502)


@anime_bp.post("/activity")
def post_activity():
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    text = ((request.get_json(force=True, silent=True) or {}).get("text") or "").strip()
    if not text:
        return err("status text required")
    try:
        return ok(anilist.save_text_activity(token, text))
    except Exception as e:
        return err(f"AniList post failed: {e}", 502)


@anime_bp.post("/activity/<int:activity_id>/reply")
def post_reply(activity_id):
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    text = ((request.get_json(force=True, silent=True) or {}).get("text") or "").strip()
    if not text:
        return err("reply text required")
    try:
        return ok(anilist.save_activity_reply(token, activity_id, text))
    except Exception as e:
        return err(f"AniList reply failed: {e}", 502)


@anime_bp.post("/like")
def like():
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    body = request.get_json(force=True, silent=True) or {}
    like_id, like_type = body.get("id"), body.get("type")
    if not like_id or like_type not in ("ACTIVITY", "ACTIVITY_REPLY", "THREAD", "THREAD_COMMENT"):
        return err("id and a valid type required")
    try:
        return ok(anilist.toggle_like(token, int(like_id), like_type))
    except Exception as e:
        return err(f"AniList like failed: {e}", 502)


@anime_bp.get("/channel")
def channel():
    """The Anime Channel — trailers related to what you've watched."""
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    try:
        return ok({"items": anilist.related_for_channel(token)})
    except Exception as e:
        return err(f"channel failed: {e}", 502)


# ── the schedule + the season chart ──────────────────────────────────────────

_WEEK = 7 * 86400


@anime_bp.get("/schedule")
@guarded("schedule")
def schedule():
    """Episodes airing in [start, end) (unix seconds; the client sends its own
    local week so days split at *its* midnight). Capped at eight days a call."""
    now = int(time.time())
    start = request.args.get("start", type=int) or now
    end = request.args.get("end", type=int) or start + _WEEK
    if end <= start or end - start > _WEEK + 86400:
        raise ValueError("start/end must span at most eight days")
    return ok(anilist.airing_schedule(start, end, token=_token()))


@anime_bp.get("/season")
@guarded("season chart")
def season():
    cur_season, cur_year = anilist._current_season()
    s = (request.args.get("season") or cur_season).upper()
    y = request.args.get("year", type=int) or cur_year
    if s not in anilist.SEASONS or not 1940 <= y <= cur_year + 3:
        raise ValueError("unknown season")
    return ok({**anilist.season_chart(s, y, token=_token()),
               "now": {"season": cur_season, "year": cur_year}})


# ── detail extras, the franchise guide, the sequel radar ─────────────────────

@anime_bp.get("/finale/<int:media_id>")
@authed("curtain call")
def finale(token, media_id):
    """The curtain call after you finish a title: your entry, the finale's
    discussion thread, and the next sequels with where they sit on your list."""
    data = anilist.finale(token, media_id)
    if not data:
        return err("not found", 404)
    return ok(data)


@anime_bp.get("/media/<int:media_id>/extras")
@guarded("extras")
def media_extras(media_id):
    data = anilist.media_extras(media_id)
    return ok(data) if data else err("not found", 404)


def _list_status_map(token):
    """media id → your list status, for painting "you are here" onto guides."""
    out = {}
    for g in anilist.user_lists(token):
        for e in g.get("entries") or []:
            out.setdefault(e["media"]["id"], {"status": e.get("status"), "progress": e.get("progress")})
    return out


@anime_bp.get("/media/<int:media_id>/franchise")
@guarded("franchise")
def franchise(media_id):
    data = anilist.franchise(media_id)
    token = _token()
    if token:
        try:
            mine = _list_status_map(token)
            for it in data["items"]:
                it["list"] = mine.get(it["id"])
        except Exception:
            pass  # the guide stands on its own without list overlay
    return ok(data)


@anime_bp.get("/sequels")
@authed("sequel radar")
def sequels(token):
    return ok(anilist.sequel_radar(token))


# ── people: characters, studios, search, birthdays ───────────────────────────

@anime_bp.get("/character/<int:char_id>")
@guarded("character")
def character(char_id):
    data = anilist.character(char_id, token=_token())
    return ok(data) if data else err("not found", 404)


@anime_bp.get("/studio/<int:studio_id>")
@guarded("studio")
def studio(studio_id):
    data = anilist.studio(
        studio_id, page=_page(), main_only=request.args.get("main") == "1",
        sort=request.args.get("sort") or "newest", token=_token())
    return ok(data) if data else err("not found", 404)


@anime_bp.get("/people")
@guarded("people")
def people():
    kind = request.args.get("kind") or "characters"
    return ok(anilist.people(kind, q=request.args.get("q"), page=_page()))


@anime_bp.get("/birthdays")
@guarded("birthdays")
def birthdays():
    return ok(anilist.birthdays())


# ── reviews + recommendations ────────────────────────────────────────────────

@anime_bp.get("/reviews")
@guarded("reviews")
def reviews():
    return ok(anilist.reviews(page=_page(), media_id=request.args.get("media_id", type=int),
                              sort=request.args.get("sort") or "recent"))


@anime_bp.get("/review/<int:review_id>")
@guarded("review")
def review(review_id):
    data = anilist.review(review_id)
    return ok(data) if data else err("not found", 404)


@anime_bp.post("/review/<int:review_id>/rate")
@authed("review vote")
def rate_review(token, review_id):
    return ok(anilist.rate_review(token, review_id, _body().get("rating") or "NO_VOTE"))


@anime_bp.get("/review/mine/<int:media_id>")
@authed("review")
def my_review(token, media_id):
    return ok(anilist.my_review(token, media_id))


@anime_bp.post("/review")
@authed("save review")
def save_review(token):
    b = _body()
    if not b.get("media_id"):
        raise ValueError("media_id required")
    return ok(anilist.save_review(
        token, int(b["media_id"]), b.get("summary"), b.get("body"), b.get("score"),
        private=bool(b.get("private")), review_id=b.get("id")))


@anime_bp.delete("/review/<int:review_id>")
@authed("delete review")
def delete_review(token, review_id):
    return ok(anilist.delete_review(token, review_id, request.args.get("media_id", type=int)))


@anime_bp.post("/markdown")
@guarded("markdown preview")
def markdown():
    return ok({"html": anilist.render_markdown((_body().get("text") or "")[:20000])})


@anime_bp.get("/recommendations")
@guarded("recommendations")
def recommendations():
    on_list = request.args.get("on_list") == "1"
    token = _token()
    if on_list and not token:
        return err("Connect AniList for recommendations based on your list.", 401)
    return ok(anilist.recommendations_feed(page=_page(), on_list=on_list, token=token))


# ── notifications + following ────────────────────────────────────────────────

@anime_bp.get("/notifications")
@authed("notifications")
def notifications(token):
    return ok(anilist.notifications(
        token, page=_page(), group=request.args.get("group") or None,
        reset=request.args.get("reset") == "1"))


@anime_bp.get("/notifications/count")
@authed("notification count")
def notification_count(token):
    return ok({"unread": anilist.unread_count(token)})


@anime_bp.post("/follow")
@authed("follow")
def follow(token):
    uid = _body().get("user_id")
    if not uid:
        raise ValueError("user_id required")
    return ok(anilist.toggle_follow(token, int(uid)))


@anime_bp.get("/follows/<int:user_id>")
@guarded("follows")
def follows(user_id):
    return ok(anilist.follows(user_id, which=request.args.get("which") or "following", page=_page()))


# ── forum writes ─────────────────────────────────────────────────────────────

@anime_bp.post("/thread")
@authed("new thread")
def new_thread(token):
    b = _body()
    title, text = (b.get("title") or "").strip(), (b.get("body") or "").strip()
    if len(title) < 3 or not text:
        raise ValueError("a thread needs a title and a body")
    return ok(anilist.save_thread(token, title, text, b.get("categories"), b.get("media_ids")))


@anime_bp.post("/thread/<int:thread_id>/subscribe")
@authed("thread subscription")
def thread_subscribe(token, thread_id):
    return ok(anilist.toggle_thread_subscription(token, thread_id, bool(_body().get("subscribe"))))


# ── your numbers ─────────────────────────────────────────────────────────────

@anime_bp.get("/stats")
@authed("statistics")
def stats(token):
    return ok(anilist.list_stats(token))


@anime_bp.get("/compare/<name>")
@authed("comparison")
def compare(token, name):
    return ok(anilist.compare_with(token, name))


# ── list housekeeping: bulk edits + custom lists ─────────────────────────────

@anime_bp.post("/list/bulk")
@authed("bulk edit")
def list_bulk(token):
    b = _body()
    ids = [int(i) for i in b.get("entry_ids") or [] if i]
    if not ids:
        raise ValueError("entry_ids required")
    if b.get("delete"):
        return ok({"deleted": anilist.bulk_delete(token, ids)})
    fields = {k: b[k] for k in ("status", "private", "hidden", "score") if k in b}
    if not fields:
        raise ValueError("nothing to change")
    return ok({"updated": anilist.bulk_update(token, ids, **fields)})


@anime_bp.post("/customlists")
@authed("custom lists")
def add_custom_list(token):
    name = (_body().get("name") or "").strip()
    if not name:
        raise ValueError("a list needs a name")
    current = anilist.viewer_settings(token).get("custom_lists") or []
    if name in current:
        raise ValueError(f"“{name}” already exists")
    anilist.update_user(token, custom_lists=current + [name])
    return ok(anilist.viewer_settings(token))


@anime_bp.delete("/customlists/<path:name>")
@authed("custom lists")
def remove_custom_list(token, name):
    anilist.delete_custom_list(token, name)
    return ok(anilist.viewer_settings(token))


# ── episodes + local playback (aggregator proxied through Tubcal) ─────────────

@anime_bp.get("/episodes/<int:anilist_id>")
def episodes(anilist_id):
    try:
        return ok(anime_source.info(anilist_id))
    except Exception as e:
        return err(f"episode source unavailable: {e}", 502)


def _watch(key):
    """Resolve+cache an episode's sources briefly (the proxy handlers reuse it)."""
    data, _ = cache.cached(f"anime:watch:{key}", 300, lambda: anime_source.watch(key))
    return data


def _referer(data):
    return (data.get("headers") or {}).get("Referer")


@anime_bp.get("/stream/<key>")
def stream(key):
    """Player stream resolution → {streams:[{kind,itag,quality}], subtitles:[…]}."""
    try:
        data = _watch(key)
    except Exception as e:
        return err(f"source resolve failed: {e}", 502)
    streams = []
    for src in data.get("sources") or []:
        if not src.get("url"):
            continue
        q = str(src.get("quality") or ("hls" if src.get("isM3U8") else "mp4"))
        streams.append({"kind": "hls" if src.get("isM3U8") else "mp4", "itag": q, "quality": q})
    subs = []
    for sub in data.get("subtitles") or []:
        u = sub.get("url") or ""
        if not u or ".vtt" not in u.lower():  # <track> only renders WebVTT
            continue
        lang = sub.get("lang") or "Subtitles"
        subs.append({"src": f"/api/anime/sub?u={_b64(u)}", "lang": lang[:8], "label": lang})
    return ok({"streams": streams, "subtitles": subs})


# ── byte/playlist proxy (forwards the source's Referer; relays Range) ─────────

_PASS = ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges")
_URI_RE = re.compile(r'URI="([^"]+)"')


def _b64(s):
    return base64.urlsafe_b64encode(s.encode()).decode()


def _unb64(t):
    return base64.urlsafe_b64decode(t.encode()).decode()


def _fwd(referer=None):
    h = {"User-Agent": config.BROWSER_UA}
    if referer:
        h["Referer"] = referer
    if request.headers.get("Range"):
        h["Range"] = request.headers["Range"]
    return h


def _relay(upstream, default_ct="application/octet-stream"):
    def generate():
        try:
            for chunk in upstream.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    headers = {k: upstream.headers[k] for k in _PASS if k in upstream.headers}
    headers.setdefault("Accept-Ranges", "bytes")
    return Response(
        stream_with_context(generate()),
        status=upstream.status_code,
        headers=headers,
        content_type=upstream.headers.get("Content-Type", default_ct),
    )


def _seg_url(abs_url, referer):
    return f"/api/anime/hls/seg?u={_b64(abs_url)}&r={_b64(referer or '')}"


def _pl_url(abs_url, referer):
    return f"/api/anime/hls/pl?u={_b64(abs_url)}&r={_b64(referer or '')}"


def _rewrite(text, base_url, referer):
    """Point every nested playlist/segment/key URI back through our proxy. A master
    playlist's variant + EXT-X-MEDIA URIs become nested playlists; a media
    playlist's segments + KEY/MAP URIs become segment fetches."""
    is_master = "EXT-X-STREAM-INF" in text
    out = []
    for line in text.splitlines():
        st = line.strip()
        if not st:
            out.append(line)
        elif st.startswith("#"):
            if st.startswith("#EXT-X-MEDIA") or (is_master and "URI=" in st):
                out.append(_URI_RE.sub(lambda m: f'URI="{_pl_url(urljoin(base_url, m.group(1)), referer)}"', st))
            else:
                out.append(_URI_RE.sub(lambda m: f'URI="{_seg_url(urljoin(base_url, m.group(1)), referer)}"', st))
        else:
            target = _pl_url(urljoin(base_url, st), referer) if is_master else _seg_url(urljoin(base_url, st), referer)
            out.append(target)
    return "\n".join(out) + "\n"


@anime_bp.get("/hls/<key>/<itag>.m3u8")
def hls(key, itag):
    try:
        data = _watch(key)
    except Exception as e:
        return err(f"source resolve failed: {e}", 502)
    referer = _referer(data)
    sources = data.get("sources") or []
    src = next((x for x in sources if str(x.get("quality")) == itag and x.get("isM3U8")), None) \
        or next((x for x in sources if x.get("isM3U8")), None)
    if not src:
        return err("no HLS source", 404)
    try:
        text = httpc.get(src["url"], headers=_fwd(referer), timeout=25).text
    except Exception as e:
        return err(f"playlist fetch failed: {e}", 502)
    return Response(_rewrite(text, src["url"], referer), content_type="application/vnd.apple.mpegurl")


@anime_bp.get("/hls/pl")
def hls_pl():
    u, r = request.args.get("u"), request.args.get("r")
    if not u:
        return err("u required")
    url, referer = _unb64(u), (_unb64(r) if r else None)
    try:
        text = httpc.get(url, headers=_fwd(referer), timeout=25).text
    except Exception as e:
        return err(f"playlist fetch failed: {e}", 502)
    return Response(_rewrite(text, url, referer), content_type="application/vnd.apple.mpegurl")


@anime_bp.get("/hls/seg")
def hls_seg():
    u, r = request.args.get("u"), request.args.get("r")
    if not u:
        return err("u required")
    url, referer = _unb64(u), (_unb64(r) if r else None)
    upstream = httpc.session.get(url, headers=_fwd(referer), stream=True, timeout=25, allow_redirects=True)
    return _relay(upstream, default_ct="video/mp2t")


@anime_bp.get("/stream/<key>/data")
def stream_data(key):
    itag = request.args.get("itag")
    try:
        data = _watch(key)
    except Exception as e:
        return err(f"source resolve failed: {e}", 502)
    referer = _referer(data)
    sources = data.get("sources") or []
    src = next((x for x in sources if str(x.get("quality")) == itag and not x.get("isM3U8")), None) \
        or next((x for x in sources if not x.get("isM3U8")), None)
    if not src:
        return err("no progressive source", 502)
    upstream = httpc.session.get(src["url"], headers=_fwd(referer), stream=True, timeout=25, allow_redirects=True)
    return _relay(upstream, default_ct="video/mp4")


@anime_bp.get("/sub")
def sub():
    u = request.args.get("u")
    if not u:
        return err("u required")
    upstream = httpc.session.get(_unb64(u), headers={"User-Agent": config.BROWSER_UA}, stream=True, timeout=20)
    return _relay(upstream, default_ct="text/vtt")
