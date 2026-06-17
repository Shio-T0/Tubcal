import pytest

from server import config


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Point the app at a throwaway DB so tests never touch real data.
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    from server import create_app, db

    db.init_db()
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()
