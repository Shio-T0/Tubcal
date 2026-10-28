"""What a saved entry is. Mirrors frontend/src/lib/saveable.js (KINDS, kindOf,
channelOfItem); tests/test_tui_saved.py checks the table against the JS."""

from __future__ import annotations

KINDS = {
    "video": ("Videos", "video"), "moment": ("Moments", "video"), "playlist": ("Playlists", "video"),
    "ytchannel": ("Channels", "video"), "anime": ("Anime", "video"), "character": ("Characters", "video"),
    "staff": ("Voices & staff", "video"), "studio": ("Studios", "video"), "thread": ("Anime threads", "video"),
    "story": ("HN stories", "social"), "post": ("Reddit posts", "social"), "subreddit": ("Subreddits", "social"),
    "repo": ("Repositories", "coding"), "release": ("Releases", "coding"), "pull": ("Pull requests", "coding"),
    "issue": ("Issues", "coding"), "commit": ("Commits", "coding"), "ghuser": ("GitHub people", "coding"),
    "event": ("GitHub activity", "coding"), "file": ("Files", "coding"), "article": ("Posts & articles", "coding"),
    "podcast": ("Podcast episodes", "coding"), "doc": ("Manuals", "coding"),
    "page": ("Pages", None), "link": ("Links", None),
}
KIND_ORDER = list(KINDS)
CHANNEL_ORDER = ["video", "social", "coding", None]
CHANNEL_LABEL = {"video": "Video", "social": "Social", "coding": "Coding", None: "Elsewhere"}
TONE = {  # the room colour an entry wears (as theme hues)
    "video": "red", "moment": "red", "playlist": "red", "ytchannel": "red",
    "anime": "blue", "character": "blue", "staff": "blue", "studio": "blue", "thread": "blue",
    "story": "yellow", "post": "dispatch", "subreddit": "dispatch",
    "repo": "magenta", "release": "magenta", "event": "magenta", "pull": "magenta", "issue": "magenta",
    "commit": "magenta", "ghuser": "magenta", "file": "green", "article": "cyan", "podcast": "cyan", "doc": "cyan",
}


def kind_of(item: dict) -> str:
    extra = item.get("extra") or {}
    k = extra.get("kind")
    if k in KINDS:
        return k
    platform = item.get("platform")
    if platform == "youtube":
        return "video"
    if platform == "reddit":
        return "post"
    if platform == "hackernews":
        return "story"
    if platform == "github":
        t = extra.get("type")
        if t == "release":
            return "release"
        if t == "event":
            return "event"
        if t == "user":
            return "ghuser"
        if t in ("pull", "issue", "commit"):
            return t
        return "repo"
    return "link"


def channel_of(item: dict) -> str | None:
    kind = kind_of(item)
    if kind == "page":
        path = str(item.get("url") or "").split("?")[0]
        for prefix, ch in (("/youtube", "video"), ("/anime", "video"), ("/archive", "video"),
                           ("/edition", "social"), ("/hackernews", "social"), ("/reddit", "social"),
                           ("/editor", "coding"), ("/dev", "coding"), ("/github", "coding")):
            if path.startswith(prefix):
                return ch
        return None
    return KINDS[kind][1]
