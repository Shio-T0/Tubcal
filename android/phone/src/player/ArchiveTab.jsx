// The Archive under a video on the phone (the Archive room's part of the phone app,
// in its split APK): the Transcript tab, which follows the playhead and seeks on a
// tap, and the Summary tab. The player loads it when this phone has the room.

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Sparkles } from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';
import { clock } from '@pc/lib/time.js';

import a from './archiveTab.module.css';
import p from './player.module.css';

const PENDING = new Set(['queued', 'transcribing', 'embedding']);

export default function ArchiveTab({ item, view, pos, ctx }) {
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
      <div className={a.invite}>
        <BookOpen size={22} />
        <p>Not in the Archive yet.</p>
        <button type="button" onClick={() => run('/brain/index', { item })} disabled={busy}>{busy ? 'Adding…' : 'Add to the Archive'}</button>
      </div>
    );
  }
  if (PENDING.has(doc.d.status)) return <p className={p.muted}>In the Archive's queue — {doc.d.status}…</p>;
  if (doc.d.status === 'error') return <p className={p.muted}>Couldn't archive this one: {doc.d.error}</p>;
  if (view === 'summary') {
    if (doc.d.summary) return <div className={a.summary}>{doc.d.summary}</div>;
    return (
      <div className={a.invite}>
        <Sparkles size={22} />
        <p>Archived, but not summarized yet.</p>
        <button type="button" onClick={() => run(`/brain/summarize/${encodeURIComponent(item.id)}`)} disabled={busy || (brain && !brain.llm_ready)}>{busy ? 'Summarizing…' : 'Write a summary'}</button>
      </div>
    );
  }
  const chunks = doc.d.chunks || [];
  const cur = chunks.reduce((acc, c, i) => (c.t_start <= pos + 0.5 ? i : acc), -1);
  return (
    <div className={a.transcript}>
      {chunks.map((c, i) => (
        <button key={c.idx} type="button" className={`${a.tSeg} ${i === cur ? a.tSegOn : ''}`} onClick={() => ctx.onSeek(c.t_start)}>
          <span>{clock(c.t_start)}</span>
          <p>{c.text}</p>
        </button>
      ))}
    </div>
  );
}
