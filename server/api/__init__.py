from flask import jsonify


def ok(data):
    return jsonify({"ok": True, "data": data})


def err(message, status=400):
    return jsonify({"ok": False, "error": str(message)}), status


# Each module's blueprints, by modules.ini id: (api file, blueprint names).
MODULE_BLUEPRINTS = {
    "edition": ("edition", ["edition_bp"]),
    "hackernews": ("hackernews", ["hn_bp"]),
    "topics": ("topics", ["topics_bp"]),
    "reddit": ("reddit", ["reddit_bp"]),
    "editor": ("editor", ["editor_bp"]),
    "dev": ("dev", ["dev_bp"]),
    "github": ("github", ["github_bp", "github_feed_bp"]),
    "youtube": ("youtube", ["youtube_bp"]),
    "anime": ("anime", ["anime_bp"]),
    "archive": ("brain", ["brain_bp"]),
}


def register_blueprints(app):
    """The core's routes, then those of each installed module. A module that's
    left out is never imported, so its routes 404 like any unknown address."""
    import importlib

    from .. import modules
    from .feeds import feeds_bp
    from .oauth import oauth_bp
    from .settings import settings_bp
    from .subscriptions import subs_bp

    for bp in (feeds_bp, subs_bp, settings_bp, oauth_bp):
        app.register_blueprint(bp)
    for module_id, (name, bps) in MODULE_BLUEPRINTS.items():
        if modules.has(module_id):
            mod = importlib.import_module(f"{__name__}.{name}")
            for bp in bps:
                app.register_blueprint(getattr(mod, bp))
