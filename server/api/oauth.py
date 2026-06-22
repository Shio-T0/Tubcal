"""Optional OAuth connections (Google/YouTube, Reddit).

Credentials are pasted by the user in Settings and stored only in the local
SQLite database. Flows use plain requests — no provider SDKs.
"""

import secrets
import time

from flask import Blueprint, redirect, request

from . import err, ok
from .. import config, db, httpc

oauth_bp = Blueprint("oauth", __name__, url_prefix="/api/oauth")

PROVIDERS = {
    "google": {
        "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "scope": "https://www.googleapis.com/auth/youtube.readonly",
    },
    "reddit": {
        "auth_url": "https://www.reddit.com/api/v1/authorize",
        "token_url": "https://www.reddit.com/api/v1/access_token",
        "scope": "read mysubreddits identity",
    },
    "anilist": {
        "auth_url": "https://anilist.co/api/v2/oauth/authorize",
        "token_url": "https://anilist.co/api/v2/oauth/token",
        "scope": None,        # AniList has no scope system — tokens are full-access
        "no_refresh": True,   # access tokens last ~1 year; there is no refresh flow
    },
}


def _redirect_uri(provider):
    return f"http://{config.HOST}:{config.PORT}/api/oauth/{provider}/callback"


def _check_provider(provider):
    if provider not in PROVIDERS:
        raise LookupError("unknown provider")


def get_valid_token(provider):
    """Return a fresh access token, refreshing lazily. Raises LookupError if not connected."""
    row = db.get_oauth(provider)
    meta = PROVIDERS.get(provider, {})

    # No-refresh providers (AniList): the access token is long-lived and there is
    # no refresh flow — return it while valid, otherwise ask the user to reconnect.
    if meta.get("no_refresh"):
        if not row or not row.get("access_token"):
            raise LookupError(f"{provider} is not connected — add credentials in Settings")
        if (row.get("expires_at") or 0) <= time.time() + 60:
            raise LookupError(f"{provider} token expired — reconnect in Settings")
        return row["access_token"]

    if not row or not row.get("refresh_token"):
        raise LookupError(f"{provider} is not connected — add credentials in Settings")
    if row.get("access_token") and (row.get("expires_at") or 0) > time.time() + 60:
        return row["access_token"]

    if provider == "google":
        resp = httpc.post(meta["token_url"], data={
            "client_id": row["client_id"],
            "client_secret": row["client_secret"],
            "refresh_token": row["refresh_token"],
            "grant_type": "refresh_token",
        })
    else:
        resp = httpc.post(
            meta["token_url"],
            ua=config.REDDIT_UA,
            auth=(row["client_id"], row["client_secret"]),
            data={"grant_type": "refresh_token", "refresh_token": row["refresh_token"]},
        )
    tok = resp.json()
    access = tok["access_token"]
    expires_at = int(time.time()) + int(tok.get("expires_in", 3600))
    db.set_oauth_tokens(provider, access, tok.get("refresh_token"), expires_at)
    return access


@oauth_bp.get("/status")
def status():
    out = {}
    for provider, meta in PROVIDERS.items():
        row = db.get_oauth(provider)
        # No-refresh providers count as connected once they hold an access token.
        connected = bool(
            row
            and (row.get("refresh_token") or (meta.get("no_refresh") and row.get("access_token")))
        )
        out[provider] = {
            "configured": bool(row and row.get("client_id")),
            "connected": connected,
        }
    return ok(out)


@oauth_bp.put("/<provider>/credentials")
def set_credentials(provider):
    try:
        _check_provider(provider)
    except LookupError as e:
        return err(str(e), 404)
    body = request.get_json(force=True, silent=True) or {}
    client_id = (body.get("client_id") or "").strip()
    client_secret = (body.get("client_secret") or "").strip()
    if not client_id or not client_secret:
        return err("client_id and client_secret are required")
    db.set_oauth_credentials(provider, client_id, client_secret)
    return ok({"saved": True, "redirect_uri": _redirect_uri(provider)})


@oauth_bp.get("/<provider>/start")
def start(provider):
    try:
        _check_provider(provider)
    except LookupError as e:
        return err(str(e), 404)
    row = db.get_oauth(provider)
    if not row:
        return err("Save credentials first", 400)

    state = secrets.token_urlsafe(24)
    db.set_setting(f"_oauth_state_{provider}", state)
    meta = PROVIDERS[provider]

    if provider == "google":
        params = {
            "client_id": row["client_id"],
            "redirect_uri": _redirect_uri(provider),
            "response_type": "code",
            "scope": meta["scope"],
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
    elif provider == "anilist":
        # AniList has no scope/duration params — just the code request.
        params = {
            "client_id": row["client_id"],
            "redirect_uri": _redirect_uri(provider),
            "response_type": "code",
            "state": state,
        }
    else:
        params = {
            "client_id": row["client_id"],
            "redirect_uri": _redirect_uri(provider),
            "response_type": "code",
            "scope": meta["scope"],
            "duration": "permanent",
            "state": state,
        }
    from urllib.parse import urlencode
    return redirect(f"{meta['auth_url']}?{urlencode(params)}")


@oauth_bp.get("/<provider>/callback")
def callback(provider):
    try:
        _check_provider(provider)
    except LookupError as e:
        return err(str(e), 404)
    expected_state = db.get_setting(f"_oauth_state_{provider}")
    db.delete_setting(f"_oauth_state_{provider}")
    if not expected_state or request.args.get("state") != expected_state:
        return err("state mismatch — try connecting again", 400)
    if request.args.get("error"):
        return redirect(f"/settings?oauth_error={request.args['error']}")
    code = request.args.get("code")
    if not code:
        return err("missing code", 400)

    row = db.get_oauth(provider)
    meta = PROVIDERS[provider]
    try:
        if provider == "google":
            resp = httpc.post(meta["token_url"], data={
                "code": code,
                "client_id": row["client_id"],
                "client_secret": row["client_secret"],
                "redirect_uri": _redirect_uri(provider),
                "grant_type": "authorization_code",
            })
        elif provider == "anilist":
            # AniList wants JSON; returns a ~1-year access_token and no refresh_token.
            resp = httpc.post(meta["token_url"], json={
                "grant_type": "authorization_code",
                "client_id": row["client_id"],
                "client_secret": row["client_secret"],
                "redirect_uri": _redirect_uri(provider),
                "code": code,
            })
        else:
            resp = httpc.post(
                meta["token_url"],
                ua=config.REDDIT_UA,
                auth=(row["client_id"], row["client_secret"]),
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": _redirect_uri(provider),
                },
            )
        tok = resp.json()
        if "access_token" not in tok:
            return redirect("/settings?oauth_error=token_exchange_failed")
        expires_at = int(time.time()) + int(tok.get("expires_in", 3600))
        db.set_oauth_tokens(
            provider, tok["access_token"], tok.get("refresh_token"), expires_at,
            scopes=meta.get("scope"),
        )
    except Exception:
        return redirect("/settings?oauth_error=token_exchange_failed")
    return redirect(f"/settings?connected={provider}")


@oauth_bp.delete("/<provider>")
def disconnect(provider):
    try:
        _check_provider(provider)
    except LookupError as e:
        return err(str(e), 404)
    db.delete_oauth(provider)
    return ok({"disconnected": True})
