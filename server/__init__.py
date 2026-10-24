import json
import logging

from flask import Flask, request, send_from_directory

from . import config, localguard, modules


def create_app():
    app = Flask(__name__, static_folder=None)

    @app.before_request
    def only_this_machine():
        # Other websites open in the browser can address 127.0.0.1 too; see
        # server/localguard.py for what this refuses and why.
        why = localguard.refusal(request.path, request.headers)
        if why is None:
            return None
        logging.getLogger("tubcal").warning(
            "refused %s %s (%s: %s)", request.method, request.path,
            why, request.headers.get("Origin") or request.referrer or request.host)
        msg = localguard.message(why)
        if request.path.startswith("/api/"):
            from .api import err
            return err(msg, 403)
        return msg + "\n", 403, {"Content-Type": "text/plain; charset=utf-8"}

    from .api import register_blueprints
    register_blueprints(app)

    # The Composing Room's terminal + LSP sockets (no-op without flask-sock).
    if modules.has("editor"):
        from .editor import sockets as editor_sockets
        editor_sockets.register(app)

    @app.after_request
    def cache_policy(resp):
        # API responses must never be cached; hashed build assets can be cached
        # forever (Vite content-hashes every filename under /assets/, so a changed
        # file gets a new URL). This turns every asset re-request into a cache hit
        # instead of a revalidation round-trip.
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        elif request.path.startswith("/assets/"):
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        # No other site may show Tubcal in a frame and steer clicks in it.
        resp.headers["Content-Security-Policy"] = "frame-ancestors 'self'"
        return resp

    def serve_index(dist):
        # Inject the saved theme so the first paint is already correct.
        from . import db
        html = (dist / "index.html").read_text()
        theme = db.get_setting("theme", "dark")
        if theme != "dark":
            html = html.replace('data-theme="dark"', f'data-theme="{theme}"')
        # Fast mode is on <html> before the bundle runs, so the first paint is
        # already still (styles/base.css holds the rule).
        if db.get_setting("fast_mode", False) is True:
            html = html.replace("<html ", '<html data-fast="" ', 1)
        # 3D objects: Home lays out its box from the first render, rather than
        # showing the flat page until the settings arrive.
        if db.get_setting("objects_3d", False) is True:
            html = html.replace("<html ", '<html data-3d="" ', 1)
        # The modules this server has, before the bundle runs: the page leaves out
        # a room the build has but the server doesn't (frontend/src/lib/modules.js).
        if modules.known():
            stamp = json.dumps(modules.installed())
            html = html.replace("</head>", f"<script>window.__TUBCAL_MODULES__={stamp}</script></head>", 1)
        return html, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"}

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def spa(path):
        # An API address nothing answers (a typo, or a module this copy left
        # out) is a JSON 404, never the page.
        if path == "api" or path.startswith("api/"):
            from .api import err
            return err(f"no such endpoint: /{path}", 404)
        dist = config.FRONTEND_DIST
        if path and (dist / path).is_file():
            return send_from_directory(dist, path)
        if (dist / "index.html").is_file():
            return serve_index(dist)
        return (
            "Tubcal API is running, but the frontend is not built yet.\n"
            "Run:  cd frontend && npm install && npm run build\n"
            "Or for development:  cd frontend && npm run dev  (http://localhost:5173)\n",
            200,
            {"Content-Type": "text/plain; charset=utf-8"},
        )

    return app
