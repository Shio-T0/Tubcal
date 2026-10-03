import re
import time

from flask import Blueprint, request

from . import err, ok
from .. import config, db

settings_bp = Blueprint("settings", __name__, url_prefix="/api")

# Allow exactly the keys we seed in DEFAULT_SETTINGS — derived so adding a new
# setting there can never drift out of sync with this allow-list again.
ALLOWED_KEYS = set(db.DEFAULT_SETTINGS)


_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_SUB_CHOICES = {"font": {"sans", "serif", "mono", "system"}, "weight": {400, 600, 800},
                "edge": {"none", "shadow", "outline"}}
_SUB_RANGES = {"size": (0.5, 2.5), "bg": (0.0, 1.0), "position": (2, 30)}


def subtitle_style(value):
    """Validate a subtitle style (the shape of frontend/src/lib/subtitleStyle.js) and
    stamp when it changed. Numbers are clamped into range; anything else that's
    wrong is a ValueError naming the field."""
    if not isinstance(value, dict):
        raise ValueError("subtitle_style must be an object")
    base = dict(db.DEFAULT_SETTINGS["subtitle_style"])
    unknown = set(value) - set(base)
    if unknown:
        raise ValueError(f"unknown subtitle_style fields: {', '.join(sorted(unknown))}")
    out = {**base, **(db.get_setting("subtitle_style") or {}), **value}
    for k, (lo, hi) in _SUB_RANGES.items():
        v = out[k]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise ValueError(f"subtitle_style.{k} must be a number")
        out[k] = min(hi, max(lo, v))
    for k, allowed in _SUB_CHOICES.items():
        if out[k] not in allowed:
            raise ValueError(f"subtitle_style.{k} must be one of {sorted(allowed, key=str)}")
    for k in ("color", "bg_color"):
        if not isinstance(out[k], str) or not _HEX.match(out[k]):
            raise ValueError(f"subtitle_style.{k} must be a #rrggbb colour")
    if not isinstance(out["lang"], str) or len(out["lang"]) > 8:
        raise ValueError("subtitle_style.lang must be a short language code")
    if not isinstance(out["show"], bool):
        raise ValueError("subtitle_style.show must be true or false")
    out["updated_at"] = time.time()
    return out


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

    if "anime_theme_volume" in body:
        val = body["anime_theme_volume"]
        if isinstance(val, bool) or not isinstance(val, (int, float)) or not 0 <= val <= 1:
            return err("anime_theme_volume must be a number between 0 and 1")
    if "anime_theme_seconds" in body:
        val = body["anime_theme_seconds"]
        if isinstance(val, bool) or not isinstance(val, int) or not 0 <= val <= 600:
            return err("anime_theme_seconds must be whole seconds, 0 (the whole song) to 600")

    if "subtitle_style" in body:
        try:
            body["subtitle_style"] = subtitle_style(body["subtitle_style"])
        except ValueError as e:
            return err(str(e))

    for key, value in body.items():
        db.set_setting(key, value)
    return ok(db.get_settings())