"""A stranger's HTML (HN comments, Reddit posts) as plain styled text for the terminal.

An allow-list walk, like the web's HnHtml.jsx: paragraphs, line breaks, italics, bold,
code and preformatted blocks, block quotes and HN's ">" quoting convention, lists,
headings and links (the label, underlined; the address is kept for `gx`). Anything
else contributes its text only. Reddit sends its HTML entity-escaped; that's undone
first.
"""

from __future__ import annotations

import html as htmllib
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser

BLOCKS = {"p", "div", "blockquote", "pre", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "table", "tr", "hr"}


@dataclass
class Block:
    kind: str = "p"                              # p | quote | pre | li | h
    spans: list[tuple[str, str]] = field(default_factory=list)   # (text, role)
    depth: int = 0                               # list nesting


class _Walker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[Block] = []
        self.cur: Block | None = None
        self.marks: list[str] = []      # open inline styles: italic, bold, code, link
        self.quote = 0
        self.pre = 0
        self.lists: list[str] = []
        self.links: list[str] = []
        self._href: str | None = None

    def _block(self, kind: str) -> None:
        self.cur = Block(kind="quote" if self.quote and kind == "p" else kind, depth=len(self.lists))
        self.blocks.append(self.cur)

    def _role(self) -> str:
        if self.pre:
            return "dim"
        role = "dim" if self.quote else "fg"
        if "code" in self.marks:
            role = "hue:cyan"
        mods = [m for m in ("bold", "italic", "underline") if m in self.marks]
        if self.quote and "italic" not in mods:
            mods.append("italic")
        return role + "".join("+" + m for m in mods)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "blockquote":
            self.quote += 1
            self.cur = None
        elif tag == "pre":
            self.pre += 1
            self._block("pre")
        elif tag in ("ul", "ol"):
            self.lists.append(tag)
            self.cur = None
        elif tag == "li":
            self._block("li")
        elif tag in ("p", "div", "tr"):
            self._block("p")
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._block("h")
            self.marks.append("bold")
        elif tag == "br":
            if self.cur is None:
                self._block("p")
            self.cur.spans.append(("\n", "fg"))
        elif tag == "hr":
            self._block("p")
            self.cur.spans.append(("———", "faint"))
            self.cur = None
        elif tag in ("i", "em"):
            self.marks.append("italic")
        elif tag in ("b", "strong"):
            self.marks.append("bold")
        elif tag == "code":
            self.marks.append("code")
        elif tag == "a":
            href = a.get("href") or ""
            self._href = href if re.match(r"^https?://", href, re.I) else None
            if self._href:
                self.marks.append("underline")

    def handle_endtag(self, tag):
        if tag == "blockquote":
            self.quote = max(0, self.quote - 1)
            self.cur = None
        elif tag == "pre":
            self.pre = max(0, self.pre - 1)
            self.cur = None
        elif tag in ("ul", "ol"):
            if self.lists:
                self.lists.pop()
            self.cur = None
        elif tag in ("p", "div", "li", "tr") or tag.startswith("h") and len(tag) == 2:
            if tag.startswith("h") and "bold" in self.marks:
                self.marks.remove("bold")
            self.cur = None
        elif tag in ("i", "em") and "italic" in self.marks:
            self.marks.remove("italic")
        elif tag in ("b", "strong") and "bold" in self.marks:
            self.marks.remove("bold")
        elif tag == "code" and "code" in self.marks:
            self.marks.remove("code")
        elif tag == "a":
            if self._href:
                if "underline" in self.marks:
                    self.marks.remove("underline")
                self.links.append(self._href)
            self._href = None

    def handle_data(self, data):
        if not data:
            return
        if self.cur is None:
            if not self.pre and not data.strip():
                return
            self._block("pre" if self.pre else "p")
        if not self.pre:
            data = re.sub(r"\s+", " ", data)
            if not self.cur.spans or self.cur.spans[-1][0].endswith(("\n", " ")):
                data = data.lstrip()
        self.cur.spans.append((data, self._role()))


def parse(source: str | None) -> tuple[list[Block], list[str]]:
    """Blocks of styled text, and the links in order."""
    text = (source or "").strip()
    if text.startswith("&lt;"):
        text = htmllib.unescape(text)          # Reddit's escaped HTML
    # HN's first paragraph has no <p>
    if text and not re.match(r"^\s*<(p|div|pre|blockquote|ul|ol|h\d|table)\b", text, re.I):
        text = "<p>" + text
    w = _Walker()
    try:
        w.feed(text)
        w.close()
    except Exception:
        return [Block(spans=[(re.sub(r"<[^>]+>", "", htmllib.unescape(source or "")), "fg")])], []
    blocks = []
    for b in w.blocks:
        joined = "".join(s for s, _ in b.spans)
        if not joined.strip():
            continue
        # HN quotes with a leading ">"
        if b.kind == "p" and joined.lstrip().startswith(">"):
            b.kind = "quote"
            first, role = b.spans[0]
            b.spans[0] = (re.sub(r"^\s*>\s?", "", first), role)
            b.spans = [(s, r if "dim" in r else r.replace("fg", "dim", 1) + ("+italic" if "italic" not in r else ""))
                       for s, r in b.spans]
        blocks.append(b)
    return blocks, w.links


def wrap(blocks: list[Block], width: int, *, quote_mark: str = "▎") -> list[list[tuple[str, str]]]:
    """Blocks laid out as lines of (text, role) runs, `width` cells wide at most,
    with a blank line between blocks."""
    from rich.cells import cell_len

    lines: list[list[tuple[str, str]]] = []
    for bi, b in enumerate(blocks):
        if bi and not (b.kind == "li" and blocks[bi - 1].kind == "li"):
            lines.append([])
        prefix: list[tuple[str, str]] = []
        if b.kind == "quote":
            prefix = [(quote_mark + " ", "faint")]
        elif b.kind == "li":
            prefix = [("  " * max(0, b.depth - 1) + "• ", "faint")]
        elif b.kind == "pre":
            prefix = [("  ", "fg")]
        room = max(8, width - sum(cell_len(s) for s, _ in prefix))
        if b.kind == "pre":
            text = "".join(s for s, _ in b.spans).rstrip("\n")
            for raw in text.split("\n"):
                cut = raw[: room]
                lines.append(prefix + [(cut, "dim")])
            continue
        # word-wrap the runs
        cur: list[tuple[str, str]] = list(prefix)
        used = 0
        # a quote keeps its bar on every line; a list item lines up under its text
        cont = list(prefix) if b.kind == "quote" else \
            ([(" " * sum(cell_len(s) for s, _ in prefix), "fg")] if prefix else [])
        for text, role in b.spans:
            if text == "\n":
                lines.append(cur)
                cur, used = list(cont), 0
                continue
            for word in re.findall(r"\s+|\S+", text):
                if word.isspace():
                    if used:                                # no spaces at the start of a line
                        cur.append((" ", role))
                        used += 1
                    continue
                w_len = cell_len(word)
                if used and used + w_len > room:
                    # a word glued to the one before it ("link" + ".") moves with it
                    carry: list[tuple[str, str]] = []
                    while len(cur) > len(cont) and cur[-1][0] != " ":
                        carry.insert(0, cur.pop())
                    if len(cur) <= len(cont):        # one long glued run: just break it
                        cur += carry
                        carry = []
                    while cur and cur[-1][0] == " ":
                        cur.pop()
                    lines.append(cur)
                    cur = list(cont) + carry
                    used = sum(cell_len(x) for x, _ in carry)
                while cell_len(word) > room:               # a URL longer than the line
                    lines.append(cur + [(word[:room], role)])
                    word = word[room:]
                    cur, used = list(cont), 0
                cur.append((word, role))
                used += cell_len(word)
        lines.append(cur)
    return lines


def plain(source: str | None) -> str:
    """Just the words (for previews and search)."""
    blocks, _ = parse(source)
    return "\n".join("".join(s for s, _ in b.spans).strip() for b in blocks)
