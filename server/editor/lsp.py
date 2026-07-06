"""LSP bridge: a language server on stdio <-> JSON-RPC over a WebSocket.

The frontend (codemirror-languageserver) speaks plain JSON text frames; a real
language server speaks Content-Length-framed JSON-RPC on stdio. This module
spawns one server per socket connection and translates between the two.
Missing binaries simply mean the language falls back to in-editor smarts —
mirrored to the UI via /api/editor/status.
"""

import json
import shutil
import subprocess
import threading

from .. import config

# lang id (from the client) -> how to launch its server. `bin` is what
# /api/editor/status probes for; args are the full launch vector.
SERVERS = {
    "python": {"bin": "pyright-langserver", "args": ["pyright-langserver", "--stdio"]},
    "typescript": {"bin": "typescript-language-server", "args": ["typescript-language-server", "--stdio"]},
    "javascript": {"bin": "typescript-language-server", "args": ["typescript-language-server", "--stdio"]},
    "rust": {"bin": "rust-analyzer", "args": ["rust-analyzer"], "probe": ["rust-analyzer", "--version"]},
    "c": {"bin": "clangd", "args": ["clangd"]},
    "cpp": {"bin": "clangd", "args": ["clangd"]},
    "go": {"bin": "gopls", "args": ["gopls"]},
}

_probe_cache = {}


def available(lang):
    """Is this language's server actually runnable? `which` alone lies for
    rustup shims (the proxy exists even when the component isn't installed),
    so servers with a `probe` get launched once with --version and cached."""
    spec = SERVERS.get(lang)
    if not spec:
        return False
    exe = shutil.which(spec["bin"])
    if not exe:
        return False
    probe = spec.get("probe")
    if not probe:
        return True
    if exe not in _probe_cache:
        try:
            r = subprocess.run([exe, *probe[1:]], capture_output=True, timeout=10)
            _probe_cache[exe] = r.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            _probe_cache[exe] = False
    return _probe_cache[exe]


def _read_framed(stdout):
    """Yield JSON-RPC message bodies from a Content-Length framed stream."""
    while True:
        length = None
        while True:
            line = stdout.readline()
            if not line:
                return
            line = line.strip()
            if not line:
                break  # blank line ends the header block
            if line.lower().startswith(b"content-length:"):
                length = int(line.split(b":", 1)[1])
        if length is None:
            continue
        body = stdout.read(length)
        if not body:
            return
        yield body


def handle(ws):
    from flask import request

    lang = request.args.get("lang", "")
    spec = SERVERS.get(lang)
    exe = shutil.which(spec["bin"]) if spec and available(lang) else None
    if not exe:
        ws.close()
        return

    proc = subprocess.Popen(
        [exe, *spec["args"][1:]],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        cwd=config.EDITOR_ROOT,
    )
    alive = True

    def pump():
        """server stdout -> WebSocket"""
        nonlocal alive
        try:
            for body in _read_framed(proc.stdout):
                if not alive:
                    break
                ws.send(body.decode("utf-8", errors="replace"))
        except Exception:
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
            body = msg.encode("utf-8") if isinstance(msg, str) else msg
            try:
                json.loads(body)  # only forward well-formed JSON-RPC
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            proc.stdin.write(f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
            proc.stdin.flush()
    except Exception:
        pass
    finally:
        alive = False
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
