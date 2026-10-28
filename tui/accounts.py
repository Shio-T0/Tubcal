"""What Settings in the web interface does, from the terminal: following channels and
subreddits, linking accounts, switching rooms on and off, and the sheet that shows
them (`Space ,` when there's no web interface, `:settings` any time). An install
with only the terminal interface depends on these.

    :follow @name | link | r/sub | owner/repo   (alone: the selected video's channel
                                                  or post's subreddit)
    :unfollow [name]                            (alone: the same, from the selection)
    :link anilist|reddit [client id] [secret]   (OAuth in your browser, then back here)
    :link github [token]                        (alone: the GitHub CLI's sign-in)
    :unlink anilist|reddit|github
    :room on|off <room>
    :about                                      (the licence and what Tubcal builds on)

Every call is a thread worker; results come back with `call_from_thread`.
"""

from __future__ import annotations

import re
import time
from typing import TYPE_CHECKING

from rich.text import Text

from . import links
from .api import ApiError
from .bootstrap import REPO
from .rooms import ALL_ROOMS, ROOM_BY_ID
from .ui.paint import style

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
        if not platform:
            app.say("`:unfollow` takes the name of a channel, r/subreddit or owner/repo "
                    "(alone: the selected video's channel or post's subreddit).", "warn")
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
        settings_sheet(app)
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
    label, where, _ = OAUTH[provider]
    r = app.roles
    t = Text()
    t.append(f"Linking {label}", style(r, "fg+bold"))
    t.append("   q closes this\n\n", style(r, "dim"))
    t.append(f"{label} wants an API client of your own, as in the web interface's Settings → Accounts.\n\n",
             style(r, "fg"))
    t.append("1  ", style(r, "hue:yellow"))
    t.append(f"Make one at {where}\n", style(r, "fg"))
    t.append("2  ", style(r, "hue:yellow"))
    t.append("Give it this redirect URL: ", style(r, "fg"))
    t.append(app.api.url(f"/api/oauth/{provider}/callback") + "\n", style(r, "fg+bold"))
    t.append("3  ", style(r, "hue:yellow"))
    t.append(f":link {provider} <client id> <client secret>\n", style(r, "fg+bold"))
    t.append("\nThen your browser asks you to approve Tubcal, and you come back here.\n", style(r, "dim"))
    app._show_info(t)


def _linked(app: TubcalApp, room_id: str, msg: str, level: str) -> None:
    app.say(msg, level)
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
            app.call_from_thread(app.say, f"{OAUTH.get(who, ('GitHub',))[0]} isn't linked any more.")
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
    app.refresh_chrome()


# ── the sheets ───────────────────────────────────────────────────────────────

def settings_sheet(app: TubcalApp) -> None:
    """Accounts, what you follow and the rooms, with the commands that change them."""
    app.say("Reading the settings…")

    def work():
        got = {}
        for key, path in (("oauth", "/oauth/status"), ("subs", "/subscriptions"), ("settings", "/settings")):
            try:
                got[key] = app.api.get(path, timeout=20) or {}
            except ApiError:
                got[key] = None
        if app.registry and app.registry.has("github"):
            try:
                got["github"] = app.api.get("/github/account", timeout=20) or {}
            except ApiError:
                got["github"] = None
        app.call_from_thread(_show_settings, app, got)
    app.run_worker(work, thread=True, group="settings", exclusive=True)


def _show_settings(app: TubcalApp, got: dict) -> None:
    r = app.roles
    reg = app.registry
    t = Text()
    t.append("Settings", style(r, "fg+bold"))
    t.append("   from the terminal · q closes\n", style(r, "dim"))

    def row(label: str, state: str, ok: bool, how: str) -> None:
        t.append(f"  {label:<14}", style(r, "fg"))
        t.append(f"{state:<30}", style(r, "fg" if ok else "dim"))
        t.append(f"{how}\n", style(r, "hue:yellow"))

    t.append("\nAccounts\n", style(r, "fg+bold"))
    oauth = got.get("oauth") or {}
    for provider, (label, _, room_id) in OAUTH.items():
        if reg and not reg.has(room_id):
            continue
        on = (oauth.get(provider) or {}).get("connected")
        row(label, "connected" if on else "not connected", bool(on),
            f":unlink {provider}" if on else f":link {provider}")
    gh = got.get("github")
    if gh is not None:
        on = gh.get("linked")
        row("GitHub", f"linked as {gh.get('login')}" if on else "not linked", bool(on),
            ":unlink github" if on else ":link github")

    t.append("\nFollowing\n", style(r, "fg+bold"))
    subs = got.get("subs") or {}
    for platform, label in (("youtube", "YouTube"), ("reddit", "Reddit"), ("github", "GitHub")):
        if reg and not reg.has(PLATFORM_ROOM[platform]):
            continue
        rows = subs.get(platform) or []
        names = ", ".join(str(x.get("display_name")) for x in rows[:6]) + (" …" if len(rows) > 6 else "")
        n = len(rows)
        word = WORD[platform] + ("s" if n != 1 and platform != "github" else "")
        row(label, f"{n} {word}" if platform != "github" else f"{n} followed", bool(n),
            ":follow …  :unfollow …")
        if names:
            t.append(f"  {'':<14}{names}\n", style(r, "dim"))

    t.append("\nRooms in the tabs\n", style(r, "fg+bold"))
    active = set((got.get("settings") or {}).get("active_rooms") or (reg.active if reg else []))
    for rm in ALL_ROOMS:
        if reg and not reg.has(rm.id):
            continue
        on = rm.fixed or rm.id in active
        row(rm.label, "always on" if rm.fixed else ("on" if on else "off"), on,
            "" if rm.fixed else f":room {'off' if on else 'on'} {rm.id}")

    t.append("\nThe rest of Settings (playback, subtitles, quiet hours, your data) is in the web "
             "interface", style(r, "dim"))
    t.append(".\n" if app.web else ", which this install doesn't have: tubcal add web\n", style(r, "dim"))
    app.say("")
    app._show_info(t)


def about(app: TubcalApp) -> None:
    """The legal notices (GPL §5d): the licence, and what Tubcal builds on."""
    r = app.roles
    t = Text()
    t.append("Tubcal", style(r, "fg+bold"))
    t.append("   q closes this\n\n", style(r, "dim"))
    t.append("Tubcal is free software: you can redistribute it and/or modify it under the terms of the "
             "GNU General Public License as published by the Free Software Foundation, either version 3 "
             "of the License, or (at your option) any later version. It comes with ABSOLUTELY NO WARRANTY.\n\n",
             style(r, "fg"))
    t.append(f"The licence: {REPO / 'LICENSE'}\n\n", style(r, "dim"))
    try:
        notices = (REPO / "THIRD_PARTY_NOTICES.md").read_text()
    except OSError:
        notices = "THIRD_PARTY_NOTICES.md is missing from this copy."
    t.append(notices, style(r, "fg"))
    app._show_info(t)

