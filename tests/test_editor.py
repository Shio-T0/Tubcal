"""The Composing Room's filesystem API — containment above all."""

import os

import pytest

from server import config


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    """A throwaway editor root with a few files in it."""
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "hello.py").write_text("print('hi')\n")
    (root / "sub").mkdir()
    (root / "sub" / "notes.md").write_text("# notes\n")
    (root / "blob.bin").write_bytes(b"\x00\x01\x02")
    monkeypatch.setattr(config, "EDITOR_ROOT", root.resolve())
    return root


# ---------------------------------------------------------------- containment

@pytest.mark.parametrize("evil", [
    "../../etc/passwd",
    "/etc/passwd",
    "sub/../../outside",
    "..",
])
def test_path_escapes_rejected(client, workspace, evil):
    r = client.get(f"/api/editor/file?path={evil}")
    assert r.status_code == 400
    assert "escapes" in r.get_json()["error"]


def test_symlink_escape_rejected(client, workspace, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret")
    os.symlink(outside, workspace / "evil")
    r = client.get("/api/editor/tree?path=evil")
    assert r.status_code == 400
    r = client.get("/api/editor/file?path=evil/secret.txt")
    assert r.status_code == 400


def test_write_and_delete_contained(client, workspace):
    r = client.post("/api/editor/file", json={"path": "../pwned.txt", "content": "x"})
    assert r.status_code == 400
    r = client.post("/api/editor/delete", json={"path": "../../something"})
    assert r.status_code == 400
    r = client.post("/api/editor/delete", json={"path": ""})
    assert r.status_code == 400  # never the root itself


# ---------------------------------------------------------------- tree / read

def test_tree_lists_dirs_first(client, workspace):
    r = client.get("/api/editor/tree")
    assert r.status_code == 200
    entries = r.get_json()["data"]["entries"]
    names = [e["name"] for e in entries]
    assert names[0] == "sub"  # dirs sort before files
    assert "hello.py" in names


def test_read_file(client, workspace):
    r = client.get("/api/editor/file?path=hello.py")
    d = r.get_json()["data"]
    assert d["content"] == "print('hi')\n"
    assert d["mtime"] > 0


def test_read_binary_rejected(client, workspace):
    r = client.get("/api/editor/file?path=blob.bin")
    assert r.status_code == 415


def test_read_missing_404(client, workspace):
    assert client.get("/api/editor/file?path=nope.txt").status_code == 404


# ---------------------------------------------------------------- write

def test_write_roundtrip_and_conflict(client, workspace):
    r = client.post("/api/editor/file", json={"path": "new.txt", "content": "abc"})
    assert r.status_code == 200
    mtime = r.get_json()["data"]["mtime"]

    # stale mtime -> 409, buffer never clobbers outside edits
    r = client.post("/api/editor/file", json={"path": "new.txt", "content": "xyz", "mtime": mtime - 100})
    assert r.status_code == 409
    assert (workspace / "new.txt").read_text() == "abc"

    # matching mtime -> accepted; force (no mtime) -> accepted
    r = client.post("/api/editor/file", json={"path": "new.txt", "content": "xyz", "mtime": mtime})
    assert r.status_code == 200
    r = client.post("/api/editor/file", json={"path": "new.txt", "content": "forced"})
    assert r.status_code == 200
    assert (workspace / "new.txt").read_text() == "forced"


def test_mkdir_rename_delete(client, workspace):
    assert client.post("/api/editor/mkdir", json={"path": "a/b"}).status_code == 200
    assert (workspace / "a" / "b").is_dir()
    r = client.post("/api/editor/rename", json={"path": "hello.py", "to": "hola.py"})
    assert r.status_code == 200
    assert (workspace / "hola.py").is_file()
    # renaming over an existing target refuses
    (workspace / "other.txt").write_text("x")
    r = client.post("/api/editor/rename", json={"path": "hola.py", "to": "other.txt"})
    assert r.status_code == 409
    assert client.post("/api/editor/delete", json={"path": "other.txt"}).status_code == 200
    assert not (workspace / "other.txt").exists()


# ---------------------------------------------------------------- search / files

def test_search_finds_hits(client, workspace):
    r = client.get("/api/editor/search?q=print")
    d = r.get_json()["data"]
    assert any(h["path"] == "hello.py" and h["line"] == 1 for h in d["hits"])


def test_search_short_query_rejected(client, workspace):
    assert client.get("/api/editor/search?q=p").status_code == 400


def test_files_flat_listing_skips_junk(client, workspace):
    (workspace / "node_modules").mkdir()
    (workspace / "node_modules" / "junk.js").write_text("x")
    r = client.get("/api/editor/files")
    files = r.get_json()["data"]["files"]
    assert "hello.py" in files and "sub/notes.md" in files
    assert not any(f.startswith("node_modules") for f in files)


# ---------------------------------------------------------------- state

def test_session_state_roundtrip(client, workspace):
    ses = {"panes": [{"tabs": ["hello.py"], "active": "hello.py"}]}
    r = client.post("/api/editor/state", json={"session": ses})
    assert r.status_code == 200
    r = client.get("/api/editor/state")
    assert r.get_json()["data"]["session"] == ses


# ---------------------------------------------------------------- status

def test_status_reports_capabilities(client, workspace):
    d = client.get("/api/editor/status").get_json()["data"]
    assert d["root_exists"] is True
    assert set(d["lsp"]) >= {"python", "typescript", "rust"}
