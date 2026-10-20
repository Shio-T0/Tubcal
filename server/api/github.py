"""The GitHub room's API: /api/github/*.

Reads anyone can make (trending, search, repositories, people, releases), the
linked account's own things (inbox, work, stars, starring, following,
comments), and the workspace's clones. Every failure from GitHub arrives as a
GitHubError carrying the status and a sentence fit to show.
"""

from flask import Blueprint, request
from werkzeug.exceptions import HTTPException

from . import err, ok
from .. import db
from ..sources import github, github_local
from ..sources.github import GitHubError

github_bp = Blueprint("github", __name__, url_prefix="/api/github")


@github_bp.before_request
def _json_writes_only():
    """Writes here act on the linked GitHub account (comment, star, follow) or
    on this machine (clone, fetch). A web page elsewhere can POST to 127.0.0.1
    as a "simple" cross-site request only with a form-like content type; asking
    for application/json makes the browser stop and ask first, and Flask never
    says yes — so only Tubcal's own pages can write."""
    if request.method not in ("GET", "HEAD", "OPTIONS") and not request.is_json:
        return err("send JSON (Content-Type: application/json)", 415)


@github_bp.errorhandler(GitHubError)
def _github_error(e):
    return err(str(e), e.status)


@github_bp.errorhandler(Exception)
def _any_error(e):
    if isinstance(e, HTTPException):
        return e
    return err(f"GitHub request failed: {e}", 502)


def _page():
    try:
        return max(0, int(request.args.get("page", 0)))
    except ValueError:
        raise GitHubError("invalid page", 400, "invalid") from None


def _flag(name):
    return request.args.get(name, "").lower() in ("1", "true", "yes")


def _body():
    return request.get_json(silent=True) or {}


# ── the account ──────────────────────────────────────────────────────────────

@github_bp.get("/account")
def account():
    me = github.account()
    return ok({**me, "gh_cli": github.gh_cli(), "budget": github.budget(),
               "local": github_local.available(), "workspace": github_local.editor_root_label()})


@github_bp.post("/account")
def link():
    body = _body()
    if body.get("method") == "gh":
        me = github.link_gh_cli()
    else:
        me = github.link_token(body.get("token"))
    return ok({**me, "gh_cli": github.gh_cli(), "budget": github.budget(refresh=True)})


@github_bp.delete("/account")
def unlink():
    return ok({**github.unlink(), "gh_cli": github.gh_cli(), "budget": github.budget(refresh=True)})


@github_bp.get("/budget")
def budget():
    return ok(github.budget(refresh=_flag("refresh")))


# ── discovery ────────────────────────────────────────────────────────────────

@github_bp.get("/trending")
def trending():
    period = (request.args.get("period") or "daily").strip().lower()
    if period not in ("daily", "weekly", "monthly"):
        return err("period must be one of daily|weekly|monthly")
    language = (request.args.get("language") or "").strip() or None
    return ok(github.trending(period, language, _page()))


@github_bp.get("/trending/developers")
def trending_developers():
    period = (request.args.get("period") or "daily").strip().lower()
    language = (request.args.get("language") or "").strip() or None
    return ok(github.trending_developers(period, language))


@github_bp.get("/search")
def search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    return ok(github.search(
        q, page=_page(), scope=request.args.get("in") or "repos", sort=request.args.get("sort") or None,
        language=(request.args.get("language") or "").strip() or None,
    ))


@github_bp.get("/item/<path:full_name>")
def item(full_name):
    return ok(github.get_item(full_name))


@github_bp.get("/following")
def following():
    return ok({"items": github.following_cards()})


@github_bp.get("/releases")
def release_radar():
    return ok(github.release_radar())


# ── a repository ─────────────────────────────────────────────────────────────

@github_bp.get("/repo/<owner>/<name>")
def repo(owner, name):
    full = github.check_repo(owner, name)
    meta, stale = github.repo(full)
    try:
        langs = github.languages(full)
    except GitHubError:
        langs = []
    try:
        viewer = github.viewer_state(full)
    except GitHubError:
        viewer = {"starred": None}
    local = github_local.find(full) if github_local.available() else None
    followed = any(s["source_id"].lower() == full.lower() for s in db.list_subscriptions("github"))
    return ok({"repo": meta, "languages": langs, "viewer": viewer, "local": local, "followed": followed,
               "clone_available": github_local.available(), "stale": stale})


@github_bp.get("/repo/<owner>/<name>/readme")
def repo_readme(owner, name):
    return ok({"html": github.readme(github.check_repo(owner, name), request.args.get("ref") or None)})


@github_bp.get("/repo/<owner>/<name>/participation")
def repo_participation(owner, name):
    return ok(github.participation(github.check_repo(owner, name)))


@github_bp.get("/repo/<owner>/<name>/branches")
def repo_branches(owner, name):
    return ok({"items": github.branches(github.check_repo(owner, name))})


@github_bp.get("/repo/<owner>/<name>/tree")
def repo_tree(owner, name):
    return ok(github.tree(github.check_repo(owner, name), request.args.get("ref") or None,
                          request.args.get("path") or ""))


@github_bp.get("/repo/<owner>/<name>/file")
def repo_file(owner, name):
    return ok(github.file(github.check_repo(owner, name), request.args.get("ref") or None,
                          request.args.get("path") or "", render=_flag("render")))


@github_bp.get("/repo/<owner>/<name>/commits")
def repo_commits(owner, name):
    return ok(github.commits(github.check_repo(owner, name), request.args.get("ref") or None,
                             request.args.get("path") or None, _page()))


@github_bp.get("/repo/<owner>/<name>/commit/<sha>")
def repo_commit(owner, name, sha):
    return ok(github.commit(github.check_repo(owner, name), sha))


@github_bp.get("/repo/<owner>/<name>/issues")
def repo_issues(owner, name):
    kind = "pull" if request.args.get("kind") == "pull" else "issue"
    return ok(github.issues(github.check_repo(owner, name), kind, request.args.get("state") or "open", _page()))


@github_bp.get("/repo/<owner>/<name>/thread/<int:number>")
def repo_thread(owner, name, number):
    return ok(github.thread(github.check_repo(owner, name), number, _page()))


@github_bp.post("/repo/<owner>/<name>/thread/<int:number>/comments")
def repo_comment(owner, name, number):
    return ok(github.add_comment(github.check_repo(owner, name), number, _body().get("body")))


@github_bp.get("/repo/<owner>/<name>/pull/<int:number>/files")
def repo_pull_files(owner, name, number):
    return ok(github.pull_files(github.check_repo(owner, name), number, _page()))


@github_bp.get("/repo/<owner>/<name>/releases")
def repo_releases(owner, name):
    return ok(github.releases(github.check_repo(owner, name), _page()))


@github_bp.get("/repo/<owner>/<name>/contributors")
def repo_contributors(owner, name):
    return ok({"items": github.contributors(github.check_repo(owner, name))})


@github_bp.put("/repo/<owner>/<name>/star")
def star(owner, name):
    return ok(github.set_star(github.check_repo(owner, name), True))


@github_bp.delete("/repo/<owner>/<name>/star")
def unstar(owner, name):
    return ok(github.set_star(github.check_repo(owner, name), False))


# ── people ───────────────────────────────────────────────────────────────────

@github_bp.get("/user/<login>")
def user(login):
    u = github.user(login)
    try:
        viewer = github.follow_state(login)
    except GitHubError:
        viewer = {"following": None}
    followed = any(s["source_id"].lower() == login.lower() for s in db.list_subscriptions("github"))
    me = github.account()
    return ok({"user": u, "viewer": viewer, "followed": followed,
               "is_me": bool(me.get("linked") and me.get("login", "").lower() == login.lower())})


@github_bp.get("/user/<login>/repos")
def user_repos(login):
    return ok(github.user_repos(login, request.args.get("sort") or "pushed", _page()))


@github_bp.get("/user/<login>/contributions")
def user_contributions(login):
    return ok(github.contributions(login))


@github_bp.put("/user/<login>/follow")
def follow(login):
    return ok(github.set_follow(login, True))


@github_bp.delete("/user/<login>/follow")
def unfollow(login):
    return ok(github.set_follow(login, False))


# ── your inbox and work ──────────────────────────────────────────────────────

@github_bp.get("/inbox")
def inbox():
    return ok(github.notifications(_flag("all"), _flag("participating"), _page()))


@github_bp.get("/inbox/count")
def inbox_count():
    return ok(github.notification_count())


@github_bp.patch("/inbox/<thread_id>")
def inbox_read(thread_id):
    github.mark_read(thread_id)
    return ok({"read": True})


@github_bp.delete("/inbox/<thread_id>")
def inbox_done(thread_id):
    github.mark_done(thread_id)
    return ok({"done": True})


@github_bp.put("/inbox/<thread_id>/mute")
def inbox_mute(thread_id):
    github.mute(thread_id)
    return ok({"muted": True})


@github_bp.put("/inbox")
def inbox_all_read():
    github.mark_all_read(_body().get("repo") or None)
    return ok({"read": True})


@github_bp.get("/work")
def work():
    return ok(github.work())


@github_bp.get("/mine/repos")
def mine_repos():
    return ok(github.my_repos(_page(), request.args.get("sort") or "pushed"))


@github_bp.get("/stars")
def my_stars():
    return ok(github.stars(_page()))


@github_bp.get("/received")
def received():
    return ok(github.received(_page()))


# ── this machine ─────────────────────────────────────────────────────────────

@github_bp.get("/local")
def local():
    if not github_local.available():
        return ok({"available": False, "items": [], "workspace": None})
    return ok({"available": True, "items": github_local.clones_with_upstream(check=_flag("check")),
               "workspace": github_local.editor_root_label()})


@github_bp.post("/local/fetch")
def local_fetch():
    return ok(github_local.fetch(_body().get("path") or ""))


@github_bp.post("/clone")
def clone():
    body = _body()
    return ok(github_local.start_clone(body.get("repo") or "", private=bool(body.get("private"))))


@github_bp.get("/clone/<job_id>")
def clone_status(job_id):
    return ok(github_local.clone_status(job_id))


# The followed repos' and people's activity as feed items, for the For You mix
# and the Edition; it predates /api/github and keeps its address.
github_feed_bp = Blueprint("github_feed", __name__, url_prefix="/api")


@github_feed_bp.get("/feed/github")
def feed_github():
    list_name = request.args.get("list", "activity")
    try:
        page = max(0, int(request.args.get("page", 0)))
    except ValueError:
        return err("invalid page")
    try:
        return ok(github.get_feed(list_name, page))
    except Exception as e:
        return err(f"GitHub fetch failed: {e}", 502)
