"""Turn a fragmented-MP4 segment index (`sidx`) into a byte-range HLS playlist.

YouTube now serves its higher-quality renditions *only* as adaptive DASH: a
video-only and an audio-only fragmented-MP4 file, each carrying an `sidx` box that
indexes the media fragments by byte size and duration. The default player clients
expose one muxed rendition at most (progressive 360p), so anything better has to
come from these adaptive files.

Rather than mux them server-side with ffmpeg, we parse the `sidx` and emit a
byte-range HLS media playlist per rendition (`#EXT-X-MAP` init + `#EXT-X-BYTERANGE`
segments, all addressing the same googlevideo URL). Paired in a master playlist —
one video variant + the original audio as an alternate rendition group — hls.js
muxes video and audio in the browser with native seeking, fetching straight from
googlevideo through our segment proxy. Playback stays fully local: no account, no
third-party front-end, nothing muxed on the server.

These functions are pure (bytes/values in, strings out) so they can be unit
tested without touching the network — see tests/test_fmp4.py.
"""

import math
import struct


def _iter_boxes(buf, end):
    """Yield (type, offset, size, header_len) for each top-level ISO-BMFF box in
    buf[0:end]. Stops cleanly if a box claims to extend past the buffer (the head
    is deliberately truncated), so a short read never raises."""
    i = 0
    while i + 8 <= end:
        size = struct.unpack(">I", buf[i:i + 4])[0]
        typ = buf[i + 4:i + 8]
        header = 8
        if size == 1:  # 64-bit largesize
            if i + 16 > end:
                return
            size = struct.unpack(">Q", buf[i + 8:i + 16])[0]
            header = 16
        elif size == 0:  # extends to end of file
            size = end - i
        if size < header or i + size > end:
            return
        yield typ, i, size, header
        i += size


def parse_sidx(head):
    """Parse the first `sidx` box in the head of an fMP4 file.

    `head` must contain at least ftyp + moov + sidx (a 256 KiB prefix is plenty —
    these DASH files carry a tiny fragmented-mode moov). Returns
    ``(init_end, [(byte_size, duration_seconds), ...])`` where the init segment is
    bytes ``[0, init_end)`` and each media fragment follows contiguously in file
    order. Raises ValueError if no usable sidx is found.
    """
    for typ, off, size, header in _iter_boxes(head, len(head)):
        if typ != b"sidx":
            continue
        p = off + header
        version = head[p]
        p += 4  # version(1) + flags(3)
        _ref_id, timescale = struct.unpack(">II", head[p:p + 8])
        p += 8
        if not timescale:
            raise ValueError("sidx has zero timescale")
        if version == 0:
            _earliest, first_offset = struct.unpack(">II", head[p:p + 8])
            p += 8
        else:
            _earliest, first_offset = struct.unpack(">QQ", head[p:p + 16])
            p += 16
        p += 2  # reserved(2)
        count = struct.unpack(">H", head[p:p + 2])[0]
        p += 2
        segs = []
        for _ in range(count):
            ref, subseg_dur, _sap = struct.unpack(">III", head[p:p + 12])
            p += 12
            if ref >> 31:
                # A reference to another sidx (hierarchical index). YouTube uses a
                # single flat sidx, so bail rather than guess.
                raise ValueError("hierarchical sidx not supported")
            segs.append((ref & 0x7FFFFFFF, subseg_dur / timescale))
        if not segs:
            raise ValueError("empty sidx")
        # The first fragment begins first_offset bytes after the sidx box ends.
        init_end = off + size + first_offset
        return init_end, segs
    raise ValueError("no sidx box found")


def media_playlist(seg_uri, init_end, segments):
    """A VOD HLS media playlist over one fMP4 rendition. Every segment (and the
    init map) addresses the same `seg_uri` via a byte range, so hls.js pulls each
    fragment with a ranged request. `segments` is the parse_sidx() list."""
    target = max(1, math.ceil(max(dur for _, dur in segments)))
    out = [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        f"#EXT-X-TARGETDURATION:{target}",
        f'#EXT-X-MAP:URI="{seg_uri}",BYTERANGE="{init_end}@0"',
    ]
    offset = init_end
    for size, dur in segments:
        out.append(f"#EXTINF:{dur:.3f},")
        out.append(f"#EXT-X-BYTERANGE:{size}@{offset}")
        out.append(seg_uri)
        offset += size
    out.append("#EXT-X-ENDLIST")
    return "\n".join(out) + "\n"


def master_playlist(video_uri, audio_uri, *, vcodec, acodec, width, height, bandwidth):
    """A master playlist tying one video variant to the original audio as an
    alternate rendition group, so hls.js muxes the two streams together."""
    codecs = ",".join(c for c in (vcodec, acodec) if c)
    res = f"RESOLUTION={width}x{height}," if width and height else ""
    return (
        "#EXTM3U\n"
        "#EXT-X-VERSION:7\n"
        f'#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Original",'
        f'DEFAULT=YES,AUTOSELECT=YES,URI="{audio_uri}"\n'
        f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},CODECS="{codecs}",'
        f'{res}AUDIO="aud"\n'
        f"{video_uri}\n"
    )
