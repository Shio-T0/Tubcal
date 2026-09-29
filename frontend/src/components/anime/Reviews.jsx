// Reviews: the card (a letter to the editor), the reader, and the composer.
//
// A review card leads with its summary as a pull-quote and the reviewer's score
// in a round seal — the texture of a letters page, not a feed. The reader shows
// the full piece (AniList's HTML, sanitised by AniHtml) with helpful / not
// helpful votes. The composer checks AniList's own rules as you type and
// previews the piece live beside the text (AniList's own render once you pause),
// so what you see is what posts.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, Lock, PenLine, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { Receiving } from '../layout/Section.jsx';
import { useToast } from '../../state.jsx';
import { timeAgo } from '../../lib/time.js';
import { MarkdownComposer } from './Composer.jsx';
import { UserLink } from './Person.jsx';
import { AniHtml } from './RichText.jsx';
import r from './reviews.module.css';

const SUMMARY_MIN = 20;
const SUMMARY_MAX = 120;
const BODY_MIN = 2200;

function Seal({ score, size = 'md' }) {
  if (score == null) return null;
  return (
    <span className={`${r.seal} ${size === 'lg' ? r.sealLg : ''}`} style={{ '--pct': `${score}%` }}>
      <span>{score}</span>
    </span>
  );
}

const helpful = (x) => (x.rating_amount ? `${x.rating} of ${x.rating_amount} found this helpful` : 'no votes yet');

export function ReviewCard({ review, onOpen, showMedia = true, index = 0 }) {
  const m = review.media || {};
  return (
    <article
      className={r.card}
      style={{ '--cover-c': m.color || 'var(--c-anime)', '--i': Math.min(index, 10) }}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      tabIndex={0}
      role="button"
      aria-label={`Read ${review.user?.name}'s review${m.title ? ` of ${m.title}` : ''}`}
    >
      {showMedia && (
        <div className={r.cardArt} style={m.banner || m.cover_xl ? { backgroundImage: `url(${m.banner || m.cover_xl})` } : undefined}>
          {m.cover && <img src={m.cover} alt="" loading="lazy" />}
          <span className={r.cardMedia}>{m.title}</span>
        </div>
      )}
      <div className={`${r.cardBody} ${showMedia ? '' : r.cardBodyPlain}`}>
        <Seal score={review.score} />
        <blockquote className={r.quote}>{review.summary}</blockquote>
        <footer className={r.byline}>
          <UserLink user={review.user} size="xs" />
          <span className={r.when}>{timeAgo(review.created_at)}</span>
          <span className={r.helpful}><ThumbsUp size={11} /> {helpful(review)}</span>
        </footer>
      </div>
    </article>
  );
}

export function ReviewModal({ id, onClose }) {
  const rev = useApi(`/anime/review/${id}`);
  const toast = useToast();
  const [vote, setVote] = useState(null);
  const [counts, setCounts] = useState(null);
  const d = rev.data;
  useEffect(() => {
    if (d) { setVote(d.user_rating); setCounts({ rating: d.rating, amount: d.rating_amount }); }
  }, [d]);

  const cast = async (want) => {
    const next = vote === want ? 'NO_VOTE' : want;
    try {
      const res = await api(`/anime/review/${id}/rate`, { method: 'POST', body: JSON.stringify({ rating: next }) });
      setVote(res.user_rating);
      setCounts({ rating: res.rating, amount: res.rating_amount });
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return createPortal(
    <div className={r.overlay} onMouseDown={onClose}>
      <div className={r.modal} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className={r.close} onClick={onClose} aria-label="Close"><X size={18} /></button>
        {rev.loading && !d && <Receiving label="unfolding the letter" />}
        {rev.error && <p className={r.err}>{rev.error}</p>}
        {d && (
          <>
            <header className={r.head} style={{ '--cover-c': d.media.color || 'var(--c-anime)' }}>
              {(d.media.banner || d.media.cover_xl) && (
                <div className={r.headArt} style={{ backgroundImage: `url(${d.media.banner || d.media.cover_xl})` }} />
              )}
              <div className={r.headInner}>
                <Link to={`/anime/${d.media.id}`} className={r.headMedia} onClick={onClose}>
                  {d.media.cover && <img src={d.media.cover} alt="" />}
                  <span>
                    <em>A review of</em>
                    {d.media.title}
                  </span>
                </Link>
                <Seal score={d.score} size="lg" />
              </div>
            </header>
            <p className={r.summary}>{d.summary}</p>
            <div className={r.meta}>
              <UserLink user={d.user} size="sm" />
              <span>{timeAgo(d.created_at)}</span>
              {d.private && <span><Lock size={11} /> private</span>}
              {d.site_url && (
                <a href={d.site_url} target="_blank" rel="noreferrer">on AniList <ExternalLink size={11} /></a>
              )}
            </div>
            <AniHtml html={d.body} className={r.body} />
            <footer className={r.votes}>
              <span>Was this review helpful?</span>
              <button className={vote === 'UP_VOTE' ? r.voteOn : r.vote} onClick={() => cast('UP_VOTE')} aria-pressed={vote === 'UP_VOTE'}>
                <ThumbsUp size={14} /> Yes
              </button>
              <button className={vote === 'DOWN_VOTE' ? r.voteOn : r.vote} onClick={() => cast('DOWN_VOTE')} aria-pressed={vote === 'DOWN_VOTE'}>
                <ThumbsDown size={14} /> No
              </button>
              {counts && <em>{counts.rating} of {counts.amount} found it helpful</em>}
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Counter({ n, min, max }) {
  const ok = n >= min && (!max || n <= max);
  return (
    <span className={ok ? r.countOk : r.count}>
      {n.toLocaleString()}{max ? ` / ${min}–${max}` : ` / ${min.toLocaleString()}+`}
    </span>
  );
}

/** The review form itself — summary, the piece (with its live preview), score,
 *  privacy — for a modal or for a page that wants it inline (the curtain call).
 *  Loads your existing review of the title if there is one. `initialScore`
 *  (0–100) seeds a new review's score, e.g. from the rating you just gave. */
const DRAFT = (id) => `tubcal.anime.review.draft.${id}`;
function readDraft(id) {
  try { return JSON.parse(localStorage.getItem(DRAFT(id))) || null; } catch { return null; }
}

export function ReviewForm({ media, initialScore, onSaved, onCancel, rows = 14 }) {
  const mine = useApi(`/anime/review/mine/${media.id}`);
  const toast = useToast();
  // An unpublished review survives closing the page (it's a lot of typing).
  const [form, setForm] = useState(() => {
    const d = readDraft(media.id);
    return { summary: d?.summary || '', body: d?.body || '', score: initialScore ?? 70, private: false };
  });
  const [busy, setBusy] = useState(false);
  const existing = mine.data;
  useEffect(() => {
    if (existing) setForm({ summary: existing.summary || '', body: existing.body || '', score: existing.score ?? 70, private: !!existing.private });
  }, [existing]);
  // A score given elsewhere on the page follows into a review you haven't scored by hand.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!existing && !touched && initialScore != null) setForm((f) => ({ ...f, score: initialScore }));
  }, [initialScore, existing, touched]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    if (existing) return;
    try {
      if (form.summary || form.body) localStorage.setItem(DRAFT(media.id), JSON.stringify({ summary: form.summary, body: form.body }));
    } catch { /* private mode: no drafts, no harm */ }
  }, [form.summary, form.body, existing, media.id]);
  const sLen = form.summary.trim().length;
  const bLen = form.body.trim().length;
  const valid = sLen >= SUMMARY_MIN && sLen <= SUMMARY_MAX && bLen >= BODY_MIN;

  const save = async () => {
    setBusy(true);
    try {
      await api('/anime/review', {
        method: 'POST',
        body: JSON.stringify({ media_id: media.id, id: existing?.id, ...form }),
      });
      toast(existing ? 'Review updated on AniList' : 'Review published to AniList', 'success');
      try { localStorage.removeItem(DRAFT(media.id)); } catch { /* fine */ }
      mine.reload();
      onSaved?.();
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  };

  const remove = async () => {
    if (!existing || !window.confirm('Delete your review from AniList? This cannot be undone.')) return;
    setBusy(true);
    try {
      await api(`/anime/review/${existing.id}?media_id=${media.id}`, { method: 'DELETE' });
      toast('Review deleted', 'success');
      onSaved?.();
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  };

  return (
    <div className={r.form}>
      {mine.loading && !mine.data && !mine.error && <Receiving label="looking for your draft" />}
      {existing && <p className={r.existing}>You've reviewed this before — editing your published review.</p>}

      <label className={r.field}>
        <span className={r.fieldHead}>Summary <Counter n={sLen} min={SUMMARY_MIN} max={SUMMARY_MAX} /></span>
        <input
          value={form.summary}
          maxLength={SUMMARY_MAX + 40}
          onChange={(e) => set('summary', e.target.value)}
          placeholder="One line that sums it up — shown on the review card"
        />
      </label>

      <div className={r.field}>
        <span className={r.fieldHead}>Review <Counter n={bLen} min={BODY_MIN} /></span>
        <MarkdownComposer
          value={form.body}
          onChange={(v) => set('body', v)}
          previewAs="review"
          rows={rows}
          placeholder="Your review. AniList markdown works: __bold__, _italic_, ~!spoilers!~, img(url), links…"
        />
      </div>

      <div className={r.row}>
        <label className={r.scoreField}>
          <span>Score</span>
          <input
            type="range"
            min="0"
            max="100"
            value={form.score}
            onChange={(e) => { setTouched(true); set('score', Number(e.target.value)); }}
            style={{ '--pct': `${form.score}%` }}
          />
          <Seal score={form.score} />
        </label>
        <label className={r.check}>
          <input type="checkbox" checked={form.private} onChange={(e) => set('private', e.target.checked)} />
          <Lock size={12} /> keep it private
        </label>
      </div>

      <footer className={r.actions}>
        {existing && (
          <button type="button" className={r.delete} onClick={remove} disabled={busy}><Trash2 size={13} /> Delete</button>
        )}
        {onCancel && <button type="button" className={r.cancel} onClick={onCancel} disabled={busy}>Not now</button>}
        <span className={r.rule}>{!valid && `AniList needs a ${SUMMARY_MIN}–${SUMMARY_MAX} character summary and ${BODY_MIN.toLocaleString()}+ characters of review.`}</span>
        <button type="button" className={r.publish} onClick={save} disabled={!valid || busy}>
          {busy ? <Loader2 size={14} className={r.spin} /> : <PenLine size={14} />}
          {existing ? 'Update' : 'Publish'}
        </button>
      </footer>
    </div>
  );
}

/** Write or edit your review of a title, in a modal. */
export function ReviewComposer({ media, onClose, onSaved }) {
  return createPortal(
    <div className={r.overlay} onMouseDown={onClose}>
      <div className={`${r.modal} ${r.composer}`} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className={r.close} onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h2 className={r.compTitle}><PenLine size={18} /> Your review — <em>{media.title}</em></h2>
        <ReviewForm media={media} onSaved={() => { onSaved?.(); onClose(); }} />
      </div>
    </div>,
    document.body,
  );
}
