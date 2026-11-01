"""The `:` commands: one list, read by `:help`, by Tab on the command line and by the
hint the line shows while you type. The app runs them (`TubcalApp.run_command`);
tests/test_tui_pages.py checks that every one here is run there.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Command:
    name: str
    args: str = ""                     # how it's written after the name
    help: str = ""                     # one line
    group: str = ""
    aliases: tuple[str, ...] = ()
    more: tuple[str, ...] = ()         # examples and details, shown under it in :help
    page: bool = False                 # it opens a page


GROUPS = ["Finding and opening", "Playing", "Following and accounts", "Settings", "Pages", "This terminal"]

COMMANDS = [
    # finding and opening
    Command("open", "<link>", "Play a YouTube link in mpv", "Finding and opening", ("play",),
            ("`:open https://youtu.be/…` plays it at once; `o` opens other links on their own site.",)),
    Command("yt", "<words>", "Search YouTube, in the Screening Room", "Finding and opening"),
    Command("hn", "<words>", "Search Hacker News, in the Wire", "Finding and opening"),
    Command("r", "<words>", "Search Reddit, in the Dispatch", "Finding and opening"),
    Command("ar", "<words>", "Search what was said in the videos the Archive has transcribed",
            "Finding and opening"),
    Command("ask", "[question]", "Ask the Archive about your videos", "Finding and opening", (),
            ("Alone, your editor opens for the question.", "The answer cites the moments it came from.")),
    # playing
    Command("queue", "", "What's playing, what's next, the radio and the sleep timer", "Playing", ("playing",),
            ("`Space q` opens it too. In the queue: Enter plays one now, `dd` takes it out, `J` `K` move it.",),
            page=True),
    Command("sleep", "[30 | 1h30 | end | off]", "The sleep timer", "Playing", (),
            ("A number is minutes; `1h30` an hour and a half; `end` stops when what's playing ends.",
             "The last 12 seconds fade out. Alone, it opens the timer on the queue's page."), page=True),
    Command("radio", "[off]", "Pause or play the radio; `off` switches it off", "Playing"),
    Command("private", "[off]", "A session that records nothing", "Playing", (),
            ("Nothing you play is recorded, no resume points, AniList isn't updated, and pictures stay "
             "in memory. `:private off` ends it.",)),
    # following and accounts
    Command("following", "", "Everything you follow, by platform", "Following and accounts", (),
            ("`dd` unfollows (`u` follows again), Enter opens it, `a` follows something new.",), page=True),
    Command("follow", "[@name | r/sub | owner/repo | link]", "Follow a channel, subreddit, repo or person",
            "Following and accounts", (),
            ("Alone: the selected video's channel, or the subreddit you're in.",
             "`:follow @veritasium`, `:follow r/linux`, `:follow torvalds/linux`.")),
    Command("unfollow", "[name]", "Stop following it", "Following and accounts", (),
            ("Alone: the selected video's channel or the subreddit you're in; with nothing selected, "
             "the list of what you follow.",)),
    Command("link", "anilist | reddit | github [token]", "Link an account", "Following and accounts", (),
            ("AniList and Reddit want an API client of your own; `:link anilist` says how.",
             "`:link github` takes the GitHub CLI's sign-in; `:link github <token>` a personal access token.")),
    Command("unlink", "anilist | reddit | github", "Unlink an account", "Following and accounts"),
    Command("room", "on | off <room>", "Put a room in the tabs, or take it out", "Following and accounts", (),
            ("`:room off wire`, `:room on github`. A room out of the tabs still opens when you ask for it.",)),
    # settings
    Command("settings", "", "Accounts, playback, rooms, and this terminal's own settings", "Settings", (),
            ("`Space ,` opens it too. Enter changes a setting, `h` `l` step through its choices.",), page=True),
    Command("set", "[name=value | name | noname | name?]", "Change a setting", "Settings", (),
            ("`:set speed=1.25`, `:set subtitles`, `:set nompris`, `:set editor=nvim`; `:set speed?` says it.",
             "`:set quality=720` switches what's playing now. Alone, it opens Settings.",
             "Every setting's name is beside it in Settings.")),
    # pages
    Command("help", "[command]", "These commands; with a name, that one", "Pages", ("h",), page=True),
    Command("keys", "", "Every key, by what it does; Enter runs one", "Pages", ("map",),
            ("`?` opens it too. The name beside each key is what `[keys]` in tui.toml takes.",), page=True),
    Command("messages", "", "What this session said in the statusline", "Pages", (), page=True),
    Command("checkhealth", "", "What works here: the server, mpv, pictures, colours", "Pages", (), page=True),
    Command("about", "", "The licence, and what Tubcal builds on", "Pages", (), page=True),
    # this terminal
    Command("theme", "", "Read the terminal's colours again", "This terminal"),
    Command("refresh", "", "Fetch this room's list again", "This terminal"),
    Command("cache", "clear", "Empty the picture cache", "This terminal"),
    Command("history", "clear", "Forget the terminal's read marks and podcast places", "This terminal", (),
            ("Your watch history is the server's: the web interface's Settings → Your data.",)),
    Command("reload", "", "Start the terminal interface again, here (`ZR` does too)", "This terminal",
            ("restart",),
            ("For new code, a changed tui.toml or new colours. You come back to the same room, and "
             "a video or the radio that's playing goes on.",)),
    Command("q", "", "Quit Tubcal (`ZZ` does too)", "This terminal", ("quit", "qa", "q!", "qa!", "wq", "x")),
]

BY_NAME = {n: c for c in COMMANDS for n in (c.name, *c.aliases)}


def find(name: str) -> Command | None:
    return BY_NAME.get(name.strip().lstrip(":"))


def names() -> list[str]:
    """Everything Tab completes, each command's own name before its aliases."""
    return [c.name for c in COMMANDS] + [a for c in COMMANDS for a in c.aliases if a.isalpha()]


def completions(word: str) -> list[str]:
    return [n for n in names() if n.startswith(word)]


def usage(c: Command) -> str:
    return f":{c.name} {c.args}".rstrip()
