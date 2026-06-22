// Per-platform playback endpoints. The global player resolves a stream and feeds
// hls.js / a native <video src> exactly the same way for every platform — only the
// URLs differ. YouTube keeps its existing endpoints byte-for-byte; anime episodes
// resolve through the local aggregator proxy by an opaque, URL-safe stream key.

export function streamApi(item) {
  if (item.platform === 'anime') {
    const k = encodeURIComponent(item.extra.stream_key);
    return {
      resolve: `/anime/stream/${k}`,
      hls: (itag) => `/api/anime/hls/${k}/${encodeURIComponent(itag)}.m3u8`,
      mp4: (itag) => `/api/anime/stream/${k}/data?itag=${encodeURIComponent(itag)}`,
      meta: null, // anime has no live/premiere metadata endpoint
    };
  }
  // default: youtube
  const vid = item.extra.video_id;
  return {
    resolve: `/youtube/stream/${vid}`,
    hls: (itag) => `/api/youtube/hls/${vid}/${itag}.m3u8`,
    mp4: (itag) => `/api/youtube/stream/${vid}/data${itag ? `?itag=${itag}` : ''}`,
    meta: `/youtube/video/${vid}`,
  };
}
