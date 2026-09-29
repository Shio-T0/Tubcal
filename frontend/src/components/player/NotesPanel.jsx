// The programme notes beside the big screen: everything about the video that
// isn't the picture. About (the numbers, the description with every timestamp and
// link live, tags, what's queued next), Chapters, Comments, and the Archive's
// transcript and summary. The transcript and chapters follow the playhead.
//
// The tab is held by the player layer, so the controls' chapter readout can open
// the Chapters tab directly.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen, CalendarDays, Crosshair, Eye, FileText, Heart, ListOrdered, ListVideo, MessageSquare, Sparkles, X,
} from 'lucide-react';


import { api, useApi } from '../../api/client.js';
import { useShared } from '../../lib/useShared.js';
import { compact } from '../../lib/format.js';
import { ago, clock } from '../../lib/time.js';
import { usePlayer, useProgress } from '../../state.jsx';
import { useChannelFaces } from '../screening/tiles.jsx';
import { Spinner } from '../ui/index.jsx';
import { RichText } from './richText.jsx';
import { VideoComments } from './VideoComments.jsx';
import { metaPath, useWatchLinks } from './watchLinks.js';
import w from './watch.module.css';

const PENDING = new Set(['queued', 'transcribing', 'embedding']);
const full = new Intl.NumberFormat('en');

/** Where the playhead is, to the second (the progress map updates as it plays). */
function usePosition(itemId) {
  const { progress } = useProgress();
  return progress[itemId]?.position ?? 0;
}

function dateLine(sec) {
  return new Date(sec * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── about ────────────────────────────────────────────────────────────────────

function Stat({ Icon, value, label, title }) {
  return (
    <div className={w.stat} title={title}>
      <Icon size={14} />
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function Description({ text, ctx }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 700 || text.split('\n').length > 12;
  return (
    <div className={w.desc}>
      <div className={!open && long ? w.descClamp : undefined}>
        <RichText text={text} ctx={ctx} />
      </div>
      {long && (
        <button type="button" className={w.descMore} onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function UpNext() {
  const { queue, open, dequeue } = usePlayer();
  if (!queue.length) return null;
  return (
    <section className={w.block}>
      <h4 className={w.blockHead}><ListVideo size={13} /> Up next · {queue.length}</h4>
      <ol className={w.queue}>
        {queue.map((q, i) => (
          <li key={q.id}>
            <button type="button" className={w.qRow} onClick={() => { dequeue(q.id); open(q); }} title="Play now">
              <span className={w.qNo}>{i + 1}</span>
              <img src={q.thumbnail} alt="" loading="lazy" />
              <span className={w.qText}><b>{q.title}</b><em>{q.source}</em></span>
            </button>
            <button type="button" className={w.qDrop} onClick={() => dequeue(q.id)} aria-label="Take off Up next"><X size={13} /></button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function About({ info, loading, ctx }) {
  if (loading && !info) return <div className={w.center}><Spinner /></div>;
  if (!info) return <p className={w.empty}>No details for this one.</p>;
  const live = info.live_status === 'is_live';
  return (
    <>
      <div className={w.stats}>
        {info.view_count != null && (
          <Stat Icon={Eye} value={compact(info.view_count)} label={live ? 'watching' : 'views'} title={`${full.format(info.view_count)} ${live ? 'watching' : 'views'}`} />
        )}
        {info.like_count != null && (
          <Stat Icon={Heart} value={compact(info.like_count)} label="likes" title={`${full.format(info.like_count)} likes`} />
        )}
        {info.published_at && (
          <Stat Icon={CalendarDays} value={dateLine(info.published_at)} label={ago(info.published_at)} />
        )}
      </div>

      {info.description ? (
        <Description text={info.description} ctx={ctx} />
      ) : (
        <p className={w.empty}>No description.</p>
      )}

      <UpNext />

      {(info.tags?.length > 0 || info.category) && (
        <section className={w.block}>
          <h4 className={w.blockHead}>Filed under</h4>
          <div className={w.tags}>
            {info.category && <span className={w.category}>{info.category}</span>}
            {info.tags.map((t) => (
              <button key={t} type="button" className={w.tagChip} onClick={() => ctx.onSearch(t)} title={`Search “${t}”`}>
                {t}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ── chapters ─────────────────────────────────────────────────────────────────

function Chapters({ chapters, pos, ctx }) {
  const cur = chapters.findIndex((c) => pos >= c.start && pos < c.end);
  return (
    <ol className={w.chapters}>
      {chapters.map((c, i) => {
        const on = i === cur;
        const pct = on ? Math.min(100, ((pos - c.start) / Math.max(1, c.end - c.start)) * 100) : i < cur ? 100 : 0;
        return (
          <li key={`${c.start}-${i}`}>
            <button type="button" className={`${w.chapter} ${on ? w.chapterOn : ''}`} onClick={() => ctx.onSeek(c.start)}>
              <span className={w.chTime}>{clock(c.start)}</span>
              <span className={w.chTitle}>{c.title}</span>
              <span className={w.chLen}>{clock(c.end - c.start)}</span>
              <span className={w.chBar}><i style={{ width: `${pct}%` }} /></span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ── the Archive: transcript + summary ────────────────────────────────────────

// Fetches an Archive doc and keeps re-fetching while it's still being processed,
// so "Transcribing…" advances on its own to the finished transcript.
function useBrainDoc(itemId) {
  const [state, setState] = useState({ doc: null, loading: true, error: null });
  const load = useCallback(() => {
    api(`/brain/doc/${encodeURIComponent(itemId)}`)
      .then((doc) => setState({ doc, loading: false, error: null }))
      .catch((e) => setState({ doc: null, loading: false, error: e.message }));
  }, [itemId]);
  useEffect(() => {
    setState((st) => ({ ...st, loading: true }));
    load();
  }, [load]);
  const status = state.doc?.status;
  useEffect(() => {
    if (!PENDING.has(status)) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [status, load]);
  return { ...state, reload: load };
}

const STATUS_COPY = {
  queued: 'Queued for the Archive…',
  transcribing: 'Winding the reels — transcribing…',
  embedding: 'Filing it away — indexing…',
};

function Transcript({ chunks, pos, ctx, scrollRoot }) {
  const [follow, setFollow] = useState(true);
  const cur = chunks.reduce((acc, c, i) => (c.t_start <= pos + 0.5 ? i : acc), -1);
  const refs = useRef({});
  useEffect(() => {
    if (!follow || cur < 0) return;
    refs.current[cur]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [cur, follow]);
  // A scroll by hand means you're reading ahead — stop following until asked.
  useEffect(() => {
    const el = scrollRoot.current;
    if (!el) return undefined;
    const stop = () => setFollow(false);
    el.addEventListener('wheel', stop, { passive: true });
    el.addEventListener('touchmove', stop, { passive: true });
    return () => {
      el.removeEventListener('wheel', stop);
      el.removeEventListener('touchmove', stop);
    };
  }, [scrollRoot]);
  return (
    <>
      <div className={w.tBar}>
        <span>{chunks.length} passages · click one to jump there</span>
        <button type="button" className={`${w.follow} ${follow ? w.followOn : ''}`} onClick={() => setFollow((f) => !f)} aria-pressed={follow}>
          <Crosshair size={13} /> {follow ? 'Following' : 'Follow along'}
        </button>
      </div>
      <div className={w.transcript}>
        {chunks.map((c, i) => (
          <button
            key={c.idx}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            className={`${w.tSeg} ${i === cur ? w.tSegOn : ''} ${i < cur ? w.tSegPast : ''}`}
            onClick={() => ctx.onSeek(c.t_start)}
          >
            <span className={w.tTime}>{clock(c.t_start)}</span>
            <span className={w.tText}>{c.text}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ArchiveTab({ item, view, pos, ctx, scrollRoot }) {
  const status = useApi('/brain/status');
  const { doc, loading, error, reload } = useBrainDoc(item.id);
  const [busy, setBusy] = useState(false);
  const brain = status.data;

  const run = async (path, body) => {
    setBusy(true);
    try {
      await api(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
      reload();
    } catch { /* surfaced on the next reload */ }
    setBusy(false);
  };

  if (!loading && (error || !doc)) {
    if (brain && !brain.whisper) {
      return <p className={w.empty}>The Archive is resting — its transcription engine isn't installed on this machine.</p>;
    }
    return (
      <div className={w.invite}>
        <BookOpen size={22} />
        <p>
          {view === 'summary'
            ? 'No summary yet. Add this to the Archive — it gets transcribed here, on this machine, then summarized.'
            : 'Not in the Archive yet. Add it and it gets transcribed here, on this machine, and becomes searchable.'}
        </p>
        <button type="button" className={w.inviteBtn} onClick={() => run('/brain/index', { item })} disabled={busy}>
          {busy ? 'Adding…' : 'Add to the Archive'}
        </button>
      </div>
    );
  }
  if (loading && !doc) return <div className={w.center}><Spinner /></div>;
  if (PENDING.has(doc.status)) {
    return (
      <div className={w.invite}>
        <Spinner />
        <p>{STATUS_COPY[doc.status]}</p>
      </div>
    );
  }
  if (doc.status === 'error') {
    return (
      <div className={w.invite}>
        <p>Couldn't archive this one: {doc.error}</p>
        <button type="button" className={w.inviteBtn} onClick={() => run('/brain/index', { item })} disabled={busy}>
          {busy ? 'Retrying…' : 'Try again'}
        </button>
      </div>
    );
  }
  if (view === 'summary') {
    if (doc.summary) return <div className={w.summary}>{doc.summary}</div>;
    return (
      <div className={w.invite}>
        <Sparkles size={22} />
        <p>Archived, but not summarized yet.</p>
        <button
          type="button"
          className={w.inviteBtn}
          onClick={() => run(`/brain/summarize/${encodeURIComponent(item.id)}`)}
          disabled={busy || (brain && !brain.llm_ready)}
        >
          {busy ? 'Summarizing…' : 'Write a summary'}
        </button>
        {brain && !brain.llm_ready && <p className={w.hint}>The local model is offline — start Ollama to summarize.</p>}
      </div>
    );
  }
  const chunks = doc.chunks || [];
  if (!chunks.length) return <p className={w.empty}>No transcript text was captured.</p>;
  return <Transcript chunks={chunks} pos={pos} ctx={ctx} scrollRoot={scrollRoot} />;
}

// ── the panel ────────────────────────────────────────────────────────────────

export function notesTabs(info) {
  return [
    { id: 'about', label: 'About', Icon: BookOpen },
    info?.chapters?.length ? { id: 'chapters', label: 'Chapters', Icon: ListOrdered, count: info.chapters.length } : null,
    { id: 'comments', label: 'Comments', Icon: MessageSquare, count: info?.comment_count },
    { id: 'transcript', label: 'Transcript', Icon: FileText },
    { id: 'summary', label: 'Summary', Icon: Sparkles },
  ].filter(Boolean);
}

export default function NotesPanel({ item, tab, onTab, onClose, className, style }) {
  const vid = item.extra?.video_id;
  const meta = useShared(vid ? metaPath(vid) : null, { maxAge: 600_000 });
  const info = meta.data;
  const ctx = useWatchLinks(item, info?.duration);
  const pos = usePosition(item.id);
  const faces = useChannelFaces();
  const scrollRef = useRef(null);
  const tabs = notesTabs(info);
  const current = tabs.some((t) => t.id === tab) ? tab : 'about';

  // A new video (or tab) starts the notes at the top.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [item.id, current]);

  const cid = info?.channel_id || item.extra?.channel_id;
  return (
    <aside className={`${w.notes} ${className || ''}`} style={style} aria-label="About this video">
      <div className={w.tabs} role="tablist">
        {tabs.map(({ id, label, Icon, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={current === id}
            className={`${w.tab} ${current === id ? w.tabOn : ''}`}
            onClick={() => onTab(id)}
          >
            <Icon size={14} />
            <span className={w.tabLabel}>{label}</span>
            {count ? <em>{compact(count)}</em> : null}
          </button>
        ))}
        {/* As a sheet over the picture it hides the strip's toggle, so it closes itself. */}
        {onClose && (
          <button type="button" className={w.close} onClick={onClose} title="Hide the notes" aria-label="Hide notes">
            <X size={15} />
          </button>
        )}
      </div>
      <div className={w.scroll} ref={scrollRef}>
        {current === 'about' && <About info={info} loading={meta.loading} ctx={ctx} />}
        {current === 'chapters' && <Chapters chapters={info.chapters} pos={pos} ctx={ctx} />}
        {current === 'comments' && vid && (
          <VideoComments
            key={vid}
            videoId={vid}
            total={info?.comment_count}
            ctx={ctx}
            scrollRoot={scrollRef}
            channelName={info?.author || item.source}
            channelFace={cid ? faces.get(cid) : undefined}
          />
        )}
        {(current === 'transcript' || current === 'summary') && (
          <ArchiveTab item={item} view={current} pos={pos} ctx={ctx} scrollRoot={scrollRef} />
        )}
      </div>
    </aside>
  );
}
