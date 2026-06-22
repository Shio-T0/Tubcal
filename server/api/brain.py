"""HTTP surface for the Archive (local second brain)."""

from flask import Blueprint, request

from .. import db
from ..brain import llm, summarize, search, transcribe
from . import err, ok

brain_bp = Blueprint("brain", __name__, url_prefix="/api/brain")


@brain_bp.get("/status")
def status():
    """What's available right now — drives graceful degradation in the UI."""
    embed_model = db.get_setting("brain_embed_model", "nomic-embed-text")
    llm_model = db.get_setting("brain_llm_model", "llama3.1:8b")
    ollama_up = llm.available()
    installed = llm.models() if ollama_up else []
    return ok({
        "enabled": db.get_setting("brain_enabled", True),
        "auto_index": db.get_setting("brain_auto_index", False),
        "whisper": transcribe.whisper_available(),
        "whisper_model": db.get_setting("brain_whisper_model", "base"),
        "ollama": ollama_up,
        "models": installed,
        "embed_model": embed_model,
        "llm_model": llm_model,
        "embed_ready": ollama_up and llm.has_model(embed_model),
        "llm_ready": ollama_up and llm.has_model(llm_model),
        "queue": db.brain_counts(),
    })


@brain_bp.get("/docs")
def docs():
    return ok({"items": db.brain_list(request.args.get("status"))})


@brain_bp.get("/doc/<path:item_id>")
def doc(item_id):
    d = db.brain_get(item_id, with_chunks=True)
    if not d:
        return err("not in the archive", 404)
    return ok(d)


@brain_bp.post("/index")
def index():
    body = request.get_json(force=True, silent=True) or {}
    item = body.get("item") or {}
    if not item.get("id"):
        return err("item with id required")
    doc = db.brain_enqueue(item)
    return ok({"doc": doc})


@brain_bp.delete("/doc/<path:item_id>")
def remove(item_id):
    return ok({"removed": db.brain_delete(item_id)})


@brain_bp.post("/summarize/<path:item_id>")
def summarize_doc(item_id):
    llm_model = db.get_setting("brain_llm_model", "llama3.1:8b")
    if not (llm.available() and llm.has_model(llm_model)):
        return err("local LLM unavailable", 503)
    try:
        return ok({"summary": summarize.summary(item_id, llm_model)})
    except Exception as e:
        return err(f"summary failed: {e}", 502)


@brain_bp.get("/search")
def do_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return err("q required")
    embed_model = db.get_setting("brain_embed_model", "nomic-embed-text")
    # Prefer semantic search; fall back to keyword scan when embeddings are off.
    if llm.available() and llm.has_model(embed_model):
        try:
            return ok({"results": search.semantic_search(q, embed_model), "mode": "semantic"})
        except Exception:
            pass
    rows = db.brain_keyword_search(q)
    results = [{
        "item_id": r["item_id"], "t_start": r["t_start"], "t_end": r["t_end"],
        "snippet": r["text"], "title": r["title"], "source_name": r["source_name"],
        "thumbnail": r["thumbnail"], "score": None,
    } for r in rows]
    return ok({"results": results, "mode": "keyword"})


@brain_bp.post("/ask")
def ask():
    body = request.get_json(force=True, silent=True) or {}
    question = (body.get("question") or "").strip()
    if not question:
        return err("question required")
    embed_model = db.get_setting("brain_embed_model", "nomic-embed-text")
    llm_model = db.get_setting("brain_llm_model", "llama3.1:8b")
    if not (llm.available() and llm.has_model(embed_model) and llm.has_model(llm_model)):
        return err("local models unavailable", 503)
    try:
        return ok(summarize.ask(question, embed_model, llm_model))
    except Exception as e:
        return err(f"ask failed: {e}", 502)


@brain_bp.get("/digest")
def digest():
    llm_model = db.get_setting("brain_llm_model", "llama3.1:8b")
    if not (llm.available() and llm.has_model(llm_model)):
        return err("local LLM unavailable", 503)
    try:
        return ok(summarize.digest(request.args.get("range", "day"), llm_model))
    except Exception as e:
        return err(f"digest failed: {e}", 502)
