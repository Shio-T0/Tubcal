"""`:help` (`:h`): every `:` command, by what it's for. The selected one opens up with
its examples; Enter runs it, or puts it on the command line when it wants words.
`:help <command>` opens on that one."""

from __future__ import annotations

from ..commands import COMMANDS, GROUPS, Command, find, usage
from . import Entry, Note, Page, Section, ticks


class HelpPage(Page):
    id = "help"
    title = "Commands"
    subtitle = "Type : and a command; Tab completes it."
    hints = (("⏎", "runs it"), ("Tab", "next section"), ("/", "filter"), ("?", "the keys"), ("q", "close"))
    one_key_column = True

    def __init__(self, app, topic: str = ""):
        super().__init__(app)
        self.topic = topic.strip().lstrip(":")

    def first(self) -> str | None:
        c = find(self.topic) if self.topic else None
        return f"cmd:{c.name}" if c else None

    def opened(self) -> None:
        if self.topic and not find(self.topic):   # not a command: show what mentions it
            self.app.sheet.body.search(self.topic, from_next=False)
            self.app.say(f"No command called {self.topic}; here is what mentions it." if self.app.sheet.body.items
                         else f"Nothing here mentions {self.topic}.", "warn")

    def _entry(self, c: Command) -> Entry:
        more = [ticks(m, "dim") for m in c.more]
        if c.aliases:
            more.append([("Also: ", "faint"), ("  ".join(f":{a}" for a in c.aliases), "hue:yellow")])
        figure = [("page", "faint")] if c.page else []
        return Entry(f"cmd:{c.name}", [(c.args, "dim")] if c.args else [], key=[(f":{c.name}", "hue:yellow+bold")],
                     figure=figure, meta=ticks(c.help, "fg"), more=more,
                     find=" ".join((c.group, *c.aliases)), act=lambda c=c: self._run(c), data=c)

    def _run(self, c: Command) -> None:
        app = self.app
        app.close_pages()
        if c.args:   # on the line, for the words (Enter alone runs one whose words are optional)
            app.start_command(c.name + " ")
            app.statusline.search_info = usage(c)
            app.statusline.refresh()
        else:
            app.run_command(c.name)

    def rows(self):
        out: list = []
        for g in GROUPS:
            cmds = [c for c in COMMANDS if c.group == g]
            if not cmds:
                continue
            out.append(Section(g, f"{len(cmds)}"))
            out += [self._entry(c) for c in cmds]
        out.append(Section("Keys"))
        out.append(Note(ticks("Every key is on its own page: `?` or `:keys`. Pressing the first key of a "
                              "chord (`Space`, `g`, `z`…) shows what can follow.")))
        return out
