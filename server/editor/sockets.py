"""Register the Composing Room's WebSocket endpoints on the app.

Kept behind a soft import so the app boots identically without the `editor`
extra installed — /api/editor/status reports terminal:false and the UI shows
the room as a pure editor.
"""


def register(app):
    try:
        from flask_sock import Sock
    except ImportError:
        return False

    from . import lsp, terminal

    sock = Sock(app)
    sock.route("/api/editor/pty", endpoint="editor_pty")(terminal.handle)
    sock.route("/api/editor/lsp", endpoint="editor_lsp")(lsp.handle)
    return True
