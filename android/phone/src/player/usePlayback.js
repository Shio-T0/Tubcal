// The playback pipeline, as a hook — the same one the desktop player card runs
// (ported from @pc/components/player/PlayerLayer.jsx), so a video behaves the
// same on the phone: resolve the streams, attach HLS (with bounded recovery) or a
// progressive mp4 (with cache-busted retries), resume where you left off, write
// progress as it plays, and push an anime episode to AniList near its end.
//
// It owns no UI. It hands back the element's event handlers and the load status;
// the phone player draws the rest.

import { useEffect, useRef, useState } from 'react';

import { rememberAudio } from '@pc/components/player/anime/useAnimeShow.js';

import { api } from '@pc/api/client.js';
import { attachHls } from '@pc/lib/hlsPlayback.js';
import { streamApi } from '@pc/lib/streams.js';
import { useShared } from '@pc/lib/useShared.js';
import { COMPLETE_RATIO, useAnimeSync, useProgress, useSettings } from '@pc/state.jsx';

export function usePlayback(item, videoRef, { muted = false, rate = 1, seekSignal, takeSeekTarget, onEnded }) {
  const { progress, writeProgress, flushProgress } = useProgress();
  const { settings } = useSettings();
  const { queueListEdit } = useAnimeSync();
  const lastRef = useRef({ position: 0, duration: 0 });
  const syncedRef = useRef(false);
  const retryRef = useRef(0);
  const everPlayedRef = useRef(false);
  const [streams, setStreams] = useState(null); // null = resolving, [] = none found
  const [subtitles, setSubtitles] = useState([]);
  const [quality, setQualityRaw] = useState(0);
  const [playErr, setPlayErr] = useState(null);
  const [healing, setHealing] = useState(false); // riding out a network hiccup mid-video
  const [canPlay, setCanPlay] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [resolveErr, setResolveErr] = useState(null); // the server's reason, when nothing resolves
  // Anime: the source's extras (opening/ending spans, the audio served, the key for
  // the other one), the other language once switched, and whether AniList was told.
  const isAnime = item.platform === 'anime';
  const [audioKey, setAudioKey] = useState(null);
  const [anime, setAnime] = useState(null); // {skip, audio, audioKeys, audioOptions}
  const [synced, setSynced] = useState(false);
  const effItem = audioKey ? { ...item, extra: { ...item.extra, stream_key: audioKey } } : item;

  const sapi = streamApi(effItem);
  const metaRes = useShared(sapi.meta, { maxAge: 600_000 });
  const info = !sapi.meta ? {} : metaRes.data || (metaRes.error ? {} : null);
  const isUpcoming = info?.live_status === 'is_upcoming';
  const isLive = info?.live_status === 'is_live';

  // Resume point, once per video: a deep link (transcript, a timestamp) wins over
  // saved progress; a finished video starts over; otherwise back up 2s for context.
  const startRef = useRef(null);
  if (startRef.current === null) {
    const forced = takeSeekTarget?.(item.id);
    if (forced != null) startRef.current = Math.max(0, Math.floor(forced));
    else {
      const p = progress[item.id];
      startRef.current = p && p.duration && p.position / p.duration < COMPLETE_RATIO ? Math.max(0, Math.floor(p.position - 2)) : 0;
    }
  }

  // A timestamp tapped while this video plays jumps it there.
  useEffect(() => {
    if (!seekSignal || seekSignal.id !== item.id) return;
    const v = videoRef.current;
    if (v && v.readyState >= 1 && seekSignal.t != null) {
      v.currentTime = seekSignal.t;
      v.play?.().catch(() => {});
    }
  }, [seekSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    setStreams(null);
    setPlayErr(null);
    setResolveErr(null);
    setSubtitles([]);
    api(sapi.resolve)
      .then((d) => {
        if (!alive) return;
        setStreams(d.streams || []);
        setSubtitles(d.subtitles || []);
        if (isAnime) {
          setAnime({
            skip: d.skip || {},
            audio: d.audio,
            audioKeys: d.audio_keys || {},
            audioOptions: d.audio_options || Object.keys(d.audio_keys || {}),
          });
        }
      })
      .catch((e) => { if (alive) { setStreams([]); setResolveErr(e?.message || null); } });
    return () => { alive = false; };
  }, [item.id, attempt, audioKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush the last position when this video goes away.
  useEffect(() => () => {
    const { position, duration } = lastRef.current;
    if (duration > 0) flushProgress(item.id, position, duration);
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted; }, [muted, videoRef]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; }, [rate, streams, videoRef]);

  const active = Array.isArray(streams) && streams[quality] ? streams[quality] : null;
  const isHls = active?.kind === 'hls';
  // an audio switch keeps kind+itag, so the key carries it — a fresh element
  const playKey = active ? `${active.kind}:${active.itag}${audioKey ? `:${audioKey}` : ''}` : null;

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active) return undefined;
    retryRef.current = 0;
    setPlayErr(null);
    setCanPlay(false);
    if (isHls) {
      const url = sapi.hls(active.itag);
      let destroy = null;
      let cancelled = false;
      // The shared attach retries, recovers and watches for stalls (a phone's
      // network drops and changes far more than a desktop's), and only reports a
      // failure it couldn't get past.
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled || !videoRef.current) return;
        if (Hls.isSupported()) {
          destroy = attachHls(Hls, v, url, {
            profile: 'phone',
            onHealth: (h) => setHealing(h === 'healing'),
            onReload: (at) => { startRef.current = at; },
            onGiveUp: (why) => setPlayErr(why),
          });
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
          v.src = url;
          v.play().catch(() => {});
        } else {
          setPlayErr('HLS not supported here');
        }
      }).catch(() => { if (!cancelled) setPlayErr('failed to load the HLS player'); });
      return () => { cancelled = true; destroy?.(); setHealing(false); };
    }
    v.src = sapi.mp4(active.itag);
    v.play().catch(() => {});
    return undefined;
  }, [playKey, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = () => {
    everPlayedRef.current = false;
    setCanPlay(false);
    setPlayErr(null);
    setStreams(null);
    setAttempt((n) => n + 1);
  };

  /** Sub ⇄ Dub: the same episode in the other language, from where you are. The
   *  choice sticks for this show's next episodes too. */
  const switchAudio = (lang) => {
    const k = anime?.audioKeys?.[lang];
    if (!k || lang === anime?.audio) return;
    startRef.current = Math.max(0, Math.floor(lastRef.current.position));
    everPlayedRef.current = false;
    setCanPlay(false);
    setAudioKey(k);
    rememberAudio(item.extra?.anilist_id, lang);
  };

  /** Switch rendition without losing your place. */
  const setQuality = (i) => {
    startRef.current = Math.max(0, Math.floor(lastRef.current.position));
    setQualityRaw(i);
  };

  const handlers = {
    onTimeUpdate: (e) => {
      const v = e.currentTarget;
      if (!v.duration) return;
      lastRef.current = { position: v.currentTime, duration: v.duration };
      writeProgress(item.id, v.currentTime, v.duration);
      if (
        !syncedRef.current && item.platform === 'anime' && item.extra?.anilist_id
        && item.extra?.episode != null && settings?.anime_autosync !== false
        && v.currentTime / v.duration >= COMPLETE_RATIO
      ) {
        syncedRef.current = true;
        setSynced(true);
        queueListEdit({ id: item.extra.anilist_id }, { progress: item.extra.episode });
      }
    },
    onLoadedMetadata: (e) => {
      const v = e.currentTarget;
      v.playbackRate = rate;
      v.muted = muted;
      if (startRef.current && startRef.current < v.duration) v.currentTime = startRef.current;
    },
    onLoadedData: () => { everPlayedRef.current = true; setCanPlay(true); },
    // playing again after a hiccup: a stale error no longer applies
    onPlaying: () => { retryRef.current = 0; setPlayErr(null); setHealing(false); },
    onCanPlay: () => { everPlayedRef.current = true; setCanPlay(true); },
    onPause: (e) => {
      const v = e.currentTarget;
      if (v.duration) flushProgress(item.id, v.currentTime, v.duration);
    },
    onEnded: () => onEnded?.(),
    onError: (e) => {
      const v = e.currentTarget;
      if (!isHls && active && retryRef.current < 3) {
        retryRef.current += 1;
        // reloading the element starts it over: resume where it broke, not at 0
        if (v.currentTime > 0) startRef.current = v.currentTime;
        const base = sapi.mp4(active.itag);
        v.src = `${base}${base.includes('?') ? '&' : '?'}r=${retryRef.current}`;
        v.load();
        v.play().catch(() => {});
        return;
      }
      const me = v.error;
      const codes = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
      setPlayErr(me ? `${codes[me.code] || me.code}${me.message ? ` — ${me.message}` : ''}` : 'unknown');
    },
  };

  let status;
  if (streams === null) status = { step: 'resolve', state: 'active' };
  else if (!streams.length) {
    // for an episode, say which sources were tried and why each came up empty
    const why = (resolveErr || '')
      .replace(/^source resolve failed:\s*/i, '')
      .replace(/^no playable source for this episode\s*—\s*/i, 'Tried ');
    status = {
      step: 'resolve',
      state: 'error',
      detail: isAnime
        ? `No playable stream was found for this episode.${why ? ` ${why}` : ''}`
        : 'No playable stream was found for this video.',
    };
  }
  else if (playErr) status = { step: 'buffer', state: 'error', detail: `Playback failed — ${playErr}.` };
  else if (!canPlay && !everPlayedRef.current) status = { step: 'buffer', state: 'active' };
  else status = { step: 'play', state: 'active' };

  return {
    info, isLive, isUpcoming, streams, subtitles, quality, setQuality, active, playKey,
    status, retry, attempt, handlers, startRef, lastRef, healing,
    anime, switchAudio, synced,
  };
}
