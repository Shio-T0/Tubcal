"""Live broadcasts: muxed HLS rungs play as they are, and the demuxed kind YouTube
serves now (video-only rungs plus an audio-only playlist) is paired into a master
whose two halves are YouTube's own live playlists, rewritten through the proxy."""

import pytest

from server import httpc
from server.api import youtube as yt_api
from server.sources import youtube


def _fmt(fid, *, v="none", a=None, h=None, note="", tbr=None):
    return {
        "format_id": fid, "url": f"https://manifest.googlevideo.com/{fid}/index.m3u8",
        "protocol": "m3u8_native", "vcodec": v, "acodec": a, "height": h,
        "width": h and h * 16 // 9, "format_note": note, "tbr": tbr,
    }


DEMUXED = [
    _fmt("233", note="Default, low"),
    _fmt("234", note="Default, high"),
    _fmt("232", v="avc1.4D401F", a="none", h=720, tbr=2300),
    _fmt("270", v="avc1.640028", a="none", h=1080, tbr=4400),
]


def test_muxed_rungs_are_kept_as_they_are():
    out = youtube._collect_live_streams([
        _fmt("95", v="avc1.4d401f", a="mp4a.40.2", h=720),
        _fmt("96", v="avc1.640028", a="mp4a.40.2", h=1080),
    ])
    assert [s["itag"] for s in out] == ["96", "95"]
    assert not any(s.get("live_demuxed") for s in out)


def test_demuxed_rungs_are_paired_with_the_high_audio():
    out = youtube._collect_live_streams(DEMUXED)
    assert [s["itag"] for s in out] == ["270", "232"]
    top = out[0]
    assert top["live_demuxed"] and top["kind"] == "hls"
    assert top["audio_url"].endswith("/234/index.m3u8")
    assert top["acodec"] == "mp4a.40.2" and top["vcodec"] == "avc1.640028"
    assert top["height"] == 1080 and top["width"] == 1920


def test_no_audio_playlist_means_no_streams():
    assert youtube._collect_live_streams([f for f in DEMUXED if f["vcodec"] != "none"]) == []


class _Resp:
    def __init__(self, text, status=200):
        self.text, self.status_code = text, status


@pytest.fixture
def live(monkeypatch):
    streams = youtube._collect_live_streams(DEMUXED)
    monkeypatch.setattr(youtube, "video_streams", lambda vid: {"streams": streams, "audio": []})
    fetched = []

    def get(url, headers=None, timeout=None):
        fetched.append(url)
        return _Resp("#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXTINF:5.0,\nseg/1.ts\n")

    monkeypatch.setattr(httpc.anon_session, "get", get)
    return fetched


def test_the_master_ties_video_to_the_live_audio(client, live):
    r = client.get("/api/youtube/hls/abcdefghijk/270.m3u8")
    assert r.status_code == 200
    text = r.get_data(as_text=True)
    assert 'URI="/api/youtube/hls/abcdefghijk/270/a.m3u8"' in text
    assert "/api/youtube/hls/abcdefghijk/270/v.m3u8" in text
    assert 'CODECS="avc1.640028,mp4a.40.2"' in text and "RESOLUTION=1920x1080" in text
    assert live == []  # the master is built without fetching anything


@pytest.mark.parametrize("track, fid", [("v", "270"), ("a", "234")])
def test_each_half_is_youtubes_playlist_through_the_proxy(client, live, track, fid):
    r = client.get(f"/api/youtube/hls/abcdefghijk/270/{track}.m3u8")
    assert r.status_code == 200
    assert live == [f"https://manifest.googlevideo.com/{fid}/index.m3u8"]
    lines = r.get_data(as_text=True).splitlines()
    assert lines[-1].startswith("/api/youtube/hls/seg?u=")
    assert yt_api._seg_proxy_url(f"https://manifest.googlevideo.com/{fid}/seg/1.ts") == lines[-1]
