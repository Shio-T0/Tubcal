"""The terminal's copy of the web's anime helpers: same episode list, same items, same
"where you are". The episode list is checked against episodeList.js itself, run under
node, so the two can't drift apart."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from tui import anime

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "frontend/src/components/player/anime/episodeList.js"

MEDIA = {
    "id": 10087, "title": "Fate/Zero", "episodes": 13, "status": "FINISHED", "cover": "c", "cover_xl": "cx",
    "streaming": [
        {"number": 1, "title": "Episode 1 - The Summoning of Heroes", "thumbnail": "s1", "url": "u1", "site": "CR"},
        {"number": 2, "title": "Episode 2: False Battle", "thumbnail": "series", "url": "u2", "site": "CR"},
        {"number": 3, "title": "Episode 3", "thumbnail": "series", "url": "u3", "site": "CR"},
    ],
}
SOURCE = [{"number": 1, "key": "k1", "title": None, "image": None},
          {"number": 2, "key": "k2", "title": "Episode 2 - False Battle", "image": None},
          {"number": 5, "key": "k5", "title": "The Mage-Killer", "image": "s5"}]
AIRING = {"id": 1, "title": "Show", "episodes": 12, "status": "RELEASING", "next_episode": 7, "streaming": []}


def node(expr: str):
    out = subprocess.run(["node", "--input-type=module", "-e",
                          f"import * as m from '{JS}'; console.log(JSON.stringify({expr}))"],
                         capture_output=True, text=True, timeout=20, check=True)
    return json.loads(out.stdout)


needs_node = pytest.mark.skipif(not shutil.which("node") or not JS.exists(), reason="node or episodeList.js missing")


@needs_node
@pytest.mark.parametrize("media, source", [(MEDIA, SOURCE), (AIRING, [{"number": 2, "key": "k"}]), (None, SOURCE)])
def test_the_episode_list_matches_the_webs(media, source):
    js = node(f"m.buildEpisodeList({json.dumps(media)}, {json.dumps(source)})")
    py = anime.build_episode_list(json.loads(json.dumps(media)), json.loads(json.dumps(source)))
    norm = lambda eps: [{k: v for k, v in e.items() if v is not None} for e in eps]  # noqa: E731
    assert norm(py) == norm(js)


@needs_node
def test_the_episode_item_matches_the_webs():
    e = {"number": 2, "key": None, "title": "False Battle", "still": None}
    js = node(f"m.episodeItem({json.dumps(MEDIA)}, {json.dumps(e)})")
    assert anime.episode_item(MEDIA, e) == js


def test_sub_and_dub_rewrite_the_key():
    key = "eyJwIjogImhpYW5pbWUiLCAiaSI6ICJtYWw6MTAwODciLCAiZSI6IDgsICJsIjogInN1YiIsICJhaWQiOiAxMDA4N30="
    dub = anime.key_with_audio(key, "dub")
    import base64
    assert json.loads(base64.urlsafe_b64decode(dub))["l"] == "dub"
    assert anime.key_with_audio(dub, "dub") == dub
    assert anime.key_with_audio("not base64!", "dub") == "not base64!"


def test_where_you_are():
    w = anime.watch_state(AIRING, {"status": "CURRENT", "progress": 4}, {"anime:1:5": {"position": 300, "duration": 1440}},
                          now=0)
    assert (w["aired"], w["left"], w["next_n"], w["can_play"]) == (6, 2, 5, True)
    assert w["resume_at"] == 300 and w["remaining_of_next"] == 1140
    caught_up = anime.watch_state(AIRING, {"status": "CURRENT", "progress": 6}, {}, now=0)
    assert not caught_up["can_play"] and caught_up["left"] == 0
    planning = anime.watch_state(MEDIA, {"status": "PLANNING", "progress": 0}, {})
    assert planning["next_n"] == 1 and planning["can_play"]
    done = anime.watch_state(MEDIA, {"status": "COMPLETED", "progress": 13}, {})
    assert not done["can_play"] and not done["can_bump"]


def test_entries_once_each_and_not_from_custom_lists():
    lists = [{"name": "Watching", "custom": False, "entries": [{"media": {"id": 1}}, {"media": {"id": 2}}]},
             {"name": "Faves", "custom": True, "entries": [{"media": {"id": 3}}]},
             {"name": "Planning", "custom": False, "entries": [{"media": {"id": 1}}]}]
    assert [e["media"]["id"] for e in anime.entries_of(lists)] == [1, 2]
