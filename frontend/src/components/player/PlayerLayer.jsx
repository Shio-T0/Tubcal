import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  ExternalLink,
  GripVertical,
  Maximize2,
  Minimize2,
  PanelRight,
  Radio,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
// hls.js (~150 KB) is loaded on demand the first time an HLS stream plays, so it
// stays out of the initial bundle for anyone who never opens a 1080p video.

import { api } from '../../api/client.js';
import { formatWhen, timeUntil } from '../../lib/time.js';
import { streamApi } from '../../lib/streams.js';
import { COMPLETE_RATIO, useAnimeSync, usePlayer, useProgress, useSettings } from '../../state.jsx';
import { useVideoControls } from '../../lib/useVideoControls.js';
import PlayerControls from './PlayerControls.jsx';
import PlayerSidePanel from './PlayerSidePanel.jsx';
import s from './player.module.css';

const MARGIN = 20;
const GAP = 12;
const BAR_H = 34;

// One card per video. The <video> is always the same element in the same
// position in the JSX, so toggling expanded/docked (which only changes inline
// styles and the surrounding chrome) never remounts it — playback continues.
//
// Playback is a native <video> fed by a muxed YouTube CDN stream that the
// server resolves through Invidious (see server/sources/invidious.video_streams).
// This sidesteps YouTube's embed player entirely — which had started refusing
// every video with "Video unavailable, watch on YouTube" — and gives us exact,
// event-driven progress via the element's own timeupdate, no postMessage hacks.
function PlayerCard({ item, expanded, style, dragging, muted, rate, roomForPanel, showPanel, seekSignal, takeSeekTarget, onTogglePanel, onClose, onMinimize, onExpand, onEnded, onRateChange, drag }) {
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
  const [info, setInfo] = useState(null); // metadata for the panel + live status

  const sapi = streamApi(item);
  const liveStatus = info?.live_status;
  const isUpcoming = liveStatus === 'is_upcoming';
  const isLive = liveStatus === 'is_live';

  // Resolve metadata once per video: drives the info panel and tells us whether
  // this is a premiere that hasn't started (so we show a countdown, not an error).
  // Platforms without a metadata endpoint (anime) just skip straight to playback.
  useEffect(() => {
    let alive = true;
    setInfo(null);
    if (!sapi.meta) {
      setInfo({});
      return undefined;
    }
    api(sapi.meta)
      .then((d) => alive && setInfo(d))
      .catch(() => alive && setInfo({}));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

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
    setSubtitles([]);
    api(sapi.resolve)
      .then((d) => {
        if (!alive) return;
        setStreams(d.streams || []);
        setSubtitles(d.subtitles || []);
      })
      .catch(() => alive && setStreams([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

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
  const playKey = active ? `${active.kind}:${active.itag}` : null;
  const ctl = useVideoControls(videoRef, playKey, cardRef);

  // Attach the chosen source to the element. Re-runs when the selection changes
  // (keyed via playKey); the <video>'s key={playKey} remounts it so this always
  // sees a fresh element with no stale buffer.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active) return undefined;
    retryRef.current = 0; // fresh source — reset the per-source error retries
    setPlayErr(null);
    if (isHls) {
      const url = sapi.hls(active.itag);
      let hls = null;
      let cancelled = false;
      // Dynamic import → hls.js is a separate chunk fetched only now.
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled || !videoRef.current) return;
        if (Hls.isSupported()) {
          // backBufferLength frees already-played segments so long videos don't
          // grow memory unbounded; the buffer caps keep ahead-of-playhead modest.
          hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            backBufferLength: 30,
          });
          // A single fatal HLS error is often transient (an expired segment, a
          // dropped connection). hls.js can recover network errors by reloading
          // and media errors by flushing the decoder, so try a bounded number of
          // recoveries before surfacing an error — this is what otherwise showed
          // up as an intermittent "unsupported format".
          let recoveries = 0;
          hls.loadSource(url);
          hls.attachMedia(v);
          hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
          hls.on(Hls.Events.ERROR, (_, d) => {
            if (!d.fatal) return;
            if (recoveries < 3) {
              recoveries += 1;
              if (d.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
              else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
              else hls.destroy();
              return;
            }
            setPlayErr(`HLS ${d.type}${d.details ? ` — ${d.details}` : ''}`);
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
      return () => { cancelled = true; if (hls) hls.destroy(); };
    }
    v.src = sapi.mp4(active.itag);
    v.play().catch(() => {});
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey]);

  const retryRef = useRef(0);
  const onVideoError = (e) => {
    const v = e.currentTarget;
    const me = v.error;
    // The progressive proxy re-resolves expired URLs itself, so a browser-side
    // error here is usually a transient network/decode blip. Reload the element
    // a couple of times (cache-busted) before giving up — this avoids a flash of
    // "unsupported format" on a stream that's actually fine on the next try.
    if (!isHls && active && retryRef.current < 2) {
      retryRef.current += 1;
      const base = sapi.mp4(active.itag);
      v.src = `${base}${base.includes('?') ? '&' : '?'}r=${retryRef.current}`;
      v.load();
      v.play().catch(() => {});
      return;
    }
    const codes = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
    setPlayErr(me ? `${codes[me.code] || me.code}${me.message ? ` — ${me.message}` : ''}` : 'unknown');
  };

  return (
    <div
      ref={cardRef}
      className={`${s.card} ${expanded ? s.cardExpanded : s.cardDocked} ${over ? s.cardOver : ''}`}
      style={style}
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
        {expanded && roomForPanel && (
          <button
            className={`${s.btn} ${showPanel ? s.btnActive : ''}`}
            title={showPanel ? 'Hide info & comments' : 'Show info & comments'}
            onClick={onTogglePanel}
            aria-label="Toggle info panel"
          >
            <PanelRight size={14} />
          </button>
        )}
        {!expanded && (
          <button className={s.btn} title="Expand" onClick={onExpand} aria-label="Expand">
            <Maximize2 size={13} />
          </button>
        )}
        {expanded && (
          <button className={s.btn} title="Minimize to corner" onClick={onMinimize} aria-label="Minimize to corner">
            <Minimize2 size={14} />
          </button>
        )}
        <button className={s.btn} title="Close" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>
      </div>

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
              onPause={onPauseFlush}
              onEnded={() => onEnded?.()}
              onRateChange={onRateEvt}
              onError={onVideoError}
            >
              {subtitles.map((sub, i) => (
                <track
                  key={sub.src}
                  kind="subtitles"
                  src={sub.src}
                  srcLang={sub.lang || 'en'}
                  label={sub.label || sub.lang || 'Subtitles'}
                  default={i === 0}
                />
              ))}
            </video>
            {!playErr && (
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
                rate={rate}
                onRate={(r) => onRateChange?.(r)}
                resumeAt={startRef.current}
                canVolume={!muted}
                onVolumePersist={setVolumePref}
              />
            )}
            {playErr && (
              <div className={s.frameMsg}>
                <div className={s.frameError}>
                  <span>Playback failed ({playErr}).</span>
                  <a className={s.metaLink} href={item.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={13} /> {item.platform === 'youtube' ? 'Watch on YouTube' : 'Open source page'}
                  </a>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className={s.frameMsg}>
            {streams === null ? (
              <div className={s.tuning}>
                <span className={s.tuningSweep} aria-hidden="true" />
                <span className={s.tuningRing} aria-hidden="true" />
                <span className={s.tuningText}>Tuning in…</span>
              </div>
            ) : (
              <div className={s.frameError}>
                <span>Couldn’t load a stream for this video.</span>
                <a className={s.metaLink} href={item.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} /> Watch on YouTube
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className={s.meta}>
          {channelId ? (
            <Link to={`/youtube/c/${channelId}`} className={s.metaChannel}>
              {item.source}
            </Link>
          ) : (
            <span className={s.metaChannel}>{item.source}</span>
          )}
          <a className={s.metaLink} href={item.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} /> Open on YouTube
          </a>
        </div>
      )}
    </div>
  );
}

export default function PlayerLayer() {
  const { players, expandedId, order, close, minimize, undock, expandFromDock, reorder, ended, seekSignal, takeSeekTarget } = usePlayer();
  const { settings, updateSettings } = useSettings();
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [dragId, setDragId] = useState(null);
  const [showPanel, setShowPanel] = useState(true);

  const soloAudio = settings?.solo_audio !== false;
  const rate = settings?.playback_rate || 1;
  // Only one video keeps its audio: the expanded one, else the bottom corner.
  const activeId = expandedId || order[order.length - 1] || null;

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  const dockW = Math.min(340, vp.w - 2 * MARGIN);
  const dockCardH = BAR_H + (dockW * 9) / 16;
  // The info/comments panel floats at the left edge; it only fits on a wide
  // enough viewport, otherwise the toggle is hidden and the video stays centered.
  const PANEL_W = 420; // keep in sync with .floatPanel width in player.module.css
  const expandedItem = players.find((p) => p.id === expandedId)?.item;
  // The info/transcript panel is YouTube-only (description, comments, the Archive);
  // anime episodes and other platforms have nothing to put in it.
  const roomForPanel = vp.w >= 1024;
  const canPanel = (it) => it?.platform === 'youtube';
  const panelVisible = !!expandedId && roomForPanel && showPanel && canPanel(expandedItem);

  // Panel floats at the right edge; the video centers in the space to its left
  // and keeps its normal size as long as that space allows — so it doesn't shrink
  // on a wide screen just because the panel is open.
  const regionRight = panelVisible ? vp.w - MARGIN - PANEL_W - GAP : vp.w - MARGIN;
  const expandedW = Math.min(960, regionRight - MARGIN);
  const expandedCenterX = (MARGIN + regionRight) / 2;

  return createPortal(
    <>
      {expandedId && <div className={s.backdrop} onMouseDown={minimize} />}
      {panelVisible && expandedItem && (
        <PlayerSidePanel item={expandedItem} onClose={() => setShowPanel(false)} />
      )}
      {players.map(({ id, item }) => {
        const isExpanded = id === expandedId;
        const dockIndex = order.indexOf(id); // 0 = bottom corner
        const style = isExpanded
          ? { left: expandedCenterX, top: '50%', transform: 'translate(-50%, -50%)', width: expandedW }
          : { right: MARGIN, bottom: MARGIN + dockIndex * (dockCardH + GAP), width: dockW };
        return (
          <PlayerCard
            key={id}
            item={item}
            expanded={isExpanded}
            style={style}
            dragging={dragId != null}
            muted={soloAudio && id !== activeId}
            rate={rate}
            roomForPanel={roomForPanel && canPanel(item)}
            showPanel={showPanel}
            seekSignal={seekSignal}
            takeSeekTarget={takeSeekTarget}
            onTogglePanel={() => setShowPanel((p) => !p)}
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
