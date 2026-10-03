// The phone player — one video at a time, three ways to hold it.
//
//   Watch page   the picture across the top, everything about it scrolling
//                beneath (channel, actions, About / Chapters / Comments /
//                Transcript / Up next). Swipe the picture down to tuck it away.
//   Mini player  a bar above the tabs, still playing; tap to bring it back,
//                swipe it sideways to stop.
//   Fullscreen   rotate the phone (or tap ⛶) and the picture takes the screen.
//
// On the picture: tap shows the controls; double-tap the left or right third
// skips 10s (keep tapping to skip more); double-tap the middle plays/pauses; hold
// anywhere for 2× while your finger stays down. The seek bar is a wide touch
// strip that draws "most replayed" and the chapter breaks, with a big time bubble
// while you drag.
//
// The <video> element never remounts between those states, so nothing restarts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, AudioLines, BookOpen, Bookmark, BookmarkCheck, CalendarClock, Captions, Check, ChevronDown,
  ChevronLeft, ChevronRight, FileText, Gauge, Heart, Link2, ListOrdered, ListVideo, Maximize, MessageSquare,
  Minimize, MonitorPlay, Pause, Play, RefreshCw, RotateCw, Settings2, Share2, SkipForward, Sparkles, Tv,
  Type, X,
} from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';
import { compact } from '@pc/lib/format.js';
import { ago, clock, formatWhen, timeUntil } from '@pc/lib/time.js';
import { useVideoControls } from '@pc/lib/useVideoControls.js';
import { usePlayer, useProgress, useSaved, useSettings, useToast } from '@pc/state.jsx';
import { RichText } from '@pc/components/player/richText.jsx';
import { VideoComments } from '@pc/components/player/VideoComments.jsx';
import { useWatchLinks } from '@pc/components/player/watchLinks.js';
import { SubscribeButton, useSubscription } from '@pc/components/screening/SubscribeButton.jsx';
import { useChannelFaces } from '@pc/components/screening/tiles.jsx';
import { useShared } from '@pc/lib/useShared.js';
import { Avatar } from '@pc/components/ui/Avatar.jsx';
import { SubtitleOverlay, SubtitleStyleEditor, useSubtitleStyle } from '@pc/components/player/Subtitles.jsx';
import { pickTrack } from '@pc/lib/subtitleStyle.js';
import EpisodeRail from '@pc/components/player/anime/EpisodeRail.jsx';
import { NextUp, SkipCue } from '@pc/components/player/anime/Cues.jsx';
import { showAccent, skipChapters, skipSpans, useAnimeShow } from '@pc/components/player/anime/useAnimeShow.js';

import { haptic, keepScreenOn, openExternal, setImmersive, setOrientation, share } from '../lib/bridge.js';
import { morph } from '../lib/motion.js';
import { usePlay } from '../lib/play.js';
import { useBack } from '../shell/back.js';
import { Sheet } from '../shell/Shell.jsx';
import { usePlayback } from './usePlayback.js';
import p from './player.module.css';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function useLandscape() {
  const q = '(orientation: landscape) and (max-height: 600px)';
  const [on, setOn] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setOn(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return on;
}

// ── the seek strip ───────────────────────────────────────────────────────────

function Heat({ values }) {
  const n = values.length;
  const pts = values.map((v, i) => [((i + 0.5) / n) * 1000, 100 - Math.max(0, Math.min(1, v)) * 94]);
  let d = `M0,100 L0,${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += ` Q${x.toFixed(1)},${y.toFixed(1)} ${((x + nx) / 2).toFixed(1)},${((y + ny) / 2).toFixed(1)}`;
  }
  d += ` L1000,${pts[n - 1][1].toFixed(1)} L1000,100 Z`;
  return (
    <svg className={p.heat} viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const chapterAt = (chapters, t) => (chapters || []).find((c) => t >= c.start && t < c.end) || null;

function Scrub({ ctl, heatmap, chapters, spans, disabled, onScrubbing }) {
  const track = useRef(null);
  const [drag, setDrag] = useState(null); // ratio while dragging
  const dur = ctl.duration || 0;
  const ratioAt = (x) => {
    const r = track.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width));
  };
  const down = (e) => {
    if (disabled || !dur) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = ratioAt(e.clientX);
    setDrag(r);
    onScrubbing(true);
    haptic('tick');
  };
  const move = (e) => {
    if (drag == null) return;
    e.stopPropagation();
    setDrag(ratioAt(e.clientX));
  };
  const up = (e) => {
    if (drag == null) return;
    e.stopPropagation();
    ctl.seek(drag * dur);
    setDrag(null);
    onScrubbing(false);
  };
  const shown = drag != null ? drag : dur ? ctl.current / dur : 0;
  const buf = dur ? Math.min(1, ctl.buffered / dur) : 0;
  const ch = drag != null ? chapterAt(chapters, drag * dur) : null;
  return (
    <div
      className={`${p.scrub} ${drag != null ? p.scrubbing : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={(e) => e.stopPropagation()}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.floor(dur)}
      aria-valuenow={Math.floor(ctl.current)}
    >
      {heatmap?.length > 0 && dur > 0 && <Heat values={heatmap} />}
      <div className={p.track} ref={track}>
        <span className={p.buf} style={{ width: `${buf * 100}%` }} />
        {dur > 0 && (spans || []).map((sp) => (
          <span key={sp.kind} className={p.span} style={{ left: `${(sp.start / dur) * 100}%`, width: `${((sp.end - sp.start) / dur) * 100}%` }} />
        ))}
        <span className={p.played} style={{ width: `${shown * 100}%` }} />
        {dur > 0 && (chapters || []).slice(1).map((c) => (
          <span key={c.start} className={p.notch} style={{ left: `${(c.start / dur) * 100}%` }} />
        ))}
        <span className={p.bead} style={{ left: `${shown * 100}%` }} />
      </div>
      {drag != null && (
        <span className={p.bubble} style={{ left: `${Math.min(88, Math.max(12, drag * 100))}%` }}>
          {ch && <b>{ch.title}</b>}
          {clock(drag * dur)}
        </span>
      )}
    </div>
  );
}

// ── controls over the picture ────────────────────────────────────────────────

function Controls({ item, pb, ctl, full, onFull, onMinimize, onSettings, next, onNext, title, chapters: chaptersOver, spans }) {
  const [shown, setShown] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [ripple, setRipple] = useState(null); // { side, n, key }
  const [fast, setFast] = useState(false);
  const hideT = useRef(null);
  const tapT = useRef(null);
  const last = useRef(null); // last tap { t, side }
  const gesture = useRef(null);
  const { settings, updateSettings } = useSettings();
  const rate = settings?.playback_rate || 1;
  // an episode's chapters are its opening/ending timings (skipChapters)
  const chapters = chaptersOver || pb.info?.chapters;

  const poke = useCallback(() => {
    setShown(true);
    clearTimeout(hideT.current);
    hideT.current = setTimeout(() => setShown(false), 3200);
  }, []);
  useEffect(() => {
    if (!ctl.playing || scrubbing) { setShown(true); clearTimeout(hideT.current); }
    else poke();
    return () => clearTimeout(hideT.current);
  }, [ctl.playing, scrubbing, poke]);

  useEffect(() => {
    if (!ripple) return undefined;
    const t = setTimeout(() => setRipple(null), 650);
    return () => clearTimeout(t);
  }, [ripple]);

  const skip = (side) => {
    const d = side === 'left' ? -10 : 10;
    ctl.skip(d);
    haptic('tick');
    setRipple((r) => ({ side, n: r && r.side === side ? r.n + 10 : 10, key: Date.now() }));
  };

  // Hold-for-2×: while a finger stays down, play fast.
  const holdStart = () => {
    const v = gesture.current;
    if (!v || v.moved) return;
    v.held = true;
    setFast(true);
    haptic('press');
    const vid = document.querySelector(`[data-player="${item.id}"] video`);
    if (vid) { v.prevRate = vid.playbackRate; vid.playbackRate = 2; }
  };
  const holdEnd = () => {
    const v = gesture.current;
    if (!v?.held) return;
    setFast(false);
    const vid = document.querySelector(`[data-player="${item.id}"] video`);
    if (vid) vid.playbackRate = v.prevRate || rate;
  };

  const down = (e) => {
    gesture.current = { x: e.clientX, y: e.clientY, moved: false, held: false, lp: setTimeout(holdStart, 520) };
  };
  const move = (e) => {
    const g = gesture.current;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 12) {
      g.moved = true;
      clearTimeout(g.lp);
    }
  };
  const up = (e) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    clearTimeout(g.lp);
    if (g.held) { holdEnd(); return; }
    if (g.moved) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const side = x < 0.33 ? 'left' : x > 0.67 ? 'right' : 'center';
    const now = Date.now();
    const prev = last.current;
    if (prev && now - prev.t < 320 && prev.side === side) {
      clearTimeout(tapT.current);
      last.current = { t: now, side };
      if (side === 'center') { ctl.toggle(); poke(); } else skip(side);
      return;
    }
    // A double-tap on a side keeps skipping on every further tap of that side.
    if (ripple && side === ripple.side && now - (prev?.t || 0) < 700) {
      last.current = { t: now, side };
      skip(side);
      return;
    }
    last.current = { t: now, side };
    clearTimeout(tapT.current);
    tapT.current = setTimeout(() => { setShown((v) => !v); if (!shown) poke(); }, 260);
  };

  const ch = chapterAt(chapters, ctl.current);
  const live = pb.isLive;
  const visible = shown || !ctl.playing || scrubbing;

  return (
    <div
      className={`${p.controls} ${visible ? p.controlsOn : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => { const g = gesture.current; if (g) clearTimeout(g.lp); holdEnd(); gesture.current = null; }}
    >
      {ripple && (
        <div key={ripple.key} className={`${p.ripple} ${ripple.side === 'left' ? p.rippleL : p.rippleR}`}>
          <span>{ripple.side === 'left' ? '«' : '»'} {ripple.n}s</span>
        </div>
      )}
      {!visible && !live && <span className={p.slim}><i style={{ width: `${ctl.duration ? (ctl.current / ctl.duration) * 100 : 0}%` }} /></span>}
      {fast && <div className={p.fast}>2× <Play size={11} fill="currentColor" /><Play size={11} fill="currentColor" /></div>}

      <div className={p.top}>
        <button type="button" className={p.cbtn} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); if (full) onFull(false); else onMinimize(); }} aria-label={full ? 'Exit fullscreen' : 'Minimise'}>
          <ChevronDown size={26} />
        </button>
        {full && <span className={p.topTitle}>{title}</span>}
        <button type="button" className={p.cbtn} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onSettings(); }} aria-label="Quality, speed and captions">
          <Settings2 size={21} />
        </button>
      </div>

      <div className={p.mid}>
        <button type="button" className={p.big} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); ctl.toggle(); haptic('tick'); }} aria-label={ctl.playing ? 'Pause' : 'Play'}>
          <span key={ctl.playing ? 'pause' : 'play'} className={p.bigIcon}>
            {ctl.playing ? <Pause size={34} fill="currentColor" /> : <Play size={34} fill="currentColor" />}
          </span>
        </button>
      </div>

      <div className={p.bottom} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <div className={p.row}>
          {live ? (
            <span className={p.live}><span className={p.liveDot} /> LIVE</span>
          ) : (
            <span className={p.time}><b>{clock(ctl.current)}</b> / {clock(ctl.duration)}</span>
          )}
          {ch && !live && <span className={p.chapter}>· {ch.title}</span>}
          <span className={p.spacer} />
          {rate !== 1 && <button type="button" className={p.rate} onClick={() => updateSettings({ playback_rate: 1 })}>{rate}×</button>}
          {next && (
            <button type="button" className={p.cbtn} onClick={onNext} aria-label={`Next: ${next.title}`}>
              <SkipForward size={20} fill="currentColor" />
            </button>
          )}
          <button type="button" className={p.cbtn} onClick={() => onFull(!full)} aria-label={full ? 'Exit fullscreen' : 'Fullscreen'}>
            {full ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>
        <Scrub ctl={ctl} heatmap={live ? null : pb.info?.heatmap} chapters={live ? null : chapters} spans={spans} disabled={live} onScrubbing={setScrubbing} />
      </div>
    </div>
  );
}

/** Before the picture: resolving, buffering, failed, or a premiere's countdown. */
function StageStatus({ pb, item }) {
  if (pb.isUpcoming) {
    return (
      <div className={p.status}>
        <CalendarClock size={26} />
        <b>Premieres {pb.info?.scheduled_at ? formatWhen(pb.info.scheduled_at) : 'soon'}</b>
        {pb.info?.scheduled_at && <span>{timeUntil(pb.info.scheduled_at)}</span>}
      </div>
    );
  }
  const failed = pb.status.state === 'error';
  return (
    <div className={p.status}>
      {failed ? <AlertTriangle size={26} /> : <span className={p.spinner} />}
      <b>
        {failed ? 'Stream stopped'
          : pb.status.step === 'resolve' ? (item.platform === 'anime' ? 'Finding the episode…' : 'Tuning in…')
            : 'Buffering…'}
      </b>
      {failed && <span>{pb.status.detail}</span>}
      {failed && (
        <div className={p.statusActs}>
          <button type="button" onClick={pb.retry}><RotateCw size={14} /> Try again</button>
          {item.url && <button type="button" onClick={() => openExternal(item.url)}>Open outside</button>}
        </div>
      )}
    </div>
  );
}

// ── the sheet of settings ────────────────────────────────────────────────────

function PlayerSettings({ open, onClose, pb, ccIndex, setCc, onStyle }) {
  const { settings, updateSettings } = useSettings();
  const rate = settings?.playback_rate || 1;
  const audio = pb.anime?.audioOptions || [];
  return (
    <Sheet open={open} onClose={onClose} title="Playback">
      {audio.length > 1 && (
        <div className={p.setGroup}>
          <h4><AudioLines size={14} /> Audio</h4>
          <div className={p.setRow}>
            {audio.map((a) => (
              <button key={a} type="button" className={pb.anime.audio === a ? p.setOn : ''} onClick={() => { pb.switchAudio(a); onClose(); }}>
                {a === 'dub' ? 'Dub' : 'Sub (Japanese)'}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={p.setGroup}>
        <h4><Gauge size={14} /> Speed</h4>
        <div className={p.setRow}>
          {SPEEDS.map((sp) => (
            <button key={sp} type="button" className={rate === sp ? p.setOn : ''} onClick={() => updateSettings({ playback_rate: sp })}>
              {sp === 1 ? 'Normal' : `${sp}×`}
            </button>
          ))}
        </div>
      </div>
      {pb.streams?.length > 1 && (
        <div className={p.setGroup}>
          <h4><MonitorPlay size={14} /> Quality</h4>
          <div className={p.setRow}>
            {pb.streams.map((st, i) => (
              <button key={`${st.kind}:${st.itag}`} type="button" className={pb.quality === i ? p.setOn : ''} onClick={() => { pb.setQuality(i); onClose(); }}>
                {st.quality || `Source ${i + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}
      {pb.subtitles?.length > 0 && (
        <div className={p.setGroup}>
          <h4><Captions size={14} /> Subtitles</h4>
          <div className={p.setRow}>
            <button type="button" className={ccIndex < 0 ? p.setOn : ''} onClick={() => setCc(-1)}>Off</button>
            {pb.subtitles.map((sub, i) => (
              <button key={sub.src} type="button" className={ccIndex === i ? p.setOn : ''} onClick={() => setCc(i)}>
                {sub.label || sub.lang || `Track ${i + 1}`}
              </button>
            ))}
          </div>
          <button type="button" className={p.setLink} onClick={onStyle}>
            <Type size={15} /> Subtitle style <ChevronRight size={16} />
          </button>
        </div>
      )}
    </Sheet>
  );
}

/** How subtitles look, saved for every player (here and on the desktop). */
function SubtitleStyleSheet({ open, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} title="Subtitle style">
      <p className={p.setNote}>Saved for every player, here and on the desktop.</p>
      <SubtitleStyleEditor sample className="ph-sub-editor" />
    </Sheet>
  );
}

// ── under the picture ────────────────────────────────────────────────────────

const PENDING = new Set(['queued', 'transcribing', 'embedding']);

function Archive({ item, view, pos, ctx }) {
  const status = useApi('/brain/status');
  const [doc, setDoc] = useState({ loading: true });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api(`/brain/doc/${encodeURIComponent(item.id)}`)
      .then((d) => setDoc({ d }))
      .catch((e) => setDoc({ error: e.message }));
  }, [item.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!PENDING.has(doc.d?.status)) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [doc.d?.status, load]);
  const run = async (path, body) => {
    setBusy(true);
    try { await api(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }); load(); } catch { /* shown on reload */ }
    setBusy(false);
  };
  const brain = status.data;
  if (doc.loading) return <p className={p.muted}>Checking the Archive…</p>;
  if (!doc.d) {
    if (brain && !brain.whisper) return <p className={p.muted}>The Archive is resting on this phone — its transcription engine lives on the desktop. Transcripts made there show up here once your data is synced.</p>;
    return (
      <div className={p.invite}>
        <BookOpen size={22} />
        <p>Not in the Archive yet.</p>
        <button type="button" onClick={() => run('/brain/index', { item })} disabled={busy}>{busy ? 'Adding…' : 'Add to the Archive'}</button>
      </div>
    );
  }
  if (PENDING.has(doc.d.status)) return <p className={p.muted}>In the Archive's queue — {doc.d.status}…</p>;
  if (doc.d.status === 'error') return <p className={p.muted}>Couldn't archive this one: {doc.d.error}</p>;
  if (view === 'summary') {
    if (doc.d.summary) return <div className={p.summary}>{doc.d.summary}</div>;
    return (
      <div className={p.invite}>
        <Sparkles size={22} />
        <p>Archived, but not summarized yet.</p>
        <button type="button" onClick={() => run(`/brain/summarize/${encodeURIComponent(item.id)}`)} disabled={busy || (brain && !brain.llm_ready)}>{busy ? 'Summarizing…' : 'Write a summary'}</button>
      </div>
    );
  }
  const chunks = doc.d.chunks || [];
  const cur = chunks.reduce((acc, c, i) => (c.t_start <= pos + 0.5 ? i : acc), -1);
  return (
    <div className={p.transcript}>
      {chunks.map((c, i) => (
        <button key={c.idx} type="button" className={`${p.tSeg} ${i === cur ? p.tSegOn : ''}`} onClick={() => ctx.onSeek(c.t_start)}>
          <span>{clock(c.t_start)}</span>
          <p>{c.text}</p>
        </button>
      ))}
    </div>
  );
}

function UpNextList() {
  const { queue, dequeue } = usePlayer();
  const { play } = usePlay();
  if (!queue.length) return <p className={p.muted}>Nothing queued. Long-press any video and pick “Play next”.</p>;
  return (
    <ol className={p.queue}>
      {queue.map((q) => (
        <li key={q.id}>
          <button type="button" className={p.qRow} onClick={(e) => { dequeue(q.id); play(q, e.currentTarget); }}>
            <img src={q.thumbnail} alt="" loading="lazy" />
            <span><b>{q.title}</b><em>{q.source}</em></span>
          </button>
          <button type="button" className={p.qDrop} onClick={() => dequeue(q.id)} aria-label="Remove"><X size={16} /></button>
        </li>
      ))}
    </ol>
  );
}

function WatchPage({ item, pb, pageRef }) {
  const navigate = useNavigate();
  const { minimize, queue } = usePlayer();
  // leave the watch page for another screen: the picture folds into the mini bar
  const goTo = (path) => morph(() => { minimize(); navigate(path); }, { kind: 'close' });
  const { saved, toggleSaved } = useSaved();
  const { progress } = useProgress();
  const toast = useToast();
  const faces = useChannelFaces();
  const youtube = item.platform === 'youtube';
  const info = pb.info || {};
  const vid = item.extra?.video_id;
  const cid = info.channel_id || item.extra?.channel_id;
  const sub = useSubscription(cid);
  const about = useShared(youtube && cid && !faces.has(cid) ? `/youtube/channel/${cid}/about` : null, { maxAge: 3_600_000 });
  const face = (cid && faces.get(cid)) || about.data?.thumbnail;
  const ctx = useWatchLinks(item, info.duration);
  const [tab, setTab] = useState('about');
  const [descOpen, setDescOpen] = useState(false);
  const pos = progress[item.id]?.position ?? 0;
  const name = info.author || item.source || '';
  const isSaved = !!saved[item.id];
  useEffect(() => { setTab('about'); setDescOpen(false); }, [item.id]);

  const tabs = youtube ? [
    { id: 'about', label: 'About', Icon: BookOpen },
    info.chapters?.length ? { id: 'chapters', label: 'Chapters', Icon: ListOrdered } : null,
    { id: 'comments', label: info.comment_count ? `Comments ${compact(info.comment_count)}` : 'Comments', Icon: MessageSquare },
    { id: 'transcript', label: 'Transcript', Icon: FileText },
    { id: 'summary', label: 'Summary', Icon: Sparkles },
    { id: 'next', label: queue.length ? `Up next ${queue.length}` : 'Up next', Icon: ListVideo },
  ].filter(Boolean) : [{ id: 'next', label: queue.length ? `Up next ${queue.length}` : 'Up next', Icon: ListVideo }];
  const curTab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;

  const linkAt = () => {
    const t = Math.floor(pb.lastRef.current.position || 0);
    return vid ? `https://youtu.be/${vid}${t > 3 ? `?t=${t}` : ''}` : item.url;
  };
  const doShare = async () => {
    const r = await share({ title: info.title || item.title, url: linkAt() });
    if (r === 'copied') toast('Link copied', 'success');
  };
  const goChannel = () => { if (cid) goTo(`/youtube/c/${cid}`); };

  const desc = info.description || '';
  const ch = chapterAt(info.chapters, pos);

  return (
    <div className={p.page} ref={pageRef}>
      <div className={p.details}>
        <h1 className={p.title}>{info.title || item.title}</h1>
        <p className={p.meta}>
          {info.view_count != null && <span>{compact(info.view_count)} {pb.isLive ? 'watching' : 'views'}</span>}
          {info.published_at && !pb.isLive && <span>{ago(info.published_at)}</span>}
          {item.platform === 'anime' && item.extra?.episode != null && <span>Episode {item.extra.episode}</span>}
        </p>

        {youtube && name && (
          <div className={p.channel}>
            <button type="button" className={p.chBtn} onClick={goChannel}>
              <Avatar src={face} name={name} imgClass={p.face} letterClass={p.faceLetter} />
              <span className={p.chText}>
                <b>{name}</b>
                <em>{info.channel_followers != null ? `${compact(info.channel_followers)} subscribers` : info.channel_handle || 'channel'}</em>
              </span>
            </button>
            {cid && <SubscribeButton channelId={cid} sub={sub} name={name} small />}
          </div>
        )}

        <div className={p.acts}>
          {info.like_count != null && <span className={p.actStat}><Heart size={16} /> {compact(info.like_count)}</span>}
          <button type="button" className={`${p.act} ${isSaved ? p.actOn : ''}`} onClick={() => { haptic('tick'); toggleSaved(item); }}>
            <span key={isSaved ? 'on' : 'off'} className={isSaved ? 'ph-pop' : undefined} style={{ display: 'inline-flex' }}>
              {isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
            </span>
            {isSaved ? 'Saved' : 'Save'}
          </button>
          <button type="button" className={p.act} onClick={doShare}><Share2 size={16} /> Share</button>
          {youtube && <button type="button" className={p.act} onClick={() => { navigator.clipboard?.writeText(linkAt()); toast('Link to this moment copied', 'success'); }}><Link2 size={16} /> At {clock(pos)}</button>}
          {item.platform === 'anime' && item.extra?.anilist_id && (
            <button type="button" className={p.act} onClick={() => goTo(`/anime/${item.extra.anilist_id}`)}><Tv size={16} /> Title page</button>
          )}
          {item.url && <button type="button" className={p.act} onClick={() => openExternal(item.url)}><MonitorPlay size={16} /> {youtube ? 'YouTube' : 'Source'}</button>}
        </div>
      </div>

      <div className={p.tabs} role="tablist">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={curTab === id} className={curTab === id ? p.tabOn : p.tab} onClick={() => setTab(id)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div className={p.tabBody}>
        {curTab === 'about' && (
          <>
            {ch && <button type="button" className={p.nowCh} onClick={() => setTab('chapters')}><ListOrdered size={14} /> {ch.title}</button>}
            {desc ? (
              <div className={`${p.desc} ${descOpen ? '' : p.descClamp}`} onClick={() => setDescOpen(true)}>
                <RichText text={desc} ctx={ctx} />
              </div>
            ) : <p className={p.muted}>No description.</p>}
            {desc && !descOpen && desc.length > 300 && <button type="button" className={p.more} onClick={() => setDescOpen(true)}>Show more</button>}
            {(info.tags?.length > 0 || info.category) && (
              <div className={p.tags}>
                {info.category && <span className={p.category}>{info.category}</span>}
                {info.tags.slice(0, 12).map((t) => <button key={t} type="button" onClick={() => ctx.onSearch(t)}>{t}</button>)}
              </div>
            )}
          </>
        )}
        {curTab === 'chapters' && (
          <ol className={p.chapters}>
            {info.chapters.map((c, i) => {
              const on = pos >= c.start && pos < c.end;
              return (
                <li key={`${c.start}-${i}`}>
                  <button type="button" className={on ? p.chapOn : ''} onClick={() => ctx.onSeek(c.start)}>
                    <span>{clock(c.start)}</span>
                    <b>{c.title}</b>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {curTab === 'comments' && vid && (
          <VideoComments
            key={vid}
            videoId={vid}
            total={info.comment_count}
            ctx={ctx}
            scrollRoot={pageRef}
            channelName={name}
            channelFace={face}
          />
        )}
        {(curTab === 'transcript' || curTab === 'summary') && <Archive item={item} view={curTab} pos={pos} ctx={ctx} />}
        {curTab === 'next' && <UpNextList />}
      </div>
    </div>
  );
}

/** Under the picture when an episode plays: the show (a way back to its page),
 *  which episode this is and what it's called, Sub/Dub when both exist, whether
 *  AniList has it, the episodes either side, then the whole run to pick from. */
function AnimeWatch({ item, pb, show, onEpisode, pageRef }) {
  const navigate = useNavigate();
  const { minimize, queue } = usePlayer();
  const goTo = (path) => morph(() => { minimize(); navigate(path); }, { kind: 'close' });
  const [tab, setTab] = useState('episodes');
  const ex = item.extra || {};
  const m = show.media;
  const ep = ex.episode;
  const title = m?.title || ex.show || item.source;
  const cover = m?.cover_xl || m?.cover || ex.cover;
  const epTitle = show.current?.title || ex.episode_title;
  const audio = pb.anime?.audio;
  const options = pb.anime?.audioOptions || [];
  const watched = pb.synced || (show.entry?.progress || 0) >= ep;

  return (
    <div className={p.page} ref={pageRef}>
      <div className={p.aHead}>
        <button type="button" className={p.aShow} onClick={() => goTo(`/anime/${ex.anilist_id}`)}>
          {cover && <img src={cover} alt="" />}
          <span>
            <b>{title}</b>
            <em>
              {m?.episodes ? `${m.episodes} episodes` : show.list.length ? `${show.list.length} episodes` : 'Title page'}
              {show.entry ? ` · ${show.entry.progress || 0} watched` : ''}
            </em>
          </span>
          <ChevronRight size={18} />
        </button>
        <h1 className={p.aEp}>
          Episode {ep}
          {m?.episodes ? <small>of {m.episodes}</small> : null}
        </h1>
        {epTitle && <p className={p.aEpTitle}>{epTitle}</p>}
        <div className={p.aRow}>
          {options.length > 1 ? (
            <span className={p.aAudio} role="group" aria-label="Audio">
              {options.map((o) => (
                <button key={o} type="button" className={o === audio ? p.aAudioOn : ''} aria-pressed={o === audio} onClick={() => { haptic('tick'); pb.switchAudio(o); }}>
                  {o === 'dub' ? 'Dub' : 'Sub'}
                </button>
              ))}
            </span>
          ) : audio ? <span className={p.aAudioOne}>{audio === 'dub' ? 'Dub' : 'Sub'}</span> : null}
          {show.entry && (
            <span className={watched ? p.aSyncOn : p.aSync}>
              {watched ? <><Check size={14} strokeWidth={3} /> Watched on AniList</> : <><RefreshCw size={13} /> Updates AniList when you finish</>}
            </span>
          )}
        </div>
        <div className={p.aNav}>
          <button type="button" disabled={!show.prev} onClick={() => show.prev && onEpisode(show.prev)}>
            <ChevronLeft size={18} /> {show.prev ? `Episode ${show.prev.number}` : 'First'}
          </button>
          <button type="button" disabled={!show.next} onClick={() => show.next && onEpisode(show.next)}>
            {show.next ? `Episode ${show.next.number}` : m?.status === 'FINISHED' ? 'Last' : 'Latest'} <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <div className={p.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'episodes'} className={tab === 'episodes' ? p.tabOn : p.tab} onClick={() => setTab('episodes')}>
          <ListOrdered size={15} /> Episodes
        </button>
        <button type="button" role="tab" aria-selected={tab === 'next'} className={tab === 'next' ? p.tabOn : p.tab} onClick={() => setTab('next')}>
          <ListVideo size={15} /> {queue.length ? `Up next ${queue.length}` : 'Up next'}
        </button>
      </div>
      <div className={p.tabBody}>
        {tab === 'episodes' && <EpisodeRail item={item} show={show} onEpisode={onEpisode} bare className="ph-episodes" />}
        {tab === 'next' && <UpNextList />}
      </div>
    </div>
  );
}

// ── the player ───────────────────────────────────────────────────────────────

function OnePlayer({ item, expanded }) {
  const { open, close, undock, queue, dequeue, seekSignal, takeSeekTarget, minimize: rawMinimize, expandFromDock: rawExpand } = usePlayer();
  const { minimize, expand } = usePlay();
  const expandFromDock = expand;
  // Leaving (swipe away / ✕ on the mini bar): slide off, then stop.
  const [leaving, setLeaving] = useState(0);
  const stop = (dir = 0) => {
    setLeaving(dir || 2);
    setTimeout(() => { close(); undock(item.id); }, 230);
  };
  const { settings } = useSettings();
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const pageRef = useRef(null);
  const [forcedFull, setForcedFull] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ccIndex, setCc] = useState(-1);
  const [dragY, setDragY] = useState(0);
  const [dragX, setDragX] = useState(0);
  const landscape = useLandscape();
  const full = expanded && (forcedFull || landscape);
  const next = queue[0] || null;

  // Anime: the show around this episode, its neighbours, and the countdown into the
  // next one when this one ends.
  const isAnime = item.platform === 'anime';
  const show = useAnimeShow(isAnime ? item : null);
  const [nextUp, setNextUp] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const playEpisode = (e) => {
    const it = show.itemFor(e);
    if (!it) return;
    haptic('tick');
    morph(() => open(it), { kind: 'swap' });
  };
  const goNext = () => { if (show.next) playEpisode(show.next); };

  // Ended: an episode counts down into the next one (straight on, if minimised);
  // otherwise roll into what's queued (staying mini if we were mini), else stop.
  const onEnded = () => {
    if (isAnime && show.next) {
      if (expanded) setNextUp(true);
      else { goNext(); setTimeout(minimize, 0); }
      return;
    }
    if (next) {
      dequeue(next.id);
      const wasExpanded = expanded;
      // the next picture cross-fades over the last
      morph(() => open(next), { kind: 'swap' });
      if (!wasExpanded) setTimeout(minimize, 0);
    } else {
      close();
      undock(item.id);
    }
  };

  const pb = usePlayback(item, videoRef, {
    rate: settings?.playback_rate || 1,
    seekSignal,
    takeSeekTarget,
    onEnded,
  });
  const ctl = useVideoControls(videoRef, pb.playKey, stageRef);

  // Subtitles: a new set of tracks starts on the one the saved style prefers (or
  // off). The SubtitleOverlay draws them and owns the tracks' modes.
  const [subStyle] = useSubtitleStyle();
  useEffect(() => { setCc(pickTrack(pb.subtitles, subStyle)); }, [pb.subtitles]); // eslint-disable-line react-hooks/exhaustive-deps

  // The opening/ending as chapters and shaded spans on the seek strip.
  const skip = pb.anime?.skip;
  const animeChapters = useMemo(() => (isAnime ? skipChapters(skip, ctl.duration) : null), [isAnime, skip, ctl.duration]);
  const animeNext = isAnime && show.next ? show.itemFor(show.next) : null;
  const accent = isAnime ? showAccent(show.media?.color || item.extra?.color) : null;

  // Keep the screen awake while something plays.
  useEffect(() => {
    keepScreenOn(ctl.playing);
    return () => keepScreenOn(false);
  }, [ctl.playing]);

  // Rotation: fullscreen locks landscape; leaving it hands rotation back.
  const setFull = (on) => {
    haptic('tick');
    setForcedFull(on);
    setOrientation(on ? 'landscape' : 'portrait');
  };
  useEffect(() => {
    if (!expanded) { setForcedFull(false); setOrientation('auto'); }
  }, [expanded]);
  useEffect(() => () => setOrientation('auto'), []);

  // Media session: the lock-screen / headset buttons, where the WebView honours them.
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms || typeof window.MediaMetadata === 'undefined') return;
    const ex = item.extra || {};
    ms.metadata = new window.MediaMetadata(isAnime ? {
      title: `Episode ${ex.episode}${ex.episode_title ? ` · ${ex.episode_title}` : ''}`,
      artist: ex.show || item.source || '',
      artwork: ex.cover || item.thumbnail ? [{ src: ex.cover || item.thumbnail, sizes: '460x650', type: 'image/jpeg' }] : [],
    } : {
      title: pb.info?.title || item.title,
      artist: pb.info?.author || item.source || '',
      artwork: item.thumbnail ? [{ src: item.thumbnail, sizes: '480x360', type: 'image/jpeg' }] : [],
    });
    const v = () => videoRef.current;
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* unsupported */ } };
    set('play', () => v()?.play());
    set('pause', () => v()?.pause());
    set('seekbackward', () => ctl.skip(-10));
    set('seekforward', () => ctl.skip(10));
    set('nexttrack', animeNext ? goNext : next ? onEnded : null);
  }, [item.id, pb.info?.title, next?.id, animeNext?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fullscreen hides the status and navigation bars (a swipe from the edge shows them).
  useEffect(() => {
    setImmersive(full);
    return () => setImmersive(false);
  }, [full]);

  useBack(expanded && !full, minimize);
  useBack(full, () => setFull(false));

  // Swipe the watch page's picture down to tuck it away; the mini bar up to bring it back, sideways to stop.
  const sw = useRef(null);
  const swDown = (e) => {
    if (full) return;
    sw.current = { x: e.clientX, y: e.clientY, dir: null };
  };
  const swMove = (e) => {
    const s0 = sw.current;
    if (!s0) return;
    const dx = e.clientX - s0.x;
    const dy = e.clientY - s0.y;
    if (!s0.dir && Math.hypot(dx, dy) > 14) s0.dir = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
    if (expanded && s0.dir === 'y' && dy > 0) setDragY(dy);
    if (!expanded && s0.dir === 'x') setDragX(dx);
    if (!expanded && s0.dir === 'y' && dy < 0) setDragY(dy);
  };
  const swUp = () => {
    const s0 = sw.current;
    sw.current = null;
    if (!s0) return;
    // The drag offset is cleared *inside* the transition's update, so the old
    // frame is captured where your finger left it and the picture travels on
    // from there instead of jumping back first.
    if (expanded && dragY > 110) {
      haptic('tick');
      morph(() => { setDragY(0); setDragX(0); rawMinimize(); }, { kind: 'close' });
      return;
    }
    if (!expanded && dragY < -40) {
      morph(() => { setDragY(0); setDragX(0); rawExpand(item.id); }, { kind: 'open' });
      return;
    }
    if (!expanded && Math.abs(dragX) > 110) { haptic('tick'); stop(Math.sign(dragX)); return; }
    setDragY(0);
    setDragX(0);
  };

  // Whether this mode's entrance animation plays: not when a View Transition is
  // already carrying the picture there (decided once per mode, so a later
  // re-render can't restart it).
  const enter = useRef({ mode: null, play: true });
  const mode = expanded ? 'page' : 'mini';
  if (enter.current.mode !== mode) enter.current = { mode, play: !document.documentElement.dataset.vt };

  const showControls = expanded && pb.status.step === 'play' && !pb.isUpcoming;
  const style = leaving
    ? { transform: leaving === 2 ? 'translateY(130%)' : `translateX(${leaving * 115}%)`, opacity: 0 }
    : expanded
      ? (dragY ? { transform: `translateY(${dragY}px)`, opacity: Math.max(0.4, 1 - dragY / 600), transition: 'none' } : undefined)
      : (dragX || dragY ? { transform: `translate(${dragX}px, ${Math.min(0, dragY)}px)`, opacity: Math.max(0.3, 1 - Math.abs(dragX) / 300), transition: 'none' } : undefined);

  return (
    <div
      className={`ph-player ${p.player} ${expanded ? p.expanded : p.mini} ${full ? p.full : ''} ${isAnime ? p.anime : ''} ${enter.current.play ? '' : p.noEnter}`}
      style={accent ? { ...style, '--signal': accent } : style}
      data-player={item.id}
    >
      <div
        className={`${p.stage} ${expanded ? '' : 'ph-stage-mini'}`}
        ref={stageRef}
        onPointerDown={swDown}
        onPointerMove={swMove}
        onPointerUp={swUp}
        onPointerCancel={swUp}
      >
        {!pb.isUpcoming && pb.active && (
          <video
            ref={videoRef}
            key={pb.playKey}
            className={p.video}
            playsInline
            crossOrigin={pb.subtitles.length ? 'anonymous' : undefined}
            poster={item.thumbnail || undefined}
            {...pb.handlers}
          >
            {/* no `default`: SubtitleOverlay draws the cues in the saved style */}
            {pb.subtitles.map((sub) => (
              <track key={sub.src} kind="subtitles" src={sub.src} srcLang={sub.lang || 'en'} label={sub.label || sub.lang || 'Subtitles'} />
            ))}
          </video>
        )}
        {expanded && pb.active && pb.subtitles.length > 0 && (
          <SubtitleOverlay videoRef={videoRef} track={ccIndex} playKey={pb.playKey} />
        )}
        {isAnime && expanded && pb.status.step === 'play' && !nextUp && (
          <SkipCue
            key={pb.playKey}
            current={ctl.current}
            skip={skip}
            next={show.next}
            onSeek={ctl.seek}
            onNext={goNext}
            autoSkip={settings?.anime_auto_skip === true}
          />
        )}
        {isAnime && expanded && nextUp && show.next && (
          <NextUp ep={show.next} show={show.media?.title || item.extra?.show} onPlay={goNext} onCancel={() => setNextUp(false)} />
        )}
        {(pb.status.step !== 'play' || pb.isUpcoming) && expanded && <StageStatus pb={pb} item={item} />}
        {!expanded && (pb.status.step !== 'play' || pb.healing) && <span className={p.miniSpin} />}
        {expanded && pb.healing && pb.status.step === 'play' && (
          <span className={p.healing} role="status"><i aria-hidden="true" /> Reconnecting…</span>
        )}
        {showControls && (
          <Controls
            item={item}
            pb={pb}
            ctl={ctl}
            full={full}
            onFull={setFull}
            onMinimize={minimize}
            onSettings={() => setSettingsOpen(true)}
            next={isAnime ? animeNext : next}
            onNext={isAnime ? goNext : onEnded}
            title={isAnime ? `${item.extra?.show || item.source} · Episode ${item.extra?.episode}` : pb.info?.title || item.title}
            chapters={animeChapters}
            spans={isAnime ? skipSpans(skip) : null}
          />
        )}
        {expanded && !showControls && (
          <button type="button" className={p.collapse} onClick={minimize} aria-label="Minimise"><ChevronDown size={26} /></button>
        )}
        {!expanded && <button type="button" className={p.miniCatch} onClick={() => expandFromDock(item.id)} aria-label="Open the player" />}
      </div>

      {!expanded && (
        <>
          <button type="button" className={p.miniText} onClick={() => expandFromDock(item.id)}>
            <b>{isAnime ? `Episode ${item.extra?.episode}${item.extra?.episode_title ? ` · ${item.extra.episode_title}` : ''}` : pb.info?.title || item.title}</b>
            <em>{isAnime ? item.extra?.show || item.source : pb.info?.author || item.source}</em>
          </button>
          <button type="button" className={p.miniBtn} onClick={() => { haptic('tick'); ctl.toggle(); }} aria-label={ctl.playing ? 'Pause' : 'Play'}>
            <span key={ctl.playing ? 'pause' : 'play'} className={p.bigIcon}>
              {ctl.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </span>
          </button>
          <button type="button" className={p.miniBtn} onClick={() => { haptic('tick'); stop(); }} aria-label="Stop">
            <X size={22} />
          </button>
          <span className={p.miniBar}><i style={{ width: `${ctl.duration ? (ctl.current / ctl.duration) * 100 : 0}%` }} /></span>
        </>
      )}

      {expanded && !full && (isAnime
        ? <AnimeWatch item={item} pb={pb} show={show} onEpisode={playEpisode} pageRef={pageRef} />
        : <WatchPage item={item} pb={pb} pageRef={pageRef} />)}

      <PlayerSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        pb={pb}
        ccIndex={ccIndex}
        setCc={setCc}
        onStyle={() => { setSettingsOpen(false); setStyleOpen(true); }}
      />
      <SubtitleStyleSheet open={styleOpen} onClose={() => setStyleOpen(false)} />
    </div>
  );
}

/** The one player on screen: the expanded video, else the most recent docked one. */
export default function PhonePlayer() {
  const { players, expandedId, order, undock } = usePlayer();
  const cur = useMemo(
    () => players.find((x) => x.id === expandedId) || players.find((x) => x.id === order[order.length - 1]) || null,
    [players, expandedId, order],
  );

  // A phone plays one thing: opening a new video stops the one before it.
  useEffect(() => {
    if (!expandedId) return;
    players.filter((x) => x.id !== expandedId).forEach((x) => undock(x.id));
  }, [expandedId, players.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // The rest of the app makes room for the mini bar / steps aside for the page.
  const mode = !cur ? 'none' : expandedId ? 'page' : 'mini';
  useEffect(() => {
    document.documentElement.dataset.player = mode;
    if (mode === 'page') document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [mode]);

  if (!cur) return null;
  return <OnePlayer key={cur.id} item={cur.item} expanded={cur.id === expandedId} />;
}

