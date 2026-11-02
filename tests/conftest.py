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


@pytest.fixture(autouse=True)
def _tui_spacing_back_to_comfy():
    """The terminal's spacing is module state (`tui.ui.paint.LOOK`), set by each app it
    makes: a test that asks for compact doesn't leave it compact for the next one."""
    yield
    try:
        from tui.ui import paint
    except ImportError:
        return
    paint.LOOK["comfy"] = True
