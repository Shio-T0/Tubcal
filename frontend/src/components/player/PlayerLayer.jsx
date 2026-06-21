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
import Hls from 'hls.js';

import { api } from '../../api/client.js';
import { formatWhen, timeUntil } from '../../lib/time.js';
import { COMPLETE_RATIO, usePlayer, useProgress, useSettings } from '../../state.jsx';
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
function PlayerCard({ item, expanded, style, dragging, muted, rate, roomForPanel, showPanel, onTogglePanel, onClose, onMinimize, onExpand, onEnded, onRateChange, drag }) {
  const channelId = item.extra?.channel_id;
  const [over, setOver] = useState(false);
  const { progress, writeProgress, flushProgress } = useProgress();
  const videoRef = useRef(null);
  const lastRef = useRef({ position: 0, duration: 0 });
  const [streams, setStreams] = useState(null); // null=loading, []=failed
  const [quality, setQuality] = useState(0); // index into streams
  const [playErr, setPlayErr] = useState(null); // browser MediaError, if any
  const [info, setInfo] = useState(null); // metadata for the panel + live status

  const vid = item.extra.video_id;
  const liveStatus = info?.live_status;
  const isUpcoming = liveStatus === 'is_upcoming';
  const isLive = liveStatus === 'is_live';

  // Resolve metadata once per video: drives the info panel and tells us whether
  // this is a premiere that hasn't started (so we show a countdown, not an error).
  useEffect(() => {
    let alive = true;
    setInfo(null);
    api(`/youtube/video/${vid}`)
      .then((d) => alive && setInfo(d))
      .catch(() => alive && setInfo({}));
    return () => {
      alive = false;
    };
  }, [vid]);

  // Compute the resume point once, when this video first mounts. A finished
  // video starts over; otherwise we rewind a couple seconds for context.
  const startRef = useRef(null);
  if (startRef.current === null) {
    const p = progress[item.id];
    startRef.current =
      p && p.duration && p.position / p.duration < COMPLETE_RATIO
        ? Math.max(0, Math.floor(p.position - 2))
        : 0;
  }

  // Resolve the playable stream URLs once per video.
  useEffect(() => {
    let alive = true;
    setStreams(null);
    setPlayErr(null);
    api(`/youtube/stream/${item.extra.video_id}`)
      .then((d) => alive && setStreams(d.streams || []))
      .catch(() => alive && setStreams([]));
    return () => {
      alive = false;
    };
  }, [item.extra.video_id]);

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
  };
  const onLoadedMeta = (e) => {
    const v = e.currentTarget;
    v.playbackRate = rate;
    v.muted = muted;
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

  // Attach the chosen source to the element. Re-runs when the selection changes
  // (keyed via playKey); the <video>'s key={playKey} remounts it so this always
  // sees a fresh element with no stale buffer.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active) return undefined;
    if (isHls) {
      const url = `/api/youtube/hls/${vid}/${active.itag}.m3u8`;
      if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 30 });
        hls.loadSource(url);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (d.fatal) setPlayErr(`HLS ${d.type}${d.details ? ` — ${d.details}` : ''}`);
        });
        return () => hls.destroy();
      }
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = url; // Safari plays HLS natively
        v.play().catch(() => {});
      } else {
        setPlayErr('HLS not supported by this browser');
      }
    } else {
      v.src = `/api/youtube/stream/${vid}/data${active.itag ? `?itag=${active.itag}` : ''}`;
      v.play().catch(() => {});
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey]);

  const onVideoError = (e) => {
    const me = e.currentTarget.error;
    const codes = { 1: 'ABORTED', 2: 'NETWORK', 3: 'DECODE', 4: 'SRC_NOT_SUPPORTED' };
    setPlayErr(me ? `${codes[me.code] || me.code}${me.message ? ` — ${me.message}` : ''}` : 'unknown');
  };

  return (
    <div
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
              controls
              playsInline
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoadedMeta}
              onPause={onPauseFlush}
              onEnded={() => onEnded?.()}
              onRateChange={onRateEvt}
              onError={onVideoError}
            />
            {playErr && (
              <div className={s.frameMsg}>
                <div className={s.frameError}>
                  <span>Playback failed ({playErr}).</span>
                  <a className={s.metaLink} href={item.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={13} /> Watch on YouTube
                  </a>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className={s.frameMsg}>
            {streams === null ? (
              <span className={s.frameSpinner}>Loading stream…</span>
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
          {Array.isArray(streams) && streams.length > 1 && (
            <select
              className={s.quality}
              value={quality}
              onChange={(e) => {
                // Remounting on src change loses position; resume where we are.
                startRef.current = Math.max(0, Math.floor(lastRef.current.position));
                setQuality(Number(e.target.value));
              }}
              title="Quality"
            >
              {streams.map((st, i) => (
                <option key={st.url} value={i}>
                  {st.quality || `Source ${i + 1}`}
                </option>
              ))}
            </select>
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
  const { players, expandedId, order, close, minimize, undock, expandFromDock, reorder, ended } = usePlayer();
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

  // Lock body scroll + Esc minimizes while a video is expanded.
  useEffect(() => {
    if (!expandedId) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') minimize();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [expandedId, minimize]);

  if (players.length === 0) return null;

  const dockW = Math.min(340, vp.w - 2 * MARGIN);
  const dockCardH = BAR_H + (dockW * 9) / 16;
  // The info/comments panel floats at the left edge; it only fits on a wide
  // enough viewport, otherwise the toggle is hidden and the video stays centered.
  const PANEL_W = 360;
  const roomForPanel = vp.w >= 1024;
  const panelVisible = !!expandedId && roomForPanel && showPanel;
  const expandedItem = players.find((p) => p.id === expandedId)?.item;

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
            roomForPanel={roomForPanel}
            showPanel={showPanel}
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
