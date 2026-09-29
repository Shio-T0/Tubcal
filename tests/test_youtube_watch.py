"""The player's watch page data: what yt-dlp's info dict becomes (chapters, the
"most replayed" heatmap, stats) and how an Invidious comment is normalized."""

from server.sources import invidious, youtube


def _info(**over):
    base = {
        "id": "abc123",
        "title": "A film",
        "description": "Intro at 0:10",
        "uploader": "Blender",
        "uploader_id": "@BlenderOfficial",
        "channel_id": "UCabc",
        "channel_follower_count": 1250000,
        "channel_is_verified": True,
        "duration": 600,
        "view_count": 1000,
        "like_count": 50,
        "comment_count": 7,
        "timestamp": 1415628355,
        "tags": ["blender", "animation", 3],
        "categories": ["Film & Animation"],
    }
    base.update(over)
    return base


def test_video_meta_carries_the_watch_page_fields():
    m = youtube.video_meta(_info())
    assert m["video_id"] == "abc123"
    assert m["channel_handle"] == "@BlenderOfficial"
    assert m["channel_followers"] == 1250000
    assert m["channel_verified"] is True
    assert m["comment_count"] == 7
    assert m["published_at"] == 1415628355
    assert m["tags"] == ["blender", "animation"]  # non-strings dropped
    assert m["category"] == "Film & Animation"
    assert m["chapters"] == [] and m["heatmap"] == []


def test_published_at_falls_back_to_upload_date():
    m = youtube.video_meta(_info(timestamp=None, upload_date="20141110"))
    assert m["published_at"] == 1415577600  # 2014-11-10 00:00 UTC
    assert youtube.video_meta(_info(timestamp=None))["published_at"] is None


def test_handle_only_when_it_is_one():
    assert youtube.video_meta(_info(uploader_id="UCsomething"))["channel_handle"] is None


def test_chapters_are_sorted_and_always_end():
    m = youtube.video_meta(_info(chapters=[
        {"start_time": 120, "title": "Middle"},
        {"start_time": 0, "end_time": 120, "title": "Start"},
        {"start_time": 400, "title": ""},
    ]))
    assert [c["title"] for c in m["chapters"]] == ["Start", "Middle", "Chapter 3"]
    assert m["chapters"][1]["end"] == 400  # next chapter's start
    assert m["chapters"][2]["end"] == 600  # the video's end


def test_heatmap_normalizes_to_the_peak():
    segs = [{"start_time": i, "end_time": i + 1, "value": v} for i, v in enumerate([0.1, 0.5] * 10)]
    hm = youtube.video_meta(_info(heatmap=segs))["heatmap"]
    assert len(hm) == 20 and max(hm) == 1.0 and hm[0] == 0.2


def test_heatmap_ignores_too_little_or_junk():
    few = [{"value": 0.5}] * 5
    assert youtube.video_meta(_info(heatmap=few))["heatmap"] == []
    junk = [{"value": "x"}] * 20
    assert youtube.video_meta(_info(heatmap=junk))["heatmap"] == []


def test_norm_comment_marks_and_face():
    c = invidious._norm_comment({
        "commentId": "Ug1",
        "author": "@maker",
        "authorId": "UCmaker",
        "authorThumbnail": "https://yt3.example/face.jpg",
        "contentHtml": "hello <b>there</b>",
        "likeCount": 12,
        "published": 1700000000,
        "isPinned": True,
        "authorIsChannelOwner": True,
        "verified": True,
        "isSponsor": False,
        "isEdited": True,
        "creatorHeart": {"creatorName": "maker"},
        "replies": {"replyCount": 3, "continuation": "tok"},
    }, 0)
    assert c["author_thumb"] == "https://yt3.example/face.jpg"
    assert c["author_id"] == "UCmaker"
    assert c["is_owner"] and c["verified"] and c["edited"] and c["hearted"] and c["is_pinned"]
    assert not c["member"]
    assert c["reply_count"] == 3 and c["reply_token"] == "tok"


def test_norm_comment_thumbnail_list_takes_the_largest():
    c = invidious._norm_comment({"authorThumbnails": [{"url": "s"}, {"url": "l"}]}, 1)
    assert c["author_thumb"] == "l"
    assert invidious._norm_comment({}, 0)["author_thumb"] is None


def test_comments_endpoint_rejects_an_unknown_sort(client):
    r = client.get("/api/youtube/comments/abc123?sort=hot")
    assert r.status_code == 400


def test_comments_endpoint_passes_sort_and_page(client, monkeypatch):
    seen = {}

    def fake(video_id, sort, continuation):
        seen.update(video_id=video_id, sort=sort, continuation=continuation)
        return {"comments": [], "continuation": None, "count": 0, "disabled": False}

    monkeypatch.setattr(youtube, "video_comments", fake)
    r = client.get("/api/youtube/comments/abc123?sort=new&continuation=next")
    assert r.status_code == 200
    assert seen == {"video_id": "abc123", "sort": "new", "continuation": "next"}
