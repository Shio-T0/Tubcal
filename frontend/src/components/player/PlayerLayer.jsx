import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ExternalLink, GripVertical, Maximize2, Minimize2, Volume2, VolumeX, X } from 'lucide-react';

import { COMPLETE_RATIO, usePlayer, useProgress, useSettings } from '../../state.jsx';
import s from './player.module.css';

const MARGIN = 20;
const GAP = 12;
const BAR_H = 34;

// One card per video. The <iframe> is always the same element in the same
// position in the JSX, so toggling expanded/docked (which only changes inline
// styles and the surrounding chrome) never remounts it — playback continues.
function PlayerCard({ item, expanded, style, dragging, muted, rate, onClose, onMinimize, onExpand, onEnded, onRateChange, drag }) {
  const channelId = item.extra?.channel_id;
  const [over, setOver] = useState(false);
  const { progress, writeProgress, flushProgress } = useProgress();
  const iframeRef = useRef(null);
  const lastRef = useRef({ position: 0, duration: 0 });
  const readyRef = useRef(false);

  // Latest mute/rate intentions, read inside the (mount-only) ready handler.
  const mutedRef = useRef(muted);
  const rateRef = useRef(rate);
  mutedRef.current = muted;
  rateRef.current = rate;

  const postCmd = (func, args = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      '*',
    );
  };

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

  // Talk to the embed via the YouTube IFrame postMessage protocol (no external
  // script, stays on youtube-nocookie). We register as a listener, then the
  // player streams `infoDelivery` events carrying currentTime + duration.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return undefined;

    const sendListening = () => {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: item.id, channel: 'widget' }),
        '*',
      );
    };
    let tries = 0;
    const handshake = setInterval(() => {
      sendListening();
      if (++tries >= 20) clearInterval(handshake);
    }, 500);
    sendListening();

    const onMsg = (e) => {
      if (e.source !== iframe.contentWindow || typeof e.data !== 'string') return;
      let data;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      const info = data?.info;
      if (!info) return;

      // First contact: apply remembered playback rate + mute state.
      if (!readyRef.current) {
        readyRef.current = true;
        clearInterval(handshake);
        if (rateRef.current && rateRef.current !== 1) postCmd('setPlaybackRate', [rateRef.current]);
        postCmd(mutedRef.current ? 'mute' : 'unMute');
      }

      if (typeof info.currentTime === 'number' && typeof info.duration === 'number' && info.duration > 0) {
        lastRef.current = { position: info.currentTime, duration: info.duration };
        writeProgress(item.id, info.currentTime, info.duration);
      }
      // User changed the speed — remember it for the next video.
      if (typeof info.playbackRate === 'number' && info.playbackRate !== rateRef.current) {
        rateRef.current = info.playbackRate;
        onRateChange?.(info.playbackRate);
      }
      // playerState 0 === ended → let the player auto-advance the queue.
      if (info.playerState === 0) onEnded?.();
    };
    window.addEventListener('message', onMsg);

    return () => {
      clearInterval(handshake);
      window.removeEventListener('message', onMsg);
      const { position, duration } = lastRef.current;
      if (duration > 0) flushProgress(item.id, position, duration);
    };
    // item.id is stable for this card's lifetime; the iframe never remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Solo-audio: mute/unmute live as focus moves between stacked players.
  useEffect(() => {
    if (readyRef.current) postCmd(muted ? 'mute' : 'unMute');
  }, [muted]);

  const start = startRef.current;
  const src =
    `https://www.youtube-nocookie.com/embed/${item.extra.video_id}` +
    `?autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}` +
    (start ? `&start=${start}` : '');

  // Live scrub bar from the shared progress map.
  const p = progress[item.id];
  const ratio = p && p.duration ? Math.min(1, p.position / p.duration) : 0;
  const seek = (e) => {
    const dur = lastRef.current.duration || p?.duration;
    if (!dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    postCmd('seekTo', [frac * dur, true]);
    writeProgress(item.id, frac * dur, dur);
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
        <span className={s.barMute} title={muted ? 'Muted (another video has the sound)' : 'Audio'}>
          {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </span>
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
        <iframe
          ref={iframeRef}
          className={`${s.frame} ${dragging ? s.frameNoPointer : ''}`}
          src={src}
          title={item.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
        <div className={s.scrub} onClick={seek} title="Seek">
          <div className={s.scrubFill} style={{ width: `${ratio * 100}%` }} />
        </div>
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
  const { players, expandedId, order, close, minimize, undock, expandFromDock, reorder, ended } = usePlayer();
  const { settings, updateSettings } = useSettings();
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [dragId, setDragId] = useState(null);

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
  const expandedW = Math.min(960, vp.w - 2 * MARGIN);

  return createPortal(
    <>
      {expandedId && <div className={s.backdrop} onMouseDown={minimize} />}
      {players.map(({ id, item }) => {
        const isExpanded = id === expandedId;
        const dockIndex = order.indexOf(id); // 0 = bottom corner
        const style = isExpanded
          ? { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: expandedW }
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
