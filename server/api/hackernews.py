"""The Wire's API: Hacker News lists, search and threads (modules.ini: hackernews)."""

from flask import Blueprint, request

from . import err, ok
from ..sources import hackernews

hn_bp = Blueprint("hackernews", __name__, url_prefix="/api")


@hn_bp.get("/feed/hackernews")
def feed_hackernews():
    list_name = request.args.get("list", "top")
    if list_name not in hackernews.LISTS:
        return err("list must be one of " + ", ".join(hackernews.LISTS))
    try:
        page = max(0, int(request.args.get("page", 0)))
    except ValueError:
        return err("invalid page")
    try:
        return ok(hackernews.get_feed(list_name, page))
    except Exception as e:
        return err(f"Hacker News fetch failed: {e}", 502)


@hn_bp.get("/hackernews/search")
def hackernews_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    try:
        return ok(hackernews.search(q, request.args.get("sort") or "relevance", request.args.get("range")))
    except Exception as e:
        return err(f"Search failed: {e}", 502)


@hn_bp.get("/hackernews/item/<int:hn_id>")
def hackernews_item(hn_id):
    try:
        return ok(hackernews.get_item(hn_id))
    except Exception as e:
        return err(f"Could not load thread: {e}", 502)
