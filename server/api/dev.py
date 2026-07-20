"""The Workbench (No 09) — one endpoint per shelf so each loads independently.

The dossier is pure registry (instant); videos/podcasts/updates/release/repos
each do their own cached network work and fail independently.
"""

from flask import Blueprint

from ..sources import dev
from . import err, ok

dev_bp = Blueprint("dev", __name__, url_prefix="/api/dev")


@dev_bp.get("/languages")
def languages():
    return ok({"languages": dev.list_languages()})


@dev_bp.get("/<lang_id>")
def dossier(lang_id):
    data = dev.dossier(lang_id)
    if not data:
        return err(f"unknown language: {lang_id}", 404)
    return ok(data)


@dev_bp.get("/<lang_id>/release")
def release(lang_id):
    if not dev.get_language(lang_id):
        return err(f"unknown language: {lang_id}", 404)
    return ok(dev.release(lang_id))


@dev_bp.get("/<lang_id>/videos")
def videos(lang_id):
    if not dev.get_language(lang_id):
        return err(f"unknown language: {lang_id}", 404)
    return ok(dev.videos(lang_id))


@dev_bp.get("/<lang_id>/podcasts")
def podcasts(lang_id):
    if not dev.get_language(lang_id):
        return err(f"unknown language: {lang_id}", 404)
    return ok(dev.podcasts(lang_id))


@dev_bp.get("/<lang_id>/updates")
def updates(lang_id):
    if not dev.get_language(lang_id):
        return err(f"unknown language: {lang_id}", 404)
    return ok(dev.updates(lang_id))


@dev_bp.get("/<lang_id>/repos")
def repos(lang_id):
    if not dev.get_language(lang_id):
        return err(f"unknown language: {lang_id}", 404)
    return ok(dev.repos(lang_id))
