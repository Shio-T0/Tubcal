"""The Anime room — AniList browse/search/detail/lists (reads).

List writes, the episode source, discussions and the trailer channel land in later
phases. Reads work without a connected account; the optional token only enriches a
detail page with your own list status.
"""

import base64
import re
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


@anime_bp.get("/search")
def search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return ok({"items": []})
    page = int(request.args.get("page") or 1)
    try:
        return ok({"items": anilist.search(q, page=page)})
    except Exception as e:
        return err(f"AniList search failed: {e}", 502)


@anime_bp.get("/browse")
def browse():
    kind = request.args.get("kind") or "trending"
    page = int(request.args.get("page") or 1)
    try:
        return ok({"items": anilist.browse(kind, page=page), "kind": kind})
    except Exception as e:
        return err(f"AniList browse failed: {e}", 502)


@anime_bp.get("/media/<int:media_id>")
def media(media_id):
    try:
        data = anilist.media(media_id, token=_token())
        if not data:
            return err("not found", 404)
        return ok(data)
    except Exception as e:
        return err(f"AniList media failed: {e}", 502)


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
    status, progress, score = body.get("status"), body.get("progress"), body.get("score")
    if status is None and progress is None and score is None:
        return err("nothing to update")
    try:
        return ok(anilist.save_list_entry(
            token, int(media_id), status=status, progress=progress, score=score))
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
    except Exception as e:
        return err(f"AniList recommend failed: {e}", 502)


# ── discussions: forum threads + activity feed ───────────────────────────────

@anime_bp.get("/threads")
def threads():
    media_id = request.args.get("media_id", type=int)
    page = int(request.args.get("page") or 1)
    try:
        return ok({"items": anilist.forum_threads(media_id=media_id, page=page)})
    except Exception as e:
        return err(f"AniList threads failed: {e}", 502)


@anime_bp.get("/thread/<int:thread_id>")
def thread(thread_id):
    try:
        return ok(anilist.thread(thread_id))
    except Exception as e:
        return err(f"AniList thread failed: {e}", 502)


@anime_bp.post("/thread/<int:thread_id>/comment")
def thread_comment(thread_id):
    try:
        token = get_valid_token("anilist")
    except LookupError as e:
        return err(str(e), 401)
    text = ((request.get_json(force=True, silent=True) or {}).get("text") or "").strip()
    if not text:
        return err("comment text required")
    try:
        return ok(anilist.save_thread_comment(token, thread_id, text))
    except Exception as e:
        return err(f"AniList comment failed: {e}", 502)


@anime_bp.get("/activity")
def activity():
    media_id = request.args.get("media_id", type=int)
    page = int(request.args.get("page") or 1)
    try:
        return ok({"items": anilist.activity_feed(media_id=media_id, page=page)})
    except Exception as e:
        return err(f"AniList activity failed: {e}", 502)


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
