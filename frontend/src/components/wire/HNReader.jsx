// A Hacker News discussion, set for reading: the story up top (with the article
// one click away, and the post's own text for Ask/Show HN), then the thread.
//
// Threads read like HN's best version of itself: the original poster marked
// wherever they reply, every level on its own coloured rail (click a rail to fold
// that branch), a quick "fold all" to skim the top-level takes, and — if you've
// been here before — the comments that arrived since your last visit marked, with
// a chip that walks you through them. Used beside the Wire's board, and as a
// sheet over the Edition.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDownToLine, Bookmark, BookmarkCheck, ChevronsDownUp, ChevronsUpDown, ExternalLink, Link2, MessageSquare, X,
} from 'lucide-react';

import { useApi } from '../../api/client.js';
import { compact } from '../../lib/format.js';
import { ago } from '../../lib/time.js';
import { useSaved, useToast } from '../../state.jsx';
import { Receiving } from '../layout/Section.jsx';
import { HnHtml } from './HnHtml.jsx';
import { lastVisit, visit } from './seen.js';
import r from './reader.module.css';

const KIND = /^(Ask|Show|Tell|Launch) HN:\s*/i;

/** "Ask HN: Why…" → { kind: 'Ask HN', rest: 'Why…' } */
export function splitKind(title = '') {
  const m = KIND.exec(title);
  return m ? { kind: `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} HN`, rest: title.slice(m[0].length) } : { kind: null, rest: title };
}

function countAll(nodes) {
  return (nodes || []).reduce((n, c) => n + 1 + countAll(c.children), 0);
}

function flatten(nodes, out = []) {
  for (const c of nodes || []) {
    out.push(c);
    flatten(c.children, out);
  }
  return out;
}

function Comment({ c, op, since, folded, onFold, onItem }) {
  const isFolded = folded.has(c.id);
  const fresh = since && c.created_at > since;
  const below = countAll(c.children);
  const mine = c.author === op;
  return (
    <div
      className={`${r.comment} ${fresh ? r.fresh : ''}`}
      id={`hn-${c.id}`}
      style={{ '--rail': `var(--rail-${c.depth % 5})` }}
      data-deep={c.depth >= 7 ? '' : undefined}
    >
      <button type="button" className={r.rail} onClick={() => onFold(c.id)} aria-label={isFolded ? 'Unfold' : 'Fold this branch'} title={isFolded ? 'Unfold' : 'Fold this branch'} />
      <div className={r.cBody}>
        <header className={r.cHead}>
          <span className={`${r.author} ${mine ? r.op : ''}`}>{c.author}</span>
          {mine && <span className={r.opTag} title="Whoever posted the story">OP</span>}
          {fresh && <span className={r.newTag}>new</span>}
          <time className={r.cTime}>{ago(c.created_at)}</time>
          {isFolded && below > 0 && <span className={r.foldNote}>+{below} {below === 1 ? 'reply' : 'replies'} folded</span>}
          <button type="button" className={r.fold} onClick={() => onFold(c.id)} aria-label={isFolded ? 'Unfold' : 'Fold'}>
            {isFolded ? '[+]' : '[–]'}
          </button>
        </header>
        {!isFolded && (
          <>
            <HnHtml html={c.body_html} onItem={onItem} />
            {c.children?.length > 0 && (
              <div className={r.children}>
                {c.children.map((k) => (
                  <Comment key={k.id} c={k} op={op} since={since} folded={folded} onFold={onFold} onItem={onItem} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The reader. Give it an `item` (instant header) and/or an `hnId`. */
export function HNReader({ item, hnId: idProp, onClose, onItem, variant = 'pane' }) {
  const hnId = idProp || item?.extra?.hn_id;
  const res = useApi(`/hackernews/item/${hnId}`, !!hnId);
  const story = res.data?.story || item;
  const comments = res.data?.comments;
  const toast = useToast();
  const { saved, toggleSaved } = useSaved();
  const scroller = useRef(null);
  // Your previous visit, read before this one is recorded.
  const [prev] = useState(() => lastVisit(hnId));
  const [folded, setFolded] = useState(() => new Set());
  const [walk, setWalk] = useState(0);

  useEffect(() => {
    if (res.data) visit(hnId, res.data.story?.comments_count ?? countAll(res.data.comments));
  }, [res.data, hnId]);

  const all = useMemo(() => flatten(comments), [comments]);
  const since = prev?.at || null;
  const fresh = useMemo(() => (since ? all.filter((c) => c.created_at > since) : []), [all, since]);

  if (!story) return <div className={r.loading}><Receiving label="pulling the thread" /></div>;

  const { kind, rest } = splitKind(story.title);
  const isLink = story.url && !story.url.includes('news.ycombinator.com/item');
  const hnUrl = `https://news.ycombinator.com/item?id=${hnId}`;
  const isSaved = !!saved[story.id];
  const total = comments ? countAll(comments) : story.comments_count;

  const fold = (id) => setFolded((f) => {
    const n = new Set(f);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const topIds = (comments || []).map((c) => c.id);
  const allFolded = topIds.length > 0 && topIds.every((id) => folded.has(id));
  const toggleAll = () => setFolded(allFolded ? new Set() : new Set(topIds));
  const nextFresh = () => {
    if (!fresh.length) return;
    const target = fresh[walk % fresh.length];
    setFolded(new Set()); // a fresh reply may sit inside a folded branch
    requestAnimationFrame(() => document.getElementById(`hn-${target.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    setWalk((w) => w + 1);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hnUrl);
      toast('Discussion link copied', 'success');
    } catch {
      toast(hnUrl, 'info');
    }
  };

  return (
    <article className={`${r.reader} ${r[variant]}`} ref={scroller}>
      <header className={r.head}>
        <div className={r.headTop}>
          <span className={r.kind}>{kind || (story.extra?.type === 'job' ? 'Hiring' : story.extra?.domain || 'Hacker News')}</span>
          {onClose && (
            <button type="button" className={r.close} onClick={onClose} aria-label="Close the discussion" title="Close (Esc)">
              <X size={17} />
            </button>
          )}
        </div>
        <h2 className={r.title}>
          {isLink ? <a href={story.url} target="_blank" rel="noopener noreferrer">{rest}</a> : rest}
        </h2>
        <div className={r.meta}>
          {story.score != null && <span className={r.points}>▲ {compact(story.score)} points</span>}
          {story.author && <span>by <b>{story.author}</b></span>}
          {story.published_at ? <span>{ago(story.published_at)}</span> : null}
          <span>{compact(total ?? 0)} comments</span>
        </div>
        <div className={r.actions}>
          {isLink && (
            <a className={r.primary} href={story.url} target="_blank" rel="noopener noreferrer">
              Read the article <ExternalLink size={13} />
              {story.extra?.domain && <em>{story.extra.domain}</em>}
            </a>
          )}
          <button type="button" className={`${r.act} ${isSaved ? r.actOn : ''}`} onClick={() => toggleSaved(story)}>
            {isSaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />} {isSaved ? 'Saved' : 'Save'}
          </button>
          <button type="button" className={r.act} onClick={copy} title="Copy the HN discussion link"><Link2 size={14} /> Link</button>
          <a className={r.act} href={hnUrl} target="_blank" rel="noopener noreferrer">HN <ExternalLink size={12} /></a>
        </div>
        {story.text_html && <HnHtml html={story.text_html} className={r.text} onItem={onItem} />}
      </header>

      <div className={r.toolbar}>
        <span className={r.count}><MessageSquare size={14} /> {compact(total ?? 0)} comments</span>
        {fresh.length > 0 && (
          <button type="button" className={r.freshChip} onClick={nextFresh} title="Walk through what's new">
            <ArrowDownToLine size={13} /> {fresh.length} new since {ago(since)}
          </button>
        )}
        {prev && !fresh.length && comments && <span className={r.caught}>nothing new since {ago(since)}</span>}
        {topIds.length > 1 && (
          <button type="button" className={r.tool} onClick={toggleAll}>
            {allFolded ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />} {allFolded ? 'Unfold all' : 'Fold all'}
          </button>
        )}
      </div>

      {res.loading && !comments && <Receiving label="pulling the thread" />}
      {res.error && <p className={r.muted}>Couldn't load the discussion — {res.error}</p>}
      {comments && !comments.length && <p className={r.muted}>No comments yet. Quiet on the wire.</p>}
      {comments && comments.length > 0 && (
        <div className={r.thread}>
          {comments.map((c) => (
            <Comment key={c.id} c={c} op={story.author} since={since} folded={folded} onFold={fold} onItem={onItem} />
          ))}
        </div>
      )}
    </article>
  );
}

/** The reader as a sheet sliding over the page (the Edition, a narrow Wire). */
export function ReaderSheet({ item, hnId, onClose, onItem }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className={r.sheetBackdrop} onMouseDown={onClose}>
      <div className={r.sheetBox} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Discussion">
        <HNReader key={hnId || item?.id} item={item} hnId={hnId} onClose={onClose} onItem={onItem} variant="sheet" />
      </div>
    </div>,
    document.body,
  );
}
