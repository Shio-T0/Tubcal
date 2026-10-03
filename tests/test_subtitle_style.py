"""The subtitle style setting: seeded, validated, clamped and stamped."""


def put(client, value):
    return client.put("/api/settings", json={"subtitle_style": value}).get_json()


def test_seeded_with_the_defaults(client):
    st = client.get("/api/settings").get_json()["data"]["subtitle_style"]
    assert st["size"] == 1 and st["font"] == "sans" and st["edge"] == "outline" and st["show"] is True


def test_partial_update_merges_clamps_and_stamps(client):
    r = put(client, {"size": 9, "color": "#ffe45c", "bg": -1})
    assert r["ok"]
    st = r["data"]["subtitle_style"]
    assert st["size"] == 2.5 and st["bg"] == 0 and st["color"] == "#ffe45c"
    assert st["font"] == "sans"  # untouched fields keep their value
    assert st["updated_at"] > 0
    # a later edit keeps the earlier one
    st2 = put(client, {"font": "serif"})["data"]["subtitle_style"]
    assert st2["font"] == "serif" and st2["color"] == "#ffe45c" and st2["updated_at"] >= st["updated_at"]


def test_rejects_what_it_cannot_draw(client):
    assert not put(client, {"font": "comic"})["ok"]
    assert not put(client, {"color": "red"})["ok"]
    assert not put(client, {"weight": 500})["ok"]
    assert not put(client, {"size": "big"})["ok"]
    assert not put(client, {"show": "yes"})["ok"]
    assert not put(client, {"sparkles": True})["ok"]
    assert not put(client, "large")["ok"]
