"""Unit tests for the fMP4 sidx → HLS byte-range playlist builder."""

import struct

import pytest

from server.sources import fmp4


def _box(typ, payload):
    return struct.pack(">I", len(payload) + 8) + typ + payload


def _make_head(segments, *, timescale=1000, first_offset=0, version=0):
    """Assemble a minimal ftyp+moov+sidx prefix. `segments` is [(size, dur_ticks)]."""
    ftyp = _box(b"ftyp", b"isom" + b"\x00\x00\x00\x00" + b"isom")
    moov = _box(b"moov", b"\x00" * 40)
    body = b"\x00\x00\x00\x00"  # version 0 + flags
    body += struct.pack(">II", 1, timescale)  # reference_ID, timescale
    body += struct.pack(">II", 0, first_offset)  # earliest_pts, first_offset
    body += struct.pack(">HH", 0, len(segments))  # reserved, reference_count
    for size, dur in segments:
        body += struct.pack(">III", size & 0x7FFFFFFF, dur, 0)
    sidx = _box(b"sidx", body)
    return ftyp + moov + sidx, len(ftyp) + len(moov), len(sidx)


def test_parse_sidx_basic():
    head, sidx_off, sidx_size = _make_head([(1000, 6000), (2000, 6000), (1500, 3000)])
    init_end, segs = fmp4.parse_sidx(head)
    assert init_end == sidx_off + sidx_size  # first_offset == 0
    assert segs == [(1000, 6.0), (2000, 6.0), (1500, 3.0)]


def test_parse_sidx_first_offset():
    head, sidx_off, sidx_size = _make_head([(500, 1000)], first_offset=128)
    init_end, segs = fmp4.parse_sidx(head)
    assert init_end == sidx_off + sidx_size + 128
    assert segs == [(500, 1.0)]


def test_parse_sidx_truncated_head_ok():
    """A head cut off inside a later box must not raise — just parse what's there."""
    head, _, _ = _make_head([(10, 1000)])
    # Append a box claiming a huge size but with no body (simulates truncation).
    head += struct.pack(">I", 999999) + b"mdat"
    init_end, segs = fmp4.parse_sidx(head)
    assert segs == [(10, 1.0)]


def test_parse_sidx_missing_raises():
    with pytest.raises(ValueError):
        fmp4.parse_sidx(_box(b"ftyp", b"isom"))


def test_media_playlist_byteranges_are_contiguous():
    init_end, segs = 100, [(1000, 6.0), (2000, 4.0)]
    pl = fmp4.media_playlist("/api/seg?u=tok", init_end, segs)
    assert "#EXT-X-MAP:URI=\"/api/seg?u=tok\",BYTERANGE=\"100@0\"" in pl
    assert "#EXT-X-BYTERANGE:1000@100" in pl
    assert "#EXT-X-BYTERANGE:2000@1100" in pl  # 100 + 1000
    assert pl.rstrip().endswith("#EXT-X-ENDLIST")
    assert "#EXT-X-TARGETDURATION:6" in pl  # ceil(max dur)


def test_master_playlist_pairs_audio_group():
    pl = fmp4.master_playlist(
        "/v.m3u8", "/a.m3u8",
        vcodec="avc1.640028", acodec="mp4a.40.2",
        width=1920, height=1080, bandwidth=2500000,
    )
    assert 'TYPE=AUDIO,GROUP-ID="aud"' in pl
    assert 'URI="/a.m3u8"' in pl
    assert 'CODECS="avc1.640028,mp4a.40.2"' in pl
    assert "RESOLUTION=1920x1080" in pl
    assert 'AUDIO="aud"' in pl
    assert pl.rstrip().endswith("/v.m3u8")
