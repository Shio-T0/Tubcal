from flask import Blueprint, request

from . import err, ok
from .. import db
from ..sources import reddit, youtube, github

subs_bp = Blueprint("subscriptions", __name__, url_prefix="/api")


@subs_bp.get("/subscriptions")
def list_subs():
    grouped = {"youtube": [], "reddit": [], "github": []}
    for row in db.list_subscriptions():
        grouped[row["platform"]].append(row)
    return ok(grouped)


@subs_bp.post("/subscriptions")
def add_sub():
    body = request.get_json(force=True, silent=True) or {}
    platform = body.get("platform")
    raw = (body.get("input") or "").strip()
    if platform not in ("youtube", "reddit", "github") or not raw:
        return err("platform ('youtube'|'reddit'|'github') and input are required")
    try:
        if platform == "youtube":
            info = youtube.resolve_channel(raw)
            source_id, name, thumb = info["channel_id"], info["title"], info["thumbnail"]
        elif platform == "reddit":
            info = reddit.validate_subreddit(raw)
            source_id, name, thumb = info["name"], info["title"], info["icon"]
        else:
            # GitHub: raw is "owner/repo" or a username — validate against the API
            info = github.resolve(raw)
            source_id, name, thumb = info["source_id"], info["name"], info["icon"]
    except LookupError as e:
        return err(str(e), 404)
    except Exception as e:
        return err(f"Could not resolve '{raw}': {e}", 502)

    row = db.add_subscription(platform, source_id, name, thumb)
    if row is None:
        return err("Already subscribed", 409)
    return ok(row)


@subs_bp.delete("/subscriptions/<int:sub_id>")
def delete_sub(sub_id):
    if not db.delete_subscription(sub_id):
        return err("No such subscription", 404)
    return ok({"deleted": True})


@subs_bp.post("/youtube/resolve")
def resolve_youtube():
    raw = ((request.get_json(force=True, silent=True) or {}).get("input") or "").strip()
    if not raw:
        return err("input required")
    try:
        return ok(youtube.resolve_channel(raw))
    except LookupError as e:
        return err(str(e), 404)
    except Exception as e:
        return err(f"Resolve failed: {e}", 502)


@subs_bp.post("/reddit/resolve")
def resolve_reddit():
    raw = ((request.get_json(force=True, silent=True) or {}).get("input") or "").strip()
    if not raw:
        return err("input required")
    try:
        return ok(reddit.validate_subreddit(raw))
    except LookupError as e:
        return err(str(e), 404)
    except Exception as e:
        return err(f"Resolve failed: {e}", 502)


@subs_bp.post("/github/resolve")
def resolve_github():
    raw = ((request.get_json(force=True, silent=True) or {}).get("input") or "").strip()
    if not raw:
        return err("input required")
    try:
        return ok(github.resolve(raw))
    except LookupError as e:
        return err(str(e), 404)
    except Exception as e:
        return err(f"Could not resolve '{raw}': {e}", 502)