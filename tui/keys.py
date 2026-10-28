"""Keys, the vim way: a table from key sequences to named actions, with counts.

`Keys.feed(token)` takes one key at a time ("j", "G", "space", "ctrl+d", "enter"…)
and returns what to do: an action to run (with its count), "pending" while a chord
is unfinished (the which-key popup shows what can follow), or nothing. No sequence
that runs an action is also the start of a longer one, so there is never a timeout
to wait out: `g` waits for its letter, `gg` runs at once.

Rooms add their own sequences on top of the global table (`Keys.push`).

Your own keys come from `[keys]` in tui.toml, in vim's notation (`remap`).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Bind:
    keys: tuple[str, ...]
    action: str
    help: str = ""


@dataclass
class Hit:
    action: str
    count: int | None = None
    keys: tuple[str, ...] = ()


# Groups shown by which-key for a pending prefix.
GROUPS = {
    ("space",): "leader",
    ("space", "g"): "go to",
    ("space", "p"): "player",
    ("space", "r"): "radio",
    ("space", "t"): "toggle",
    ("g",): "go",
    ("z",): "view",
    ("y",): "copy",
    ("d",): "delete",
    ("Z",): "quit",
}

GLOBAL = [
    Bind(("j",), "down", "down"), Bind(("down",), "down", "down"),
    Bind(("k",), "up", "up"), Bind(("up",), "up", "up"),
    Bind(("h",), "left", "back / pane left"), Bind(("left",), "left", "back / pane left"),
    Bind(("l",), "right", "open / pane right"), Bind(("right",), "right", "open / pane right"),
    Bind(("g", "g"), "top", "first"), Bind(("G",), "bottom", "last"),
    Bind(("home",), "top", "first"), Bind(("end",), "bottom", "last"),
    Bind(("ctrl+d",), "half_down", "half a page down"), Bind(("ctrl+u",), "half_up", "half a page up"),
    Bind(("ctrl+f",), "page_down", "a page down"), Bind(("ctrl+b",), "page_up", "a page up"),
    Bind(("pagedown",), "page_down", "a page down"), Bind(("pageup",), "page_up", "a page up"),
    Bind(("z", "z"), "center", "centre the line"), Bind(("z", "t"), "to_top", "line to the top"),
    Bind(("z", "b"), "to_bottom", "line to the bottom"),
    Bind(("tab",), "next_view", "next view"), Bind(("shift+tab",), "prev_view", "previous view"),
    Bind(("H",), "prev_room", "previous room"), Bind(("L",), "next_room", "next room"),
    Bind(("g", "t"), "next_room", "next room"), Bind(("g", "T"), "prev_room", "previous room"),
    Bind(("ctrl+o",), "jump_back", "jump back"),
    Bind(("/",), "search", "search this list"), Bind(("n",), "search_next", "next match"),
    Bind(("N",), "search_prev", "previous match"),
    Bind((":",), "command", "command line"), Bind(("?",), "help", "keys"),
    Bind(("escape",), "escape", "cancel"), Bind(("q",), "close", "close"),
    Bind(("Z", "Z"), "quit", "quit"), Bind(("Z", "Q"), "quit", "quit"),
    Bind(("r",), "refresh", "refresh"),
    Bind(("o",), "open_browser", "open in the browser"), Bind(("O",), "open_web", "open in Tubcal's web UI"),
    Bind(("y", "y"), "copy_link", "copy the link"), Bind(("y", "t"), "copy_link_time", "copy the link at this second"),
    Bind(("K",), "details", "details"),
    Bind(("V",), "visual", "select rows (VISUAL)"), Bind(("v",), "visual", "select rows (VISUAL)"),
    # the web's chords
    Bind(("space", "g", "s"), "channel:social", "Social"), Bind(("space", "g", "c"), "channel:coding", "Coding"),
    Bind(("space", "g", "v"), "channel:video", "Video"), Bind(("space", "g", "a"), "room:anime", "the Anime"),
    Bind(("space", "g", "h"), "room:home", "Home"),
    Bind(("space", "1"), "channel_n:1", "channel 1"), Bind(("space", "2"), "channel_n:2", "channel 2"),
    Bind(("space", "3"), "channel_n:3", "channel 3"),
    Bind(("space", "s"), "saved", "Saved"), Bind(("space", ","), "settings", "Settings ↗"),
    Bind(("space", "/"), "search_platform", "search the platform"),
    Bind(("space", "f"), "find", "find anything"),
    Bind(("space", "P"), "private", "private session"),
    Bind(("space", "p", "p"), "player_pause", "pause / play"), Bind(("space", "p", "n"), "player_next", "next in the queue"),
    Bind(("space", "p", "s"), "player_stop", "stop"), Bind(("space", "p", "q"), "player_quality", "quality"),
    Bind(("space", "p", "l"), "player_forward", "forward 10 s"), Bind(("space", "p", "h"), "player_back", "back 10 s"),
    Bind(("space", "p", "z"), "sleep_prompt", "sleep timer"),
    Bind(("space", "r", "r"), "radio_pause", "pause / play"), Bind(("space", "r", "l"), "radio_forward", "forward 30 s"),
    Bind(("space", "r", "h"), "radio_back", "back 15 s"), Bind(("space", "r", "x"), "radio_off", "switch off"),
    Bind(("space", "q"), "queue", "the queue"),
    Bind(("g", "h"), "room:home", "Home"),
]

# VISUAL (vim's linewise V): j/k/G… stretch the range from where it started; these act
# on every row in it. `d` and `x` do what `dd` and `x` do in the room, to each row.
VISUAL = [
    Bind(("V",), "visual_end", "leave VISUAL"), Bind(("v",), "visual_end", "leave VISUAL"),
    Bind(("escape",), "visual_end", "leave VISUAL"), Bind(("o",), "visual_swap", "go to the other end"),
    Bind(("s",), "visual_save", "save them (or unsave)"), Bind(("a",), "visual_queue", "add them to the queue"),
    Bind(("y",), "visual_copy", "copy their links"), Bind(("d",), "visual_d", "what dd does, to each"),
    Bind(("x",), "visual_x", "what x does, to each"),
]

# `g` + letter: the web's room keys
for _letter, _room in (("e", "edition"), ("y", "youtube"), ("r", "reddit"), ("n", "hackernews"),
                       ("w", "hackernews"), ("c", "editor"), ("a", "anime"), ("d", "dev"), ("s", "saved")):
    GLOBAL.append(Bind(("g", _letter), f"room:{_room}", _room))


class Keys:
    def __init__(self, binds: list[Bind] | None = None):
        self.layers: list[list[Bind]] = [list(binds if binds is not None else GLOBAL)]
        self.pending: tuple[str, ...] = ()
        self.count = ""

    def push(self, binds: list[Bind]) -> None:
        self.layers.append(list(binds))

    def pop(self) -> None:
        if len(self.layers) > 1:
            self.layers.pop()

    def drop(self, layer: list[Bind]) -> None:
        """Take out the layer pushed as `layer`, wherever it is now."""
        for i in range(len(self.layers) - 1, 0, -1):
            if self.layers[i] is layer or self.layers[i] == layer:
                del self.layers[i]
                return

    def action_for(self, keys: tuple[str, ...]) -> str | None:
        """What `keys` runs now."""
        b = self._table().get(keys)
        return b.action if b else None

    def _table(self) -> dict[tuple[str, ...], Bind]:
        table: dict[tuple[str, ...], Bind] = {}
        for layer in self.layers:  # later layers (the room) win
            for b in layer:
                table[b.keys] = b
        return table

    def reset(self) -> None:
        self.pending = ()
        self.count = ""

    def feed(self, token: str) -> Hit | str | None:
        """An action to run, "pending", or None (the key means nothing here)."""
        if not self.pending and token.isdigit() and (self.count or token != "0"):
            self.count += token
            return "pending"
        seq = self.pending + (token,)
        table = self._table()
        if seq in table:
            count = int(self.count) if self.count else None
            self.reset()
            return Hit(table[seq].action, count, seq)
        if any(k[:len(seq)] == seq for k in table):
            self.pending = seq
            return "pending"
        self.reset()
        return None

    def next_keys(self) -> list[tuple[str, str]]:
        """For which-key: what can follow the pending prefix, as (key, label)."""
        n = len(self.pending)
        seen: dict[str, str] = {}
        for keys, b in self._table().items():
            if len(keys) > n and keys[:n] == self.pending:
                k = keys[n]
                if len(keys) == n + 1:
                    seen[k] = b.help or b.action
                elif k not in seen:
                    seen[k] = "+" + GROUPS.get(keys[:n + 1], "more")
        return sorted(seen.items(), key=lambda kv: (kv[1].startswith("+"), kv[0].lower(), kv[0]))

    def describe(self) -> str:
        return (self.count + " ".join(self.pending)).strip()


# vim's <names> → our tokens
NAMES = {
    "leader": "space", "space": "space", "cr": "enter", "enter": "enter", "return": "enter",
    "esc": "escape", "tab": "tab", "s-tab": "shift+tab", "bs": "backspace", "up": "up", "down": "down",
    "left": "left", "right": "right", "pageup": "pageup", "pagedown": "pagedown", "home": "home", "end": "end",
    "lt": "<", "bar": "|", "bslash": "\\",
}
NOTHING = ("", "nop", "<nop>")


def parse(notation: str) -> tuple[str, ...] | None:
    """vim's key notation as our tokens: "<leader>ff" → ("space", "f", "f"),
    "<C-d>" → ("ctrl+d",), "gT" → ("g", "T"). None when it isn't one."""
    out: list[str] = []
    i = 0
    while i < len(notation):
        ch = notation[i]
        if ch == "<":
            end = notation.find(">", i)
            if end == -1:
                return None
            name = notation[i + 1:end].lower()
            i = end + 1
            if name in NAMES:
                out.append(NAMES[name])
            elif len(name) == 3 and name.startswith("c-") and name[2].isprintable():
                out.append(f"ctrl+{name[2]}")
            elif len(name) == 3 and name.startswith("s-") and name[2].isalpha():
                out.append(notation[end - 1].upper())
            else:
                return None
            continue
        out.append("space" if ch == " " else ch)
        i += 1
    return tuple(out) or None


def notation(keys: tuple[str, ...]) -> str:
    """Our tokens in vim's notation, for messages."""
    back = {"space": "<leader>", "enter": "<CR>", "escape": "<Esc>", "tab": "<Tab>", "shift+tab": "<S-Tab>"}
    return "".join(back.get(k) or (f"<C-{k[5:]}>" if k.startswith("ctrl+") else
                                   f"<{k.capitalize()}>" if len(k) > 1 else k) for k in keys)


def remap(binds: list[Bind], mine: dict, known: set[str], *, where: str = "keys",
          under: list[Bind] = ()) -> tuple[list[Bind], list[str]]:
    """Your keys over a layer: (the layer, what was wrong). A key that can't be read,
    an action this layer doesn't have, or a digit (digits are counts) is left out and
    said; a key that hides longer ones (`g` hides `gg`), or that a shorter one hides
    (`<leader>ff` under `<leader>f`), is kept and said."""
    out = list(binds)
    problems: list[str] = []
    added: list[tuple[str, ...]] = []
    for note, action in mine.items():
        if isinstance(action, dict):     # a room's own table, read with that room
            continue
        keys = parse(str(note))
        if keys is None:
            problems.append(f"[{where}] `{note}` isn't a key Tubcal can read")
            continue
        if keys[0].isdigit():
            problems.append(f"[{where}] `{note}`: digits are counts")
            continue
        if not isinstance(action, str) or (action.lower() not in NOTHING and action not in known):
            problems.append(f"[{where}] `{note}`: no action called `{action}` here")
            continue
        out = [b for b in out if b.keys != keys]
        if action.lower() not in NOTHING:
            label = next((b.help for b in (*binds, *under) if b.action == action and b.help), action)
            out.append(Bind(keys, action, label))
            added.append(keys)
    everything = [b.keys for b in (*under, *out)]
    for keys in added:
        shorter = [k for k in everything if len(k) < len(keys) and keys[:len(k)] == k]
        if shorter:
            problems.append(f"[{where}] `{notation(keys)}` never runs: `{notation(shorter[0])}` runs first")
            continue
        longer = sorted({k for k in everything if len(k) > len(keys) and k[:len(keys)] == keys},
                        key=lambda k: ("".join(k).lower(), k))
        if longer:
            hidden = ", ".join(notation(k) for k in longer[:3]) + (f" and {len(longer) - 3} more" if len(longer) > 3 else "")
            problems.append(f"[{where}] `{notation(keys)}` now hides {hidden}")
    return out, problems


def token_of(key: str, character: str | None) -> str:
    """Textual's key event → our token: the printed character when there is one
    ("G", ":", "?"), else the key name ("enter", "ctrl+d", "shift+tab")."""
    if key == "space":
        return "space"
    if character and character.isprintable() and len(character) == 1 and not key.startswith("ctrl+"):
        return character
    return key
