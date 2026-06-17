import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ExternalLink, GripVertical, Maximize2, Minimize2, X } from 'lucide-react';

import { COMPLETE_RATIO, usePlayer, useProgress } from '../../state.jsx';
import s from './player.module.css';

const MARGIN = 20;
const GAP = 12;
const BAR_H = 34;

// One card per video. The <iframe> is always the same element in the same
// position in the JSX, so toggling expanded/docked (which only changes inline
// styles and the surrounding chrome) never remounts it — playback continues.
function PlayerCard({ item, expanded, style, dragging, onClose, onMinimize, onExpand, drag }) {
  const channelId = item.extra?.channel_id;
  const [over, setOver] = useState(false);
  const { progress, writeProgress, flushProgress } = useProgress();
  const iframeRef = useRef(null);
  const lastRef = useRef({ position: 0, duration: 0 });

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
      if (typeof info.currentTime === 'number' && typeof info.duration === 'number' && info.duration > 0) {
        clearInterval(handshake); // events are flowing now
        lastRef.current = { position: info.currentTime, duration: info.duration };
        writeProgress(item.id, info.currentTime, info.duration);
      }
    };
    window.addEventListener('message', onMsg);

    return () => {
      clearInterval(handshake);
      window.removeEventListener('message', onMsg);
      const { position, duration } = lastRef.current;
      if (duration > 0) flushProgress(item.id, position, duration);
    };
    // item.id is stable for this card's lifetime; the iframe never remounts.
  }, [item.id, writeProgress, flushProgress]);

  const start = startRef.current;
  const src =
    `https://www.youtube-nocookie.com/embed/${item.extra.video_id}` +
    `?autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}` +
    (start ? `&start=${start}` : '');

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
        {!expanded && (
          <button className={s.btn} title="Expand" onClick={onExpand}>
            <Maximize2 size={13} />
          </button>
        )}
        {expanded && (
          <button className={s.btn} title="Minimize to corner" onClick={onMinimize}>
            <Minimize2 size={14} />
          </button>
        )}
        <button className={s.btn} title="Close" onClick={onClose}>
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
  const { players, expandedId, order, close, minimize, undock, expandFromDock, reorder } = usePlayer();
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [dragId, setDragId] = useState(null);

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
            onClose={() => (isExpanded ? close() : undock(id))}
            onMinimize={minimize}
            onExpand={() => expandFromDock(id)}
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
