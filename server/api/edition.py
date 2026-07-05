"""The Edition API. Read paths are one SQLite row each — the paper is
pre-built by the background thread in server/brain/edition.py; nothing here
computes anything."""

import re

from flask import Blueprint

from . import err, ok
from .. import db
from ..brain import edition as builder

edition_bp = Blueprint("edition", __name__, url_prefix="/api")

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@edition_bp.get("/edition/latest")
def edition_latest():
    payload = db.edition_latest()
    if payload is None:
        return err("no edition yet", 404)
    return ok(payload)


@edition_bp.get("/edition/archive")
def edition_archive():
    return ok({"editions": db.edition_list()})


@edition_bp.get("/edition/status")
def edition_status():
    return ok(builder.status())


@edition_bp.post("/edition/rebuild")
def edition_rebuild():
    builder.rebuild_async()  # no-op if a build is already holding the lock
    return ok({"building": True})


@edition_bp.get("/edition/<date>")
def edition_by_date(date):
    if not _DATE_RE.match(date):
        return err("date must be YYYY-MM-DD")
    payload = db.edition_get(date)
    if payload is None:
        return err("no edition for that date", 404)
    return ok(payload)
