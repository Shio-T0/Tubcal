from flask import Flask, request, send_from_directory

from . import config


def create_app():
    app = Flask(__name__, static_folder=None)

    from .api import register_blueprints
    register_blueprints(app)

    @app.after_request
    def no_store(resp):
        if request.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    def serve_index(dist):
        # Inject the saved theme so the first paint is already correct.
        from . import db
        html = (dist / "index.html").read_text()
        theme = db.get_setting("theme", "dark")
        if theme != "dark":
            html = html.replace('data-theme="dark"', f'data-theme="{theme}"')
        return html, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"}

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def spa(path):
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
