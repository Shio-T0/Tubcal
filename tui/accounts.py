"""What Settings in the web interface does, from the terminal: following channels and
subreddits, linking accounts, switching rooms on and off. The Settings page
(tui/pages/settings.py: `Space ,`, `:settings`) shows them and runs these; an install
with only the terminal interface depends on them.

    :follow @name | link | r/sub | owner/repo   (alone: the selected video's channel
                                                  or post's subreddit)
    :unfollow [name]                            (alone: the same, from the selection)
    :link anilist|reddit [client id] [secret]   (OAuth in your browser, then back here)
    :link github [token]                        (alone: the GitHub CLI's sign-in)
    :unlink anilist|reddit|github
    :room on|off <room>

Every call is a thread worker; results come back with `call_from_thread`.
"""

from __future__ import annotations

import re
import time
from typing import TYPE_CHECKING

from . import links
from .api import ApiError
from .rooms import ALL_ROOMS, ROOM_BY_ID

if TYPE_CHECKING:
    from .app import TubcalApp

# OAuth providers you link with an API client of your own (as in Settings → Accounts)
OAUTH = {
    "anilist": ("AniList", "https://anilist.co/settings/developer", "anime"),
    "reddit": ("Reddit", "https://www.reddit.com/prefs/apps (a \"web app\")", "reddit"),
}
PLATFORM_ROOM = {"youtube": "youtube", "reddit": "reddit", "github": "github"}
WORD = {"youtube": "channel", "reddit": "subreddit", "github": "repository or person"}


# ── following ────────────────────────────────────────────────────────────────

def platform_of(text: str, room_id: str) -> tuple[str | None, str]:
    """(platform, input) for what was typed: the shape says which, else the room."""
    t = text.strip()
    low = t.lower()
    if re.match(r"^/?r/[\w-]+/?$", low) or "reddit.com/r/" in low:
        return "reddit", t
    if t.startswith("@") or "youtube.com/" in low or "youtu.be/" in low or re.fullmatch(r"UC[\w-]{22}", t):
        return "youtube", t
    if "github.com/" in low or re.fullmatch(r"[\w.-]+/[\w.-]+", t):
        return "github", t
    if room_id in PLATFORM_ROOM:
        return PLATFORM_ROOM[room_id], t
    return None, t


def from_selection(app: TubcalApp) -> tuple[str | None, str, str]:
    """(platform, input, a name to say) for the thing in front of you: the selected
    video's channel, the subreddit you're in or the selected post's."""
    room = app.room
    if room is None:
        return None, "", ""
    if app.room_id == "youtube":
        if getattr(room, "focus_pane", "") == "index":
            row = room.index.selected or {}
            chan = row.get("_chan")
            return ("youtube", f"https://www.youtube.com/channel/{chan}", row.get("title") or chan) if chan \
                else (None, "", "")
        item = room.list.selected or {}
        chan = (item.get("extra") or {}).get("channel_id")
        if chan:
            return "youtube", f"https://www.youtube.com/channel/{chan}", item.get("source") or chan
    if app.room_id == "reddit":
        sub = getattr(room, "sub", None)
        if not sub:
            post = room.selected() or {}
            sub = (post.get("extra") or {}).get("subreddit")
        if sub:
            return "reddit", f"r/{sub}", f"r/{sub}"
    return None, "", ""


def follow(app: TubcalApp, arg: str) -> None:
    if arg:
        platform, raw = platform_of(arg, app.room_id)
        name = raw
    else:
        platform, raw, name = from_selection(app)
        if not platform:   # nothing selected to follow: what you follow, and how
            app.open_following()
            app.say("`:follow @channel`, `:follow r/subreddit` or `:follow owner/repo`.")
            return
    if not platform:
        app.say("`:follow` takes @channel or a YouTube link, r/subreddit, or owner/repo "
                "(alone: the selected video's channel or post's subreddit).", "warn")
        return
    if app.registry and not app.registry.has(PLATFORM_ROOM[platform]):
        room = ROOM_BY_ID[PLATFORM_ROOM[platform]]
        app.say(f"{room.label} isn't installed here: tubcal add {room.id}", "warn")
        return
    app.say(f"Looking up {name}…")

    def work():
        try:
            row = app.api.post("/subscriptions", {"platform": platform, "input": raw}, timeout=60) or {}
            msg, level = f"Following {row.get('display_name') or name}.", "info"
        except ApiError as e:
            msg, level = ((f"You already follow {name}.", "info") if e.status == 409 else (str(e), "error"))
            row = None
        app.call_from_thread(_followed, app, platform, msg, level, row is not None)
    app.run_worker(work, thread=True, group="follow")


def _followed(app: TubcalApp, platform: str, msg: str, level: str, changed: bool) -> None:
    app.say(msg, level)
    if changed:
        room = app.rooms.get(PLATFORM_ROOM[platform])
        if room is not None and room.loaded:
            room.reload(force=True)


def unfollow(app: TubcalApp, arg: str) -> None:
    if arg:
        platform, raw = platform_of(arg, app.room_id)
        name = raw
    else:
        platform, raw, name = from_selection(app)
        if not platform:   # nothing selected: the list, where dd unfollows
            app.open_following()
            return

    def work():
        try:
            subs = app.api.get("/subscriptions") or {}
        except ApiError as e:
            app.call_from_thread(app.say, str(e), "error")
            return
        row = match_subscription(subs, platform, raw)
        if row is None:
            app.call_from_thread(app.say, f"You don't follow {name}.", "warn")
            return
        try:
            app.api.delete(f"/subscriptions/{row['id']}")
        except ApiError as e:
            app.call_from_thread(app.say, str(e), "error")
            return
        app.call_from_thread(_followed, app, row["platform"],
                             f"Not following {row.get('display_name') or name} any more. (`:follow` brings it back.)",
                             "info", True)
    app.run_worker(work, thread=True, group="follow")


def match_subscription(subs: dict, platform: str | None, raw: str) -> dict | None:
    """The subscription `raw` names: its id (a channel id in a link, `r/name`), or its
    name, ignoring case and a leading @ or r/."""
    want = raw.strip().rstrip("/")
    m = re.search(r"/channel/([\w-]+)", want)
    if m:
        want = m.group(1)
    key = re.sub(r"^(/?r/|@)", "", want.split("reddit.com/r/")[-1]).lower()
    platforms = [platform] if platform else list(subs)
    for p in platforms:
        for row in subs.get(p) or []:
            shown = str(row.get("display_name") or "").lower()
            if key in (str(row.get("source_id") or "").lower(), shown, re.sub(r"^(r/|@)", "", shown)):
                return row
    return None


# ── accounts ─────────────────────────────────────────────────────────────────

def link(app: TubcalApp, arg: str) -> None:
    parts = arg.split()
    if not parts:
        app.open_settings("accounts")
        return
    who = parts[0].lower()
    if who == "github":
        _link_github(app, parts[1] if len(parts) > 1 else None)
    elif who in OAUTH:
        _link_oauth(app, who, parts[1:])
    elif who in ("youtube", "google"):
        app.say("The YouTube account link is only used by the web interface; follow channels here "
                "with `:follow @name`.", "warn")
    else:
        app.say("`:link anilist`, `:link reddit` or `:link github`.", "warn")


def _link_github(app: TubcalApp, token: str | None) -> None:
    app.say("Linking GitHub…")

    def work():
        try:
            body = {"token": token} if token else {"method": "gh"}
            me = app.api.post("/github/account", body, timeout=40) or {}
            msg = (f"GitHub linked as {me['login']}." if me.get("login") else "GitHub linked."), "info"
        except ApiError as e:
            hint = "" if token else " (or `:link github <token>` with a personal access token)"
            msg = f"{e}{hint}", "error"
        app.call_from_thread(_linked, app, "github", *msg)
    app.run_worker(work, thread=True, group="link")


def _link_oauth(app: TubcalApp, provider: str, creds: list[str]) -> None:
    label, where, room_id = OAUTH[provider]

    def work():
        try:
            if len(creds) >= 2:
                app.api.put(f"/oauth/{provider}/credentials", {"client_id": creds[0], "client_secret": creds[1]})
            status = (app.api.get("/oauth/status") or {}).get(provider) or {}
        except ApiError as e:
            app.call_from_thread(app.say, str(e), "error")
            return
        if not status.get("configured"):
            app.call_from_thread(_oauth_steps, app, provider)
            return
        url = app.api.url(f"/api/oauth/{provider}/start")
        problem = links.open_url(url, app.cfg["browser"])
        if problem:
            app.call_from_thread(app.say, f"{problem} Open {url} on this computer.", "error")
            return
        app.call_from_thread(app.say, f"Approve Tubcal for {label} in your browser; this waits for it.")
        for _ in range(150):   # five minutes
            time.sleep(2)
            try:
                if ((app.api.get("/oauth/status") or {}).get(provider) or {}).get("connected"):
                    app.call_from_thread(_linked, app, room_id, f"{label} is connected.", "info")
                    return
            except ApiError:
                pass
        app.call_from_thread(app.say, f"{label} didn't connect. `:link {provider}` tries again.", "warn")
    app.run_worker(work, thread=True, group="link", exclusive=True)


def _oauth_steps(app: TubcalApp, provider: str) -> None:
    from .pages.info import steps_page
    label, where, _ = OAUTH[provider]
    app.open_page(steps_page(app, provider, label, where))


def _linked(app: TubcalApp, room_id: str, msg: str, level: str) -> None:
    app.say(msg, level)
    if app.page is not None and app.page.id == "settings":
        app.page.reload()
    if level == "info":
        if room_id == "anime":
            app.anime.loaded_at = 0
        room = app.rooms.get(room_id)
        if room is not None and room.loaded:
            room.reload(force=True)


def unlink(app: TubcalApp, arg: str) -> None:
    who = arg.strip().lower()
    if who not in (*OAUTH, "github"):
        app.say("`:unlink anilist`, `:unlink reddit` or `:unlink github`.", "warn")
        return

    def work():
        try:
            app.api.delete("/github/account" if who == "github" else f"/oauth/{who}")
            label, _, room_id = OAUTH.get(who, ("GitHub", "", "github"))
            app.call_from_thread(_linked, app, room_id, f"{label} isn't linked any more.", "info")
        except ApiError as e:
            app.call_from_thread(app.say, str(e), "error")
    app.run_worker(work, thread=True, group="link")


# ── rooms ────────────────────────────────────────────────────────────────────

def room(app: TubcalApp, arg: str) -> None:
    """`:room on|off <room>`: the tabs' rooms, as Settings → Rooms keeps them."""
    how, _, which = arg.strip().partition(" ")
    target = next((r for r in ALL_ROOMS if which.strip().lower() in (r.id, r.short.lower(), r.label.lower(),
                                                                       r.label.lower().removeprefix("the "))), None)
    if how not in ("on", "off") or not target:
        app.say("`:room on <room>` or `:room off <room>` (wire, anime, github…).", "warn")
        return
    if target.fixed:
        app.say(f"{target.label} is always on.", "warn")
        return
    if app.registry and not app.registry.has(target.id):
        app.say(f"{target.label} isn't installed here: tubcal add {target.id}", "warn")
        return

    def work():
        try:
            active = list((app.api.get("/settings") or {}).get("active_rooms") or [])
            if how == "on" and target.id not in active:
                active.append(target.id)
            elif how == "off":
                active = [r for r in active if r != target.id]
            app.api.put("/settings", {"active_rooms": active})
        except ApiError as e:
            app.call_from_thread(app.say, str(e), "error")
            return
        app.call_from_thread(_rooms_changed, app, active, f"{target.label} is {how} in the tabs.")
    app.run_worker(work, thread=True)


def _rooms_changed(app: TubcalApp, active: list[str], msg: str) -> None:
    app.settings["active_rooms"] = active
    if app.registry:
        app.registry.active = set(active)
    app.say(msg)
    app.repaint_page()
    app.refresh_chrome()
