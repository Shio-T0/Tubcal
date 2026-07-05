import { useCallback, useEffect, useRef, useState } from 'react';

// Reactive control surface over a bare <video> element. PlayerCard keeps full
// ownership of the element (HLS attach, source swaps, resume, progress); this
// hook only *reads* live playback state for the custom deck and exposes a few
// imperative actions the deck's buttons call. It re-subscribes whenever the
// element is replaced — PlayerCard remounts <video> on a quality switch, keyed
// by `playKey`, so passing that key here re-runs the listener effect against the
// fresh element.
//
// While playing we sample on requestAnimationFrame (not just `timeupdate`, which
// only fires ~4×/s) so the scrubber glides instead of stepping. Paused seeks fall
// back to the element's own events.
export function useVideoControls(videoRef, playKey, fullscreenRef) {
  const [st, setSt] = useState({
    playing: false,
    current: 0,
    duration: 0,
    buffered: 0, // furthest buffered second at/ahead of the playhead
    volume: 1,
    muted: false,
    waiting: false,
    fullscreen: false,
  });
  const rafRef = useRef(0);

  // Pull the element's live values into state. Cheap; called on rAF + events.
  const sample = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    let bufferedEnd = 0;
    try {
      const b = v.buffered;
      for (let i = 0; i < b.length; i += 1) {
        // the range straddling (or just ahead of) the playhead is what's "ready"
        if (b.start(i) <= v.currentTime + 0.5 && b.end(i) > bufferedEnd) bufferedEnd = b.end(i);
      }
      if (!bufferedEnd && b.length) bufferedEnd = b.end(b.length - 1);
    } catch {
      /* buffered throws until the element has data — ignore */
    }
    setSt((s) => ({
      ...s,
      current: v.currentTime || 0,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      buffered: bufferedEnd,
      volume: v.volume,
      muted: v.muted,
      playing: !v.paused && !v.ended,
    }));
  }, [videoRef]);

  // Subscribe to the (current) element. Re-runs when the element is swapped.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;

    const startLoop = () => {
      cancelAnimationFrame(rafRef.current);
      const tick = () => {
        sample();
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };
    const stopLoop = () => cancelAnimationFrame(rafRef.current);

    const onPlay = () => {
      setSt((s) => ({ ...s, playing: true, waiting: false }));
      startLoop();
    };
    const onPause = () => {
      setSt((s) => ({ ...s, playing: false }));
      stopLoop();
      sample();
    };
    const onWaiting = () => setSt((s) => ({ ...s, waiting: true }));
    const onPlaying = () => setSt((s) => ({ ...s, waiting: false }));
    const onVolume = () => setSt((s) => ({ ...s, volume: v.volume, muted: v.muted }));
    const onMetaOrProgress = () => sample();

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);
    v.addEventListener('volumechange', onVolume);
    v.addEventListener('durationchange', onMetaOrProgress);
    v.addEventListener('loadedmetadata', onMetaOrProgress);
    v.addEventListener('progress', onMetaOrProgress);
    v.addEventListener('timeupdate', onMetaOrProgress);
    v.addEventListener('seeked', onMetaOrProgress);

    sample();
    if (!v.paused) startLoop();

    return () => {
      stopLoop();
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('volumechange', onVolume);
      v.removeEventListener('durationchange', onMetaOrProgress);
      v.removeEventListener('loadedmetadata', onMetaOrProgress);
      v.removeEventListener('progress', onMetaOrProgress);
      v.removeEventListener('timeupdate', onMetaOrProgress);
      v.removeEventListener('seeked', onMetaOrProgress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, sample]);

  // Reflect browser fullscreen state (Esc / F11 / our toggle all funnel here).
  useEffect(() => {
    const onFs = () => setSt((s) => ({ ...s, fullscreen: !!document.fullscreenElement }));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, [videoRef]);

  const seek = useCallback(
    (t) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration)) return;
      v.currentTime = Math.max(0, Math.min(v.duration, t));
      sample();
    },
    [videoRef, sample],
  );

  const skip = useCallback(
    (d) => {
      const v = videoRef.current;
      if (!v) return;
      seek((v.currentTime || 0) + d);
    },
    [videoRef, seek],
  );

  const setVolume = useCallback(
    (vol) => {
      const v = videoRef.current;
      if (!v) return;
      const nv = Math.max(0, Math.min(1, vol));
      v.volume = nv;
      if (nv > 0 && v.muted) v.muted = false;
    },
    [videoRef],
  );

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 0.5; // unmuting from zero gives something to hear
  }, [videoRef]);

  const toggleFullscreen = useCallback(() => {
    const el = fullscreenRef?.current;
    if (!document.fullscreenElement) el?.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }, [fullscreenRef]);

  return { ...st, toggle, seek, skip, setVolume, toggleMute, toggleFullscreen };
}
