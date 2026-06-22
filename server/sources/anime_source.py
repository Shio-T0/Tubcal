"""Episode-source adapter.

Talks to a local, AniList-id-mapped meta-aggregator (Consumet-compatible) whose
base URL is configured in Settings (key: anime_source_url) or via env. It only
forwards what that service returns; Tubcal proxies the resulting HLS/mp4 + subtitle
URLs through its own endpoints so the browser only ever talks to localhost.

Pluggable by design: swap this module's `info`/`watch` for a local-files or torrent
adapter later without touching the player or the proxy endpoints.
"""

import base64
from urllib.parse import quote

from .. import config, db, httpc


def _base():
    return (db.get_setting("anime_source_url") or config.ANIME_SOURCE_URL or "").rstrip("/")


def _provider():
    return db.get_setting("anime_provider") or config.ANIME_PROVIDER or ""


def _key(episode_id):
    """Opaque, URL-safe handle for an episode id (which may contain $ / : etc.)."""
    return base64.urlsafe_b64encode(str(episode_id).encode()).decode()


def episode_id_from_key(key):
    return base64.urlsafe_b64decode(key.encode()).decode()


def _params():
    return {"provider": _provider()} if _provider() else {}


def info(anilist_id):
    """Episode list for an AniList id, mapped by the aggregator."""
    base = _base()
    if not base:
        raise RuntimeError("no anime source configured (set it in Settings → Anime)")
    data = httpc.get(f"{base}/meta/anilist/info/{anilist_id}", params=_params(), timeout=25).json()
    eps = []
    for e in (data.get("episodes") or []):
        num = e.get("number")
        eps.append({
            "key": _key(e.get("id")),
            "number": num,
            "title": e.get("title") or (f"Episode {num}" if num is not None else "Episode"),
            "image": e.get("image"),
        })
    return {"episodes": eps, "total": data.get("totalEpisodes") or len(eps)}


def watch(key):
    """Resolve playable sources + subtitles for one episode key.

    Returns the aggregator's raw shape: {sources:[{url,quality,isM3U8}],
    subtitles:[{url,lang}], headers:{Referer}}. Tubcal proxies the URLs itself.
    """
    base = _base()
    if not base:
        raise RuntimeError("no anime source configured (set it in Settings → Anime)")
    episode_id = episode_id_from_key(key)
    url = f"{base}/meta/anilist/watch/{quote(episode_id, safe='')}"
    return httpc.get(url, params=_params(), timeout=30).json()
