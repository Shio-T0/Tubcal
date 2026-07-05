from flask import jsonify


def ok(data):
    return jsonify({"ok": True, "data": data})


def err(message, status=400):
    return jsonify({"ok": False, "error": str(message)}), status


def register_blueprints(app):
    from .feeds import feeds_bp
    from .subscriptions import subs_bp
    from .settings import settings_bp
    from .oauth import oauth_bp
    from .brain import brain_bp
    from .anime import anime_bp
    from .edition import edition_bp

    app.register_blueprint(feeds_bp)
    app.register_blueprint(subs_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(oauth_bp)
    app.register_blueprint(brain_bp)
    app.register_blueprint(anime_bp)
    app.register_blueprint(edition_bp)
