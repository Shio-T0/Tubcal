"""The Archive's ask prompt: excerpts must carry their provenance.

The retrieval itself needs Ollama, so these tests drive the pure prompt-building
half directly and monkeypatch the two things that reach outside (the embedder
and the chat call).
"""

import pytest

from server import db
from server.brain import summarize


@pytest.fixture
def archive(client):
    """A tiny archive: one video, two embedded chunks, one watch record."""
    doc = db.brain_enqueue({
        "id": "yt:abc123",
        "title": "How Rust Handles Memory",
        "source": "Ferris Talks",
        "url": "https://www.youtube.com/watch?v=abc123",
        "extra": {"video_id": "abc123", "channel_id": "UC_ferris"},
    })
    db.brain_save_transcript("yt:abc123", "en", "ownership and borrowing", 2822.0)
    chunks = [
        {"idx": i, "t_start": i * 45.0, "t_end": i * 45.0 + 45.0,
         "text": f"chunk {i}", "embedding": b"x"}
        for i in range(20)
    ]
    chunks[16]["t_start"], chunks[16]["t_end"] = 754.0, 799.0
    chunks[16]["text"] = "the borrow checker rejects two mutable aliases"
    db.brain_save_chunks(doc["id"], "yt:abc123", chunks)
    db.brain_set_summary("yt:abc123", "A tour of ownership.\n\n- moves\n- borrows")
    db.brain_mark_ready("yt:abc123")
    db.add_history("youtube", "yt:abc123", "How Rust Handles Memory", "UC_ferris",
                   "Ferris Talks", None, "https://youtu.be/abc123")
    return doc


def _hit(**over):
    base = {
        "item_id": "yt:abc123", "idx": 16, "t_start": 754.0, "t_end": 799.0,
        "snippet": "the borrow checker rejects two mutable aliases",
        "title": "How Rust Handles Memory", "source_name": "Ferris Talks",
        "thumbnail": None, "score": 0.8123,
    }
    base.update(over)
    return base


def test_context_lookup_joins_doc_and_watch_state(archive):
    ctx = db.brain_context(["yt:abc123", "yt:missing"])
    meta = ctx["yt:abc123"]
    assert "yt:missing" not in ctx
    assert meta["source_name"] == "Ferris Talks"
    assert meta["duration"] == 2822.0
    assert meta["lang"] == "en"
    assert meta["chunk_count"] == 20
    assert meta["watched_at"] and meta["watch_count"] == 1
    assert meta["summary"].startswith("A tour of ownership")


def test_context_lookup_is_empty_for_no_ids(client):
    assert db.brain_context([]) == {}
    assert db.brain_context(None) == {}


def test_excerpt_carries_channel_and_position(archive):
    meta = db.brain_context(["yt:abc123"])["yt:abc123"]
    block = summarize._excerpt(1, _hit(), meta, first_of_video=True)
    head, facts, about, text = block.split("\n")

    assert head == "[1] How Rust Handles Memory — Ferris Talks"
    assert "12:34–13:19 of 47:02" in facts   # past an hour would read h:mm:ss
    assert "part 17/20" in facts
    assert "lang en" in facts and "relevance 0.81" in facts
    assert about.strip().startswith("Whole video: A tour of ownership.")
    assert "\n" not in about.strip()          # summary flattened to one line
    assert text == "the borrow checker rejects two mutable aliases"


def test_video_summary_only_on_first_excerpt_of_a_video(archive):
    meta = db.brain_context(["yt:abc123"])["yt:abc123"]
    second = summarize._excerpt(2, _hit(idx=0), meta, first_of_video=False)
    assert "Whole video:" not in second


def test_excerpt_survives_missing_metadata():
    """A doc row that's gone (or never had a duration) must not break the prompt."""
    block = summarize._excerpt(1, _hit(t_end=None, score=None), {}, first_of_video=True)
    assert block.startswith("[1] How Rust Handles Memory — Ferris Talks")
    assert "of 0:00" not in block             # unknown duration is omitted, not zeroed
    assert "relevance" not in block


@pytest.fixture
def two_hits():
    return [_hit(), _hit(idx=5, t_start=225.0, t_end=270.0,
                         snippet="chunk 5", score=0.42)]


def _chat_spy(monkeypatch, select_reply='{"expand": [1]}', answer="Because [1]."):
    """Record every llm.chat call; reply as the selector then as the answerer."""
    calls = []

    def fake_chat(system, prompt, model, **kw):
        calls.append({"system": system, "prompt": prompt, **kw})
        return select_reply if system is summarize._SELECT_SYSTEM else answer

    monkeypatch.setattr(summarize.llm, "chat", fake_chat)
    return calls


def test_ask_prompt_includes_provenance(archive, two_hits, monkeypatch):
    monkeypatch.setattr(summarize.search, "semantic_search", lambda q, m, k=8: two_hits)
    monkeypatch.setattr(summarize.config, "BRAIN_ASK_EXPAND", 0)  # zoom pass off
    calls = _chat_spy(monkeypatch)

    out = summarize.ask("why can't I alias mutably?", "embed", "chat")
    assert out["answer"] == "Because [1]."
    assert [c["n"] for c in out["citations"]] == [1, 2]
    assert out["citations"][0]["source_name"] == "Ferris Talks"
    assert len(calls) == 1                      # no zoom pass, one call

    prompt = calls[0]["prompt"]
    assert "from 1 video(s)" in prompt          # both hits share a video
    assert prompt.count("Ferris Talks") == 2    # channel on every excerpt
    assert prompt.count("Whole video:") == 1    # ...but the TL;DR only once
    assert "why can't I alias mutably?" in prompt


def test_zoom_pass_expands_the_chosen_excerpt(archive, two_hits, monkeypatch):
    monkeypatch.setattr(summarize.search, "semantic_search", lambda q, m, k=8: two_hits)
    calls = _chat_spy(monkeypatch, select_reply='{"expand": [1]}')

    out = summarize.ask("why can't I alias mutably?", "embed", "chat")
    assert out["expanded"] == [1]
    assert len(calls) == 2

    select, answer = calls
    assert select["fmt"] == "json" and select["temperature"] == 0
    assert "chunk 14" not in select["prompt"]   # selector sees only the keyholes

    # Excerpt 1 now carries idx 14–18; excerpt 2 is untouched.
    assert "chunk 14 chunk 15 the borrow checker" in answer["prompt"]
    assert "expanded to 5 consecutive parts" in answer["prompt"]
    assert "10:30–14:15" in answer["prompt"]    # span widened to the window
    assert answer["prompt"].count("expanded to") == 1


def test_zoom_pass_never_sends_the_same_chunk_twice(archive, monkeypatch):
    """Adjacent hits: expanding both must not duplicate the overlap."""
    hits = [_hit(idx=8, t_start=360.0, t_end=405.0, snippet="chunk 8"),
            _hit(idx=10, t_start=450.0, t_end=495.0, snippet="chunk 10", score=0.7)]
    monkeypatch.setattr(summarize.search, "semantic_search", lambda q, m, k=8: hits)
    calls = _chat_spy(monkeypatch, select_reply='{"expand": [1, 2]}')

    summarize.ask("q", "embed", "chat")
    prompt = calls[1]["prompt"]
    for i in range(6, 13):
        assert prompt.count(f"chunk {i} ") + prompt.count(f"chunk {i}\n") <= 1, i


def test_zoom_pass_falls_back_when_the_model_returns_junk(archive, two_hits, monkeypatch):
    monkeypatch.setattr(summarize.search, "semantic_search", lambda q, m, k=8: two_hits)
    _chat_spy(monkeypatch, select_reply="I think excerpt one, probably?")

    out = summarize.ask("q", "embed", "chat")
    assert out["expanded"] == [1, 2]  # falls back to the top-scoring excerpts


@pytest.mark.parametrize("reply", [
    '{"expand": []}', '{"expand": [99, -1, 0]}', '{"expand": "1"}',
    '{"expand": [true]}', '{}', 'null',
])
def test_zoom_pass_rejects_out_of_range_and_wrong_typed_picks(
        archive, two_hits, monkeypatch, reply):
    monkeypatch.setattr(summarize.search, "semantic_search", lambda q, m, k=8: two_hits)
    _chat_spy(monkeypatch, select_reply=reply)
    assert summarize.ask("q", "embed", "chat")["expanded"] == [1, 2]


def test_zoom_pass_survives_an_unreachable_selector(archive, two_hits, monkeypatch):
    """The selector call failing must not take the answer down with it."""
    import requests

    monkeypatch.setattr(summarize.search, "semantic_search", lambda q, m, k=8: two_hits)

    def fake_chat(system, prompt, model, **kw):
        if system is summarize._SELECT_SYSTEM:
            raise requests.ConnectionError("ollama went away")
        return "Answer [1]."

    monkeypatch.setattr(summarize.llm, "chat", fake_chat)
    out = summarize.ask("q", "embed", "chat")
    assert out["answer"] == "Answer [1]." and out["expanded"] == [1, 2]


def test_single_hit_skips_the_zoom_pass(archive, monkeypatch):
    monkeypatch.setattr(summarize.search, "semantic_search", lambda q, m, k=8: [_hit()])
    calls = _chat_spy(monkeypatch)
    out = summarize.ask("q", "embed", "chat")
    assert len(calls) == 1 and out["expanded"] == []
