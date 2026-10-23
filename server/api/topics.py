"""By topic's API (modules.ini: topics, which needs the Wire): the front page
sorted by the local AI (sources/hn_topics.py). Reading never starts work; the
page asks for a sort when the last one has gone stale."""

from flask import Blueprint

from . import err, ok
from ..sources import hn_topics

topics_bp = Blueprint("topics", __name__, url_prefix="/api")


@topics_bp.get("/hackernews/topics")
def topics_status():
    return ok(hn_topics.status())


@topics_bp.post("/hackernews/topics/sort")
def topics_sort():
    _model, problem = hn_topics.readiness()
    if problem:
        return err(problem, 503)
    return ok({"started": hn_topics.start()})
