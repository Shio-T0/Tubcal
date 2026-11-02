"""The pages that tell you things: `:messages`, `:checkhealth`, `:about`, and the
steps for linking an account that wants an API client of your own."""

from __future__ import annotations

import shutil
import time

from ..bootstrap import REPO
from ..theme import gamma_ok
from . import Entry, Note, Page, Section, TextPage, ticks

LEVEL_ROLE = {"error": "hue:red", "warn": "hue:yellow"}


class MessagesPage(Page):
    id = "messages"
    title = "Messages"
    subtitle = "What this session said in the statusline, newest last"
    hints = (("yy", "copy one"), ("/", "filter"), ("q", "close"))

    def first(self) -> str | None:
        n = len(self.app.messages[-200:])
        return f"msg:{n - 1}" if n else None

    def rows(self):
        msgs = self.app.messages[-200:]
        if not msgs:
            return [Note([("No messages yet.", "dim")])]
        out: list = []
        day = ""
        for i, (ts, level, text) in enumerate(msgs):
            d = time.strftime("%A %-d %B", time.localtime(ts))
            if d != day:
                out.append(Section(d))
                day = d
            out.append(Entry(f"msg:{i}", [(text, LEVEL_ROLE.get(level, "fg"))],
                             key=[(time.strftime("%H:%M:%S", time.localtime(ts)), "faint")],
                             figure=[(level, LEVEL_ROLE.get(level, "faint"))] if level != "info" else [],
                             data=text, find=level, act=lambda t=text: self.app.copy(t)))
        return out

    def handle(self, action, entry, count) -> bool:
        if action == "copy_link" and entry is not None:
            self.app.copy(entry.data)
            return True
        return False


class HealthPage(Page):
    id = "checkhealth"
    title = "checkhealth"
    subtitle = "What works here"
    hints = (("/", "filter"), ("q", "close"))

    def __init__(self, app):
        super().__init__(app)
        self.checks: list[tuple[str, str, str]] | None = None

    def opened(self) -> None:
        self.app.run_worker(self._check, thread=True, group="checkhealth", exclusive=True)

    def _check(self) -> None:
        app = self.app
        r, g, term = app.roles, app.glyphs, app.term
        checks: list[tuple[str, str, str]] = []  # (ok|warn|error, title, detail)
        h = app.api.health()
        checks.append(("ok", "Tubcal server", f"{app.api.base} · modules: {', '.join(h.get('modules') or [])}")
                      if h else ("error", "Tubcal server", f"not answering at {app.api.base}"))
        mpv = shutil.which("mpv")
        checks.append(("ok", "mpv", mpv) if mpv else ("error", "mpv", "not installed: videos can't play here"))
        checks.append(("ok" if app.image_backend != "off" else "warn", "Pictures",
                       {"kitty": "kitty graphics (sharp, in the terminal itself)",
                        "sixel": "sixel graphics", "halfcell": "coloured half-blocks (this terminal draws no pictures)",
                        "off": "off (`images` in the config)"}.get(app.image_backend, app.image_backend)
                       + (" · kept in memory only (private)" if app.private else "")))
        checks.append(("ok" if term.palette else "warn", "Colours",
                       f"from {term.palette.source} ({term.took_ms} ms)" if term.palette
                       else "the terminal didn't say; using its named colours"))
        checks.append(("ok", "Cell size", f"{term.cell_px[0]}×{term.cell_px[1]} px" if all(term.cell_px) else "unknown"))
        checks.append(("ok", "Glyphs", g.kind))
        checks.append(("ok", "YouTube plays through", "mpv's own yt-dlp" if app.cfg["youtube_player"] == "ytdl"
                       else "the Tubcal server (one extraction, mpv only talks to 127.0.0.1)"))
        from .. import editor
        argv = editor.resolve(app.cfg.get("editor") or "")
        checks.append(("ok", "Writing", f"in {' '.join(argv)} (notes, questions, comments)") if argv else
                      ("warn", "Writing", "no editor found: set `editor` in the config, or $VISUAL"))
        checks.append(("ok" if mpv else "warn", "The radio", "podcasts on a second mpv, without a window" if mpv
                       else "needs mpv too"))
        checks.append(("warn" if app.private else "ok", "Private session", "on" if app.private else "off"))
        self.missed = gamma_ok(r)

        def show():
            self.checks = checks
            self.repaint()
        app.call_from_thread(show)

    def rows(self):
        if self.checks is None:
            return [Note([("Checking…", "dim")])]
        r = self.app.roles
        out: list = [Section("Checks")]
        for state, title, detail in self.checks:
            mark, role = {"ok": ("✓ ok", "hue:green"), "warn": ("! warning", "hue:yellow"),
                          "error": ("✗ error", "hue:red")}[state]
            out.append(Entry(f"check:{title}", [(title, "fg+bold")], key=[(mark, role)],
                             meta=ticks(detail, "fg"), find=state))
        if r.truecolor:
            out.append(Section("The palette", "solved for contrast"))
            for name in ("fg", "dim", "faint", "rule", "surface", "surface2",
                         "hue.red", "hue.yellow", "hue.green", "hue.blue", "hue.magenta", "hue.cyan", "hue.dispatch"):
                hexv = r.hex.get(name, "")
                ratio = r.ratios.get(name)
                role = f"hue:{name[4:]}" if name.startswith("hue.") else ("fg" if name.startswith("surface") else name)
                out.append(Entry(f"pal:{name}", [("████", role)], key=[(name, "dim")],
                                 figure=[(f"{hexv}  {ratio}:1" if ratio else hexv, "fg")], find="palette colour"))
            if self.missed:
                out.append(Note([(f"! {', '.join(self.missed)} couldn't reach their contrast target on this "
                                  "palette.", "hue:yellow")]))
        return out


class AboutPage(Page):
    id = "about"
    title = "Tubcal"
    subtitle = "The licence, and what it builds on"
    hints = (("/", "filter"), ("q", "close"))

    def rows(self):
        out: list = [Section("The licence"),
                     Note([("Tubcal is free software: you can redistribute it and/or modify it under the terms of "
                            "the GNU General Public License as published by the Free Software Foundation, either "
                            "version 3 of the License, or (at your option) any later version. It comes with "
                            "ABSOLUTELY NO WARRANTY.", "fg")]),
                     Note([(f"The licence: {REPO / 'LICENSE'}", "dim")])]
        try:
            notices = (REPO / "THIRD_PARTY_NOTICES.md").read_text()
        except OSError:
            return out + [Note([("THIRD_PARTY_NOTICES.md is missing from this copy.", "hue:yellow")])]
        # the notices' own headings become the page's sections
        para: list[str] = []

        def flush():
            if para:
                out.append(Note([(" ".join(para), "fg")]))
                para.clear()
        for line in notices.splitlines():
            if line.startswith("#"):
                flush()
                out.append(Section(line.lstrip("# ").strip()))
            elif not line.strip():
                flush()
            elif line.lstrip().startswith(("- ", "* ")):
                flush()
                para.append("• " + line.lstrip()[2:])
                flush()
            else:
                para.append(line.strip())
        flush()
        return out


def steps_page(app, provider: str, label: str, where: str) -> TextPage:
    """How to link an account that wants an API client of your own (AniList, Reddit)."""
    redirect = app.api.url(f"/api/oauth/{provider}/callback")
    rows = [
        Section(f"Linking {label}"),
        Note([(f"{label} wants an API client of your own, as in the web interface's Settings → Accounts.", "fg")]),
        Entry("step:1", [(f"Make one at {where}", "fg")], key=[("1", "hue:yellow+bold")]),
        Entry("step:2", [("Give it this redirect URL", "fg")], key=[("2", "hue:yellow+bold")],
              meta=[(redirect, "fg+bold")], mark=[("⏎ copies it", "faint")], act=lambda: app.copy(redirect)),
        Entry("step:3", [(f":link {provider} <client id> <client secret>", "fg+bold")],
              key=[("3", "hue:yellow+bold")], mark=[("⏎ puts it on the line", "faint")],
              act=lambda: (app.close_pages(), app.start_command(f"link {provider} "))),
        Note([("Then your browser asks you to approve Tubcal, and you come back here.", "dim")]),
    ]
    page = TextPage(app, f"Linking {label}", rows, page_id=f"link-{provider}")
    page.hints = (("⏎", "copy / use"), ("q", "close"))
    return page

