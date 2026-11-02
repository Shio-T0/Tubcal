"""Only the account running Tubcal gets an answer (server/peers.py): every account
on the computer can open 127.0.0.1, and the Composing Room's terminal is a shell."""

import http.client
import os
import socket
import struct
import sys
import threading

import pytest

from server import config, peers

pytestmark = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="asks the Linux kernel")


@pytest.fixture
def server(monkeypatch):
    from werkzeug.serving import make_server

    monkeypatch.setattr(config, "PEER_CHECK", True)

    def app(environ, start):
        start("200 OK", [("Content-Type", "text/plain")])
        return [b"ok"]

    srv = make_server("127.0.0.1", 0, app, threaded=True, request_handler=peers.OwnUserOnly)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_port
    srv.shutdown()


def _get(port):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request("GET", "/")
    r = c.getresponse()
    return r.status, r.read()


def test_this_users_programs_are_answered(server):
    assert _get(server) == (200, b"ok")


def test_another_account_is_refused(server, monkeypatch):
    me = os.getuid()
    monkeypatch.setattr(peers.os, "getuid", lambda: me + 1)  # as if Tubcal ran as someone else
    status, body = _get(server)
    assert status == 403 and b"account" in body


def test_both_ways_of_asking_agree():
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen()
    client = socket.create_connection(srv.getsockname())
    conn, _ = srv.accept()
    try:
        here, there = conn.getsockname(), conn.getpeername()
        assert peers._ask_proc(socket.AF_INET, there, here) == os.getuid()
        nl = peers._ask_netlink(socket.AF_INET, there, here)
        assert nl is peers.UNKNOWN or nl == os.getuid()
        assert peers.owner(conn) == os.getuid()
    finally:
        client.close(), conn.close(), srv.close()


def test_a_client_that_reset_after_sending_is_refused(monkeypatch):
    # Its request would still be read from the buffer; there's no one left to vouch for.
    monkeypatch.setattr(config, "PEER_CHECK", True)
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen()
    client = socket.create_connection(srv.getsockname())
    client.sendall(b"POST /api/editor/file HTTP/1.1\r\n\r\n")
    client.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
    client.close()
    conn, _ = srv.accept()
    try:
        assert peers.allowed(conn) is False
    finally:
        conn.close(), srv.close()


def test_it_can_be_turned_off(monkeypatch):
    monkeypatch.setattr(config, "PEER_CHECK", False)
    assert peers.allowed(object()) is True
