"""`Space q` (`:queue`, `:sleep` alone): what's playing, what's next, the radio and
the sleep timer, on one page that keeps up with them.

    Playing        Enter pauses or plays, h l go back and on 10 s; its quality (h l)
    Up next        Enter plays one now, dd takes it out (u puts it back), J K move it
    The radio      Enter pauses or plays, h l go back 15 s and on 30 s; switch it off
    Sleep timer    Enter sets one
"""

from __future__ import annotations

import re

from .. import fmt
from ..keys import Bind
from ..ui.paint import who
from . import Entry, Note, Page, Section, ticks

def height_of(quality: str) -> int:
    m = re.match(r"(\d+)", quality or "")
    return int(m.group(1)) if m else 0


SLEEPS = [(15 * 60, "15 minutes"), (30 * 60, "30 minutes"), (45 * 60, "45 minutes"), (60 * 60, "1 hour"),
          (90 * 60, "1 hour 30"), ("end", "When what's playing ends"), ("off", "Off")]


class PlayingPage(Page):
    id = "playing"
    title = "Playing"
    subtitle = "What's playing, what's next, the radio and the sleep timer"
    hints = (("⏎", "play / pause"), ("h l", "seek"), ("dd", "take out"), ("J K", "move"), ("q", "close"))

    def __init__(self, app, start: str = ""):
        super().__init__(app)
        self.start = start
        self.taken: list[tuple[int, dict]] = []   # (where it was, item): `u` puts it back

    def first(self) -> str | None:
        return "sleep:now" if self.start == "sleep" else None

    def binds(self) -> list[Bind]:
        return [Bind(("d", "d"), "take_out", "take it out of the queue"), Bind(("u",), "undo", "put it back"),
                Bind(("J",), "move_down", "later in the queue"), Bind(("K",), "move_up", "sooner in the queue")]

    def tick(self) -> None:
        self.repaint()

    def rows(self):
        app = self.app
        g = app.glyphs
        out: list = []
        player, now = app.player, app.player.now
        playing = player.playing
        out.append(Section("Playing"))
        if now.active or now.loading:
            item = playing.item if playing else {}
            title = fmt.clean(item.get("title") or now.title) or "…"
            state = "loading" if now.loading and not now.active else ("paused" if now.paused else "playing")
            meta = [(fmt.clean(item.get("source")), who(fmt.clean(item.get("source")))) if item.get("source")
                    else ("", "dim"), (f"  {state}", "dim")]
            if now.buffering:
                meta.append(("  buffering", "faint"))
            out.append(Entry("now", [(title, "fg")], key=[(g.paused if now.paused else g.playing, "mark:green")],
                             figure=[(f"{fmt.duration(now.pos) or '0:00'} / {fmt.duration(now.dur) or '–'}", "fg")],
                             meta=meta, mark=[("h l seek 10 s", "faint")], act=lambda: app.run_key("player_pause"),
                             data="now"))
            if playing and len(playing.heights) > 1:
                cur = height_of(playing.quality)
                strip: list = []
                for h in playing.heights:
                    label = f"{h}p"
                    if strip:
                        strip.append(("  ", "fg"))
                    strip += [(g.choice_l, f"hue:{self.hue}"), (label, f"hue:{self.hue}+bold"),
                              (g.choice_r, f"hue:{self.hue}")] if h == cur else [(label, "dim")]
                out.append(Entry("quality", [("Quality", "fg")], figure=strip,
                                 meta=[("For this video; the highest it starts at is in Settings", "dim")],
                                 mark=[(":set quality=720", "faint")], data="quality",
                                 act=lambda: self._quality(1)))
            out.append(Entry("stop", [("Stop", "fg")], meta=ticks("Closes mpv's window (`Space ps`)"),
                             act=lambda: app.run_key("player_stop")))
        else:
            out.append(Note(ticks("Nothing is playing. Enter on a video or an episode plays it; `a` adds it to "
                                  "the queue.")))
        out.append(Section("Up next", f"{len(player.queue)}" if player.queue else ""))
        for n, item in enumerate(player.queue):
            src = fmt.clean(item.get("source"))
            out.append(Entry(f"q:{n}:{item.get('id')}", [(fmt.clean(item.get("title")), "fg")],
                             key=[(f"{n + 1}", "faint")],
                             figure=[(fmt.duration(item.get("duration")), "dim")] if item.get("duration") else [],
                             meta=[(src, who(src))] if src else [], data=("queue", n),
                             act=lambda n=n: self._play_now(n)))
        if not player.queue:
            follow = player._followed() if playing else None
            out.append(Note(ticks(f"Then: {fmt.clean(follow.get('title'))}, the next episode." if follow else
                                  "Nothing queued. `a` on a video or a talk adds it; `N` in mpv plays the next.")))
        out += self._radio()
        out += self._sleep()
        return out

    def _radio(self) -> list:
        app = self.app
        radio, g = app.radio, app.glyphs
        out = [Section("The radio")]
        ep = radio.episode
        if not ep:
            out.append(Note(ticks("Off. The Workbench's podcasts play here, on a second mpv without a window "
                                  "(Enter on an episode).")))
            return out
        n = radio.now
        show = fmt.clean(ep.get("show"))
        state = "tuning" if n.loading else ("paused" if n.paused else "on")
        out.append(Entry("radio", [(fmt.clean(ep.get("title")), "fg")],
                         key=[(g.paused if n.paused else g.playing, "mark:cyan")],
                         figure=[(f"{fmt.duration(n.pos) or '0:00'} / {fmt.duration(n.dur) or '–'}", "fg")],
                         meta=[(show, who(show)), (f"  {state}", "dim")], mark=[("h l seek", "faint")],
                         act=lambda: app.run_key("radio_pause"), data="radio"))
        out.append(Entry("radio:off", [("Switch it off", "fg")], meta=ticks("Its place is kept (`Space rx`)"),
                         act=lambda: app.run_key("radio_off")))
        return out

    def _sleep(self) -> list:
        app = self.app
        sleep, g = app.sleep, app.glyphs
        label = sleep.label()
        out = [Section("Sleep timer", "one for the video and the radio")]
        state = (f"{label} left" if label and label != "end" else
                 "when what's playing ends" if label == "end" else "off")
        out.append(Entry("sleep:now", [("Now", "fg")], figure=[(state, "hue:magenta" if label else "dim")],
                         meta=[("The last 12 seconds fade out, then everything pauses", "dim")],
                         mark=[(":sleep 30 | end | off", "faint")], act=lambda: None))
        for what, words in SLEEPS:
            on = (what == "end" and label == "end") or (what == "off" and not label)
            out.append(Entry(f"sleep:{what}", [(words, "fg")], key=[(g.on if on else g.off, "hue:magenta" if on
                                                                     else "faint")],
                             act=lambda w=what: self._set_sleep(w)))
        return out

    def _set_sleep(self, what) -> None:
        self.app.run_command(f"sleep {what if isinstance(what, str) else int(what // 60)}")
        self.repaint()

    def _play_now(self, n: int) -> None:
        q = self.app.player.queue
        if 0 <= n < len(q):
            item = q.pop(n)
            self.app.player.queue_changed()
            self.app.play(item)
            self.repaint()

    def _quality(self, step: int) -> None:
        p = self.app.player.playing
        if not p or len(p.heights) < 2:
            return
        cur = next((i for i, h in enumerate(p.heights) if h == height_of(p.quality)), 0)
        h = p.heights[(cur + step) % len(p.heights)]
        self.app.run_command(f"set quality={h}")

    def handle(self, action: str, entry: Entry | None, count: int | None) -> bool:
        app = self.app
        q = app.player.queue
        data = entry.data if entry else None
        n = count or 1
        if data in ("now", "radio") and action in ("left", "right", "decrease", "increase"):
            back = action in ("left", "decrease")
            if data == "now":
                for _ in range(n):
                    app.run_key("player_back" if back else "player_forward")
            else:
                for _ in range(n):
                    app.run_key("radio_back" if back else "radio_forward")
            return True
        if data == "quality" and action in ("left", "right", "decrease", "increase"):
            self._quality(-1 if action in ("left", "decrease") else 1)
            return True
        if action == "undo":
            if not self.taken:
                app.say("Nothing to put back.")
            else:
                at, item = self.taken.pop()
                q.insert(min(at, len(q)), item)
                app.player.queue_changed()
                app.say("Back in the queue.")
                self.repaint(keep=f"q:{min(at, len(q) - 1)}:{item.get('id')}")
            return True
        if not (isinstance(data, tuple) and data[0] == "queue"):
            return action in ("take_out", "move_down", "move_up")
        i = data[1]
        if action == "take_out" and i < len(q):
            item = q.pop(i)
            self.taken.append((i, item))
            app.player.queue_changed()
            app.say(f"Took {fmt.cut(fmt.clean(item.get('title')), 40)} out · u puts it back")
            self.repaint()
            return True
        if action in ("move_down", "move_up") and i < len(q):
            j = i + (1 if action == "move_down" else -1)
            if 0 <= j < len(q):
                q[i], q[j] = q[j], q[i]
                app.player.queue_changed()
                self.repaint(keep=f"q:{j}:{q[j].get('id')}")
            return True
        return False
