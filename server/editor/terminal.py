"""A real PTY bridged over a WebSocket — the room's integrated terminal.

Protocol: the client sends JSON text frames {"type":"input","data":str} and
{"type":"resize","cols":int,"rows":int}; the server sends raw utf-8 output
frames. One shell per connection; closing the socket reaps the shell.
"""

import fcntl
import json
import os
import pty
import select
import signal
import struct
import termios
import threading

from .. import config


def _resize(fd, cols, rows):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass


def _contained(rel):
    """Best-effort cwd containment; falls back to the workspace root."""
    root = config.EDITOR_ROOT
    p = (root / (rel or "")).resolve()
    if p == root or (p.is_relative_to(root) and p.is_dir()):
        return p
    return root


def handle(ws):
    from flask import request

    cwd = _contained(request.args.get("cwd", ""))
    shell = os.environ.get("SHELL") or "/bin/bash"

    pid, fd = pty.fork()
    if pid == 0:  # child: become the shell
        try:
            os.chdir(cwd)
        except OSError:
            pass
        env = dict(os.environ, TERM="xterm-256color", COLORTERM="truecolor")
        os.execvpe(shell, [shell], env)

    _resize(fd, 120, 30)
    alive = True

    def pump():
        """PTY -> WebSocket. Runs until the shell exits or the socket dies."""
        nonlocal alive
        try:
            while alive:
                r, _, _ = select.select([fd], [], [], 0.5)
                if not r:
                    continue
                data = os.read(fd, 65536)
                if not data:
                    break
                ws.send(data.decode("utf-8", errors="replace"))
        except OSError:
            pass
        finally:
            alive = False
            try:
                ws.close()
            except Exception:
                pass

    t = threading.Thread(target=pump, daemon=True)
    t.start()

    try:
        while alive:
            msg = ws.receive()
            if msg is None:
                break
            try:
                m = json.loads(msg)
            except (json.JSONDecodeError, TypeError):
                continue
            if m.get("type") == "input":
                os.write(fd, m.get("data", "").encode("utf-8"))
            elif m.get("type") == "resize":
                _resize(fd, int(m.get("cols", 80)), int(m.get("rows", 24)))
    except Exception:
        pass
    finally:
        alive = False
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.kill(pid, signal.SIGHUP)
            os.waitpid(pid, os.WNOHANG)
        except OSError:
            pass
