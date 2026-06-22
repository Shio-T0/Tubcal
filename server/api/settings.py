from flask import Blueprint, request

from . import err, ok
from .. import db

settings_bp = Blueprint("settings", __name__, url_prefix="/api")

# Allow exactly the keys we seed in DEFAULT_SETTINGS — derived so adding a new
# setting there can never drift out of sync with this allow-list again.
ALLOWED_KEYS = set(db.DEFAULT_SETTINGS)


@settings_bp.get("/settings")
def get_settings():
    return ok(db.get_settings())


@settings_bp.put("/settings")
def put_settings():
    body = request.get_json(force=True, silent=True) or {}
    unknown = set(body) - ALLOWED_KEYS
    if unknown:
        return err(f"unknown settings: {', '.join(sorted(unknown))}")
    for key, value in body.items():
        db.set_setting(key, value)
    return ok(db.get_settings())
