"""The terminal interface end to end, headless (Textual's pilot), against the real Flask
app on a throwaway DB through httpx's WSGI transport. YouTube itself is stubbed."""

import asyncio
import time

import httpx
import pytest

from server import config
from tui.terminal import TermInfo
from tui.theme import Palette, parse_hex

NOW = time.time()
FEED = [
    {"id": f"yt:video{n:05d}xx", "platform": "youtube", "title": f"Video number {n}", "source": f"Channel {n % 3}",
     "url": f"https://www.youtube.com/watch?v=video{n:05d}xx", "thumbnail": "", "published_at": NOW - n * 20000,
     "extra": {"video_id": f"video{n:05d}xx", "channel_id": f"UC{n % 3}", "description": "About it."}}
    for n in range(1, 15)
]

PALETTE = Palette(fg=parse_hex("#d3c6aa"), bg=parse_hex("#2d353b"),
                  ansi=[parse_hex(c) for c in "#475258 #e67e80 #a7c080 #dbbc7f #7fbbb3 #d699b6 #83c092 #d3c6aa".split() * 2])


@pytest.fixture
def make_app(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "config"))
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))
    (tmp_path / "config" / "tubcal").mkdir(parents=True)
    (tmp_path / "config" / "tubcal" / "tui.toml").write_text('images = "off"\n')
    from server import create_app, db
    from server.sources import youtube

    db.init_db()
    db.add_subscription("youtube", "UC1", "Channel 1", None)
    monkeypatch.setattr(youtube, "get_feed", lambda ids: {"items": FEED, "stale": False})
    monkeypatch.setattr(youtube, "get_live_and_upcoming", lambda ids: [])
    flask_app = create_app()

    def make(**kw):
        from tui.app import TubcalApp
        info = TermInfo(palette=PALETTE, cell_px=(8, 18), term="st-256color", answered=True)
        kw.setdefault("start_room", "youtube")
        return TubcalApp(info, transport=httpx.WSGITransport(app=flask_app),
                         base="http://127.0.0.1:5000", **kw)
    return make


async def ready(app, pilot):
    for _ in range(100):
        await pilot.pause(0.05)
        if app.ready and app.room is not None and app.room.list.items:
            return
    raise AssertionError("the Screening Room never filled")


def run(coro):
    return asyncio.run(coro)


def test_the_screening_room_fills_and_moves(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(120, 32)) as pilot:
            await ready(app, pilot)
            room = app.room
            assert room.view == "latest" and len(room.list.items) == 14
            await pilot.press("j", "j", "3", "j")
            assert room.list.position == (6, 14)
            await pilot.press("G")
            assert room.list.position == (14, 14)
            await pilot.press("g", "g")
            assert room.list.position == (1, 14)
            assert room.preview.display  # 120 columns: list + preview
            assert not room.index.display
    run(go())


def test_search_jumps_and_n_repeats(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(120, 32)) as pilot:
            await ready(app, pilot)
            await pilot.press("/", "n", "u", "m", "b", "e", "r", " ", "1", "enter")
            assert app.mode == "NORMAL"
            assert app.room.list.selected["title"] == "Video number 1"
            await pilot.press("n")
            assert app.room.list.selected["title"] in ("Video number 10", "Video number 11")
    run(go())


def test_saving_and_undo_reach_the_server(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(120, 32)) as pilot:
            await ready(app, pilot)
            first = app.room.list.selected
            await pilot.press("s")
            await pilot.pause(0.3)
            saved = app.api.get("/saved")["items"]
            assert [i["id"] for i in saved] == [first["id"]]
            await pilot.press("s")
            await pilot.pause(0.3)
            assert app.api.get("/saved")["items"] == []
            await pilot.press("u")
            await pilot.pause(0.3)
            assert [i["id"] for i in app.api.get("/saved")["items"]] == [first["id"]]
    run(go())


def test_views_chords_and_the_command_line(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(120, 32)) as pilot:
            await ready(app, pilot)
            await pilot.press("tab")
            assert app.room.view == "live"
            await pilot.press("shift+tab")
            assert app.room.view == "latest"
            await pilot.press("space")
            assert app.keys.pending == ("space",)
            await pilot.pause(0.4)
            assert app.whichkey.display
            await pilot.press("escape")
            assert not app.whichkey.display and app.keys.pending == ()
            await pilot.press(":", "c", "h", "e", "c", "k", "h", "e", "a", "l", "t", "h", "enter")
            await pilot.pause(0.5)
            assert app.info.display and "checkhealth" in str(app.info.render())
            await pilot.press("q")
            assert not app.info.display
            await pilot.press("q")  # nothing open: q only says how to quit
            assert "Type :q" in app.statusline.message.text
    run(go())


def test_the_private_session_badge_and_gate(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(120, 32)) as pilot:
            await ready(app, pilot)
            await pilot.press("space", "P")
            assert app.private and app.api.private and app.statusline.private
            assert "PRIV" in str(app.statusline.render())
    run(go())


def test_a_room_without_a_terminal_screen_opens_on_the_web(make_app, monkeypatch):
    """Every room has a screen now; one that doesn't (a newer room) is drawn as a sign."""
    opened = []
    monkeypatch.setattr("tui.links.open_url", lambda url, configured="": opened.append(url))
    from tui import app as app_mod
    real = app_mod.load_screen
    monkeypatch.setattr(app_mod, "load_screen", lambda room: None if room.id == "archive" else real(room))

    async def go():
        app = make_app()
        async with app.run_test(size=(120, 32)) as pilot:
            await ready(app, pilot)
            await pilot.press("L", "L")  # Screening Room → the Anime → the Archive
            assert app.room_id == "archive"
            await pilot.press("enter")
            assert opened == ["http://127.0.0.1:5000/archive"]
            await pilot.press("ctrl+o")
            assert app.room_id == "anime"
    run(go())


SHOW = {"id": 21, "title": "A Show", "episodes": 12, "status": "RELEASING", "next_episode": 6,
        "next_airing_at": NOW + 3 * 86400, "duration": 24, "cover": "", "format": "TV", "season": "FALL", "year": 2026}
PLANNED = {"id": 22, "title": "Later Show", "episodes": 24, "status": "FINISHED", "cover": "", "format": "TV"}


@pytest.fixture
def with_anilist(monkeypatch):
    from server.api import anime as anime_api
    from server.sources import anilist, anime_source
    lists = [{"name": "Watching", "status": "CURRENT", "custom": False,
              "entries": [{"entry_id": 1, "status": "CURRENT", "progress": 3, "score": 8, "updated_at": int(NOW),
                           "media": SHOW}]},
             {"name": "Planning", "status": "PLANNING", "custom": False,
              "entries": [{"entry_id": 2, "status": "PLANNING", "progress": 0, "score": 0, "updated_at": int(NOW) - 99,
                           "media": PLANNED}]}]
    monkeypatch.setattr(anime_api, "get_valid_token", lambda provider: "token")
    monkeypatch.setattr(anilist, "user_lists", lambda token: lists)
    monkeypatch.setattr(anilist, "viewer", lambda token: {"name": "me"})
    monkeypatch.setattr(anilist, "media", lambda mid, token=None: dict(SHOW, streaming=[], list_entry=lists[0]["entries"][0]))
    monkeypatch.setattr(anime_source, "info", lambda mid: {
        "episodes": [{"number": n, "key": f"key{n}", "title": f"Episode {n}", "image": None} for n in range(1, 6)],
        "total": 12, "provider": "test"})
    writes = []

    def save(token, media_id, **fields):
        writes.append((media_id, fields))
        return {"status": "CURRENT", "progress": fields.get("progress")}
    monkeypatch.setattr(anilist, "save_list_entry", save)
    return writes


def test_home_lines_up_what_to_watch(make_app, with_anilist):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press("g", "h")
            for _ in range(100):
                await pilot.pause(0.05)
                if app.room_id == "home" and len(app.room.upnext.items) >= 6:
                    break
            home = app.room
            picks = home.upnext.items
            assert picks[0]["kind"] == "anime" and picks[0]["w"]["next_n"] == 4
            assert all(p["kind"] == "fresh" for p in picks[1:])
            assert any(x["kind"] == "episode" for x in home.coming.items)
            assert "episodes to watch" in str(home.hello.render())
            played = []
            app.anime.play = lambda m, n: played.append((m["id"], n))
            await pilot.press("enter")
            assert played == [(21, 4)]
    run(go())


def test_the_anime_list_title_page_and_your_place(make_app, with_anilist):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press("g", "a")
            for _ in range(100):
                await pilot.pause(0.05)
                if app.room_id == "anime" and app.room.list.items:
                    break
            room = app.room
            assert [e["media"]["id"] for e in room.list.items] == [21]
            await pilot.press("tab")
            assert room.view == "PLANNING" and [e["media"]["id"] for e in room.list.items] == [22]
            await pilot.press("shift+tab", "enter")
            for _ in range(100):
                await pilot.pause(0.05)
                if room.episodes.items:
                    break
            assert room.mode == "title"
            assert room.episodes.selected["number"] == 4  # opens on your next episode
            await pilot.press("+")
            for _ in range(60):
                await pilot.pause(0.05)
                if with_anilist:
                    break
            assert with_anilist == [(21, {"progress": 4})]
            await pilot.press("q")
            assert room.mode == "list"
    run(go())


def test_the_saved_drawer(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            first = app.room.list.selected
            await pilot.press("s")
            await pilot.pause(0.3)
            await pilot.press("space", "s")
            for _ in range(60):
                await pilot.pause(0.05)
                if app.drawer.list.items and app.drawer.list.items[0].get("saved_at"):
                    break
            assert app.drawer.display and [i["id"] for i in app.drawer.list.items] == [first["id"]]
            assert app.statusline.crumbs[0] == "Saved"
            await pilot.press("x")
            await pilot.pause(0.3)
            assert app.api.get("/saved")["items"][0]["done_at"]
            assert app.drawer.list.items == []  # To do no longer lists it
            await pilot.press("tab")
            assert app.drawer.view == "done" and len(app.drawer.list.items) == 1
            await pilot.press("d", "d")
            await pilot.pause(0.3)
            assert app.api.get("/saved")["items"] == []
            await pilot.press("u")
            await pilot.pause(0.3)
            assert [i["id"] for i in app.api.get("/saved")["items"]] == [first["id"]]
            await pilot.press("q")
            assert not app.drawer.display and app.keys.feed("j").action == "down"
    run(go())


HN_STORIES = [
    {"id": f"hn:{1000 + n}", "platform": "hackernews", "title": ("Ask HN: " if n == 2 else "") + f"Story {n}",
     "url": f"https://example.org/{n}", "author": f"user{n}", "score": 100 + n, "comments_count": 3,
     "published_at": NOW - n * 3600, "source": "Hacker News", "thumbnail": None,
     "extra": {"hn_id": 1000 + n, "domain": "example.org", "type": "story"}}
    for n in range(1, 31)
]


def hn_item(hn_id):
    story = next(s for s in HN_STORIES if s["extra"]["hn_id"] == hn_id)
    return {"story": dict(story, text_html=None), "stale": False, "comments": [
        {"id": 1, "author": "ann", "body_html": "First <i>thought</i>", "score": None, "depth": 0,
         "created_at": NOW - 600, "children": [
             {"id": 2, "author": story["author"], "body_html": "A reply", "score": None, "depth": 1,
              "created_at": NOW - 300, "children": []}]},
        {"id": 3, "author": "bo", "body_html": "Second", "score": None, "depth": 0, "created_at": NOW - 200,
         "children": []}]}


@pytest.fixture
def with_social(monkeypatch):
    from server import db
    from server.sources import hackernews, reddit
    monkeypatch.setattr(hackernews, "get_feed", lambda name, page: {"items": HN_STORIES, "has_more": False, "stale": False})
    monkeypatch.setattr(hackernews, "get_item", hn_item)
    monkeypatch.setattr(hackernews, "search", lambda q, sort, rng: {"items": HN_STORIES[:2], "stale": False})
    post = {"id": "rd:abc", "platform": "reddit", "title": "A post", "url": "https://reddit.com/r/linux/abc",
            "author": "u/poster", "score": None, "comments_count": None, "published_at": NOW - 100, "source": "r/linux",
            "extra": {"subreddit": "linux", "post_id": "abc", "link_url": "https://www.youtube.com/watch?v=abcdefghijk",
                      "is_self": False}}
    monkeypatch.setattr(reddit, "get_feed", lambda names, sort: {"items": [post], "stale": False, "limited": True})
    monkeypatch.setattr(reddit, "get_post", lambda sub, pid: {"post": post, "selftext_html": "", "stale": False,
        "limited": True, "comments": [{"id": "c1", "author": "someone", "body_html": "&lt;p&gt;nice&lt;/p&gt;",
                                       "score": None, "depth": 0, "created_at": NOW - 50, "children": []}]})
    db.add_subscription("reddit", "linux", "r/linux", None)
    paper = {"date": time.strftime("%Y-%m-%d"), "issue": 7, "status": "edited", "model": "m", "sources": 3,
             "window_h": 36, "generated_at": int(NOW),
             "lede": {"headline": "The lede", "dek": "Its dek", "body": "Its body.", "synthesized": True,
                      "items": [HN_STORIES[0]]},
             "columns": [{"headline": "A column", "dek": "d", "body": "b", "synthesized": True, "items": [post]}],
             "briefs": [{"headline": "A brief", "salience": 1, "items": [HN_STORIES[1]]}]}
    monkeypatch.setattr(db, "edition_latest", lambda: paper)
    monkeypatch.setattr(db, "edition_list", lambda: [{"date": paper["date"]}])
    return post


def test_the_wire_reads_a_thread(make_app, with_social):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press("g", "n")
            for _ in range(60):
                await pilot.pause(0.05)
                if app.room_id == "hackernews" and app.room.board.items:
                    break
            wire = app.room
            assert len(wire.board.items) == 30
            await pilot.press("enter")
            for _ in range(60):
                await pilot.pause(0.05)
                if wire.reader.items:
                    break
            assert wire.focus_pane == "reader" and [c["id"] for c in wire.reader.items] == [1, 2, 3]
            assert wire.last_visit(wire.story) is not None   # the visit is remembered
            await pilot.press("j")
            await pilot.press("z", "a")
            assert [c["id"] for c in wire.reader.items] == [1, 3]
            await pilot.press("]", "]")
            assert wire.reader.selected["id"] == 3
            await pilot.press("h")
            assert wire.focus_pane == "board"
            await pilot.press("tab")
            assert wire.view == "best"
    run(go())


def test_the_dispatch_opens_a_post(make_app, with_social):
    async def go():
        app = make_app()
        async with app.run_test(size=(150, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press("g", "r")
            for _ in range(60):
                await pilot.pause(0.05)
                if app.room_id == "reddit" and app.room.list.items:
                    break
            d = app.room
            assert d.index.display and [r["title"] for r in d.index.items] == ["All of yours", "r/linux"]
            assert "RSS, no account" in d.winbar.right
            await pilot.press("enter")
            for _ in range(60):
                await pilot.pause(0.05)
                if d.reader.items:
                    break
            assert d.reader.items[0]["author"] == "someone"
    run(go())


def test_the_edition_opens_a_story_in_the_wire(make_app, with_social):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press("g", "e")
            for _ in range(60):
                await pilot.pause(0.05)
                if app.room_id == "edition" and app.room.paper_view.units:
                    break
            ed = app.room
            assert [u["kind"] for u in ed.paper_view.units] == ["lede", "column", "brief"]
            await pilot.press("enter")
            for _ in range(60):
                await pilot.pause(0.05)
                if app.room_id == "hackernews" and app.room.reader.items:
                    break
            assert app.room_id == "hackernews" and app.room.story["extra"]["hn_id"] == 1001
            await pilot.press("g", "e")
            assert HN_STORIES[0]["id"] in ed._marks()
            await pilot.press("]", "n")
            assert ed.paper_view.cursor == 1
    run(go())


def test_the_finder(make_app, with_social, monkeypatch):
    from server.api import feeds
    monkeypatch.setattr(feeds, "_source", lambda room: type("S", (), {"search": staticmethod(
        lambda q: {"items": HN_STORIES[:1] if room == "hackernews" else []})}))

    async def go():
        app = make_app()
        async with app.run_test(size=(140, 40)) as pilot:
            await ready(app, pilot)
            await pilot.press("space", "f")
            assert app.mode == "FIND" and app.finder.display
            await pilot.press("w", "i", "r")
            assert [x["title"] for x in app.finder.list.items] == ["The Wire"]
            await pilot.press("backspace", "backspace", "backspace", "s", "t", "o", "r", "y")
            for _ in range(60):
                await pilot.pause(0.05)
                if any(not x.get("_place") for x in app.finder.list.items):
                    break
            assert any(x.get("title") == "Story 1" for x in app.finder.list.items)
            await pilot.press("escape")
            assert not app.finder.display and app.mode == "NORMAL"
            await pilot.press("space", "f", "w", "i", "r", "enter")
            for _ in range(40):
                await pilot.pause(0.05)
                if app.room_id == "hackernews":
                    break
            assert app.room_id == "hackernews"
    run(go())


# ── M4: the Workbench and its radio, the Archive, GitHub, the Composing Room ──

async def until(pilot, check, tries=80):
    for _ in range(tries):
        await pilot.pause(0.05)
        if check():
            return
    raise AssertionError("it never happened")


EPISODE = {"id": "dev:pod:rust:https://x.fm/1.mp3", "title": "Episode one", "show": "Rustacean Station",
           "show_art": "https://x.fm/art.jpg", "audio": "https://x.fm/1.mp3", "duration": 3600,
           "url": "https://x.fm/1", "published_at": NOW - 3600, "summary": "About lifetimes."}


@pytest.fixture
def with_bench(monkeypatch):
    from server.sources import dev
    langs = [{"id": "rust", "name": "Rust"}, {"id": "python", "name": "Python"}]
    monkeypatch.setattr(dev, "list_languages", lambda: langs)
    monkeypatch.setattr(dev, "get_language", lambda i: {"id": i} if i in ("rust", "python") else None)
    monkeypatch.setattr(dev, "dossier", lambda i: {"id": i, "name": i.title(), "docs": [
        {"kind": "book", "title": "The Book", "url": "https://doc.rust-lang.org/book/", "note": "the official book"}]})
    monkeypatch.setattr(dev, "podcasts", lambda i: {"episodes": [dict(EPISODE, id=EPISODE["id"].replace("rust", i))],
                                                    "stale": False})
    monkeypatch.setattr(dev, "videos", lambda i: {"items": FEED[:2], "has_more": False})
    monkeypatch.setattr(dev, "updates", lambda i: {"items": [{"id": "u1", "type": "release", "tag": "1.91.0",
                                                              "url": "https://blog.rust-lang.org/x", "published_at": NOW}]})
    monkeypatch.setattr(dev, "repos", lambda i, period="weekly": {"items": []})
    monkeypatch.setattr(dev, "release", lambda i: {"tag": "1.91.0", "url": "https://x"})


def test_the_workbench_puts_a_podcast_on_the_radio(make_app, with_bench):
    async def go():
        app = make_app(start_room="dev")
        tuned = []
        app.radio.tune = lambda ep: tuned.append(ep)
        async with app.run_test(size=(150, 40)) as pilot:
            await until(pilot, lambda: app.ready and app.room_id == "dev" and app.room.list.items)
            bench = app.room
            assert bench.view == "podcasts" and bench.list.selected["title"] == "Episode one"
            assert "Rust 1.91.0" in bench.winbar.right
            await pilot.press("enter")
            assert tuned and tuned[0]["audio"] == "https://x.fm/1.mp3" and tuned[0]["lang"] == "rust"
            await pilot.press("s")
            await pilot.pause(0.3)
            saved = app.api.get("/saved")["items"]
            assert saved[0]["id"] == "podcast:" + EPISODE["id"] and saved[0]["extra"]["audio"] == EPISODE["audio"]
            await pilot.press("]", "l")
            await until(pilot, lambda: bench.lang == "python" and bench.list.items
                        and "python" in bench.list.selected["id"])
            await pilot.press("tab", "tab")
            await until(pilot, lambda: bench.view == "updates" and bench.list.items)
            assert bench.list.selected["tag"] == "1.91.0"
            # a saved episode opens on the radio from the drawer too
            tuned.clear()
            app.open_item(saved[0])
            assert tuned[0]["id"] == EPISODE["id"]
    run(go())


@pytest.fixture
def with_archive(monkeypatch):
    from server import db
    from server.brain import llm, search, summarize
    doc = {"item_id": "yt:aaaaaaaaaaa", "title": "A talk", "source_name": "Chan", "status": "ready", "duration": 600,
           "thumbnail": "", "url": "https://www.youtube.com/watch?v=aaaaaaaaaaa", "has_summary": 1,
           "added_at": NOW - 1000, "indexed_at": NOW - 900, "platform": "youtube", "error": None}
    chunks = [{"idx": 0, "t_start": 0.0, "t_end": 40.0, "text": "Hello and welcome."},
              {"idx": 1, "t_start": 40.0, "t_end": 80.0, "text": "Ownership is the key idea."}]
    monkeypatch.setattr(db, "brain_list", lambda status=None, limit=500: [doc])
    monkeypatch.setattr(db, "brain_get", lambda iid, with_chunks=False: dict(doc, summary="It is about X.", chunks=chunks))
    monkeypatch.setattr(llm, "available", lambda: True)
    monkeypatch.setattr(llm, "has_model", lambda m: True)
    monkeypatch.setattr(llm, "models", lambda: ["m"])
    monkeypatch.setattr(search, "semantic_search", lambda q, model, k=None: [
        {"item_id": doc["item_id"], "t_start": 40.0, "t_end": 80.0, "snippet": "Ownership is the key idea.",
         "title": "A talk", "source_name": "Chan", "thumbnail": "", "score": 0.7, "idx": 1}])
    monkeypatch.setattr(summarize, "ask", lambda q, e, m: {
        "answer": "It's ownership [1].", "citations": [{"n": 1, "item_id": doc["item_id"], "title": "A talk",
                                                        "t_start": 40.0}], "expanded": [1]})


def test_the_archive_reads_searches_asks_and_plays_from_there(make_app, with_archive):
    async def go():
        app = make_app(start_room="archive")
        played = []
        app.player.play = lambda item, start=None: played.append((item["id"], start))
        async with app.run_test(size=(140, 40)) as pilot:
            await until(pilot, lambda: app.ready and app.room_id == "archive" and app.room.list.items)
            ar = app.room
            assert ar.view == "library" and ar.list.selected["title"] == "A talk"
            await pilot.press("enter")
            await until(pilot, lambda: len(ar.list.items) == 2)
            await pilot.press("j", "enter")
            assert played == [("yt:aaaaaaaaaaa", 40.0)]
            await pilot.press("s")
            await pilot.pause(0.3)
            assert app.api.get("/saved")["items"][0]["id"] == "moment:yt:aaaaaaaaaaa@40"
            await pilot.press("h")
            assert ar.doc is None
            await pilot.press(":", *"ar ownership", "enter")
            await until(pilot, lambda: ar.view == "search" and ar.list.items)
            assert ar.list.selected["snippet"].startswith("Ownership")
            await pilot.press(":", *"ask what matters", "enter")
            await until(pilot, lambda: ar.view == "ask" and ar.list.items)
            assert "ownership" in str(ar.panel.render()) and ar.list.selected["n"] == 1
            await pilot.press("enter")
            assert played[-1] == ("yt:aaaaaaaaaaa", 40.0)
    run(go())


NOTIFS = [
    {"id": "11", "unread": True, "reason": "mention", "updated_at": NOW - 60, "repo": "me/proj", "repo_avatar": None,
     "private": False, "title": "Fix the thing", "type": "Issue",
     "target": {"kind": "issue", "number": 7, "html_url": "https://github.com/me/proj/issues/7"}},
    {"id": "12", "unread": True, "reason": "ci_activity", "updated_at": NOW - 90, "repo": "me/proj", "repo_avatar": None,
     "private": False, "title": "CI failed", "type": "CheckSuite",
     "target": {"kind": "checks", "html_url": "https://github.com/me/proj/actions"}},
]


@pytest.fixture
def with_github(monkeypatch):
    from server.sources import github
    calls = []
    monkeypatch.setattr(github, "account", lambda: {"linked": True, "login": "me",
                                                    "can": {"notifications": True, "comment": True}})
    monkeypatch.setattr(github, "notifications", lambda show_all=False, participating=False, page=0: {
        "items": [dict(n) for n in NOTIFS], "has_more": False, "stale": False})
    monkeypatch.setattr(github, "mark_read", lambda tid: calls.append(("read", tid)))
    monkeypatch.setattr(github, "mark_done", lambda tid: calls.append(("done", tid)))
    monkeypatch.setattr(github, "thread", lambda full, number, page=0: {
        "item": {"title": "Fix the thing", "author": "ann",
                 "extra": {"repo": full, "number": number, "state": "open", "created_at": NOW - 500, "labels": []}},
        "body_html": "<p>It breaks.</p>", "comments": [{"author": "bo", "html": "<p>Same here</p>", "created_at": NOW - 30}],
        "more_comments": False, "locked": False})
    monkeypatch.setattr(github, "add_comment", lambda full, number, body: calls.append(("comment", full, number, body))
                        or {"id": 1})
    return calls


def test_github_reads_the_inbox_comments_and_marks_done(make_app, with_github, monkeypatch):
    from tui import editor
    from tui.rooms.github import room as gh_room
    monkeypatch.setattr(gh_room, "DONE_AFTER", 0.3)
    monkeypatch.setattr(editor, "resolve", lambda configured="": ["nvim"])
    drafts = []

    def write(app, cmd):
        text = open(cmd[-1]).read()
        drafts.append(text)
        open(cmd[-1], "w").write("Looks good to me.\n" + text)
        return 0
    monkeypatch.setattr(editor, "run_editor", write)

    async def go():
        app = make_app(start_room="github")
        async with app.run_test(size=(150, 40)) as pilot:
            await until(pilot, lambda: app.ready and app.room_id == "github" and app.room.list.items)
            gh = app.room
            assert [n["title"] for n in gh.list.items] == ["Fix the thing", "CI failed"]
            await pilot.press("enter")
            await until(pilot, lambda: gh.thread is not None)
            assert ("read", "11") in with_github
            body = str(gh.preview.body.render())
            assert "It breaks." in body and "Same here" in body
            await pilot.press("i")
            await until(pilot, lambda: any(c[0] == "comment" for c in with_github))
            assert ("comment", "me/proj", 7, "Looks good to me.") in with_github
            assert "> Same here" in drafts[0]          # the last comment is there to answer
            await pilot.press("j", "d", "d")
            assert [n["title"] for n in gh.list.items] == ["Fix the thing"]
            await pilot.press("u")                     # taken back before it was sent
            assert len(gh.list.items) == 2
            await pilot.pause(0.5)
            assert not any(c[0] == "done" for c in with_github)
            assert [n["id"] for n in gh.list.items] == ["12", "11"]   # unread first, the read one below
            await pilot.press("G", "d", "d")
            await until(pilot, lambda: ("done", "11") in with_github)
    run(go())


def test_the_composing_room_opens_files_in_your_editor(make_app, tmp_path, monkeypatch):
    from server import config as server_config, db
    from tui import editor
    ws = tmp_path / "ws"
    (ws / "proj" / "src").mkdir(parents=True)
    (ws / "proj" / "src" / "main.rs").write_text("fn main() {}\n")
    (tmp_path / "escape.txt").write_text("outside")
    monkeypatch.setattr(server_config, "EDITOR_ROOT", ws)
    monkeypatch.setattr(editor, "resolve", lambda configured="": ["nvim"])
    opened = []
    monkeypatch.setattr(editor, "run_editor", lambda app, cmd: opened.append(cmd) or 0)

    async def go():
        app = make_app(start_room="editor")
        db.editor_state_set("session", {"panes": [{"active": "proj/src/main.rs",
                                                   "tabs": ["proj/src/main.rs", "../escape.txt"]}]})
        async with app.run_test(size=(120, 32)) as pilot:
            await until(pilot, lambda: app.ready and app.room_id == "editor" and app.room.list.items)
            room = app.room
            assert [i["title"] for i in room.list.items] == ["main.rs", "escape.txt"]
            await pilot.press("enter")
            assert opened == [["nvim", str((ws / "proj" / "src" / "main.rs").resolve())]]   # your own setup, no -n
            await pilot.press("j", "enter")
            assert len(opened) == 1 and "outside the workspace" in app.statusline.message.text
    run(go())


def test_a_note_in_the_saved_drawer_and_the_sleep_timer(make_app, monkeypatch):
    from tui import editor
    monkeypatch.setattr(editor, "resolve", lambda configured="": ["nvim"])

    def write(app, cmd):
        text = open(cmd[-1]).read()
        open(cmd[-1], "w").write("Watch with Sam." + text)
        return 0
    monkeypatch.setattr(editor, "run_editor", write)

    async def go():
        app = make_app()
        async with app.run_test(size=(140, 36)) as pilot:
            await ready(app, pilot)
            first = app.room.list.selected
            await pilot.press("s")
            await pilot.pause(0.3)
            await pilot.press("space", "s")
            await until(pilot, lambda: app.drawer.list.items)
            await pilot.press("i")
            await pilot.pause(0.3)
            saved = app.api.get("/saved")["items"]
            assert saved[0]["id"] == first["id"] and saved[0]["note"] == "Watch with Sam."
            assert app.drawer.list.selected["note"] == "Watch with Sam."
            await pilot.press("q")
            await pilot.press(":", *"sleep 30", "enter")
            assert app.sleep.mode == "time" and app.statusline.sleep in ("30m", "29m")
            await pilot.press(":", *"sleep end", "enter")
            assert app.statusline.sleep == "end"
            await pilot.press(":", *"sleep off", "enter")
            assert not app.sleep.on and app.statusline.sleep == ""
            await pilot.press(":", *"radio", "enter")
            assert "radio is off" in app.statusline.message.text
    run(go())


def test_visual_saves_queues_and_copies_a_range(make_app, monkeypatch):
    from tui import links
    copied = []
    monkeypatch.setattr(links, "copy", lambda text: copied.append(text) or True)

    async def go():
        app = make_app()
        async with app.run_test(size=(140, 36)) as pilot:
            await ready(app, pilot)
            lst = app.room.list
            await pilot.press("j", "V", "j", "j")
            assert app.mode == "VISUAL" and lst.visual_range() == (1, 3)
            assert app.statusline.pending == "3 rows"
            await pilot.press("o")
            assert lst.cursor == 1 and lst.visual_range() == (1, 3)
            want = [i["id"] for i in lst.items[1:4]]
            await pilot.press("s")
            assert app.mode == "NORMAL" and lst.anchor is None
            await until(pilot, lambda: sorted(i["id"] for i in app.api.get("/saved")["items"]) == sorted(want))
            await pilot.press("u")   # one u takes back the whole range
            await until(pilot, lambda: app.api.get("/saved")["items"] == [])
            # all saved already: s takes them all out
            await pilot.press("V", "j", "s")
            await until(pilot, lambda: len(app.api.get("/saved")["items"]) == 2)
            await pilot.press("k", "V", "j", "s")
            await until(pilot, lambda: app.api.get("/saved")["items"] == [])
            await pilot.press("k", "V", "2", "j", "a")
            assert [i["id"] for i in app.player.queue] == want
            await pilot.press("V", "j", "y")
            assert copied == ["\n".join(links.clean(i["url"]) for i in lst.items[3:5])]
            # a key that isn't VISUAL's ends it and then does its usual thing
            await pilot.press("V", "j", "tab")
            assert app.mode == "NORMAL" and lst.anchor is None and app.room.view == "live"
            await pilot.press("shift+tab", "V", "escape")
            assert app.mode == "NORMAL" and app.keys.feed("d") == "pending"
            app.keys.reset()
    run(go())


def test_visual_d_and_x_do_what_the_room_does_with_one(make_app):
    from server import db
    for item in FEED[:3]:
        db.add_history("youtube", item["id"], item["title"], "UC1", "Channel 1", "", item["url"])

    async def go():
        app = make_app()
        async with app.run_test(size=(140, 36)) as pilot:
            await ready(app, pilot)
            room = app.room
            await pilot.press("V", "j", "x")   # x: these channels are seen
            assert "2 channels marked seen" in app.statusline.message.text
            await pilot.press("V", "d")        # not in History: says where it works
            assert "History" in app.statusline.message.text
            room.set_view("history")
            await until(pilot, lambda: room.view == "history" and len(room.list.items) == 3)
            await pilot.press("V", "j", "d")
            await until(pilot, lambda: len(room.list.items) == 1)
            left = [h["item_id"] for h in app.api.get("/history", platform="youtube")["items"]]
            assert left == [room.list.items[0]["id"]]
            # the Saved drawer: x marks a range done, d takes it off, u brings it back
            for item in FEED[:3]:
                app.toggle_saved(item)
            await until(pilot, lambda: len(app.api.get("/saved")["items"]) == 3)
            await pilot.press("space", "s")
            await until(pilot, lambda: len(app.drawer.list.items) == 3)
            await pilot.press("V", "j", "x")
            await until(pilot, lambda: sum(1 for i in app.api.get("/saved")["items"] if i.get("done_at")) == 2)
            assert len(app.drawer.list.items) == 1
            await pilot.press("tab", "tab")    # All
            await pilot.press("g", "g", "V", "G", "d")
            await until(pilot, lambda: app.api.get("/saved")["items"] == [])
            assert app.drawer.list.items == []
            await pilot.press("u")
            await until(pilot, lambda: len(app.api.get("/saved")["items"]) == 3)
    run(go())


def test_the_github_room_shows_your_contributions_when_theres_room(make_app, with_github, monkeypatch):
    import datetime as dt
    from server.sources import github
    today = dt.date.today()
    days = [{"date": (today - dt.timedelta(days=i)).isoformat(), "count": i % 3, "level": i % 3} for i in range(365)]
    monkeypatch.setattr(github, "contributions", lambda login: {"total": 365, "days": days, "private": True})

    async def go():
        app = make_app(start_room="github")
        async with app.run_test(size=(150, 40)) as pilot:
            await until(pilot, lambda: app.ready and app.room_id == "github" and app.room.calendar.display)
            text = str(app.room.calendar.render())
            assert "me · 365 contributions in the last year" in text and "Wed " in text
            await pilot.resize_terminal(150, 28)
            await until(pilot, lambda: not app.room.calendar.display)   # the list keeps its rows
    run(go())


def test_visual_in_the_github_inbox(make_app, with_github, monkeypatch):
    from tui.rooms.github import room as gh_room
    monkeypatch.setattr(gh_room, "DONE_AFTER", 0.3)

    async def go():
        app = make_app(start_room="github")
        async with app.run_test(size=(150, 40)) as pilot:
            await until(pilot, lambda: app.ready and app.room_id == "github" and app.room.list.items)
            gh = app.room
            await pilot.press("V", "j", "x")
            await pilot.pause(0.3)
            assert sorted(c for c in with_github if c[0] == "read") == [("read", "11"), ("read", "12")]
            await pilot.press("g", "g", "V", "j", "d")
            assert gh.list.items == []
            await pilot.press("u")              # within the five seconds: nothing was sent
            assert len(gh.list.items) == 2
            await pilot.press("V", "j", "d")
            await until(pilot, lambda: sum(1 for c in with_github if c[0] == "done") == 2)
    run(go())


def test_visual_needs_a_list(make_app, with_social):
    async def go():
        app = make_app(start_room="hackernews")
        async with app.run_test(size=(140, 36)) as pilot:
            await until(pilot, lambda: app.ready and app.room is not None and app.room.board.items)
            await pilot.press("enter")
            await until(pilot, lambda: app.room.reader.items)
            await pilot.press("V")   # the reader is a thread, not a list of things
            assert app.mode == "NORMAL" and "isn't one" in app.statusline.message.text
    run(go())


def test_map_lists_the_keys_with_their_action_names(make_app):
    async def go():
        app = make_app()
        async with app.run_test(size=(140, 36)) as pilot:
            await ready(app, pilot)
            await pilot.press(":", *"map", "enter")
            assert app.info.display
            text = str(app.info.render())
            assert "<leader>f" in text and "find" in text           # everywhere
            assert "[keys.youtube]" in text and "toggle_watched" in text
            assert "[keys.visual]" in text and "visual_save" in text
            await pilot.press("q")
            assert not app.info.display
    run(go())
