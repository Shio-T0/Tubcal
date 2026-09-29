"""Thin HTTP client for a local Ollama server (embeddings + chat).

Everything stays on 127.0.0.1 — no SDK, just `requests` (already a dependency).
Every call degrades gracefully: if Ollama isn't running or the model isn't
pulled, callers get a clear RuntimeError and the UI shows a calm "offline" card.
"""

import requests

from .. import config

_TIMEOUT_FAST = 5
_TIMEOUT_EMBED = 120
_TIMEOUT_CHAT = 300


def available():
    """True if an Ollama server answers on the configured URL."""
    try:
        requests.get(f"{config.OLLAMA_URL}/api/tags", timeout=_TIMEOUT_FAST)
        return True
    except requests.RequestException:
        return False


def models():
    """Names of locally-pulled Ollama models (e.g. ['qwen3.5:9b', ...])."""
    try:
        r = requests.get(f"{config.OLLAMA_URL}/api/tags", timeout=_TIMEOUT_FAST)
        r.raise_for_status()
        return [m["name"] for m in r.json().get("models", [])]
    except requests.RequestException:
        return []


def has_model(name):
    """Whether `name` (or `name:latest`) is pulled. Tolerant of the :latest tag."""
    if not name:
        return False
    have = models()
    return name in have or f"{name}:latest" in have or any(
        m.split(":")[0] == name.split(":")[0] for m in have
    )


def embed(texts, model):
    """Embed a list of strings → list of float vectors. Batched via /api/embed,
    falling back to the older per-prompt /api/embeddings endpoint."""
    if not texts:
        return []
    try:
        r = requests.post(
            f"{config.OLLAMA_URL}/api/embed",
            json={"model": model, "input": texts},
            timeout=_TIMEOUT_EMBED,
        )
        if r.ok:
            data = r.json()
            vecs = data.get("embeddings")
            if vecs:
                return vecs
    except requests.RequestException:
        pass
    # Fallback: one request per text (older Ollama).
    out = []
    for t in texts:
        r = requests.post(
            f"{config.OLLAMA_URL}/api/embeddings",
            json={"model": model, "prompt": t},
            timeout=_TIMEOUT_EMBED,
        )
        r.raise_for_status()
        out.append(r.json()["embedding"])
    return out


def chat(system, prompt, model, temperature=0.2, fmt=None):
    """Single-shot chat completion → the assistant's text. `fmt="json"` asks
    Ollama to constrain the output to valid JSON (used by The Edition)."""
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        # qwen3.5 and other reasoning models emit their preamble into
        # message.thinking and leave message.content empty; The Edition and
        # ask() stage 1 both need clean JSON, so keep thinking off.
        "think": False,
        "options": {"temperature": temperature},
    }
    if fmt:
        body["format"] = fmt
    r = requests.post(
        f"{config.OLLAMA_URL}/api/chat",
        json=body,
        timeout=_TIMEOUT_CHAT,
    )
    r.raise_for_status()
    return (r.json().get("message") or {}).get("content", "").strip()
