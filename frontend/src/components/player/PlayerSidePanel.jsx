import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Eye, FileText, MessageCircle, Sparkles, ThumbsUp, X } from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { compact } from '../../lib/format.js';
import { clock } from '../../lib/time.js';
import { usePlayer } from '../../state.jsx';
import CommentThread from '../modals/CommentThread.jsx';
import { Spinner } from '../ui/index.jsx';
import s from './player.module.css';

const DESC_CLAMP = 400;
const PENDING = new Set(['queued', 'transcribing', 'embedding']);

function Description({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > DESC_CLAMP;
  const shown = open || !long ? text : `${text.slice(0, DESC_CLAMP).trimEnd()}…`;
  return (
    <div className={s.panelDesc}>
      {shown}
      {long && (
        <button className={s.panelMore} onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

// Fetches an Archive doc and keeps re-fetching while it's still being processed,
// so the "Transcribing…" state advances on its own to the finished transcript.
function useBrainDoc(itemId, enabled) {
  const [state, setState] = useState({ doc: null, loading: enabled, error: null });

  const load = useCallback(() => {
    if (!enabled) return;
    api(`/brain/doc/${encodeURIComponent(itemId)}`)
      .then((doc) => setState({ doc, loading: false, error: null }))
      .catch((e) => setState({ doc: null, loading: false, error: e.message }));
  }, [itemId, enabled]);

  useEffect(() => {
    setState((st) => ({ ...st, loading: true }));
    load();
  }, [load]);

  const status = state.doc?.status;
  useEffect(() => {
    if (!enabled || !PENDING.has(status)) return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [status, enabled, load]);

  return { ...state, reload: load };
}

const STATUS_COPY = {
  queued: 'Queued for the Archive…',
  transcribing: 'Winding the reels — transcribing…',
  embedding: 'Filing it away — indexing…',
};

function ArchiveTab({ item, view }) {
  const { seek } = usePlayer();
  const status = useApi('/brain/status');
  const { doc, loading, error, reload } = useBrainDoc(item.id, true);
  const [adding, setAdding] = useState(false);
  const [summing, setSumming] = useState(false);

  const brain = status.data;
  const inactive = brain && !brain.whisper;

  const addToBrain = async () => {
    setAdding(true);
    try {
      await api('/brain/index', { method: 'POST', body: JSON.stringify({ item }) });
      reload();
    } catch {
      /* surfaced on next reload */
    } finally {
      setAdding(false);
    }
  };

  const generateSummary = async () => {
    setSumming(true);
    try {
      await api(`/brain/summarize/${encodeURIComponent(item.id)}`, { method: 'POST' });
      reload();
    } catch {
      /* leave the prompt */
    } finally {
      setSumming(false);
    }
  };

  // Not in the Archive yet (or the worker is off) → invite to add it.
  if (!loading && (error || !doc)) {
    return (
      <div className={s.brainEmpty}>
        {inactive ? (
          <p className={s.panelEmpty}>
            The Archive is resting — its transcription engine isn’t installed on this
            machine.
          </p>
        ) : (
          <>
            <BookOpen size={20} className={s.brainEmptyIcon} />
            <p className={s.panelEmpty}>
              {view === 'summary'
                ? 'No summary yet. Add this to the Archive to transcribe and summarize it.'
                : 'Not in the Archive yet. Add it to transcribe this video and make it searchable.'}
            </p>
            <button className={s.brainBtn} onClick={addToBrain} disabled={adding}>
              {adding ? 'Adding…' : 'Add to the Archive'}
            </button>
          </>
        )}
      </div>
    );
  }

  if (loading && !doc) {
    return (
      <div className={s.panelCenter}>
        <Spinner />
      </div>
    );
  }

  if (PENDING.has(doc.status)) {
    return (
      <div className={s.brainPending}>
        <Spinner />
        <span className={s.brainStatusText}>{STATUS_COPY[doc.status]}</span>
      </div>
    );
  }

  if (doc.status === 'error') {
    return (
      <div className={s.brainEmpty}>
        <p className={s.panelEmpty}>Couldn’t archive this one: {doc.error}</p>
        <button className={s.brainBtn} onClick={addToBrain} disabled={adding}>
          {adding ? 'Retrying…' : 'Try again'}
        </button>
      </div>
    );
  }

  // ready ----------------------------------------------------------------
  if (view === 'summary') {
    if (doc.summary) {
      return <div className={s.summaryBody}>{doc.summary}</div>;
    }
    return (
      <div className={s.brainEmpty}>
        <Sparkles size={20} className={s.brainEmptyIcon} />
        <p className={s.panelEmpty}>This video is archived but not summarized yet.</p>
        <button
          className={s.brainBtn}
          onClick={generateSummary}
          disabled={summing || (brain && !brain.llm_ready)}
        >
          {summing ? 'Summarizing…' : 'Write a summary'}
        </button>
        {brain && !brain.llm_ready && (
          <p className={s.brainHint}>Local LLM offline — start Ollama to summarize.</p>
        )}
      </div>
    );
  }

  // transcript view
  const chunks = doc.chunks || [];
  if (!chunks.length) {
    return <p className={s.panelEmpty}>No transcript text was captured.</p>;
  }
  return (
    <div className={s.transcript}>
      {chunks.map((c) => (
        <button
          key={c.idx}
          className={s.tSeg}
          onClick={() => seek(item.id, c.t_start)}
          title={`Jump to ${clock(c.t_start)}`}
        >
          <span className={s.tTime}>{clock(c.t_start)}</span>
          <span className={s.tText}>{c.text}</span>
        </button>
      ))}
    </div>
  );
}

function InfoTab({ item }) {
  const vid = item.extra?.video_id;
  const meta = useApi(vid ? `/youtube/video/${vid}` : '', !!vid);
  const comments = useApi(vid ? `/youtube/comments/${vid}` : '', !!vid);
  const info = meta.data;
  const list = comments.data?.comments || [];

  // Lazily fetch a comment's nested replies by its continuation token.
  const loadReplies = useCallback(
    (token, depth) =>
      api(`/youtube/comments/${vid}/replies?token=${encodeURIComponent(token)}&depth=${depth}`),
    [vid],
  );

  return (
    <>
      {info && (info.view_count != null || info.like_count != null) && (
        <div className={s.panelStats}>
          {info.view_count != null && (
            <span className={s.statChip}>
              <Eye size={13} />
              <b>{compact(info.view_count)}</b>
              {info.live_status === 'is_live' ? 'watching' : 'views'}
            </span>
          )}
          {info.like_count != null && (
            <span className={s.statChip}>
              <ThumbsUp size={13} />
              <b>{compact(info.like_count)}</b>
              likes
            </span>
          )}
        </div>
      )}

      {info?.description ? (
        <section className={s.panelSection}>
          <div className={s.panelLabel}>Description</div>
          <Description text={info.description} />
        </section>
      ) : null}

      <section className={s.panelSection}>
        <div className={s.panelLabel}>
          <MessageCircle size={12} /> Comments
          {list.length > 0 && <span className={s.labelCount}>{list.length}</span>}
        </div>
        {comments.loading && (
          <div className={s.panelCenter}>
            <Spinner />
          </div>
        )}
        {comments.error && <p className={s.panelEmpty}>Comments unavailable right now.</p>}
        {!comments.loading && !comments.error && list.length === 0 && (
          <p className={s.panelEmpty}>No comments to show.</p>
        )}
        {list.length > 0 && <CommentThread comments={list} loadReplies={loadReplies} />}
      </section>
    </>
  );
}

const TABS = [
  { id: 'info', label: 'Info', Icon: BookOpen },
  { id: 'transcript', label: 'Transcript', Icon: FileText },
  { id: 'summary', label: 'Summary', Icon: Sparkles },
];

// A free-floating card pinned to the screen edge (detached from the centered
// video) holding the focused video's info, transcript and AI summary. Self-
// contained: every tab fetches its own data.
export default function PlayerSidePanel({ item, onClose }) {
  const channelId = item.extra?.channel_id;
  const [tab, setTab] = useState('info');

  return (
    <aside className={s.floatPanel}>
      <div className={s.panelHead}>
        {item.thumbnail && (
          <img className={s.panelHeadThumb} src={item.thumbnail} alt="" loading="lazy" />
        )}
        <div className={s.panelHeadText}>
          <span className={s.panelHeadTitle}>{item.title}</span>
          {channelId ? (
            <Link className={s.panelHeadChannel} to={`/youtube/c/${channelId}`}>
              {item.source}
            </Link>
          ) : (
            <span className={s.panelHeadChannel}>{item.source}</span>
          )}
        </div>
        <button className={s.btn} title="Hide panel" onClick={onClose} aria-label="Hide panel">
          <X size={15} />
        </button>
      </div>

      <div className={s.panelTabs}>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`${s.panelTab} ${tab === id ? s.panelTabActive : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      <div className={s.panelScroll}>
        {tab === 'info' ? <InfoTab item={item} /> : <ArchiveTab item={item} view={tab} />}
      </div>
    </aside>
  );
}
