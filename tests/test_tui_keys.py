"""The terminal's keys: counts, chords, which-key, and a room's own layer."""

from tui.keys import GLOBAL, Bind, Hit, Keys, token_of


def feed(keys, *tokens):
    out = None
    for t in tokens:
        out = keys.feed(t)
    return out


def test_counts_and_motions():
    k = Keys()
    hit = feed(k, "1", "2", "j")
    assert isinstance(hit, Hit) and hit.action == "down" and hit.count == 12
    assert feed(k, "j").count is None


def test_zero_alone_is_not_a_count():
    k = Keys()
    assert k.feed("0") is None
    assert feed(Keys(), "1", "0", "j").count == 10


def test_chords_wait_then_run():
    k = Keys()
    assert k.feed("g") == "pending"
    assert k.feed("g").action == "top"
    assert feed(Keys(), "space", "g", "v").action == "channel:video"
    assert feed(Keys(), "Z", "Z").action == "quit"


def test_an_unknown_follow_up_resets():
    k = Keys()
    assert k.feed("g") == "pending"
    assert k.feed("enter") is None
    assert k.pending == ()
    assert k.feed("j").action == "down"


def test_no_action_is_also_a_prefix():
    """So nothing ever waits for a timeout."""
    seqs = {b.keys for b in GLOBAL}
    for s in seqs:
        assert not any(o != s and o[:len(s)] == s for o in seqs), s


def test_which_key_lists_what_follows():
    k = Keys()
    k.feed("space")
    labels = dict(k.next_keys())
    assert labels["g"] == "+go to" and labels["p"] == "+player"
    assert labels[","].startswith("Settings")


def test_a_room_layer_wins_and_pops():
    k = Keys()
    k.push([Bind(("p",), "play", "play"), Bind(("d", "d"), "remove", "remove")])
    assert k.feed("p").action == "play"
    assert feed(k, "d", "d").action == "remove"
    k.pop()
    assert k.feed("p") is None


def test_tokens():
    assert token_of("space", " ") == "space"
    assert token_of("G", "G") == "G"
    assert token_of("colon", ":") == ":"
    assert token_of("ctrl+d", "\x04") == "ctrl+d"
    assert token_of("enter", "\r") == "enter"
    assert token_of("shift+tab", None) == "shift+tab"


def test_vim_notation():
    from tui.keys import notation, parse
    assert parse("<leader>ff") == ("space", "f", "f")
    assert parse("<Space>gs") == ("space", "g", "s")
    assert parse("<C-d>") == ("ctrl+d",)
    assert parse("gT") == ("g", "T")
    assert parse("<S-Tab>") == ("shift+tab",) and parse("<S-j>") == ("J",)
    assert parse("<CR>") == ("enter",) and parse("<lt>") == ("<",)
    assert parse("<bogus>") is None and parse("<C-") is None and parse("") is None
    assert notation(("space", "f", "f")) == "<leader>ff" and notation(("ctrl+d",)) == "<C-d>"


def test_your_keys_over_a_layer():
    from tui.keys import GLOBAL, Keys, remap
    known = {b.action for b in GLOBAL}
    binds, problems = remap(GLOBAL, {"<C-n>": "down", "<leader>ff": "find", "K": "", "J": "next_room"}, known)
    keys = Keys(binds)
    assert keys.feed("ctrl+n").action == "down"
    assert keys.feed("ctrl+n").action == "down"
    assert keys.feed("K") is None                       # unbound
    assert keys.feed("J").action == "next_room"
    assert keys.feed("j").action == "down"              # the rest stays
    assert next(b.help for b in binds if b.keys == ("J",)) == "next room"
    assert problems == ["[keys] `<leader>ff` never runs: `<leader>f` runs first"]


def test_mistakes_in_your_keys_are_said_not_fatal():
    from tui.keys import GLOBAL, remap
    known = {b.action for b in GLOBAL}
    binds, problems = remap(GLOBAL, {"<nope>": "down", "1": "down", "x": "fly", "g": "top"}, known)
    assert "[keys] `<nope>` isn't a key Tubcal can read" in problems
    assert "[keys] `1`: digits are counts" in problems
    assert "[keys] `x`: no action called `fly` here" in problems
    assert any(p.startswith("[keys] `g` now hides ga, gc, gd and ") for p in problems)
    assert ("g",) in [b.keys for b in binds]            # kept: you asked for it


def test_a_rooms_own_keys(tmp_path, monkeypatch):
    """[keys.youtube] remaps the Screening Room's layer; a global action works there too."""
    from tui.app import TubcalApp
    from tui.keys import Keys
    from tui.terminal import TermInfo
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
    (tmp_path / "tubcal").mkdir()
    (tmp_path / "tubcal" / "tui.toml").write_text(
        '[keys]\n"<C-n>" = "down"\n"x" = "fly"\n[keys.youtube]\n"w" = "toggle_watched"\n"e" = "find"\n'
        '[keys.visual]\n"<CR>" = "visual_save"\n')
    app = TubcalApp(TermInfo(palette=None, cell_px=(8, 18), term="xterm", answered=False),
                    base="http://127.0.0.1:1")
    assert any(b.keys == ("ctrl+n",) for b in app.global_binds)
    assert any(b.keys == ("enter",) and b.action == "visual_save" for b in app.visual_binds)
    from tui.keys import Bind
    room = app._layer("youtube", [Bind(("x",), "seen", "mark the channel seen"),
                                  Bind(("H",), "toggle_watched", "hide watched")])
    keys = Keys(app.global_binds)
    keys.push(room)
    assert keys.feed("w").action == "toggle_watched" and keys.feed("e").action == "find"
    assert keys.feed("x").action == "seen"   # the room's own x: the bad global one was left out
    assert app._key_problems == ["[keys] `x`: no action called `fly` here"]
