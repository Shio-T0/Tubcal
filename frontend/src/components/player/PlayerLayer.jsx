import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ExternalLink,
  GripVertical,
  Maximize2,
  Radio,
  RotateCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
// hls.js (~150 KB) is loaded on demand the first time an HLS stream plays, so it
// stays out of the initial bundle for anyone who never opens a 1080p video.

import { api } from '../../api/client.js';
import { formatWhen, timeUntil } from '../../lib/time.js';
import { streamApi } from '../../lib/streams.js';
import { useShared } from '../../lib/useShared.js';
import { COMPLETE_RATIO, useAnimeSync, usePlayer, useProgress, useSettings } from '../../state.jsx';
import { useVideoControls } from '../../lib/useVideoControls.js';
import NotesPanel from './NotesPanel.jsx';
import { SubtitleOverlay, SubtitleStyleEditor, useSubtitleStyle } from './Subtitles.jsx';
import { pickTrack } from '../../lib/subtitleStyle.js';
import PlayerControls from './PlayerControls.jsx';
import WatchInfo from './WatchInfo.jsx';
import AnimeStrip from './anime/AnimeStrip.jsx';
import EpisodeRail from './anime/EpisodeRail.jsx';
import { NextUp, SkipCue } from './anime/Cues.jsx';
import { rememberAudio, showAccent, skipChapters, skipSpans, useAnimeShow } from './anime/useAnimeShow.js';
import { attachHls } from '../../lib/hlsPlayback.js';
import s from './player.module.css';

const MARGIN = 20;
const GAP = 16; // between the picture and the notes
const DOCK_GAP = 12; // between stacked corner players
const BAR_H = 34;
// Height of the strip under the big screen (title + channel row), for sizing the
// picture so the two together fit the window.
const INFO_H = 128;

// The ordered stages a stream passes through before it plays. The status readout
// walks these top-to-bottom so a failure shows exactly how far it got.
const LOAD_STEPS = [
  { key: 'resolve', label: 'Finding a stream' },
  { key: 'buffer', label: 'Buffering video' },
  { key: 'play', label: 'Playing' },
];

// In-frame status readout shown whenever a video isn't playing yet: a live
// stepper while it loads, and — if a stage stalls — the reason plus a "Try again"
// button that replays the whole pipeline. Replaces the old one-line placeholders
// so the user can always see what it's doing and where it stopped.
// An episode's stages read as what they are: the source is looked up per episode.
const ANIME_STEP = { resolve: 'Finding the episode', buffer: 'Loading the picture', play: 'Playing' };

function StreamStatus({ status, attempt, onRetry, item }) {
  const failed = status.state === 'error';
  const curIdx = LOAD_STEPS.findIndex((st) => st.key === status.step);
  const anime = item.platform === 'anime';
  const srcLabel = item.platform === 'youtube' ? 'Watch on YouTube' : anime ? 'Open on AniList' : 'Open source page';

  return (
    <div className={s.frameMsg}>
      <div className={`${s.status} ${failed ? s.statusFailed : ''}`}>
        {!failed && <span className={s.tuningSweep} aria-hidden="true" />}
        <div className={s.statusHead}>
          {failed ? (
            <AlertTriangle className={s.statusHeadIcon} size={22} />
          ) : (
            <span className={s.statusHeadRing} aria-hidden="true" />
          )}
          <span className={s.statusHeadText}>
            {failed ? 'Stream stopped' : status.step === 'resolve' ? 'Tuning in…' : 'Buffering…'}
          </span>
        </div>

        <ol className={s.statusSteps}>
          {LOAD_STEPS.map((st, i) => {
            const state =
              i < curIdx ? 'done' : i > curIdx ? 'pending' : failed ? 'error' : 'active';
            return (
              <li key={st.key} className={`${s.step} ${s[`step_${state}`]}`}>
                <span className={s.stepMark} aria-hidden="true">
                  {state === 'done' && <Check size={12} strokeWidth={3} />}
                  {state === 'active' && <span className={s.stepSpin} />}
                  {state === 'error' && <X size={12} strokeWidth={3} />}
                  {state === 'pending' && <span className={s.stepPip} />}
                </span>
                <span className={s.stepLabel}>{anime ? ANIME_STEP[st.key] : st.label}</span>
              </li>
            );
          })}
        </ol>

        {failed && status.detail && <p className={s.statusDetail}>{status.detail}</p>}
        {attempt > 0 && (
          <p className={s.statusAttempt}>
            {failed ? `Attempt ${attempt + 1} failed` : `Attempt ${attempt + 1}…`}
          </p>
        )}

        {failed && (
          <div className={s.statusActions}>
            <button type="button" className={s.retryBtn} onClick={onRetry}>
              <RotateCw size={14} /> Try again
            </button>
            <a className={s.metaLink} href={item.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} /> {srcLabel}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// One card per video. The <video> is always the same element in the same
// position in the JSX, so toggling expanded/docked (which only changes inline
// styles and the surrounding chrome) never remounts it — playback continues.
//
// Playback is a native <video> fed by a muxed YouTube CDN stream that the
// server resolves through Invidious (see server/sources/invidious.video_streams).
// This sidesteps YouTube's embed player entirely — which had started refusing
// every video with "Video unavailable, watch on YouTube" — and gives us exact,
// event-driven progress via the element's own timeupdate, no postMessage hacks.
function PlayerCard({ item, expanded, style, dragging, muted, rate, notes, onChapters, next, onNext, onSwitch, seekSignal, takeSeekTarget, onClose, onMinimize, onExpand, onEnded, onRateChange, drag }) {
  const channelId = item.extra?.channel_id;
  const [over, setOver] = useState(false);
  const { progress, writeProgress, flushProgress } = useProgress();
  const { settings, setVolumePref } = useSettings();
  const { queueListEdit } = useAnimeSync();
  const videoRef = useRef(null);
  const cardRef = useRef(null);
  const lastRef = useRef({ position: 0, duration: 0 });
  const syncedRef = useRef(false); // anime → AniList progress bumped once near the end
  const [streams, setStreams] = useState(null); // null=loading, []=failed
  const [subtitles, setSubtitles] = useState([]); // [{src, lang, label}] — anime episodes
  const [quality, setQuality] = useState(0); // index into streams
  const [playErr, setPlayErr] = useState(null); // browser MediaError, if any
  const [healing, setHealing] = useState(false); // riding out a network hiccup mid-video
  const [canPlay, setCanPlay] = useState(false); // first playable frame reached
  const [attempt, setAttempt] = useState(0); // manual-retry counter; bumping re-runs the whole pipeline
  const everPlayedRef = useRef(false); // has this source ever reached playable? (keeps controls up while re-buffering)
  const [resolveErr, setResolveErr] = useState(null); // why resolution failed, from the server
  // Subtitles: which track (-1 = off), chosen from the saved style when the tracks
  // arrive, and whether the style editor is open over the picture.
  const [subStyle] = useSubtitleStyle();
  const [ccIndex, setCc] = useState(-1);
  const [styleOpen, setStyleOpen] = useState(false);

  // Anime: the show around this episode, the source's own extras (opening/ending
  // timings, which audio came back, the key for the other one), whether AniList
  // has been told, and the next-episode countdown.
  const isAnime = item.platform === 'anime';
  const show = useAnimeShow(isAnime ? item : null);
  const [audioKey, setAudioKey] = useState(null); // the other language's key, once switched
  const [animeInfo, setAnimeInfo] = useState(null); // {skip, audio, audioKeys}
  const [synced, setSynced] = useState(false);
  const [nextUp, setNextUp] = useState(false);
  const effItem = audioKey ? { ...item, extra: { ...item.extra, stream_key: audioKey } } : item;

  const sapi = streamApi(effItem);
  // Metadata once per video (shared with the notes panel, one request between
  // them): the strip under the picture, chapters + "most replayed" for the seek
  // bar, and whether this is a premiere that hasn't started (a countdown, not an
  // error). Platforms without a metadata endpoint (anime) skip straight to playback.
  const metaRes = useShared(sapi.meta, { maxAge: 600_000 });
  const info = !sapi.meta ? {} : metaRes.data || (metaRes.error ? {} : null);
  const liveStatus = info?.live_status;
  const isUpcoming = liveStatus === 'is_upcoming';
  const isLive = liveStatus === 'is_live';



  // Compute the resume point once, when this video first mounts. A finished
  // video starts over; otherwise we rewind a couple seconds for context.
  const startRef = useRef(null);
  if (startRef.current === null) {
    // A transcript deep-link (Archive / side panel) wins over resume position.
    const forced = takeSeekTarget?.(item.id);
    if (forced != null) {
      startRef.current = Math.max(0, Math.floor(forced));
    } else {
      const p = progress[item.id];
      startRef.current =
        p && p.duration && p.position / p.duration < COMPLETE_RATIO
          ? Math.max(0, Math.floor(p.position - 2))
          : 0;
    }
  }

  // Live seek: a transcript click on an already-playing video jumps it there.
  useEffect(() => {
    if (!seekSignal || seekSignal.id !== item.id) return;
    const v = videoRef.current;
    if (v && v.readyState >= 1 && seekSignal.t != null) {
      v.currentTime = seekSignal.t;
      v.play?.().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekSignal]);

  // Resolve the playable stream URLs (and any subtitle tracks) once per video.
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
          setAnimeInfo({
            skip: d.skip || {},
            audio: d.audio,
            audioKeys: d.audio_keys || {},
            audioOptions: d.audio_options || Object.keys(d.audio_keys || {}),
          });
        }
      })
      .catch((e) => {
        if (!alive) return;
        setStreams([]);
        setResolveErr(e?.message || null);
      });
    return () => {
      alive = false;
    };
    // `attempt` re-runs resolution when the user hits "Try again"; `audioKey` when
    // the episode switches between Sub and Dub.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, attempt, audioKey]);

  // A fresh set of tracks (a new episode, the other audio): start on the one the
  // saved style prefers, or with subtitles off if that's how you like it.
  useEffect(() => {
    setCc(pickTrack(subtitles, subStyle));
    // only when the tracks change — not every time the style is edited
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitles]);

  // "Try again": re-run the entire pipeline from scratch — re-resolve the stream
  // list, re-mount the <video>, and replay the stepped status so the user can see
  // exactly where it gets to this time.
  const retry = () => {
    everPlayedRef.current = false;
    setCanPlay(false);
    setPlayErr(null);
    setStreams(null);
    setAttempt((n) => n + 1);
  };

  // Flush the final position when this card unmounts (closed).
  useEffect(() => {
    return () => {
      const { position, duration } = lastRef.current;
      if (duration > 0) flushProgress(item.id, position, duration);
    };
    // item.id is stable for this card's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Keep the element's mute + rate in sync with the app's intentions.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate, streams]);

  // Native media events drive progress — timeupdate fires ~4×/s while playing,
  // so position is always accurate without interpolation.
  const onTimeUpdate = (e) => {
    const v = e.currentTarget;
    if (!v.duration) return;
    lastRef.current = { position: v.currentTime, duration: v.duration };
    writeProgress(item.id, v.currentTime, v.duration);
    // Anime: once you've effectively finished the episode, push progress to AniList.
    if (
      !syncedRef.current &&
      item.platform === 'anime' &&
      item.extra?.anilist_id &&
      item.extra?.episode != null &&
      settings?.anime_autosync !== false &&
      v.currentTime / v.duration >= COMPLETE_RATIO
    ) {
      syncedRef.current = true;
      setSynced(true);
      // Route through the shared sync queue so it coalesces with any list edits
      // and the overlay reflects the bumped progress everywhere at once.
      queueListEdit({ id: item.extra.anilist_id }, { progress: item.extra.episode });
    }
  };
  const onLoadedMeta = (e) => {
    const v = e.currentTarget;
    v.playbackRate = rate;
    v.muted = muted;
    v.volume = settings?.player_volume ?? 1; // restore the remembered level
    if (startRef.current && startRef.current < v.duration) v.currentTime = startRef.current;
  };
  const onPauseFlush = (e) => {
    const v = e.currentTarget;
    if (v.duration) flushProgress(item.id, v.currentTime, v.duration);
  };
  const onRateEvt = (e) => {
    const r = e.currentTarget.playbackRate;
    if (r && r !== rate) onRateChange?.(r);
  };

  const active = Array.isArray(streams) && streams[quality] ? streams[quality] : null;
  // Everything plays through the Flask proxy (same-origin) — browsers refuse the
  // raw googlevideo URLs. Progressive mp4 is a native <video src>; HLS renditions
  // (up to 1080p) are fed to hls.js, which fetches the (proxied) playlist+segments.
  const isHls = active?.kind === 'hls';
  // An audio switch keeps kind+itag, so the key carries it too — a fresh element.
  const playKey = active ? `${active.kind}:${active.itag}${audioKey ? `:${audioKey}` : ''}` : null;
  const ctl = useVideoControls(videoRef, playKey, cardRef);

  // Attach the chosen source to the element. Re-runs when the selection changes
  // (keyed via playKey); the <video>'s key={playKey} remounts it so this always
  // sees a fresh element with no stale buffer.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active) return undefined;
    retryRef.current = 0; // fresh source — reset the per-source error retries
    setPlayErr(null);
    setCanPlay(false); // re-enter "buffering" until this source yields a frame
    if (isHls) {
      const url = sapi.hls(active.itag);
      let destroy = null;
      let cancelled = false;
      // Dynamic import → hls.js is a separate chunk fetched only now. The
      // attach (lib/hlsPlayback.js) retries, recovers and watches for stalls,
      // and only reports a failure it couldn't get past.
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled || !videoRef.current) return;
        if (Hls.isSupported()) {
          destroy = attachHls(Hls, v, url, {
            profile: 'desktop',
            onHealth: (h) => setHealing(h === 'healing'),
            // rebuilt mid-video: resume here, not at the original resume point
            onReload: (at) => { startRef.current = at; },
            onGiveUp: (why) => setPlayErr(why),
          });
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
          v.src = url; // Safari plays HLS natively
          v.play().catch(() => {});
        } else {
          setPlayErr('HLS not supported by this browser');
        }
      }).catch(() => {
        if (!cancelled) setPlayErr('failed to load HLS player');
      });
      return () => { cancelled = true; destroy?.(); setHealing(false); };
    }
    v.src = sapi.mp4(active.itag);
    v.play().catch(() => {});
    return undefined;
    // `attempt` forces a fresh attach even when a retry re-resolves to the same source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, attempt]);

  const retryRef = useRef(0);
  const onVideoError = (e) => {
    const v = e.currentTarget;
    const me = v.error;
    // The progressive proxy re-resolves expired URLs itself, so a browser-side
    // error here is usually a transient network/decode blip. Reload the element
    // a couple of times (cache-busted) before giving up — this avoids a flash of
    // "unsupported format" on a stream that's actually fine on the next try.
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
    const codes = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
    setPlayErr(me ? `${codes[me.code] || me.code}${me.message ? ` — ${me.message}` : ''}` : 'unknown');
  };

  // First playable frame — leave "buffering" and reveal the controls.
  const onReady = () => {
    everPlayedRef.current = true;
    setCanPlay(true);
  };
  // Playing again after a hiccup: whatever error was showing no longer applies,
  // and the progressive path's reload budget refills.
  const onPlaying = () => {
    retryRef.current = 0;
    setPlayErr(null);
    setHealing(false);
  };

  // Single source of truth for the load pipeline, driving the stepped status
  // readout: which stage we're at and whether it stalled there. A failed lookup
  // says what the server said — for an episode, which sources it tried and why
  // each came up empty.
  let loadStatus;
  if (streams === null) {
    loadStatus = { step: 'resolve', state: 'active' };
  } else if (streams.length === 0) {
    const why = (resolveErr || '')
      .replace(/^source resolve failed:\s*/i, '')
      .replace(/^no playable source for this episode\s*—\s*/i, 'Tried ');
    loadStatus = {
      step: 'resolve',
      state: 'error',
      detail: isAnime
        ? `No playable stream was found for this episode.${why ? ` ${why}` : ''}`
        : 'No playable stream was found for this video.',
    };
  } else if (playErr) {
    loadStatus = { step: 'buffer', state: 'error', detail: `Playback failed — ${playErr}.` };
  } else if (!canPlay && !everPlayedRef.current) {
    loadStatus = { step: 'buffer', state: 'active' };
  } else {
    loadStatus = { step: 'play', state: 'active' };
  }
  // Controls take over once we're playing; otherwise the status readout is shown.
  const showControls = loadStatus.step === 'play';

  // ── anime ──
  // Sub ⇄ Dub: re-resolve the same episode in the other language, from here.
  const switchAudio = (lang) => {
    const k = animeInfo?.audioKeys?.[lang];
    if (!k) return;
    startRef.current = Math.max(0, Math.floor(lastRef.current.position));
    everPlayedRef.current = false;
    setCanPlay(false);
    setAudioKey(k);
    rememberAudio(item.extra?.anilist_id, lang);
  };
  // Another episode of the show, in the language you're listening in.
  const playEpisode = useCallback((e) => onSwitch?.(show.itemFor(e)), [onSwitch, show]);
  const goNext = useCallback(() => show.next && playEpisode(show.next), [show.next, playEpisode]);
  // The source's opening/ending timings as chapters: notches on the seek bar,
  // names under the pointer, and Ctrl ←/→ to step between the parts.
  const dur = ctl.duration;
  const skip = animeInfo?.skip;
  const animeChapters = useMemo(() => (isAnime ? skipChapters(skip, dur) : null), [isAnime, dur, skip]);
  const animeSpans = skipSpans(skip);
  const nextItem = isAnime && show.next ? show.itemFor(show.next) : null;
  // The show's colour carries the anime player: scrubber, cues, strip.
  const accent = isAnime ? showAccent(show.media?.color || item.extra?.color) : null;
  const cardStyle = accent ? { ...style, '--signal': accent, '--accent-strong': accent } : style;
  const veilNext = (() => {
    try { if (localStorage.getItem('tubcal.anime.spoilerGuard') === '0') return false; } catch { /* default on */ }
    return !!show.entry && (show.next?.number || 0) > Math.max(show.entry.progress || 0, item.extra?.episode || 0);
  })();

  return (
    <div
      ref={cardRef}
      className={`${s.card} ${expanded ? s.cardExpanded : s.cardDocked} ${over ? s.cardOver : ''}`}
      style={cardStyle}
      onDragOver={drag ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={drag ? () => setOver(false) : undefined}
      onDrop={
        drag
          ? (e) => {
              e.preventDefault();
              setOver(false);
              drag.onDropTo(drag.index);
            }
          : undefined
      }
    >
      {!expanded && (
      <div
        className={s.bar}
        draggable={!!drag}
        onDragStart={
          drag
            ? (e) => {
                e.dataTransfer.effectAllowed = 'move';
                drag.onStart();
              }
            : undefined
        }
        onDragEnd={drag ? drag.onEnd : undefined}
      >
        {drag && (
          <span className={s.grip} title="Drag to reorder">
            <GripVertical size={14} />
          </span>
        )}
        {channelId ? (
          <Link className={s.title} to={`/youtube/c/${channelId}`} draggable={false} title={item.title}>
            {item.title}
          </Link>
        ) : (
          <span className={s.title} title={item.title}>
            {item.title}
          </span>
        )}
        {isLive && (
          <span className={s.livePill} title="Live now">
            <Radio size={11} /> LIVE
          </span>
        )}
        <span className={s.barMute} title={muted ? 'Muted (another video has the sound)' : 'Audio'}>
          {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </span>
        <button className={s.btn} title="Back to the big screen" onClick={onExpand} aria-label="Expand">
          <Maximize2 size={13} />
        </button>
        <button className={s.btn} title="Close" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>
      </div>
      )}

      <div className={s.frameWrap}>
        {isUpcoming ? (
          <div className={s.frameMsg}>
            <div className={s.upcoming}>
              <CalendarClock size={26} />
              <span className={s.upcomingWhen}>
                Premieres {info?.scheduled_at ? formatWhen(info.scheduled_at) : 'soon'}
              </span>
              {info?.scheduled_at && (
                <span className={s.upcomingCountdown}>{timeUntil(info.scheduled_at)}</span>
              )}
              <a className={s.metaLink} href={item.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} /> Set a reminder on YouTube
              </a>
            </div>
          </div>
        ) : active ? (
          <>
            <video
              ref={videoRef}
              key={playKey}
              className={`${s.frame} ${dragging ? s.frameNoPointer : ''}`}
              title={item.title}
              crossOrigin={subtitles.length ? 'anonymous' : undefined}
              playsInline
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoadedMeta}
              onLoadedData={onReady}
              onCanPlay={onReady}
              onPlaying={onPlaying}
              onPause={onPauseFlush}
              onEnded={() => (isAnime && expanded && show.next ? setNextUp(true) : onEnded?.())}
              onRateChange={onRateEvt}
              onError={onVideoError}
            >
              {/* no `default`: the overlay below draws the cues, not the browser */}
              {subtitles.map((sub) => (
                <track
                  key={sub.src}
                  kind="subtitles"
                  src={sub.src}
                  srcLang={sub.lang || 'en'}
                  label={sub.label || sub.lang || 'Subtitles'}
                />
              ))}
            </video>
            {subtitles.length > 0 && <SubtitleOverlay videoRef={videoRef} track={ccIndex} playKey={playKey} />}
            {styleOpen && expanded && (
              <div className={s.subPanel} onMouseDown={(e) => e.stopPropagation()}>
                <div className={s.subPanelHead}>
                  <b>Subtitle style</b>
                  <span>Saved for every player</span>
                  <button type="button" onClick={() => setStyleOpen(false)} aria-label="Close"><X size={15} /></button>
                </div>
                <SubtitleStyleEditor />
              </div>
            )}
            {healing && showControls && (
              <span className={s.healing} role="status">
                <span className={s.healingDot} aria-hidden="true" /> Reconnecting…
              </span>
            )}
            {showControls ? (
              <PlayerControls
                expanded={expanded}
                isLive={isLive}
                dragging={dragging}
                videoRef={videoRef}
                playKey={playKey}
                ctl={ctl}
                streams={streams}
                quality={quality}
                onQuality={(i) => {
                  // Remounting on a source change loses position; resume where we are.
                  startRef.current = Math.max(0, Math.floor(lastRef.current.position));
                  setQuality(i);
                }}
                subtitles={subtitles}
                ccIndex={ccIndex}
                onCc={setCc}
                onSubtitleStyle={() => setStyleOpen((v) => !v)}
                rate={rate}
                onRate={(r) => onRateChange?.(r)}
                resumeAt={startRef.current}
                canVolume={!muted}
                onVolumePersist={setVolumePref}
                heatmap={info?.heatmap}
                chapters={isAnime ? animeChapters : info?.chapters}
                spans={isAnime ? animeSpans : null}
                onChapters={isAnime ? notes?.toggle : onChapters}
                next={isAnime ? nextItem : next}
                onNext={isAnime ? goNext : onNext}
              />
            ) : (
              <StreamStatus status={loadStatus} attempt={attempt} onRetry={retry} item={item} />
            )}
            {isAnime && expanded && showControls && !nextUp && (
              <SkipCue
                key={playKey}
                current={ctl.current}
                skip={skip}
                next={show.next}
                onSeek={ctl.seek}
                onNext={goNext}
                autoSkip={settings?.anime_auto_skip === true}
              />
            )}
            {isAnime && nextUp && show.next && (
              <NextUp
                ep={veilNext ? { ...show.next, title: null, still: null } : show.next}
                show={show.media?.title || item.extra?.show}
                onPlay={goNext}
                onCancel={() => setNextUp(false)}
              />
            )}
          </>
        ) : (
          <StreamStatus status={loadStatus} attempt={attempt} onRetry={retry} item={item} />
        )}
      </div>

      {expanded && isAnime && (
        <div className={s.watchSlot}>
          <AnimeStrip
            item={item}
            show={show}
            audio={animeInfo?.audio}
            audioOptions={animeInfo?.audioOptions}
            onAudio={switchAudio}
            synced={synced}
            onEpisode={playEpisode}
            rail={notes}
            onMinimize={onMinimize}
            onClose={onClose}
          />
        </div>
      )}
      {expanded && !isAnime && (
        <div className={s.watchSlot}>
          <WatchInfo
            item={item}
            info={info}
            isLive={isLive}
            getTime={() => lastRef.current.position}
            notes={notes}
            onMinimize={onMinimize}
            onClose={onClose}
          />
        </div>
      )}
    </div>
  );
}

/** The episode rail for the expanded episode — its own component so the show hook
 *  runs only while an episode is on the big screen. */
function AnimeRailHost({ item, onEpisode, ...rest }) {
  const show = useAnimeShow(item);
  return (
    <EpisodeRail item={item} show={show} onEpisode={(e) => onEpisode(show.itemFor(e))} {...rest} />
  );
}

export default function PlayerLayer() {
  const { players, expandedId, order, queue, open, close, minimize, undock, expandFromDock, reorder, ended, seekSignal, takeSeekTarget } = usePlayer();
  const { settings, updateSettings } = useSettings();
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [dragId, setDragId] = useState(null);
  const [showPanel, setShowPanel] = useState(() => {
    try { return localStorage.getItem('tubcal.player.notes') !== '0'; } catch { return true; }
  });
  const [panelTab, setPanelTab] = useState('about');

  const soloAudio = settings?.solo_audio !== false;
  const rate = settings?.playback_rate || 1;
  // Only one video keeps its audio: the expanded one, else the bottom corner.
  const activeId = expandedId || order[order.length - 1] || null;

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // A new video opens its notes on About again.
  useEffect(() => { setPanelTab('about'); }, [expandedId]);

  // Lock body scroll + Esc minimizes while a video is expanded. The body marker
  // lets the global feed shortcuts (j/k) stand down so the player owns those keys.
  useEffect(() => {
    if (!expandedId) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') minimize();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    document.body.dataset.playerExpanded = '1';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      delete document.body.dataset.playerExpanded;
    };
  }, [expandedId, minimize]);

  if (players.length === 0) return null;

  const setNotes = (v) => {
    setShowPanel(v);
    try { localStorage.setItem('tubcal.player.notes', v ? '1' : '0'); } catch { /* fine */ }
  };

  const dockW = Math.min(340, vp.w - 2 * MARGIN);
  const dockCardH = BAR_H + (dockW * 9) / 16;
  const expandedItem = players.find((p) => p.id === expandedId)?.item;
  // Beside the picture: the notes (description, chapters, comments, the Archive)
  // for YouTube, the episode rail for anime.
  const canPanel = (it) => it?.platform === 'youtube' || it?.platform === 'anime';
  // Another episode takes the big screen; the one playing closes (its progress is
  // flushed on the way out).
  const switchTo = (it) => {
    if (!it) return;
    close();
    open(it);
  };
  const panelVisible = !!expandedId && showPanel && canPanel(expandedItem);
  // Wide enough: the notes stand beside the picture. Narrower: they slide over it
  // as a sheet from the right, and the picture keeps the whole stage.
  const beside = vp.w >= 1100;
  const PANEL_W = vp.w >= 1720 ? 480 : vp.w >= 1400 ? 440 : 400;

  // The stage: everything left of the notes. The picture is as large as the stage
  // allows with the strip under it still on screen.
  const regionRight = panelVisible && beside ? vp.w - MARGIN - PANEL_W - GAP : vp.w - MARGIN;
  const regionW = regionRight - MARGIN;
  const fitH = ((vp.h - 2 * MARGIN - INFO_H) * 16) / 9;
  const expandedW = Math.max(300, Math.min(regionW, fitH, 1920));
  const expandedCenterX = (MARGIN + regionRight) / 2;
  const panelStyle = beside
    ? { top: MARGIN, bottom: MARGIN, right: MARGIN, width: PANEL_W }
    : { top: 10, bottom: 10, right: 10, width: Math.min(440, vp.w - 20) };

  const next = queue[0] || null;

  return createPortal(
    <>
      {expandedId && (
        <div className={s.theatre} onMouseDown={minimize} aria-hidden="true">
          {(() => {
            // an episode glows with its show's key art, not the episode still
            const art = expandedItem?.platform === 'anime'
              ? expandedItem.extra?.banner || expandedItem.extra?.cover || expandedItem.thumbnail
              : expandedItem?.thumbnail;
            return art ? <img className={s.ambient} src={art} alt="" /> : null;
          })()}
        </div>
      )}
      {panelVisible && expandedItem?.platform === 'anime' && (
        <AnimeRailHost
          key={expandedItem.extra?.anilist_id}
          item={expandedItem}
          onEpisode={switchTo}
          onClose={beside ? null : () => setNotes(false)}
          style={panelStyle}
        />
      )}
      {panelVisible && expandedItem && expandedItem.platform !== 'anime' && (
        <NotesPanel
          item={expandedItem}
          tab={panelTab}
          onTab={setPanelTab}
          onClose={beside ? null : () => setNotes(false)}
          className={beside ? s.notesBeside : s.notesSheet}
          style={panelStyle}
        />
      )}
      {players.map(({ id, item }) => {
        const isExpanded = id === expandedId;
        const dockIndex = order.indexOf(id); // 0 = bottom corner
        const style = isExpanded
          ? { left: expandedCenterX, top: '50%', transform: 'translate(-50%, -50%)', width: expandedW }
          : { right: MARGIN, bottom: MARGIN + dockIndex * (dockCardH + DOCK_GAP), width: dockW };
        return (
          <PlayerCard
            key={id}
            item={item}
            expanded={isExpanded}
            style={style}
            dragging={dragId != null}
            muted={soloAudio && id !== activeId}
            rate={rate}
            notes={{ available: canPanel(item), open: panelVisible, toggle: () => setNotes(!panelVisible) }}
            onChapters={() => { setNotes(true); setPanelTab('chapters'); }}
            next={isExpanded ? next : null}
            onNext={() => ended(id)}
            onSwitch={switchTo}
            seekSignal={seekSignal}
            takeSeekTarget={takeSeekTarget}
            onClose={() => (isExpanded ? close() : undock(id))}
            onMinimize={minimize}
            onExpand={() => expandFromDock(id)}
            onEnded={() => ended(id)}
            onRateChange={(r) => updateSettings({ playback_rate: r })}
            drag={
              isExpanded
                ? null
                : {
                    index: dockIndex,
                    onStart: () => setDragId(id),
                    onEnd: () => setDragId(null),
                    onDropTo: (overIndex) => {
                      if (dragId != null) reorder(order.indexOf(dragId), overIndex);
                      setDragId(null);
                    },
                  }
            }
          />
        );
      })}
    </>,
    document.body,
  );
}
