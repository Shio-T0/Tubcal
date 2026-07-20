"""The Workbench (server/sources/dev.py + server/api/dev.py).

Feed parsing is pure-function tested against inline RSS/Atom samples; the API
tests monkeypatch the network edge (_fetch_feed / github._fetch) so nothing
here touches a real host.
"""

import pytest

from server.sources import dev

PODCAST_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Rustacean Station</title>
    <itunes:image href="https://example.org/cover.jpg"/>
    <item>
      <title>Episode One</title>
      <link>https://example.org/ep1</link>
      <pubDate>Mon, 06 Jul 2026 10:00:00 +0000</pubDate>
      <description>&lt;p&gt;All about &lt;b&gt;traits&lt;/b&gt;.&lt;/p&gt;</description>
      <enclosure url="https://example.org/ep1.mp3" type="audio/mpeg" length="1"/>
      <itunes:duration>1:02:30</itunes:duration>
    </item>
    <item>
      <title>No Audio Here</title>
      <link>https://example.org/blogpost</link>
      <pubDate>Sun, 05 Jul 2026 10:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>
"""

ATOM_FEED = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>The Rust Blog</title>
  <entry>
    <title>Announcing Rust 1.99.0</title>
    <link rel="alternate" href="https://blog.rust-lang.org/1.99.0"/>
    <published>2026-07-03T00:00:00+00:00</published>
    <summary>Faster everything.</summary>
  </entry>
</feed>
"""


def test_parse_feed_rss_podcast():
    feed = dev.parse_feed(PODCAST_RSS)
    assert feed["title"] == "Rustacean Station"
    assert feed["image"] == "https://example.org/cover.jpg"
    assert len(feed["entries"]) == 2
    ep = feed["entries"][0]
    assert ep["audio"] == "https://example.org/ep1.mp3"
    assert ep["duration"] == 3750
    assert ep["published_at"] > 0
    assert "traits" in ep["summary"] and "<" not in ep["summary"]
    assert feed["entries"][1]["audio"] is None


def test_parse_feed_atom():
    feed = dev.parse_feed(ATOM_FEED)
    assert feed["title"] == "The Rust Blog"
    entry = feed["entries"][0]
    assert entry["url"] == "https://blog.rust-lang.org/1.99.0"
    assert entry["title"] == "Announcing Rust 1.99.0"
    assert entry["published_at"] > 0


@pytest.mark.parametrize(
    "text,expected",
    [("3750", 3750), ("1:02:30", 3750), ("42:10", 2530), ("", None), ("n/a", None)],
)
def test_parse_duration(text, expected):
    assert dev._parse_duration(text) == expected


def test_registry_is_complete():
    assert dev.LANGUAGE_ORDER[0] == "rust"
    for lid in dev.LANGUAGE_ORDER:
        lang = dev.LANGUAGES[lid]
        for key in ("name", "mascot", "accent", "tagline", "site", "repo",
                    "gh_language", "video_query", "facts", "docs",
                    "podcasts", "feeds"):
            assert lang.get(key), f"{lid} missing {key}"


def test_languages_endpoint(client):
    body = client.get("/api/dev/languages").get_json()
    assert body["ok"] is True
    ids = [l["id"] for l in body["data"]["languages"]]
    assert ids[0] == "rust"


def test_dossier_endpoint(client):
    body = client.get("/api/dev/rust").get_json()
    assert body["ok"] is True
    assert body["data"]["name"] == "Rust"
    assert body["data"]["docs"]
    # the raw search query is backend plumbing, not dossier material
    assert "video_query" not in body["data"]


def test_unknown_language_404(client):
    res = client.get("/api/dev/cobol")
    assert res.status_code == 404
    assert res.get_json()["ok"] is False


def test_podcasts_endpoint_merges_and_sorts(client, monkeypatch):
    monkeypatch.setattr(dev, "_fetch_feed", lambda url: dev.parse_feed(PODCAST_RSS))
    body = client.get("/api/dev/rust/podcasts").get_json()
    assert body["ok"] is True
    eps = body["data"]["episodes"]
    # audio-less items dropped; one audio episode per configured show
    assert len(eps) == len(dev.LANGUAGES["rust"]["podcasts"])
    assert all(e["audio"] for e in eps)
    assert eps == sorted(eps, key=lambda e: e["published_at"], reverse=True)


def test_updates_endpoint_merges_blogs_and_releases(client, monkeypatch):
    from server.sources import github

    monkeypatch.setattr(dev, "_fetch_feed", lambda url: dev.parse_feed(ATOM_FEED))
    monkeypatch.setattr(
        github,
        "_fetch",
        lambda path: [
            {
                "id": 1,
                "tag_name": "1.99.0",
                "name": "Rust 1.99.0",
                "html_url": "https://github.com/rust-lang/rust/releases/tag/1.99.0",
                "published_at": "2026-07-03T00:00:00Z",
                "prerelease": False,
            }
        ],
    )
    body = client.get("/api/dev/rust/updates").get_json()
    assert body["ok"] is True
    types = {i["type"] for i in body["data"]["items"]}
    assert types == {"blog", "release"}


def test_release_endpoint_prefers_latest_release(client, monkeypatch):
    from server.sources import github

    monkeypatch.setattr(
        github,
        "_fetch",
        lambda path: {
            "tag_name": "1.99.0",
            "html_url": "https://example.org/rel",
            "published_at": "2026-07-03T00:00:00Z",
        },
    )
    body = client.get("/api/dev/rust/release").get_json()
    assert body["ok"] is True
    assert body["data"]["tag"] == "1.99.0"


def test_release_tag_filter_skips_prereleases(client, monkeypatch):
    from server.sources import github

    tags = [
        {"name": "v3.15.0b3"},
        {"name": "weekly.2012-03-27"},
        {"name": "v3.14.6"},
        {"name": "v3.13.9"},
    ]
    monkeypatch.setattr(github, "_fetch", lambda path: tags)
    body = client.get("/api/dev/python/release").get_json()
    assert body["data"]["tag"] == "v3.14.6"
