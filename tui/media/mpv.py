"""One mpv, driven over its JSON IPC socket.

mpv starts at the first play and is reused while it lives; if you quit it (`q` in its
window), the next play starts a new one. The socket lives in a 0700 folder under
$XDG_RUNTIME_DIR. URLs go over the socket, never on the command line.

Your own mpv config is kept (key bindings, hwdec, the system MPRIS script that makes
the media keys work). What Tubcal adds only stops mpv from keeping its own record of
what you watched: Tubcal's server holds history and resume points.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable

LUA = Path(__file__).with_name("tubcal.lua")

BASE_ARGS = [
    "--idle=yes",
    "--force-window=no",
    "--x11-name=tubcal",
    "--title=${?media-title:${media-title}}${!media-title:Tubcal}",
    "--cache=yes",
    "--ytdl=no",
    # mpv keeps none of its own records of what played
    "--resume-playback=no",
    "--save-position-on-quit=no",
    "--save-watch-history=no",
    "--cache-on-disk=no",
]

OBSERVED = ("time-pos", "duration", "pause", "idle-active", "paused-for-cache", "height", "media-title")


class MpvError(Exception):
    pass


def socket_dir() -> Path:
    run = os.environ.get("XDG_RUNTIME_DIR")
    if run and os.path.isdir(run):
        d = Path(run) / "tubcal"
        d.mkdir(mode=0o700, exist_ok=True)
        os.chmod(d, 0o700)
        return d
    return Path(tempfile.mkdtemp(prefix="tubcal-"))


class Mpv:
    """`on_event(dict)` is called for every mpv event, in order, from a thread of its own
    (one per mpv). Never from the reader: a handler may ask mpv something (the player
    sets force-window when mpv goes idle, the video and the radio pause each other), and
    the reader has to stay free to read the answer."""

    def __init__(self, on_event: Callable[[dict], None], *, extra_args: list[str] | None = None,
                 mpris: bool = True, binary: str = "mpv", name: str = "mpv"):
        self.on_event = on_event
        self.name = name                # the socket's name: the radio runs a second mpv
        self.extra_args = list(extra_args or [])
        self.mpris = mpris
        self.binary = binary
        self._proc: subprocess.Popen | None = None
        self._sock: socket.socket | None = None
        self._wfile = None
        self._lock = threading.Lock()
        self._pending: dict[int, list] = {}
        self._next_id = 0
        self._path: Path | None = None
        self._pid: int | None = None             # an mpv taken back after a reload (`adopt`)
        self._letting_go: socket.socket | None = None

    @staticmethod
    def available(binary: str = "mpv") -> bool:
        return shutil.which(binary) is not None

    @property
    def alive(self) -> bool:
        return self._sock is not None and self._running()

    def _running(self) -> bool:
        """mpv's process hasn't exited (started here, or taken back after a reload)."""
        if self._proc is not None:
            return self._proc.poll() is None
        if self._pid is None:
            return False
        try:
            done, _ = os.waitpid(self._pid, os.WNOHANG)   # an exited one is reaped here
        except ChildProcessError:
            done = self._pid
        if done:
            self._pid = None
        return not done

    def ensure(self) -> None:
        if self.alive:
            return
        self.close()
        if not self.available(self.binary):
            raise MpvError("mpv isn't installed. `o` opens the item in the browser instead.")
        d = socket_dir()
        self._path = d / f"{self.name}-{os.getpid()}.sock"
        if self._path.exists():
            self._path.unlink()
        args = [self.binary, *BASE_ARGS, f"--input-ipc-server={self._path}"]
        if LUA.exists():
            args.append(f"--script={LUA}")
        if not self.mpris:
            args.append("--load-scripts=no")
        args += self.extra_args
        env = dict(os.environ)
        env["no_proxy"] = env["NO_PROXY"] = "127.0.0.1,localhost,::1"
        self._proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL, env=env, start_new_session=True)
        self._connect("mpv exited at once; try running `mpv` in a terminal to see why.")

    # ── a reload: the same mpv, playing on, for the next run ─────────────────

    def keep(self) -> dict | None:
        """Let go of this mpv without stopping it, for the next run of the terminal (a
        reload runs it again in this very process, so mpv stays its child). `adopt`
        takes it back. None when there's no mpv to keep."""
        if not self.alive or self._path is None:
            return None
        kept = {"pid": self._proc.pid if self._proc is not None else self._pid, "path": str(self._path)}
        sock, wfile, self._letting_go = self._sock, self._wfile, self._sock
        self._sock = self._wfile = self._proc = self._pid = None
        try:
            # shutdown, not only close: the reader's file still holds the socket, and the
            # connection has to end now (mpv stops sending this client its events)
            sock.shutdown(socket.SHUT_RDWR)
            wfile.close()
            sock.close()
        except OSError:
            pass
        return kept

    def adopt(self, kept: dict | None) -> bool:
        """Take back the mpv a reload kept: only this process's own child, on its own
        socket. False (and nothing changed) when it's gone."""
        try:
            pid, path = int(kept["pid"]), Path(kept["path"])
        except (KeyError, TypeError, ValueError):
            return False
        if path.name != f"{self.name}-{os.getpid()}.sock" or not path.exists():
            return False
        try:
            if os.waitpid(pid, os.WNOHANG)[0]:
                return False                    # it has just exited (and is reaped now)
        except ChildProcessError:
            return False                        # not ours
        self._pid, self._path = pid, path
        try:
            self._connect("mpv went away during the reload.")
        except MpvError:
            self.close()
            return False
        return True

    def _connect(self, gone: str) -> None:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if not self._running():
                raise MpvError(gone)
            if self._path.exists():
                try:
                    s = socket.socket(socket.AF_UNIX)
                    s.connect(str(self._path))
                    self._sock = s
                    break
                except OSError:
                    s.close()
            time.sleep(0.05)
        if self._sock is None:
            raise MpvError("mpv didn't open its control socket.")
        self._wfile = self._sock.makefile("wb")
        events: queue.SimpleQueue = queue.SimpleQueue()
        threading.Thread(target=self._dispatch, args=(events,), daemon=True, name=f"{self.name}-events").start()
        threading.Thread(target=self._read, args=(self._sock, events), daemon=True, name="mpv-ipc").start()
        for i, prop in enumerate(OBSERVED, 1):
            self.command("observe_property", i, prop)

    def _read(self, sock: socket.socket, events: queue.SimpleQueue) -> None:
        """Answers go to whoever is waiting for them; events go to `_dispatch`."""
        f = sock.makefile("rb")
        try:
            for line in f:
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                rid = msg.get("request_id")
                if rid is not None and "event" not in msg:
                    slot = self._pending.pop(rid, None)
                    if slot:
                        slot[1] = msg
                        slot[0].set()
                    continue
                events.put(msg)
        except OSError:
            pass
        finally:
            for slot in list(self._pending.values()):
                slot[1] = {"error": "mpv closed"}
                slot[0].set()
            self._pending.clear()
            if self._sock is sock:
                self._sock = None
            if self._letting_go is not sock:     # kept for a reload: mpv plays on
                events.put({"event": "mpv-exit"})
            events.put(None)

    def _dispatch(self, events: queue.SimpleQueue) -> None:
        while True:
            msg = events.get()
            if msg is None:
                return
            try:
                self.on_event(msg)
            except Exception:  # an event handler must never stop the events
                pass

    def command(self, *args, timeout: float = 5.0):
        if self._sock is None or self._wfile is None:
            raise MpvError("mpv isn't running.")
        with self._lock:
            self._next_id += 1
            rid = self._next_id
            slot = [threading.Event(), None]
            self._pending[rid] = slot
            try:
                self._wfile.write((json.dumps({"command": list(args), "request_id": rid}) + "\n").encode())
                self._wfile.flush()
            except OSError as e:
                self._pending.pop(rid, None)
                raise MpvError("mpv isn't running.") from e
        if not slot[0].wait(timeout):
            self._pending.pop(rid, None)
            raise MpvError(f"mpv didn't answer {args[0]}.")
        reply = slot[1] or {}
        if reply.get("error") not in ("success", None):
            raise MpvError(f"mpv: {reply.get('error')} ({args[0]})")
        return reply.get("data")

    def get(self, prop: str, default=None):
        try:
            return self.command("get_property", prop)
        except MpvError:
            return default

    def set(self, prop: str, value) -> None:
        self.command("set_property", prop, value)

    def message(self, *args: str) -> None:
        """A script-message for tubcal.lua."""
        self.command("script-message", *[str(a) for a in args])

    def close(self, quit: bool = False) -> None:
        if quit and self.alive:
            try:
                self.command("quit", timeout=2)
            except MpvError:
                pass
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
        self._sock = None
        self._wfile = None
        if quit and self._proc is not None:
            try:
                self._proc.wait(3)
            except subprocess.TimeoutExpired:
                self._proc.terminate()
        elif quit and self._pid is not None:
            deadline = time.monotonic() + 3
            while self._running() and time.monotonic() < deadline:
                time.sleep(0.05)
            if self._pid is not None:
                try:
                    os.kill(self._pid, 15)
                except OSError:
                    pass
        if self._path is not None and self._path.exists() and not self._running():
            try:
                self._path.unlink()
            except OSError:
                pass
