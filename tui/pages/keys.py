"""`?` (`:keys`, `:map`): every key, by what it does.

First the keys of where you are (the room, the Saved drawer or the page you came
from), then everywhere's by section, VISUAL's, the drawer's, every page's, the
command line's, the finder's and mpv's, and then each other room's own. Keys that do
the same thing share a line (`j / ↓`). The name on the right is the action, which is
what `[keys]` in tui.toml takes; a key you set there says "yours". Enter runs the
selected key, when it works from here.
"""

from __future__ import annotations

from ..keys import GLOBAL, SECTIONS, VISUAL, Bind, section_of, written
from ..rooms import HOME, ROOM_BY_ID, load_screen
from ..theme import ROOM_HUES
from . import COMMON, Entry, Note, Page, Section, ticks

LINE = [  # the command line and the / search line (not remappable)
    (("enter",), "run it (a search: keep it)"), (("escape",), "cancel"), (("tab",), "complete the command"),
    (("up", "down"), "the commands you ran before"), (("ctrl+w",), "take the last word back"),
    (("ctrl+u",), "take everything before the cursor back"), (("ctrl+a", "home"), "to the start"),
    (("ctrl+e", "end"), "to the end"), (("left", "ctrl+b"), "a character left"),
    (("right", "ctrl+f"), "a character right"), (("backspace",), "the character before (on an empty line: cancel)"),
]
FINDER = [
    (("down", "ctrl+n", "ctrl+j", "tab"), "the next result"), (("up", "ctrl+p", "ctrl+k", "shift+tab"), "the one before"),
    (("enter",), "open it where it lives"), (("ctrl+w",), "take the last word back"), (("ctrl+u",), "start again"),
    (("escape",), "close"),
]
MPV = [  # in the video window (tubcal.lua), on top of mpv's own keys
    (("s",), "skip the opening (while the cue shows)"), (("N",), "the next video or episode"),
]
PAGE = [  # what every page does with the usual keys
    (("tab",), "the next section"), (("shift+tab",), "the section before"), (("/",), "filter as you type"),
    (("l",), "run it (on a choice: the next one)"), (("h",), "back (on a choice: the one before)"),
    (("escape",), "show everything again, then close"), (("q",), "close (back to the page before)"),
]


def _caps(alts: list[tuple[str, ...]], hue: str, ascii_only: bool) -> list:
    out = []
    for i, keys in enumerate(alts):
        if i:
            out.append((" / ", "faint"))
        out.append((written(keys, ascii_only), f"hue:{hue}+bold"))
    return out


class KeysPage(Page):
    id = "keys"
    title = "Keys"
    subtitle = "Every key, by what it does. The name on the right is what [keys] in tui.toml takes."
    hints = (("⏎", "runs it"), ("Tab", "next section"), ("/", "filter"), ("q", "close"))

    def __init__(self, app, here: tuple[str, str, str, list[Bind], list[Bind]] | None = None,
                 chord: tuple[str, ...] = ()):
        """`here`: (label, [keys.<name>] table, hue, the keys in force, the keys without yours).
        `chord`: only the keys that start with it (`?` in the middle of one)."""
        super().__init__(app)
        self.here = here
        self.chord = chord
        self.ascii = app.glyphs.kind == "ascii"
        if chord:
            self.subtitle = f"The keys after {written(chord, self.ascii)}. :keys has every key."

    def _lines(self, binds: list[Bind], defaults: list[Bind], hue: str, section: str, *, runs: bool,
               why: str = "") -> list[Entry]:
        """One entry per thing a key does, its keys side by side."""
        if self.chord:
            binds = [b for b in binds if b.keys[:len(self.chord)] == self.chord]
        mine = [b for b in binds if b not in defaults]
        groups: dict[tuple[str, str], list[Bind]] = {}
        for b in binds:
            groups.setdefault((b.action, b.help or b.action), []).append(b)
        out = []
        for (action, label), bs in groups.items():
            alts = [b.keys for b in bs]
            yours = any(b in mine for b in bs)
            figure = ([("yours  ", "hue:green")] if yours else []) + [(action, "faint")]
            keys = alts[0]
            act = (lambda a=action, k=keys: self.app.run_key(a, k)) if runs else \
                (lambda w=why: self.app.say(w))
            out.append(Entry(f"{section}:{action}:{label}", [(label, "fg")], key=_caps(alts, hue, self.ascii),
                             figure=figure, find=f"{action} {section}", act=act))
        return out

    def _fixed(self, rows: list, hue: str, section: str, why: str) -> list[Entry]:
        return [Entry(f"{section}:{label}", [(label, "fg")], key=_caps(list((k,) for k in keys), hue, self.ascii),
                      find=section, act=lambda w=why: self.app.say(w)) for keys, label in rows]

    def rows(self):
        app = self.app
        out: list = []
        if self.here:
            label, table, hue, binds, defaults = self.here
            out.append(Section(f"Here · {label}", f"[keys.{table}]" if table else "", hue=hue))
            room = table not in ("", "saved")   # a page's or the drawer's keys work there, not from here
            out += self._lines(binds, defaults, hue, "here", runs=room,
                               why=f"These work in {label}: q goes back to it.") or \
                [Note([("Nothing of its own: the keys below work here.", "dim")])]
        # everywhere's, by section
        by: dict[str, list[Bind]] = {}
        for b in app.global_binds:
            by.setdefault(section_of(b.action), []).append(b)
        for title in [t for t, _ in SECTIONS] + ["Other"]:
            if by.get(title):
                out.append(Section(title, "[keys]" if title == SECTIONS[0][0] else ""))
                if title == "Moving":
                    out.append(Note(ticks("A number first repeats a key or picks a row: `5j`, `12G`, `3⏎`.")))
                out += self._lines(by[title], GLOBAL, "yellow", title, runs=True)
        out.append(Section("VISUAL", "[keys.visual]", hue="magenta"))
        out.append(Note(ticks("`V` in a list starts it; `j` `k` `G` and counts stretch the range, and these "
                              "act on every row in it.")))
        out += self._lines([b for b in app.visual_binds if b.keys != ("v",)], VISUAL, "magenta", "visual",
                           runs=False, why="VISUAL's keys work after V in a list.")
        drawer = app._layer("saved", app.drawer.binds())
        out.append(Section("The Saved drawer", "[keys.saved]"))
        out += self._lines(drawer, app.drawer.binds(), "blue", "drawer", runs=False,
                           why="These work in the Saved drawer: Space s opens it.")
        out.append(Section("Pages like this one"))
        out += self._lines(COMMON, COMMON, "yellow", "pages", runs=False, why="These work on a page.")
        out += self._fixed(PAGE, "yellow", "pages", "These work on a page.")
        out.append(Section("The command line", "after : or /"))
        out += self._fixed(LINE, "yellow", "line", "These work while you type a command or a search.")
        out.append(Section("Space f, the finder"))
        out += self._fixed(FINDER, "yellow", "finder", "These work in the finder: Space f opens it.")
        out.append(Section("In the video window", "mpv"))
        out.append(Note(ticks("mpv's own keys work as always (`Space`, `←` `→`, `f`, `m`, `9` `0`); "
                              "Tubcal adds these.")))
        out += self._fixed(MPV, "yellow", "mpv", "These work in mpv's window.")
        out += self._rooms()
        if self.chord:   # only what the chord leads to: no notes, no sections left empty
            kept = [r for r in out if not isinstance(r, Note) and not
                    (isinstance(r, Entry) and r.id.split(":")[0] in ("pages", "line", "finder", "mpv"))]
            out = [r for i, r in enumerate(kept) if not isinstance(r, Section)
                   or (i + 1 < len(kept) and isinstance(kept[i + 1], Entry))]
        return out

    def _rooms(self) -> list:
        """Each other room's own keys (a room not opened yet is made, not shown, to ask)."""
        app = self.app
        out: list = []
        here_id = self.here[1] if self.here else None
        rooms = [HOME] + [ROOM_BY_ID[r] for r in ROOM_BY_ID if app.registry is None or app.registry.has(r)]
        for room in rooms:
            if room.id == here_id or not room.built:
                continue
            view = app.rooms.get(room.id)
            if view is None:
                cls = load_screen(room)
                if cls is None:
                    continue
                view = cls(room)
            defaults = view.binds()
            binds = app._layer(room.id, defaults)
            hue = ROOM_HUES.get(room.id, "blue")
            go = next((b for b in app.global_binds if b.action == f"room:{room.id}"), None)
            note = f"{written(go.keys)} goes there" if go else ""
            out.append(Section(room.label, f"[keys.{room.id}]" + (f" · {note}" if note else ""), hue=hue))
            out += self._lines(binds, defaults, hue, room.id, runs=False,
                               why=f"That's {room.label}'s own" + (f"; {note}." if note else "."))
        return out
