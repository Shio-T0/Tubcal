"""An install with only the terminal interface (install.sh --tui-only; the launcher
sets TUBCAL_WEB=0): the server serves a short page instead of the web app, says so in
/api/health, and an account linked from the terminal lands on that page."""

from pathlib import Path

from server import config

ROOT = Path(__file__).resolve().parents[1]


def test_the_web_interface_is_there_by_default(client):
    assert client.get("/api/health").get_json()["data"]["web"] is True


def test_without_the_web_interface_the_page_points_at_the_terminal(client, monkeypatch):
    monkeypatch.setattr(config, "WEB", False)
    health = client.get("/api/health").get_json()["data"]
    assert health["web"] is False
    for path in ("/", "/youtube", "/settings"):
        page = client.get(path)
        assert page.status_code == 200 and b"tubcal tui" in page.data and b'id="root"' not in page.data
    assert client.get("/api/nothing-here").status_code == 404   # the API is still the API


def test_an_account_linked_from_the_terminal_lands_here(client, monkeypatch):
    monkeypatch.setattr(config, "WEB", False)
    assert b"Anilist is connected" in client.get("/settings?connected=anilist").data
    page = client.get("/settings?oauth_error=<script>alert(1)</script>").data
    assert b"<script>alert" not in page and b"&lt;script&gt;" in page


def test_the_menu_entry_opens_a_terminal_without_the_web_interface():
    entry = (ROOT / "packaging/linux/tubcal.desktop").read_text()
    assert 'Exec="@BIN@/tubcal" @OPEN@' in entry and "Terminal=@TERMINAL@" in entry
    installer = (ROOT / "install.sh").read_text()
    assert "t=${t//@OPEN@/tui} t=${t//@TERMINAL@/true}" in installer
