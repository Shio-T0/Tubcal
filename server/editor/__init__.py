"""The Composing Room's process-facing side: PTY terminal + LSP bridge.

The HTTP filesystem API lives in server/api/editor.py; this package holds the
WebSocket endpoints (registered from create_app via sockets.register) and the
subprocess plumbing they bridge to. Everything degrades: without flask-sock the
register call is a no-op and the room is a pure editor.
"""
