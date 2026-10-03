"""AnimeThemes: episode-span parsing, theme normalisation, the endpoint, and the
three theme-player settings."""

from server import cache, httpc
from server.sources import animethemes


def _video(audio):
    return {"audio": {"link": audio} if audio else None}


def _theme(type_, seq, title, entries, artists=("SPYAIR",)):
    return {
        "type": type_, "sequence": seq, "slug": f"{type_}{seq}",
        "song": {"title": title, "artists": [{"name": a} for a in artists]},
        "animethemeentries": entries,
    }


ANIME = {
    "slug": "juukishi",
    "animethemes": [
        _theme("ED", 1, "Lv.1", [{"episodes": "1-", "videos": [_video("https://a.animethemes.moe/ED1.ogg")]}]),
        _theme("OP", 2, "Rewrite the Answer", [{"episodes": "14-", "videos": [_video("https://a.animethemes.moe/OP2.ogg")]}]),
        _theme("OP", 1, "Awake", [
            {"episodes": "1-13", "spoiler": False, "videos": [_video(None), _video("https://a.animethemes.moe/OP1.ogg")]},
            {"episodes": "25", "videos": [_video("https://a.animethemes.moe/OP1v2.ogg")]},
        ]),
        # no audio rip anywhere → not playable, dropped
        _theme("OP", 3, "Silent", [{"episodes": "26", "videos": [_video(None)]}]),
        # an insecure link is not one we'd hand an <audio> element
        _theme("IN", 1, "Insert", [{"episodes": "5", "videos": [_video("http://a.animethemes.moe/IN1.ogg")]}]),
    ],
}


def test_parse_episodes_spans():
    assert animethemes.parse_episodes("1-12") == [[1, 12]]
    assert animethemes.parse_episodes("14-") == [[14, None]]
    assert animethemes.parse_episodes("1000") == [[1000, 1000]]
    assert animethemes.parse_episodes("1-4, 6") == [[1, 4], [6, 6]]
    assert animethemes.parse_episodes("1-2, Recap") == [[1, 2]]
    assert animethemes.parse_episodes(None) == []
    assert animethemes.parse_episodes("") == []


def test_normalize_orders_openings_first_and_drops_silent_themes():
    out = animethemes.normalize(ANIME)
    assert [t["slug"] for t in out] == ["OP1", "OP2", "ED1"]
    op1 = out[0]
    # the first entry with an audio rip wins; its span is the theme's span
    assert op1["audio"] == "https://a.animethemes.moe/OP1.ogg"
    assert op1["episodes"] == "1-13" and op1["ranges"] == [[1, 13]]
    assert op1["title"] == "Awake" and op1["artists"] == ["SPYAIR"]
    assert out[1]["ranges"] == [[14, None]]


def test_normalize_tolerates_nothing():
    assert animethemes.normalize(None) == []
    assert animethemes.normalize({"animethemes": None}) == []


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def test_endpoint_returns_themes_and_page(client, monkeypatch):
    calls = []

    def fake_get(url, **kw):
        calls.append(kw)
        return _Resp({"anime": [ANIME]})

    monkeypatch.setattr(httpc, "get", fake_get)
    cache.invalidate("animethemes:")
    r = client.get("/api/anime/themes/180136").get_json()
    assert r["ok"]
    assert [t["slug"] for t in r["data"]["themes"]] == ["OP1", "OP2", "ED1"]
    assert r["data"]["page"] == "https://animethemes.moe/anime/juukishi"
    # looked up by AniList id, anonymously
    assert calls[0]["params"]["filter[external_id]"] == "180136"
    assert calls[0]["anonymous"] is True
    # a second look is served from the cache
    client.get("/api/anime/themes/180136")
    assert len(calls) == 1


def test_endpoint_unknown_title_is_empty(client, monkeypatch):
    monkeypatch.setattr(httpc, "get", lambda url, **kw: _Resp({"anime": []}))
    cache.invalidate("animethemes:")
    r = client.get("/api/anime/themes/1").get_json()
    assert r["ok"] and r["data"] == {"themes": [], "page": None}


def test_theme_settings_seeded_and_validated(client):
    s = client.get("/api/settings").get_json()["data"]
    assert s["anime_theme_audio"] is True
    assert s["anime_theme_volume"] == 0.35
    assert s["anime_theme_seconds"] == 30

    ok = client.put("/api/settings", json={"anime_theme_audio": False, "anime_theme_volume": 0.6,
                                           "anime_theme_seconds": 0}).get_json()
    assert ok["ok"] and ok["data"]["anime_theme_audio"] is False and ok["data"]["anime_theme_seconds"] == 0

    assert not client.put("/api/settings", json={"anime_theme_volume": 1.5}).get_json()["ok"]
    assert not client.put("/api/settings", json={"anime_theme_volume": True}).get_json()["ok"]
    assert not client.put("/api/settings", json={"anime_theme_seconds": 12.5}).get_json()["ok"]
