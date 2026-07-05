import { useCallback, useEffect, useState } from 'react';
import { BookOpen, CornerDownLeft, FileText, Play, Sparkles, Trash2 } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { SectionHead } from '../components/layout/Section.jsx';
import { EmptyState, SegmentedControl, Spinner } from '../components/ui/index.jsx';
import { clock, timeAgo } from '../lib/time.js';
import { usePlayer } from '../state.jsx';
import s from './archive.module.css';

const SIGNAL = 'var(--signal)';
const PENDING = new Set(['queued', 'transcribing', 'embedding']);
const STATUS_LABEL = {
  queued: 'queued',
  transcribing: 'transcribing',
  embedding: 'indexing',
  ready: 'ready',
  error: 'error',
};

// Rebuild a playable feed item from a stored Archive row.
function toItem(r) {
  const vid = r.item_id?.startsWith('yt:') ? r.item_id.slice(3) : null;
  return {
    id: r.item_id,
    platform: 'youtube',
    title: r.title,
    source: r.source_name,
    url: r.url || (vid ? `https://www.youtube.com/watch?v=${vid}` : undefined),
    thumbnail: r.thumbnail || (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : undefined),
    extra: { video_id: vid },
  };
}

function StatusPill({ status }) {
  return (
    <span className={`${s.pill} ${s[`pill_${status}`] || ''}`} data-status={status}>
      {PENDING.has(status) && <span className={s.pillDot} />}
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// ---- Ask the Archive ---------------------------------------------------
function AskBlock({ ready, onJump }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState({ loading: false, answer: null, citations: [], error: null });

  const ask = async (e) => {
    e?.preventDefault();
    const question = q.trim();
    if (!question || state.loading) return;
    setState({ loading: true, answer: null, citations: [], error: null });
    try {
      const d = await api('/brain/ask', { method: 'POST', body: JSON.stringify({ question }) });
      setState({ loading: false, answer: d.answer, citations: d.citations || [], error: null, empty: d.empty });
    } catch (err) {
      setState({ loading: false, answer: null, citations: [], error: err.message });
    }
  };

  return (
    <section className={s.block}>
      <div className={s.blockHead}>
        <Sparkles size={15} /> Ask the Archive
      </div>
      <form className={s.askForm} onSubmit={ask}>
        <textarea
          className={s.askInput}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            ready
              ? 'Ask anything about the videos you’ve watched…'
              : 'The local LLM is offline — start Ollama to ask.'
          }
          rows={2}
          disabled={!ready}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(e);
          }}
        />
        <button className={s.askBtn} disabled={!ready || state.loading || !q.trim()}>
          {state.loading ? <Spinner /> : <><CornerDownLeft size={13} /> Ask</>}
        </button>
      </form>

      {state.error && <p className={s.muted}>Couldn’t answer: {state.error}</p>}
      {state.empty && <p className={s.muted}>Nothing in the Archive touches on that yet.</p>}
      {state.answer && (
        <div className={s.answer}>
          <p className={s.answerText}>{state.answer}</p>
          {state.citations.length > 0 && (
            <div className={s.cites}>
              {state.citations.map((c) => (
                <button
                  key={c.n}
                  className={s.cite}
                  onClick={() => onJump(c, c.t_start)}
                  title={`${c.title} · ${clock(c.t_start)}`}
                >
                  <span className={s.citeN}>{c.n}</span>
                  <span className={s.citeTitle}>{c.title}</span>
                  <span className={s.citeTime}>{clock(c.t_start)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---- Search ------------------------------------------------------------
function SearchBlock({ onJump }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState({ loading: false, results: null, mode: null });

  const run = async (e) => {
    e?.preventDefault();
    const query = q.trim();
    if (!query) return;
    setState({ loading: true, results: null, mode: null });
    try {
      const d = await api(`/brain/search?q=${encodeURIComponent(query)}`);
      setState({ loading: false, results: d.results, mode: d.mode });
    } catch {
      setState({ loading: false, results: [], mode: null });
    }
  };

  return (
    <section className={s.block}>
      <div className={s.blockHead}>
        <FileText size={15} /> Search transcripts
      </div>
      <form className={s.searchRow} onSubmit={run}>
        <input
          className="search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a moment by what was said…"
          spellCheck={false}
        />
        <button className={s.searchGo} disabled={!q.trim()}>Search</button>
      </form>

      {state.loading && <div className={s.center}><Spinner /></div>}
      {state.results && state.results.length === 0 && (
        <p className={s.muted}>No matching moments — try indexing more videos.</p>
      )}
      {state.results && state.results.length > 0 && (
        <>
          {state.mode === 'keyword' && (
            <p className={s.modeNote}>Keyword match (semantic search needs Ollama).</p>
          )}
          <div className={s.results}>
            {state.results.map((r, i) => (
              <button key={i} className={s.result} onClick={() => onJump(r, r.t_start)}>
                {r.thumbnail && <img className={s.resultThumb} src={r.thumbnail} alt="" />}
                <span className={s.resultBody}>
                  <span className={s.resultTop}>
                    <span className={s.resultTitle}>{r.title}</span>
                    <span className={s.resultTime}>
                      <Play size={9} /> {clock(r.t_start)}
                    </span>
                  </span>
                  <span className={s.resultSnippet}>{r.snippet}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ---- Digest ------------------------------------------------------------
function DigestBlock({ ready }) {
  const [range, setRange] = useState('day');
  const digest = useApi(ready ? `/brain/digest?range=${range}` : '', ready);

  return (
    <section className={s.block}>
      <div className={s.blockHead}>
        <BookOpen size={15} /> The digest
        <span className={s.blockHeadCtl}>
          <SegmentedControl
            options={[
              { value: 'day', label: 'Today' },
              { value: 'week', label: 'This week' },
            ]}
            value={range}
            onChange={setRange}
          />
        </span>
      </div>
      {!ready && <p className={s.muted}>Start Ollama to brew a digest of what you’ve watched.</p>}
      {ready && digest.loading && <div className={s.center}><Spinner /></div>}
      {ready && digest.data && (
        digest.data.count === 0 ? (
          <p className={s.muted}>Nothing archived in this window yet.</p>
        ) : (
          <div className={s.digest}>{digest.data.text}</div>
        )
      )}
    </section>
  );
}

// ---- Browse / shelf ----------------------------------------------------
function BrowseBlock({ docs, onOpen, onRemove }) {
  if (!docs) return <div className={s.center}><Spinner /></div>;
  if (docs.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={30} />}
        color={SIGNAL}
        title="The Archive is empty"
        subtitle="Open a video, then ‘Add to the Archive’ from its side panel to transcribe and index it."
      />
    );
  }
  return (
    <section className={s.block}>
      <div className={s.blockHead}>In the Archive · {docs.length}</div>
      <div className={s.shelf}>
        {docs.map((d) => (
          <div key={d.item_id} className={s.row}>
            <button
              className={s.rowMain}
              onClick={() => d.status === 'ready' && onOpen(d)}
              disabled={d.status !== 'ready'}
            >
              {d.thumbnail && <img className={s.rowThumb} src={d.thumbnail} alt="" />}
              <span className={s.rowBody}>
                <span className={s.rowTitle}>{d.title || d.item_id}</span>
                <span className={s.rowMeta}>
                  {d.source_name || '—'}
                  {d.indexed_at ? ` · ${timeAgo(d.indexed_at)}` : ''}
                </span>
              </span>
            </button>
            <StatusPill status={d.status} />
            <button className={s.rowDel} title="Remove from Archive" onClick={() => onRemove(d.item_id)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Archive() {
  const { open } = usePlayer();
  const status = useApi('/brain/status');
  const docsApi = useApi('/brain/docs');
  const docs = docsApi.data?.items;

  const brain = status.data;
  const llmReady = !!brain?.llm_ready;
  const anyPending = (docs || []).some((d) => PENDING.has(d.status));

  // Keep the shelf + status live while anything is still processing.
  useEffect(() => {
    if (!anyPending) return undefined;
    const t = setInterval(() => {
      docsApi.reload();
      status.reload();
    }, 4000);
    return () => clearInterval(t);
  }, [anyPending, docsApi, status]);

  const jump = useCallback((r, t) => open(toItem(r), { start: t }), [open]);

  const remove = useCallback(
    async (itemId) => {
      try {
        await api(`/brain/doc/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
        docsApi.reload();
      } catch {
        /* ignore */
      }
    },
    [docsApi],
  );

  return (
    <>
      <SectionHead
        kicker="No 05 — The Archive"
        title="The Archive"
        note="Everything you’ve watched, transcribed and searchable — a private memory that never leaves this machine."
        color={SIGNAL}
      >
        {brain && (
          <span className={s.engine} data-on={!!brain.whisper}>
            <span className={s.engineDot} />
            {brain.whisper ? (brain.ollama ? 'engine warm' : 'transcribing only') : 'engine resting'}
          </span>
        )}
      </SectionHead>

      {brain && !brain.whisper && (
        <p className={s.banner}>
          The Archive’s transcription engine isn’t installed here, so new videos can’t be
          indexed. Existing transcripts remain searchable.
        </p>
      )}

      <div className={s.layout}>
        <AskBlock ready={llmReady} onJump={jump} />
        <SearchBlock onJump={jump} />
        <DigestBlock ready={llmReady} />
        <BrowseBlock docs={docs} onOpen={(d) => open(toItem(d))} onRemove={remove} />
      </div>
    </>
  );
}
