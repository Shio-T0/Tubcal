"""Only this account's programs may talk to Tubcal.

Binding to 127.0.0.1 keeps other machines out and server/localguard.py keeps other
websites out, but every account on this computer can still open 127.0.0.1:5000,
and the Composing Room's terminal is a shell. So each connection is checked once,
when it's accepted: the kernel says which user owns the other end, and a connection
from anyone but this user (or root, who can read the database anyway) is answered
with a 403 before a byte of its request is read.

The question goes to the kernel over netlink (sock_diag, what `ss` uses): one exact
lookup of the client's socket, about 50 µs, and a kept-alive connection isn't asked
again. Where netlink can't answer, /proc/net/tcp is read instead; where neither
can (not Linux), nothing is checked. A client that is gone by the time it's asked
(reset right after sending, so its request would still be read) is refused.
`TUBCAL_PEER_CHECK=0` turns this off, for a proxy that runs as another user.

The phone doesn't use this: Android keeps apps away from netlink and /proc/net,
so there the API wants the app's access key instead (config.ACCESS_KEY).
"""

import errno
import ipaddress
import logging
import os
import socket
import struct

from werkzeug.serving import WSGIRequestHandler

from . import config

log = logging.getLogger("tubcal")

UNKNOWN = object()  # the kernel couldn't be asked

_NETLINK_SOCK_DIAG = 4
_SOCK_DIAG_BY_FAMILY = 20
_NLMSG_ERROR = 2
_NLM_F_REQUEST = 1
_NO_COOKIE = 0xFFFFFFFF
_warned = False


def _packed(family, ip):
    raw = socket.inet_pton(family, ip)
    return raw + bytes(16 - len(raw))


def _ask_netlink(family, client, server):
    """The uid owning the socket whose local end is `client` and remote end is
    `server`, None if there's no such socket, UNKNOWN if netlink can't say."""
    try:
        nl = socket.socket(socket.AF_NETLINK, socket.SOCK_DGRAM, _NETLINK_SOCK_DIAG)
    except (OSError, AttributeError):
        return UNKNOWN
    try:
        nl.settimeout(1)
        sockid = (struct.pack(">HH", client[1], server[1]) + _packed(family, client[0])
                  + _packed(family, server[0]) + struct.pack("=III", 0, _NO_COOKIE, _NO_COOKIE))
        req = struct.pack("=BBBBI", family, socket.IPPROTO_TCP, 0, 0, 0xFFFFFFFF) + sockid
        nl.send(struct.pack("=IHHII", 16 + len(req), _SOCK_DIAG_BY_FAMILY, _NLM_F_REQUEST, 1, 0) + req)
        reply = nl.recv(8192)
    except OSError:
        return UNKNOWN
    finally:
        nl.close()
    if len(reply) < 20:
        return UNKNOWN
    kind = struct.unpack_from("=H", reply, 4)[0]
    if kind == _NLMSG_ERROR:
        code = -struct.unpack_from("=i", reply, 16)[0]
        return None if code == errno.ENOENT else UNKNOWN
    if kind != _SOCK_DIAG_BY_FAMILY or len(reply) < 16 + 68:
        return UNKNOWN
    return struct.unpack_from("=I", reply, 16 + 64)[0]  # inet_diag_msg.idiag_uid


def _hex_addr(family, ip, port):
    """An address as /proc/net/tcp{,6} writes it: the 32-bit words in host order."""
    raw = socket.inet_pton(family, ip)
    words = struct.unpack(f"={len(raw) // 4}I", raw)
    return "".join(f"{w:08X}" for w in words) + f":{port:04X}"


def _ask_proc(family, client, server):
    name = "/proc/net/tcp6" if family == socket.AF_INET6 else "/proc/net/tcp"
    want = (_hex_addr(family, *client), _hex_addr(family, *server))
    try:
        with open(name) as f:
            next(f, None)
            for line in f:
                cols = line.split()
                if len(cols) > 7 and (cols[1], cols[2]) == want:
                    return int(cols[7])
    except (OSError, ValueError):
        return UNKNOWN
    return None


def owner(sock):
    """Which user owns the other end of an accepted TCP connection on this machine:
    a uid, None (no such socket any more), or UNKNOWN."""
    try:
        server, client = sock.getsockname()[:2], sock.getpeername()[:2]
    except OSError:
        return None  # reset already
    family = sock.family
    uid = _ask_netlink(family, client, server)
    if uid is UNKNOWN:
        uid = _ask_proc(family, client, server)
    return uid


def allowed(sock):
    """Whether this connection may be served (see the module's docstring)."""
    global _warned
    if not config.PEER_CHECK:
        return True
    try:
        ip = ipaddress.ip_address(sock.getpeername()[0])
    except (OSError, ValueError):
        return False
    if not ip.is_loopback and not (ip.version == 6 and ip.ipv4_mapped and ip.ipv4_mapped.is_loopback):
        return True  # another machine; binding to 127.0.0.1 is what keeps those out
    uid = owner(sock)
    if uid is UNKNOWN:
        if not _warned:
            _warned = True
            log.warning("can't tell which user a connection comes from here; not checking")
        return True
    if uid in (os.getuid(), 0):
        return True
    log.warning("refused a connection from another account (uid %s)", "?" if uid is None else uid)
    return False


_REFUSED = (b"HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\n"
            b"Connection: close\r\nContent-Length: 51\r\n\r\n"
            b"Tubcal answers only the account that's running it.\n")


class OwnUserOnly(WSGIRequestHandler):
    """Werkzeug's request handler, for connections from this user's programs only."""

    def handle(self):
        if allowed(self.connection):
            return super().handle()
        try:
            self.connection.sendall(_REFUSED)
        except OSError:
            pass
