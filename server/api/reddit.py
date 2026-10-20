"""The Dispatch's API: subreddit feeds, search and threads (modules.ini: reddit)."""

from flask import Blueprint, request

from . import err, ok
from .. import db
from ..sources import reddit

reddit_bp = Blueprint("reddit", __name__, url_prefix="/api")


@reddit_bp.get("/feed/reddit")
def feed_reddit():
    sort = request.args.get("sort", "hot")
    if sort not in ("hot", "new", "top"):
        return err("sort must be hot, new, or top")
    if request.args.get("source") == "account":
        from .oauth import get_valid_token
        try:
            token = get_valid_token("reddit")
        except LookupError as e:
            return err(str(e), 401)
        try:
            return ok(reddit.get_account_feed(token))
        except Exception as e:
            return err(f"Reddit account feed failed: {e}", 502)
    subs_param = (request.args.get("subs") or "").strip()
    if subs_param:
        names = [n.strip().lower() for n in subs_param.split(",") if n.strip()]
    else:
        names = [s["source_id"] for s in db.list_subscriptions("reddit")]
    if not names:
        return ok({"items": [], "stale": False})
    try:
        return ok(reddit.get_feed(names, sort))
    except Exception as e:
        return err(f"Reddit fetch failed: {e}", 502)


@reddit_bp.get("/reddit/search")
def reddit_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    sub = (request.args.get("sub") or "").strip() or None
    try:
        return ok(reddit.search(q, sub))
    except Exception as e:
        return err(f"Search failed: {e}", 502)


@reddit_bp.get("/reddit/post/<sub>/<post_id>")
def reddit_post(sub, post_id):
    try:
        return ok(reddit.get_post(sub, post_id))
    except Exception as e:
        return err(f"Could not load post: {e}", 502)
