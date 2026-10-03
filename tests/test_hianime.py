"""hianime / ZokoAnime: the embed blob, page parsing, the watch payload, and the
order anime_source tries its sources in. The network edge is monkeypatched."""

import base64
import json

import pytest

from server.sources import anime_source, hianime


def _blob(cfg):
    raw = json.dumps(cfg).encode()
    return base64.b64encode(bytes(b ^ hianime.KEY[i % len(hianime.KEY)] for i, b in enumerate(raw))).decode()


CFG = {
    "src": "https://hls.example/p/abc/master.m3u8",
    "subtitles": [
        {"lang": "en", "label": "German (German - [Full])", "default": False, "src": "https://hls.example/subs/de.vtt"},
        {"lang": "en", "label": "English", "default": True, "src": "https://hls.example/subs/en.vtt"},
        {"lang": "en", "label": "Japanese (Japanese - [SDH])", "default": False, "src": "https://hls.example/subs/ja.vtt"},
    ],
    "skip": {"intro": {"start": 42, "end": 132}, "outro": {"start": 1313, "end": 1406}},
}


def test_deobfuscate_round_trips_the_xor_blob():
    assert hianime.deobfuscate(_blob(CFG)) == CFG
    # the page's base64 sometimes arrives without its padding
    assert hianime.deobfuscate(_blob(CFG).rstrip("=")) == CFG


def test_parse_search_skips_the_sidebar_repeat():
    page = (
        '<div class="film-detail"><h3 class="film-name"> <a href="/anime/fatezero-1115" title="Fate/Zero">x</a></h3></div>'
        '<div class="film-detail"><h3 class="film-name"><a href="/anime/fatezero-season-2-1117" title="Fate/Zero Season 2">x</a></h3></div>'
        '<div id="main-sidebar"><h3 class="film-name"><a href="/anime/one-piece-100" title="One &amp; Piece">x</a></h3></div>'
    )
    assert hianime.parse_search(page) == [("fatezero-1115", "Fate/Zero"), ("fatezero-season-2-1117", "Fate/Zero Season 2")]


def test_parse_episodes_reads_the_fragment_and_guards_the_slug():
    frag = (
        '<a class="ssl-item ep-item" data-number="1" data-id="18716" href="/watch/fatezero-1115?ep=18716">'
        '<a class="ssl-item ep-item" data-number="2" data-id="18717" href="/watch/fatezero-1115?ep=18717">'
        '<a class="ssl-item ep-item" data-number="1" data-id="99" href="/watch/other-show-9?ep=99">'
        '<a class="ssl-item ep-item" data-number="12.5" data-id="18730" href="/watch/fatezero-1115?ep=18730">'
    )
    payload = {"status": True, "html": frag.replace('"', '\\"')}
    assert hianime.parse_episodes(payload, "fatezero-1115") == {1: "18716", 2: "18717", 12.5: "18730"}


def test_parse_servers_decodes_each_embed():
    url = "https://zokoanime.video/stream/mal/10087/8/sub"
    h = base64.b64encode(url.encode()).decode()
    frag = (
        f'<div class="item server-item" data-type="sub" data-server-name="ZokoAnime" data-hash="{h}"></div>'
        f'<div class="item server-item" data-type="sub" data-server-name="HD-1" data-hash="{h}"></div>'
        '<div class="item server-item" data-type="dub" data-server-name="ZokoAnime"></div>'
    )
    out = hianime.parse_servers({"html": frag})
    assert out == [
        {"type": "sub", "name": "ZokoAnime", "embed": url},
        {"type": "sub", "name": "HD-1", "embed": url},
    ]


def test_to_watch_shapes_the_payload():
    w = hianime.to_watch(CFG, "https://zokoanime.video/stream/mal/1/8/sub", "sub")
    assert w["sources"] == [{"url": CFG["src"], "quality": "auto", "isM3U8": True}]
    assert w["headers"] == {"Referer": "https://zokoanime.video/"}
    assert w["skip"] == {"intro": {"start": 42.0, "end": 132.0}, "outro": {"start": 1313.0, "end": 1406.0}}
    assert w["audio"] == "sub"
    # the site's default track first; labels cleaned; languages from the label
    assert [(s["lang"], s["label"], s["default"]) for s in w["subtitles"]] == [
        ("en", "English", True), ("de", "German", False), ("ja", "Japanese", False),
    ]


def test_to_watch_drops_nonsense_skip_spans_and_refuses_no_stream():
    cfg = {**CFG, "skip": {"intro": {"start": 50, "end": 10}, "outro": {"start": "x"}}}
    assert hianime.to_watch(cfg, "https://z.example/e", "sub")["skip"] == {}
    with pytest.raises(hianime.NotAvailable):
        hianime.to_watch({"src": ""}, "https://z.example/e", "sub")


def _embeds(monkeypatch, have):
    """embed_config that serves CFG for the (episode, audio) pairs in `have`."""
    seen = []

    def fake(url):
        seen.append(url)
        ep, audio = url.rsplit("/", 2)[-2:]
        if (int(ep), audio) in have:
            return CFG
        raise hianime.NotAvailable("empty player")

    monkeypatch.setattr(hianime, "embed_config", fake)
    return seen


def test_resolve_goes_direct_by_mal_id(monkeypatch):
    seen = _embeds(monkeypatch, {(8, "sub"), (8, "dub")})
    w = hianime.resolve(8, mal_id=10087)
    assert seen[0] == "https://zokoanime.video/stream/mal/10087/8/sub"
    assert w["audio"] == "sub" and w["audio_options"] == ["sub", "dub"]


def test_resolve_falls_back_to_sub_when_no_dub(monkeypatch):
    _embeds(monkeypatch, {(8, "sub")})
    w = hianime.resolve(8, mal_id=10087, want_dub=True)
    assert w["audio"] == "sub" and w["audio_options"] == ["sub"]


def test_resolve_explains_itself_when_nothing_plays(monkeypatch):
    _embeds(monkeypatch, set())
    with pytest.raises(hianime.NotAvailable, match="sub: empty player"):
        hianime.resolve(8, mal_id=10087)


# ── anime_source: the order sources are tried in ─────────────────────────────

def test_watch_old_anipy_keys_resolve_through_hianime(monkeypatch):
    calls = {}

    def fake_resolve(episode, **kw):
        calls.update(kw, episode=episode)
        return {"sources": [{"url": "u", "isM3U8": True}], "audio": "sub"}

    monkeypatch.setattr(hianime, "resolve", fake_resolve)
    monkeypatch.setattr(anime_source.anilist, "media", lambda aid: {"id_mal": 10087, "title_romaji": "Fate/Zero"})
    key = anime_source._encode_key("allanime", "wa4fPudphY6oQZFkf", 8, "sub", 10087)
    assert anime_source.watch(key)["sources"]
    assert calls["episode"] == 8 and calls["mal_id"] == 10087 and calls["want_dub"] is False


def test_watch_reports_every_source_that_failed(monkeypatch):
    def nope(episode, **kw):
        raise hianime.NotAvailable("episode gone")

    monkeypatch.setattr(hianime, "resolve", nope)
    monkeypatch.setattr(anime_source, "_fallback_watch", lambda *a: None)
    monkeypatch.setattr(anime_source.anilist, "media", lambda aid: {"id_mal": 1})
    key = anime_source._encode_key("hianime", "mal:1", 3, "sub", 1)
    with pytest.raises(RuntimeError, match="hianime: episode gone.*aniworld"):
        anime_source.watch(key)


def test_with_audio_swaps_only_the_language():
    key = anime_source._encode_key("hianime", "mal:10087", 8, "sub", 10087)
    other = anime_source._decode_key(anime_source.with_audio(key, "dub"))
    assert other == ("hianime", "mal:10087", 8, "dub", 10087)


def test_info_numbers_episodes_from_anilist_after_one_probe(client, monkeypatch):
    from server import cache
    cache.invalidate("anime:info:")
    monkeypatch.setattr(anime_source.anilist, "media",
                        lambda aid: {"id_mal": 10087, "status": "FINISHED", "episodes": 13, "title_romaji": "Fate/Zero"})
    probes = _embeds(monkeypatch, {(1, "sub")})
    d = anime_source.info(10087)
    assert [e["number"] for e in d["episodes"]] == list(range(1, 14)) and d["provider"] == "hianime"
    assert probes == ["https://zokoanime.video/stream/mal/10087/1/sub"]
    assert anime_source._decode_key(d["episodes"][7]["key"])[:3] == ("hianime", "mal:10087", 8)


def test_info_airing_show_counts_to_the_last_aired(client, monkeypatch):
    from server import cache
    cache.invalidate("anime:info:")
    monkeypatch.setattr(anime_source.anilist, "media",
                        lambda aid: {"id_mal": 5, "status": "RELEASING", "next_episode": 9, "episodes": 24})
    _embeds(monkeypatch, {(1, "sub")})
    assert anime_source.info(5)["total"] == 8
