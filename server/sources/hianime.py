"""hianime.at + its ZokoAnime embed — the anime episode source ani-cli uses (5.1+).

allanime, which anipy scraped, stopped answering (`AA_CRYPTO_STALE`), and anipy
3.10 dropped it from its provider registry altogether — so ani-cli moved here and
so do we.

Credit: the method comes from ani-cli (https://github.com/pystardust/ani-cli,
GPL-3.0-or-later, the ani-cli contributors). That covers which pages to ask, the
ZokoAnime embed, and the `otaku-embed-v1` key. This module is a separate Python
implementation written for Tubcal, not a copy of ani-cli's script; see
THIRD_PARTY_NOTICES.md. The steps:

  1. hianime.at search → the show's slug        (`/search?keyword=`)
  2. its episode list  → the episode's id       (`/api/theme/episode/list/<id>`)
  3. that episode's servers → the ZokoAnime one (`/api/theme/episode/servers`);
     its `data-hash` is the base64 of the embed page's URL
  4. the embed page carries its whole player config as `window.__P`: base64 of the
     JSON XOR-ed with the ASCII key "otaku-embed-v1"
  5. the config holds the HLS master, every subtitle track, and the intro/outro
     timings the player turns into Skip buttons.

The embed URL is keyed by MyAnimeList id and episode number
(`zokoanime.video/stream/mal/<mal>/<ep>/<sub|dub>`), and AniList carries each
show's MAL id. So when we have one, steps 1–3 are skipped: no title search to get
wrong, and two requests instead of five. The hianime walk stays as the route for
titles without a MAL id, or if the embed ever stops being addressable that way.

The stream host serves plain MPEG-TS (named `.ts.jpg`) without caring about the
Referer; the subtitle host refuses without the embed origin as Referer, which is
what `headers` carries for the proxy.

Pure, tested pieces: `deobfuscate`, `parse_search`, `parse_episodes`,
`parse_servers`, `to_watch` (tests/test_hianime.py).
"""

import base64
import html as htmllib
import json
import re
from urllib.parse import quote

from .. import httpc

BASE = "https://hianime.at"
EMBED = "https://zokoanime.video"
KEY = b"otaku-embed-v1"
SERVER = "ZokoAnime"  # the one embed deobfuscate() understands; the others use other players
# ani-cli's user agent: hianime sits behind Cloudflare, which is kinder to a browser UA.
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

_BLOB = re.compile(r'window\.__P\s*=\s*"([^"]+)"')
_FILM = re.compile(r'<h3 class="film-name">\s*<a href="[^"]*/([^"/]+)"\s*title="([^"]*)"')
_SERVER_TAG = re.compile(r"<[^>]*\bserver-item\b[^>]*>")
_ATTR = re.compile(r'(data-[a-z-]+)="([^"]*)"')
# subtitle labels → BCP-47 for <track srclang> (the config says "en" for every track)
_LANGS = {
    "english": "en", "german": "de", "japanese": "ja", "portuguese": "pt", "spanish": "es",
    "french": "fr", "italian": "it", "arabic": "ar", "russian": "ru", "indonesian": "id",
    "thai": "th", "vietnamese": "vi", "malay": "ms", "chinese": "zh", "korean": "ko",
    "polish": "pl", "turkish": "tr", "hindi": "hi",
}


class NotAvailable(RuntimeError):
    """The source doesn't have this episode (in this language)."""


# ── pure pieces ──────────────────────────────────────────────────────────────

def deobfuscate(blob):
    """`window.__P` → the embed's config dict (base64, then XOR with KEY)."""
    raw = base64.b64decode(blob + "=" * (-len(blob) % 4))
    return json.loads(bytes(b ^ KEY[i % len(KEY)] for i, b in enumerate(raw)).decode("utf-8"))


def parse_search(page):
    """hianime's search page → [(slug, title)]. The "top 10" sidebar repeats the
    result markup, so the page is cut before it (as ani-cli does)."""
    page = page.split('id="main-sidebar"', 1)[0]
    return [(slug, htmllib.unescape(title)) for slug, title in _FILM.findall(page)]


def parse_episodes(payload, slug=None):
    """The episode-list API (JSON with an `html` fragment) → {number: episode_id}.
    With `slug`, only links into that show count — ani-cli's guard against ids
    from an older provider sharing the same shape."""
    frag = payload.get("html") if isinstance(payload, dict) else str(payload or "")
    frag = (frag or "").replace("\\", "")
    out = {}
    for tag in re.findall(r"<a[^>]*\bep-item\b[^>]*>", frag):
        attrs = dict(_ATTR.findall(tag))
        num, eid = attrs.get("data-number"), attrs.get("data-id")
        if not (num and eid and eid.isdigit()):
            continue
        if slug and f"/watch/{slug}" not in tag:
            continue
        try:
            n = float(num)
        except ValueError:
            continue
        out[int(n) if n.is_integer() else n] = eid
    return out


def parse_servers(payload):
    """The servers API → [{type: 'sub'|'dub', name, embed}] (the hash decoded)."""
    frag = payload.get("html") if isinstance(payload, dict) else str(payload or "")
    frag = (frag or "").replace('\\"', '"')
    out = []
    for tag in _SERVER_TAG.findall(frag):
        a = dict(_ATTR.findall(tag))
        h = a.get("data-hash")
        if not h:
            continue
        try:
            embed = base64.b64decode(h + "=" * (-len(h) % 4)).decode("utf-8")
        except Exception:
            continue
        out.append({"type": a.get("data-type"), "name": a.get("data-server-name"), "embed": embed})
    return out


def _origin(url):
    m = re.match(r"^(https?://[^/]+)", url or "")
    return (m.group(1) + "/") if m else None


def _lang_code(label, fallback):
    first = (label or "").split(" ", 1)[0].strip("([").lower()
    return _LANGS.get(first, fallback or "und")


def _span(d):
    try:
        start, end = float(d["start"]), float(d["end"])
    except (TypeError, KeyError, ValueError):
        return None
    return {"start": start, "end": end} if end > start >= 0 else None


def to_watch(cfg, embed_url, audio):
    """The embed config → the watch() payload the player + proxy already speak,
    plus `skip` (intro/outro spans, seconds) and the `audio` actually served."""
    src = cfg.get("src") or ""
    if ".m3u8" not in src:
        raise NotAvailable("the embed has no HLS stream")
    subs = []
    for s in cfg.get("subtitles") or []:
        if not s.get("src"):
            continue
        label = (s.get("label") or s.get("lang") or "Subtitles").strip()
        subs.append({
            "url": s["src"],
            "lang": _lang_code(label, s.get("lang")),
            "label": re.sub(r"\s*\(.*\)$", "", label) or label,
            "default": bool(s.get("default")),
        })
    subs.sort(key=lambda s: not s["default"])  # the site's default track first
    skip = {k: v for k, v in ((k, _span((cfg.get("skip") or {}).get(k))) for k in ("intro", "outro")) if v}
    return {
        "sources": [{"url": src, "quality": "auto", "isM3U8": True}],
        "subtitles": subs,
        "headers": {"Referer": _origin(embed_url)},
        "skip": skip,
        "audio": audio,
        "provider": "hianime",
    }


# ── network ──────────────────────────────────────────────────────────────────

def _get(url, referer=None):
    headers = {"Referer": referer} if referer else None
    return httpc.get(url, ua=UA, headers=headers, timeout=15, anonymous=True)


def embed_url(mal_id, episode, audio):
    return f"{EMBED}/stream/mal/{int(mal_id)}/{episode}/{audio}"


def embed_config(url):
    """Fetch an embed page and decode its config. NotAvailable if it has none
    (an episode or language the source doesn't carry renders an empty player)."""
    m = _BLOB.search(_get(url, referer=BASE + "/").text)
    if not m:
        raise NotAvailable("no player config on the embed page")
    return deobfuscate(m.group(1))


def _ratio(a, b):
    try:
        from rapidfuzz import fuzz
        return fuzz.WRatio(a, b)
    except Exception:
        import difflib
        return difflib.SequenceMatcher(None, a, b).ratio() * 100


def find_show(titles):
    """Best hianime slug for any of `titles` (romaji first works best), or None."""
    for title in titles:
        results = parse_search(_get(f"{BASE}/search?keyword={quote(title)}").text)
        if not results:
            continue
        slug, score = max(
            ((slug, max(_ratio(t.lower(), name.lower()) for t in titles)) for slug, name in results),
            key=lambda x: x[1],
        )
        if score >= 80:
            return slug
    return None


def episode_list(slug):
    """{number: episode_id} for a hianime slug."""
    r = _get(f"{BASE}/api/theme/episode/list/{slug.rsplit('-', 1)[-1]}")
    return parse_episodes(r.json(), slug)


def _via_site(slug, episode, langs):
    eps = episode_list(slug)
    eid = eps.get(episode)
    if not eid:
        raise NotAvailable(f"hianime has no episode {episode}")
    servers = parse_servers(_get(f"{BASE}/api/theme/episode/servers?episodeId={eid}").json())
    for audio in langs:
        for s in servers:
            if s["type"] == audio and s["name"] == SERVER:
                try:
                    return to_watch(embed_config(s["embed"]), s["embed"], audio)
                except NotAvailable:
                    break
    raise NotAvailable(f"no {SERVER} stream for episode {episode}")


def resolve(episode, *, mal_id=None, slug=None, titles=(), want_dub=False):
    """One episode's watch payload. The language asked for first, then the other —
    `audio` in the result says which one came back. Direct by MAL id when there is
    one, else (or failing that) by walking hianime the way ani-cli does — from a
    known `slug`, or by searching `titles`."""
    langs = ["dub", "sub"] if want_dub else ["sub", "dub"]
    errors = []
    if slug:
        return _via_site(slug, episode, langs)
    if mal_id:
        for audio in langs:
            url = embed_url(mal_id, episode, audio)
            try:
                payload = to_watch(embed_config(url), url, audio)
            except Exception as e:  # noqa: BLE001 — try the other language, then the site
                errors.append(f"{audio}: {e}")
                continue
            payload["audio_options"] = available_audio(mal_id, episode, have=audio)
            return payload
    if titles:
        slug = find_show(list(titles))
        if not slug:
            errors.append("hianime search found no matching show")
        else:
            try:
                return _via_site(slug, episode, langs)
            except Exception as e:  # noqa: BLE001
                errors.append(str(e))
    raise NotAvailable("; ".join(errors) or "no MAL id and no title to search")


def available_audio(mal_id, episode, have):
    """Which of sub/dub this episode has — `have` is known; the other is one fetch."""
    other = "dub" if have == "sub" else "sub"
    try:
        embed_config(embed_url(mal_id, episode, other))
        return sorted([have, other], key=lambda a: a != "sub")
    except Exception:  # noqa: BLE001 — not there (or unreachable): offer what we have
        return [have]
