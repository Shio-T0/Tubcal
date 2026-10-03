// HLS playback that heals itself. Shared by the desktop player card and the
// phone player (which imports it through its synced copy of this tree).
//
// What used to stop a video partway: hls.js gave up after its default retries;
// the player allowed 3 recoveries for the *whole* video (so a long one spent
// them on ordinary blips and the 4th turned into an error panel — over a video
// still playing out its buffer, which then ran dry); and when loading stopped
// with nothing left buffered, nothing restarted it.
//
// Here instead:
//  - fragment / playlist loads retry patiently (exponential backoff), and the
//    forward buffer is deeper, so a slow patch is ridden out, not felt;
//  - a fatal error is recovered (network: restart loading where we are; media:
//    flush the decoder, then try the other audio codec), and the recovery budget
//    refills once fragments flow again — it's per minute, not per video;
//  - a watchdog notices a stall (the element waiting with the loader idle) and
//    restarts loading, hopping small buffer holes itself;
//  - the "reconnecting" hint (onHealth) shows only while playback is actually
//    stuck or a fatal error is being recovered — never over a video that plays;
//  - only when all that fails does it rebuild the player from scratch at the
//    current position (the server re-resolves dead URLs on its side), and only
//    after that fails twice in a row does the caller hear `onGiveUp`.

const loadPolicy = (ttfb, total, retries) => ({
  default: {
    maxTimeToFirstByteMs: ttfb,
    maxLoadTimeMs: total,
    timeoutRetry: { maxNumRetry: retries, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: { maxNumRetry: retries, retryDelayMs: 700, maxRetryDelayMs: 8000, backoff: 'exponential' },
  },
});

/** hls.js settings: 'desktop' buffers a minute ahead, 'phone' a little less. */
export function hlsConfig(profile = 'desktop') {
  const phone = profile === 'phone';
  return {
    // ahead of the playhead: deep enough to ride out a slow patch
    maxBufferLength: phone ? 40 : 60,
    maxMaxBufferLength: phone ? 90 : 150,
    maxBufferSize: (phone ? 70 : 140) * 1000 * 1000,
    // behind it: freed so long videos don't grow memory without bound
    backBufferLength: phone ? 15 : 30,
    startFragPrefetch: true,
    testBandwidth: false, // one rendition per source; nothing to choose between
    // a server-side URL refresh (a fresh yt-dlp resolve) can take a few seconds
    fragLoadPolicy: loadPolicy(20000, 60000, 6),
    playlistLoadPolicy: loadPolicy(20000, 30000, 4),
    manifestLoadPolicy: loadPolicy(20000, 30000, 4),
    nudgeMaxRetry: 8,
  };
}

/** Seconds buffered ahead of the playhead. */
export function bufferedAhead(video) {
  const t = video.currentTime;
  const b = video.buffered;
  for (let i = 0; i < b.length; i += 1) {
    if (b.start(i) <= t + 0.25 && b.end(i) > t) return b.end(i) - t;
  }
  return 0;
}

/**
 * Attach `url` to `video` with hls.js (`Hls` is the imported class).
 * Callbacks: onHealth(state) — 'ok' | 'healing', for a quiet "reconnecting"
 * hint; onReload(at) — the player is being rebuilt to resume at `at` seconds
 * (don't seek back to an old resume point); onGiveUp(message) — it couldn't
 * recover. Returns `destroy()`.
 */
export function attachHls(Hls, video, url, { profile = 'desktop', onHealth, onReload, onGiveUp } = {}) {
  let hls = null;
  let dead = false;
  let fatal = []; // times of recent fatal-error recoveries (the per-minute budget)
  let lastMediaErr = 0;
  let rebuilds = 0;
  let lastRebuild = 0;
  let waitingSince = 0;
  let lastKick = 0;
  let healing = false;
  const setHealing = (on) => {
    if (on !== healing) { healing = on; onHealth?.(on ? 'healing' : 'ok'); }
  };

  const rebuild = (why) => {
    if (dead) return;
    // two rebuilds in quick succession that didn't get playback going: stop
    if (rebuilds >= 2 && Date.now() - lastRebuild < 90000) {
      setHealing(false);
      onGiveUp?.(why);
      return;
    }
    if (Date.now() - lastRebuild > 90000) rebuilds = 0;
    rebuilds += 1;
    lastRebuild = Date.now();
    const at = video.currentTime || 0;
    onReload?.(at);
    fatal = [];
    hls?.destroy();
    create(at);
  };

  const create = (startAt) => {
    hls = new Hls({ ...hlsConfig(profile), startPosition: startAt > 0 ? startAt : -1 });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    // fragments are flowing again: the trouble is over, the budget refills
    hls.on(Hls.Events.FRAG_BUFFERED, () => {
      if (fatal.length) fatal = [];
      setHealing(false);
    });
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (dead) return;
      if (!d.fatal) return; // the loader retries these on its own
      const now = Date.now();
      fatal = fatal.filter((t) => now - t < 60000);
      fatal.push(now);
      setHealing(true);
      if (fatal.length > 6) { rebuild(`HLS ${d.type} — ${d.details}`); return; }
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR) {
        const wait = Math.min(8000, 600 * 2 ** (fatal.length - 1));
        setTimeout(() => { if (!dead && hls) hls.startLoad(video.currentTime > 0 ? video.currentTime : -1); }, wait);
      } else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (now - lastMediaErr < 3000) hls.swapAudioCodec();
        lastMediaErr = now;
        hls.recoverMediaError();
      } else {
        rebuild(`HLS ${d.type} — ${d.details}`);
      }
    });
  };

  // The watchdog: playback is waiting and not getting anywhere.
  const onWaiting = () => { if (!waitingSince) waitingSince = Date.now(); };
  const onPlaying = () => { waitingSince = 0; setHealing(false); };
  video.addEventListener('waiting', onWaiting);
  video.addEventListener('stalled', onWaiting);
  video.addEventListener('playing', onPlaying);
  video.addEventListener('timeupdate', onPlaying);
  const dog = setInterval(() => {
    if (dead || !hls || !waitingSince || video.paused || video.seeking) return;
    const stuck = Date.now() - waitingSince;
    const ahead = bufferedAhead(video);
    // only a real wait earns the "reconnecting" hint, not a blip the buffer hides
    if (stuck > 2500) setHealing(true);
    if (stuck > 3000 && ahead > 0.5 && video.readyState < 3) {
      // data is there but the element won't move: hop the gap
      video.currentTime += 0.1;
    } else if (stuck > 6000 && ahead < 0.5 && Date.now() - lastKick > 8000) {
      // nothing buffered and nothing arriving: the loader has stopped — restart it
      lastKick = Date.now();
      setHealing(true);
      hls.startLoad(video.currentTime > 0 ? video.currentTime : -1);
    }
    if (stuck > 25000) {
      waitingSince = Date.now();
      rebuild('playback stalled');
    }
  }, 1500);

  create(-1);

  return () => {
    dead = true;
    clearInterval(dog);
    video.removeEventListener('waiting', onWaiting);
    video.removeEventListener('stalled', onWaiting);
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('timeupdate', onPlaying);
    hls?.destroy();
    hls = null;
  };
}
