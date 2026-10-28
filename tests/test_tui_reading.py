"""Reading in the terminal: strangers' HTML made into safe text, and a comment thread
with folds and jumps."""

import asyncio

from tui.glyphs import Glyphs
from tui.theme import solve
from tui.ui.html import parse, plain, wrap
from tui.ui.thread import ThreadView, flatten


def text(lines):
    return ["".join(s for s, _ in ln) for ln in lines]


def test_hn_html_paragraphs_quotes_code_and_links():
    blocks, links = parse('First<p>&gt; quoted<p>See <a href="https://x.org/a">this</a> and '
                          '<a href="javascript:alert(1)">that</a>.<p><pre><code>  x = 1\n  y = 2</code></pre>')
    out = text(wrap(blocks, 40))
    assert out == ["First", "", "▎ quoted", "", "See this and that.", "", "    x = 1", "    y = 2"]
    assert links == ["https://x.org/a"]  # a javascript: link is only its label


def test_reddit_escaped_html_lists_and_quotes():
    src = ("&lt;div class=\"md\"&gt;&lt;p&gt;A &lt;strong&gt;bold&lt;/strong&gt; claim&lt;/p&gt;"
           "&lt;ul&gt;&lt;li&gt;one&lt;/li&gt;&lt;li&gt;two&lt;/li&gt;&lt;/ul&gt;"
           "&lt;blockquote&gt;&lt;p&gt;quoted words that wrap onto a second line&lt;/p&gt;&lt;/blockquote&gt;&lt;/div&gt;")
    blocks, _ = parse(src)
    out = text(wrap(blocks, 24))
    assert out[:4] == ["A bold claim", "", "• one", "• two"]
    assert all(line.startswith("▎ ") for line in out[5:])  # every line of a quote has its bar


def test_no_markup_gets_through():
    blocks, _ = parse('<script>alert(1)</script><img src=x onerror=alert(1)><p onclick="x">ok</p>')
    assert "<" not in "".join(text(wrap(blocks, 40)))
    assert plain("<p>Hello <b>there</b></p>") == "Hello there"


def test_words_glued_to_punctuation_wrap_together():
    blocks, _ = parse('Normal <i>italic</i> and <a href="https://x.org">a link</a>.')
    assert text(wrap(blocks, 24)) == ["Normal italic and a", "link."]


COMMENTS = [
    {"id": 1, "author": "ann", "body_html": "top one", "created_at": 100, "children": [
        {"id": 2, "author": "op", "body_html": "reply", "created_at": 300, "children": [
            {"id": 3, "author": "cy", "body_html": "deeper", "created_at": 400, "children": []}]}]},
    {"id": 4, "author": "dee", "body_html": "top two", "created_at": 500, "children": []},
]


def test_flatten_keeps_depth_and_descendants():
    flat = flatten(COMMENTS)
    assert [(c["id"], c["_depth"], c["_desc"]) for c in flat] == [(1, 0, 2), (2, 1, 1), (3, 2, 0), (4, 0, 0)]


def run_view(check):
    from textual.app import App

    class T(App):
        def compose(self):
            self.view = ThreadView(roles=solve(None), glyphs=Glyphs("unicode"))
            yield self.view

    async def go():
        app = T()
        async with app.run_test(size=(80, 30)) as pilot:
            await pilot.pause()
            check(app.view)
    asyncio.run(go())


def test_thread_moves_folds_and_finds_new_comments():
    def check(v):
        v.set_thread(lambda w: [[("Title", "fg+bold")]], COMMENTS, since=250, op="op")
        assert v.position == (0, 4) and v.new_count == 3
        v.move(1)
        assert v.selected["id"] == 1
        assert v.jump("new") and v.selected["id"] == 2
        assert v.jump("top") and v.selected["id"] == 4
        v.go(0)
        v.fold("toggle")
        assert [c["id"] for c in v.items] == [1, 4]
        assert any("2 replies hidden" in "".join(s for s, _ in ln) for ln, _ in v._lines)
        # a new comment inside a fold opens the fold to show it
        assert v.jump("new") and v.selected["id"] == 2 and len(v.items) == 4
        v.fold("all")
        assert [c["id"] for c in v.items] == [1, 4] and v.selected["id"] == 1
        v.fold("none")
        assert len(v.items) == 4
        assert any(" OP" in "".join(s for s, _ in ln) for ln, _ in v._lines)
    run_view(check)
