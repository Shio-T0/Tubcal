"""`python -m tui [room | link]` — Tubcal in the terminal.

    python -m tui                 the room you were last in
    python -m tui wire            a room by name (youtube, anime, wire, …)
    python -m tui <youtube link>  play it
    python -m tui play <link>     play it in mpv, without the interface
    python -m tui --private       a session that records nothing
"""

from __future__ import annotations

import argparse
import sys

ROOM_WORDS = {
    "youtube": "youtube", "yt": "youtube", "screening": "youtube", "anime": "anime",
    "wire": "hackernews", "hn": "hackernews", "hackernews": "hackernews",
    "dispatch": "reddit", "reddit": "reddit", "edition": "edition", "paper": "edition",
    "github": "github", "gh": "github", "workbench": "dev", "dev": "dev",
    "editor": "editor", "archive": "archive", "home": "home",
}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="tubcal tui", description="Tubcal in the terminal.")
    ap.add_argument("what", nargs="*", help="a room, a link, or `play <link>`")
    ap.add_argument("--private", action="store_true", help="record nothing this session")
    args = ap.parse_args(argv)

    words = list(args.what)
    if words[:1] == ["play"]:
        from .play import play_cli
        return play_cli(words[1:], private=args.private)

    import os
    # Esc is used all the time here; Textual waits ESCDELAY ms to tell it from an escape
    # sequence (100 by default). Local terminals send sequences in one write.
    os.environ.setdefault("ESCDELAY", "25")

    from . import terminal
    if not terminal.interactive():
        print("Tubcal's terminal interface needs a terminal.", file=sys.stderr)
        return 2
    info = terminal.probe()
    terminal.prepare_env(info)
    terminal.seed_textual_image(info)

    start_room, url = None, None
    for w in words:
        if w.lower() in ROOM_WORDS:
            start_room = ROOM_WORDS[w.lower()]
        elif "://" in w or ("." in w.split("/")[0] and "/" in w):
            url = w if "://" in w else "https://" + w
        else:
            print(f"Not a room or a link: {w}", file=sys.stderr)
            return 2

    from .app import TubcalApp
    TubcalApp(info, start_room=start_room, url=url, private=args.private).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
