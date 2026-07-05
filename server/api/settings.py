from flask import Blueprint, request

from . import err, ok
from .. import config, db

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

    # Validate room configuration.
    if "active_rooms" in body:
        rooms = body["active_rooms"]
        if not isinstance(rooms, list):
            return err("active_rooms must be a JSON array of room ids")
        max_rooms = body.get("max_active_rooms") or db.get_setting("max_active_rooms", 6)
        if len(rooms) > max_rooms:
            return err(f"active_rooms exceeds max_active_rooms ({max_rooms})")
        if len(rooms) != len(set(rooms)):
            return err("active_rooms contains duplicates")
        for rid in rooms:
            if rid not in config.ROOM_IDS:
                return err(f"unknown room id: {rid}")

    if "max_active_rooms" in body:
        val = body["max_active_rooms"]
        if not isinstance(val, int) or val < 1 or val > 12:
            return err("max_active_rooms must be an integer between 1 and 12")
        body["max_active_rooms"] = max(1, min(12, val))

    for key, value in body.items():
        db.set_setting(key, value)
    return ok(db.get_settings())