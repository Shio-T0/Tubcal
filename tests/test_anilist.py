"""The Anime room's pure logic: filter building, the franchise guide, the sequel
radar, list statistics, taste comparison, notifications, review rules — plus the
batch cache and the API's auth/validation edges. The AniList network is never
touched; the I/O wrappers are monkeypatched where a route is exercised."""

import datetime

import pytest

from server import cache
from server.sources import anilist


# ── the finder's filter mapping ──────────────────────────────────────────────

def _filter(**f):
    decl, args, v = anilist.build_media_filter(f)
    return dict(zip([a.split(":")[0] for a in args], [v[d.split(":")[0][1:]] for d in decl]))


def test_filter_ranges_step_past_each_end():
    got = _filter(year_from=2010, year_to=2015, score_min=70, episodes_min=1, episodes_max=13,
                  duration_min=20, duration_max=30)
    # inclusive UI bounds become AniList's strict greater/lesser
    assert got["startDate_greater"] == 20099999
    assert got["startDate_lesser"] == 20160000
    assert got["averageScore_greater"] == 69
    assert got["episodes_greater"] == 0 and got["episodes_lesser"] == 14
    assert got["duration_greater"] == 19 and got["duration_lesser"] == 31


def test_filter_drops_unknown_enums_and_keeps_false():
    got = _filter(formats=["TV", "NOVEL", "bogus"], statuses=["RELEASING", "nope"],
                  sources=["LIGHT_NOVEL", "x"], country="US", season="SPRING", year="2024",
                  on_list=False, services=["5", "", "abc", 7])
    assert got["format_in"] == ["TV"]  # NOVEL is a manga format; one bad enum fails the query
    assert got["status_in"] == ["RELEASING"]
    assert got["source_in"] == ["LIGHT_NOVEL"]
    assert "countryOfOrigin" not in got
    assert got["season"] == "SPRING" and got["seasonYear"] == 2024
    assert got["onList"] is False  # "hide what's on my list" is a real filter
    assert got["licensedById_in"] == [5, 7]


def test_filter_exclusions_and_tag_rank():
    got = _filter(genres=["Drama"], exclude_genres=["Ecchi"], tags=["Iyashikei"],
                  exclude_tags=["Gore"], min_tag_rank=60)
    assert got["genre_in"] == ["Drama"] and got["genre_not_in"] == ["Ecchi"]
    assert got["tag_in"] == ["Iyashikei"] and got["tag_not_in"] == ["Gore"]
    assert got["minimumTagRank"] == 60
    # a tag-rank floor without tags is meaningless and isn't sent
    assert "minimumTagRank" not in _filter(min_tag_rank=60)


def test_filter_signature_is_order_stable():
    a = anilist.filter_signature({"formats": ["TV", "MOVIE"], "year": None, "on_list": False})
    b = anilist.filter_signature({"on_list": False, "formats": ["MOVIE", "TV"], "tags": []})
    assert a == b and "on_list=false" in a
    assert anilist.filter_signature({"formats": [], "year": None}) == ""


# ── seasons ──────────────────────────────────────────────────────────────────

def test_december_is_next_years_winter():
    dec = datetime.datetime(2026, 12, 5, tzinfo=datetime.timezone.utc)
    assert anilist._current_season(dec) == ("WINTER", 2027)
    sep = datetime.datetime(2026, 9, 28, tzinfo=datetime.timezone.utc)
    assert anilist._current_season(sep) == ("FALL", 2026)
    assert anilist._season_start("WINTER", 2027) == 20261201
    assert anilist._season_start("FALL", 2026) == 20260901


# ── the franchise guide ──────────────────────────────────────────────────────

def _n(i, fmt="TV", start=(2010, 1, 1), eps=12, typ="ANIME"):
    return {"id": i, "type": typ, "format": fmt, "episodes": eps, "start": list(start),
            "title": f"t{i}", "adult": False, "status": "FINISHED"}


def _graph(nodes, edges):
    g = {i: {"self": n, "edges": []} for i, n in nodes.items()}
    for a, rel, b in edges:
        g[a]["edges"].append({"relation": rel, "media": nodes[b]})
    return g


def test_franchise_finds_the_main_line_from_an_ova():
    nodes = {
        1: _n(1, start=(2010, 4, 1), eps=24),
        2: _n(2, start=(2012, 4, 1), eps=12),
        3: _n(3, "OVA", start=(2011, 1, 1), eps=2),
        4: _n(4, "SPECIAL", start=(2013, 1, 1), eps=1),
        5: _n(5, "TV", start=(2015, 1, 1), eps=12),       # a spin-off series
        6: _n(6, "MOVIE", start=(2014, 1, 1), eps=1),     # a recap film
        7: _n(7, "TV", start=(2020, 1, 1), eps=24),       # a remake
        8: _n(8, "MANGA", typ="MANGA"),
        9: _n(9, "TV", start=(2016, 1, 1)),               # crossover cameo
    }
    edges = [
        (3, "PARENT", 1), (1, "SIDE_STORY", 3),
        (1, "SEQUEL", 2), (2, "PREQUEL", 1),
        (2, "SIDE_STORY", 4), (1, "SPIN_OFF", 5), (1, "SUMMARY", 6),
        (1, "ALTERNATIVE", 7), (1, "ADAPTATION", 8), (1, "CHARACTER", 9),
    ]
    g = _graph(nodes, edges)
    del g[8], g[9]  # the walk never expands across ADAPTATION/CHARACTER edges
    items = anilist.build_franchise(3, g)
    by = {it["id"]: it for it in items}
    assert set(by) == {1, 2, 3, 4, 5, 6, 7}  # no manga, no cameo
    assert by[1]["kind"] == by[2]["kind"] == "main"
    assert by[3]["kind"] == "side" and by[3]["is_root"]
    assert by[4]["kind"] == "side"
    assert by[5]["kind"] == "spin-off"
    assert by[6]["kind"] == "recap"
    assert by[7]["kind"] == "alternative"
    assert by[1]["relation"] == "PARENT"  # how the root (the OVA) relates to it
    assert [it["id"] for it in items] == [1, 3, 2, 4, 6, 5, 7]  # release order


def test_franchise_unknown_root_is_empty():
    assert anilist.build_franchise(99, {}) == []


# ── the sequel radar ─────────────────────────────────────────────────────────

def test_sequel_radar_buckets_and_ranks():
    seeds = [{"id": 1, "title": "A"}, {"id": 2, "title": "B"}]
    out_now = dict(_n(10, start=(2022, 1, 1)), status="FINISHED")
    side = dict(_n(11, "OVA", start=(2023, 1, 1)), status="FINISHED")
    soon = dict(_n(12, start=(2027, 1, 1)), status="NOT_YET_RELEASED")
    dead = dict(_n(13), status="CANCELLED")
    planned = dict(_n(14), status="FINISHED")
    rels = {
        1: {"edges": [{"relation": "SEQUEL", "media": out_now},
                      {"relation": "SIDE_STORY", "media": side},
                      {"relation": "SEQUEL", "media": dead},
                      {"relation": "SEQUEL", "media": planned},
                      {"relation": "PREQUEL", "media": dict(_n(15), status="FINISHED")}]},
        2: {"edges": [{"relation": "SEQUEL", "media": soon},
                      {"relation": "SEQUEL", "media": out_now}]},
    }
    r = anilist.find_sequels(seeds, rels, listed={1, 2, 14})
    assert [row["media"]["id"] for row in r["out_now"]] == [10, 11]  # sequels lead
    assert r["out_now"][0]["after"] == [{"id": 1, "title": "A", "cover": None},
                                        {"id": 2, "title": "B", "cover": None}]
    assert r["out_now"][1]["kind"] == "side"
    assert [row["media"]["id"] for row in r["coming"]] == [12]
    assert all(row["media"]["id"] not in (13, 14, 15) for row in r["out_now"] + r["coming"])


# ── list statistics ──────────────────────────────────────────────────────────

def _e(mid, status="COMPLETED", score=0, progress=12, crowd=None, genres=("Drama",),
       completed=None, updated=None, eps=12, dur=24, fmt="TV", repeat=0):
    return {"status": status, "progress": progress, "repeat": repeat, "score": score,
            "updated_at": updated, "started_at": None, "completed_at": completed,
            "media": {"id": mid, "title": f"t{mid}", "format": fmt, "episodes": eps,
                      "duration": dur, "genres": list(genres), "score": crowd, "year": 2020,
                      "source": "MANGA", "country": "JP", "studios": [{"id": 1, "name": "S"}],
                      "tags": ["Iyashikei"], "next_episode": None}}


def test_stats_totals_buckets_and_takes():
    now = 1_800_000_000
    entries = [
        _e(1, score=90, crowd=70, completed="2025-03-02"),
        _e(1, score=90, crowd=70, completed="2025-03-02"),  # same title on a custom list
        _e(2, score=40, crowd=85, completed="2025-07-10", genres=("Comedy",)),
        _e(3, status="CURRENT", progress=3, updated=now - 60 * 86400),
        _e(4, status="PLANNING", progress=0, eps=None),
        _e(5, status="DROPPED", progress=2),
        _e(6, fmt="MOVIE", eps=1, dur=None, progress=1, completed="2024-12-31", repeat=1),
    ]
    s = anilist.compute_stats(entries, now=now)
    t = s["totals"]
    assert t["titles"] == 6 and t["watched"] == 5 and t["planning"] == 1
    # 12+12+3+2 TV episodes at 24m, plus a 90m film watched twice
    assert t["episodes"] == 31 and t["minutes"] == 29 * 24 + 180
    assert t["mean_score"] == 65.0
    assert t["backlog_minutes"] == 12 * 24 and t["backlog_guessed"] == 1
    assert t["completion_rate"] == 75  # 3 finished vs 1 dropped
    assert {b["score"]: b["count"] for b in s["scores"]}[90] == 1
    assert {b["score"]: b["count"] for b in s["scores"]}[40] == 1
    assert s["hot_takes"]["higher"][0]["media"]["id"] == 1
    assert s["hot_takes"]["lower"][0]["diff"] == -45
    assert [x["media"]["id"] for x in s["stalled"]] == [3]
    assert s["wrapped"]["2025"]["completed"] == 2
    assert s["wrapped"]["2025"]["months"][2] == 1 and s["wrapped"]["2025"]["months"][6] == 1
    assert s["wrapped"]["2025"]["best"][0]["id"] == 1
    assert [l["length"] for l in s["lengths"]][0] == "1"  # all buckets, fixed axis
    assert s["genres"][0]["genre"] == "Drama"


# ── taste comparison ─────────────────────────────────────────────────────────

def _m(mid, genres=("Drama",)):
    return {"id": mid, "title": f"t{mid}", "genres": list(genres), "score": 70}


def test_compare_perfect_agreement_and_picks():
    mine = {i: {"status": "COMPLETED", "score": 10 * i, "media": _m(i)} for i in range(1, 6)}
    theirs = {i: {"status": "COMPLETED", "score": 10 * i + 5, "media": _m(i)} for i in range(1, 6)}
    theirs[9] = {"status": "COMPLETED", "score": 95, "media": _m(9)}
    mine[9] = {"status": "PLANNING", "score": 0, "media": _m(9)}
    theirs[8] = {"status": "COMPLETED", "score": 60, "media": _m(8)}  # below the pick bar
    c = anilist.compare_lists(mine, theirs)
    assert c["affinity"] == 100
    assert c["shared"] == 5 and c["mean_diff"] == 5.0
    assert c["genre_similarity"] == 100
    assert [p["media"]["id"] for p in c["their_picks"]] == [9]
    assert c["their_picks"][0]["planned"] is True


def test_compare_needs_three_pairs_for_affinity():
    mine = {1: {"status": "COMPLETED", "score": 80, "media": _m(1)}}
    theirs = {1: {"status": "COMPLETED", "score": 20, "media": _m(1)}}
    c = anilist.compare_lists(mine, theirs)
    assert c["affinity"] is None and c["disagreements"][0]["diff"] == 60


# ── notifications, reviews, advanced scores ──────────────────────────────────

def test_airing_notification_text_is_assembled():
    n = anilist.norm_notification({
        "id": 1, "type": "AIRING", "episode": 12, "contexts": ["Episode ", " of ", " aired."],
        "media": {"id": 5, "type": "ANIME", "title": {"english": "Frieren"}, "coverImage": {}},
    })
    assert n["text"] == "Episode 12 of Frieren aired." and n["group"] == "airing"
    f = anilist.norm_notification({"id": 2, "type": "FOLLOWING", "context": " started following you.",
                                   "user": {"id": 3, "name": "kai", "avatar": {"large": None}}})
    assert f["group"] == "follows" and f["user"]["name"] == "kai" and f["text"] is None


def test_review_rules():
    assert anilist.validate_review("x" * 20, "y" * 2200, 80) == []
    problems = anilist.validate_review("short", "y" * 10, 101)
    assert len(problems) == 3


def test_advanced_scores_follow_category_order():
    cats = ["Story", "Characters", "Visuals"]
    assert anilist.advanced_score_list({"Visuals": 8, "Story": "9"}, cats) == [9.0, 0.0, 8.0]
    assert anilist.advanced_score_list(None, cats) == [0.0, 0.0, 0.0]


def test_custom_list_memberships():
    assert anilist._custom_lists([{"name": "Comfy", "enabled": True},
                                  {"name": "Rewatch", "enabled": False}]) == ["Comfy"]
    assert anilist._custom_lists({"Comfy": True, "Rewatch": False}) == ["Comfy"]


# ── the batch cache ──────────────────────────────────────────────────────────

def test_cached_many_fetches_only_misses_and_survives_failure(client, monkeypatch):
    monkeypatch.setattr(cache, "_mem", {})
    calls = []

    def fetch(missing):
        calls.append(sorted(missing))
        return {k: k.upper() for k in missing}

    assert cache.cached_many(["a", "b"], 60, fetch) == {"a": "A", "b": "B"}
    assert cache.cached_many(["a", "b", "c"], 60, fetch) == {"a": "A", "b": "B", "c": "C"}
    assert calls == [["a", "b"], ["c"]]

    def boom(missing):
        raise RuntimeError("rate limited")

    with pytest.raises(RuntimeError):
        cache.cached_many(["d"], 60, boom)  # nothing stale to fall back on
    # expired-but-present values are served when the refresh fails
    assert cache.cached_many(["a"], 0, boom) == {"a": "A"}


# ── routes ───────────────────────────────────────────────────────────────────

def test_personal_routes_need_the_account(client):
    for path in ("/api/anime/sequels", "/api/anime/stats", "/api/anime/notifications"):
        assert client.get(path).status_code == 401


def test_schedule_window_is_validated(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(anilist, "airing_schedule",
                        lambda s, e, token=None: seen.update(s=s, e=e) or {"items": []})
    assert client.get("/api/anime/schedule?start=100&end=50").status_code == 400
    assert client.get(f"/api/anime/schedule?start=0&end={30 * 86400}").status_code == 400
    r = client.get("/api/anime/schedule?start=1000&end=2000")
    assert r.status_code == 200 and seen == {"s": 1000, "e": 2000}


def test_review_and_bulk_validation(client, monkeypatch):
    from server.api import anime as anime_api
    monkeypatch.setattr(anime_api, "get_valid_token", lambda p: "tok")
    r = client.post("/api/anime/review", json={"media_id": 1, "summary": "hi", "body": "x", "score": 5})
    assert r.status_code == 400 and "summary" in r.get_json()["error"]
    assert client.post("/api/anime/list/bulk", json={}).status_code == 400
    assert client.post("/api/anime/list/bulk", json={"entry_ids": [1]}).status_code == 400


def test_discover_with_only_a_format_filter_queries(client, monkeypatch):
    got = {}

    def fake(**kw):
        got.update(kw)
        return {"items": [], "has_next": False}

    monkeypatch.setattr(anilist, "discover", fake)
    r = client.get("/api/anime/discover?formats=MOVIE&on_list=0")
    assert r.status_code == 200
    assert got["filters"]["formats"] == ["MOVIE"] and got["filters"]["on_list"] is False
    assert client.get("/api/anime/discover").get_json()["data"]["empty"] is True


def test_social_routes_validate_and_pass_through(client, monkeypatch):
    got = {}
    monkeypatch.setattr(anilist, "forum_threads", lambda **kw: got.update(kw) or {"items": [], "has_next": False})
    monkeypatch.setattr(anilist, "activity_feed", lambda **kw: got.update(kw) or {"items": [], "has_next": True})
    assert client.get("/api/anime/threads?sort=bogus").status_code == 400
    r = client.get("/api/anime/threads?sort=replies&page=2")
    assert r.status_code == 200 and got["sort"] == "replies" and got["page"] == 2
    assert r.get_json()["data"] == {"items": [], "has_next": False}
    assert client.get("/api/anime/activity?kind=nope").status_code == 400
    r = client.get("/api/anime/activity?kind=talk")
    assert r.status_code == 200 and got["kind"] == "talk" and r.get_json()["data"]["has_next"] is True
    # deleting needs the account
    assert client.delete("/api/anime/thread/1/comment/2").status_code == 401
    assert client.delete("/api/anime/activity/1/reply/2").status_code == 401


def test_people_are_drawn_with_their_colour_and_supporter_tier():
    u = anilist._norm_user({"id": 7, "name": "Kai", "avatar": {"large": "a.png"},
                            "options": {"profileColor": "pink"}, "donatorTier": 2})
    assert u == {"id": 7, "name": "Kai", "avatar": "a.png", "color": "pink", "donator": 2}
    # a bare user (older payloads, deleted accounts) still normalises
    assert anilist._norm_user(None) == {"id": None, "name": None, "avatar": None, "color": None, "donator": 0}


def test_one_activity_route(client, monkeypatch):
    monkeypatch.setattr(anilist, "activity", lambda aid: {"id": aid, "kind": "TextActivity"} if aid == 5 else None)
    assert client.get("/api/anime/activity/5").get_json()["data"] == {"id": 5, "kind": "TextActivity"}
    assert client.get("/api/anime/activity/6").status_code == 404


def test_markdown_render_is_memoised(monkeypatch):
    calls = []
    monkeypatch.setattr(anilist, "_MD_MEMO", {})
    monkeypatch.setattr(anilist, "_post", lambda q, v, **kw: calls.append(v) or {"Markdown": {"html": "<p>x</p>"}})
    assert anilist.render_markdown("**x**") == "<p>x</p>"
    assert anilist.render_markdown("**x**") == "<p>x</p>"
    assert len(calls) == 1  # the same draft never costs a second request
    anilist.render_markdown("other")
    assert len(calls) == 2


def test_activity_filter_keeps_the_stream_anime_only():
    assert anilist._activity_filter(None) == "type_in:[TEXT,ANIME_LIST]"
    assert anilist._activity_filter(None, own=True) == "type_in:[TEXT,ANIME_LIST,MESSAGE]"
    assert anilist._activity_filter("talk") == "hasRepliesOrTypeText:true,type_in:[TEXT,ANIME_LIST]"
    assert anilist._activity_filter("list") == "type_in:[ANIME_LIST]"
    assert anilist._activity_filter("text", own=True) == "type:TEXT"


# ── the curtain call ─────────────────────────────────────────────────────────

def _rel(i, relation="SEQUEL", fmt="TV", start=(2020, 1, 1), **kw):
    node = {"id": i, "type": "ANIME", "format": fmt, "status": "FINISHED", "adult": False,
            "title": f"t{i}", "start": list(start)}
    node.update(kw)
    return {"relation": relation, "media": node}


def test_pick_sequel_prefers_the_main_line_then_the_earliest():
    edges = [
        _rel(1, relation="PREQUEL"),
        _rel(2, fmt="OVA", start=(2019, 1, 1)),
        _rel(3, fmt="MOVIE", start=(2022, 1, 1)),
        _rel(4, fmt="TV", start=(2021, 6, 1)),
    ]
    assert anilist.pick_sequel(edges)["id"] == 4
    assert anilist.pick_sequel(edges, seen={4})["id"] == 3


def test_pick_sequel_skips_what_isnt_a_continuation():
    edges = [
        _rel(1, type="MANGA"),
        _rel(2, adult=True),
        _rel(3, fmt="MUSIC"),
        _rel(4, status="CANCELLED"),
        _rel(5, relation="SIDE_STORY"),
    ]
    assert anilist.pick_sequel(edges) is None
    assert anilist.pick_sequel(None) is None


def test_sequel_chain_walks_and_stops(monkeypatch):
    graph = {
        10: {"edges": [_rel(11)]},
        11: {"edges": [_rel(10, relation="PREQUEL"), _rel(12, fmt="MOVIE")]},
        12: {"edges": [_rel(11, relation="PREQUEL")]},
    }
    monkeypatch.setattr(anilist, "relations_batch", lambda ids: {i: graph.get(i) for i in ids})
    monkeypatch.setattr(anilist, "_budget", lambda *a, **k: True)
    assert [n["id"] for n in anilist.sequel_chain(10)] == [11, 12]
    assert [n["id"] for n in anilist.sequel_chain(10, limit=1)] == [11]


def test_match_episode_thread_names_the_episode():
    rows = [
        {"id": 1, "title": "[Spoilers] Show - Episode 120 Discussion", "replyCount": 50},
        {"id": 2, "title": "Episode 12 thoughts?", "replyCount": 90},
        {"id": 3, "title": "[Spoilers] Show - Episode 12 Discussion", "replyCount": 40},
        {"id": 4, "title": "Show - Episode 11 Discussion", "replyCount": 10},
    ]
    assert anilist.match_episode_thread(rows, 12)["id"] == 3  # "Discussion" wins over more replies
    assert anilist.match_episode_thread(rows, 7) is None
    assert anilist.match_episode_thread(rows, None) is None
    assert anilist.match_episode_thread([{"id": 9, "title": "Ep. 05 discussion"}], 5)["id"] == 9
