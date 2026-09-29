// The curtain call — the screen after the last episode of a finished season.
//
// Drapes part on the title you just finished, and everything you'd want to do
// right then is on one sheet: give it your score (one tap, in your own AniList
// scale, with words for the numbers), talk about the finale in its episode
// thread (reply box first — the conversation's right under it), write the review
// while it's fresh (drafts are kept), and see what comes next — up to three
// sequels down the line, each one tap from Planning or Watching. When there's
// nothing after it, it says so: the story's over.
//
// Raised by CurtainCallHost; data from /anime/finale/<id> (one call, mostly cache).

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Bookmark, CalendarCheck, Check, Clock, Flag, Frown, MessagesSquare, Meh, PenLine, Play, Smile,
  Sparkles, Star, X,
} from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { applyOverlay, useAnimeSync, useToast } from '../../state.jsx';
import { MarkdownComposer } from './Composer.jsx';
import { ReviewForm } from './Reviews.jsx';
import { ThreadView } from './Thread.jsx';
import { STATUS_LABEL, SyncBadge, formatLabel } from './shared.jsx';
import c from './curtain.module.css';

// ── scores, in any of AniList's five scales ──────────────────────────────────

const WORDS = ['', 'Appalling', 'Horrible', 'Very bad', 'Bad', 'Average', 'Fine', 'Good', 'Very good', 'Great', 'Masterpiece'];
const TENS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** A score in the viewer's format → the nearest whole 1–10 (for words and tiles). */
function tenOf(v, f) {
  if (!v) return 0;
  if (f === 'POINT_100') return Math.max(1, Math.round(v / 10));
  if (f === 'POINT_5') return v * 2;
  if (f === 'POINT_3') return { 1: 3, 2: 6, 3: 9 }[v] || 0;
  return Math.max(1, Math.round(v));
}
/** …and → 0–100, to seed a review's score from the rating. */
function hundredOf(v, f) {
  if (!v) return null;
  if (f === 'POINT_100') return v;
  if (f === 'POINT_5') return v * 20;
  if (f === 'POINT_3') return { 1: 35, 2: 60, 3: 85 }[v] ?? null;
  return Math.round(v * 10);
}

function Verdict({ media, format, score, onScore, sync }) {
  const [hover, setHover] = useState(0);
  const shown = hover || tenOf(score, format);
  const faces = [[1, Frown, 'Not for me'], [2, Meh, 'It was fine'], [3, Smile, 'Loved it']];
  return (
    <section className={c.card}>
      <h2 className={c.cardHead}>
        <Star size={15} /> Your verdict
        {sync && <SyncBadge status={sync} />}
      </h2>
      <p className={c.word} aria-live="polite">
        {format === 'POINT_3'
          ? (faces.find(([n]) => n === (hover || score))?.[2] || 'How was it, all told?')
          : shown ? <><b>{WORDS[shown]}</b><span>{scoreText(hover ? fromHover(hover, format) : score, format)}</span></> : 'How was it, all told?'}
      </p>

      {format === 'POINT_5' && (
        <div className={c.stars} onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={c.star}
              data-on={(hover ? hover / 2 : score) >= n ? '' : undefined}
              onMouseEnter={() => setHover(n * 2)}
              onClick={() => onScore(score === n ? 0 : n)}
              aria-label={`${n} of 5`}
            >
              <Star size={30} fill="currentColor" />
            </button>
          ))}
        </div>
      )}

      {format === 'POINT_3' && (
        <div className={c.faces}>
          {faces.map(([n, Icon, label]) => (
            <button
              key={n}
              type="button"
              className={c.face}
              data-on={score === n ? '' : undefined}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => onScore(score === n ? 0 : n)}
              aria-label={label}
            >
              <Icon size={30} />
            </button>
          ))}
        </div>
      )}

      {!['POINT_5', 'POINT_3'].includes(format) && (
        <>
          <div className={c.tens} onMouseLeave={() => setHover(0)} role="radiogroup" aria-label="Score">
            {TENS.map((n) => {
              const on = tenOf(score, format) === n;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={c.ten}
                  data-on={on ? '' : undefined}
                  data-lit={(hover || tenOf(score, format)) >= n ? '' : undefined}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => onScore(fromHover(n, format))}
                  title={WORDS[n]}
                >
                  {n}
                </button>
              );
            })}
          </div>
          {(format === 'POINT_100' || format === 'POINT_10_DECIMAL') && score > 0 && (
            <label className={c.fine}>
              <span>fine-tune</span>
              <input
                type="range"
                min={format === 'POINT_100' ? 1 : 0.5}
                max={format === 'POINT_100' ? 100 : 10}
                step={format === 'POINT_100' ? 1 : 0.5}
                value={score}
                style={{ '--pct': `${(score / (format === 'POINT_100' ? 100 : 10)) * 100}%` }}
                onChange={(e) => onScore(Number(e.target.value))}
              />
              <b>{score}</b>
            </label>
          )}
        </>
      )}

      <div className={c.verdictFoot}>
        {media.score ? <span>AniList average <b>{media.score}%</b></span> : <span />}
        {score > 0 && <button type="button" className={c.linkBtn} onClick={() => onScore(0)}>clear</button>}
      </div>
    </section>
  );
}

/** A 1–10 tile (or a star, counted in tens) → a score in the viewer's format. */
function fromHover(n, format) {
  if (format === 'POINT_100') return n * 10;
  if (format === 'POINT_5') return n / 2;
  return n;
}
function scoreText(v, format) {
  if (!v) return '';
  if (format === 'POINT_100') return `${v} / 100`;
  if (format === 'POINT_5') return `${v} / 5`;
  return `${v} / 10`;
}

// ── what comes next ──────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function whenLine(s) {
  const [y, m] = s.start || [];
  if (s.status === 'RELEASING') return s.next_episode ? `airing · ep ${s.next_episode - 1} out` : 'airing now';
  if (s.status === 'NOT_YET_RELEASED') return y ? `coming ${m ? `${MONTHS[m - 1]} ` : ''}${y}` : 'announced · date TBA';
  if (s.status === 'HIATUS') return 'on hiatus';
  return y ? String(y) : '';
}

function NextUp({ sequels, onSet, onOpen }) {
  const { overlay } = useAnimeSync();
  if (!sequels.length) {
    return (
      <section className={`${c.card} ${c.theEnd}`}>
        <span className={c.owari} lang="ja" aria-hidden="true">終</span>
        <h2 className={c.endTitle}>Series finished</h2>
        <p>Nothing comes after this one on AniList — that's the whole story.</p>
      </section>
    );
  }
  return (
    <section className={c.card}>
      <h2 className={c.cardHead}><Flag size={15} /> What comes next</h2>
      <ol className={c.sequels}>
        {sequels.map((s, i) => {
          const entry = applyOverlay(s.id, s.list ? { id: s.list.entry_id, status: s.list.status, progress: s.list.progress } : null, overlay);
          const st = entry?.status;
          const unreleased = s.status === 'NOT_YET_RELEASED';
          return (
            <li key={s.id} className={c.sequel} style={{ '--i': i }}>
              <button type="button" className={c.seqCover} onClick={() => onOpen(s.id)} title="Open its page">
                {s.cover ? <img src={s.cover} alt="" /> : null}
                <span className={c.seqStep}>{i + 1}</span>
              </button>
              <div className={c.seqText}>
                <button type="button" className={c.seqTitle} onClick={() => onOpen(s.id)}>{s.title}</button>
                <span className={c.seqMeta}>
                  {[formatLabel(s.format), whenLine(s), s.episodes ? `${s.episodes} eps` : null].filter(Boolean).join(' · ')}
                </span>
                <div className={c.choice} role="group" aria-label={`Add ${s.title} to your list`}>
                  <button
                    type="button"
                    className={st === 'PLANNING' ? c.choiceOn : ''}
                    aria-pressed={st === 'PLANNING'}
                    onClick={() => st !== 'PLANNING' && onSet(s, entry, 'PLANNING')}
                  >
                    {st === 'PLANNING' ? <Check size={13} /> : <Bookmark size={13} />} Planning
                  </button>
                  <button
                    type="button"
                    className={st === 'CURRENT' ? c.choiceOn : ''}
                    aria-pressed={st === 'CURRENT'}
                    disabled={unreleased}
                    title={unreleased ? "It hasn't started airing yet" : undefined}
                    onClick={() => st !== 'CURRENT' && onSet(s, entry, 'CURRENT')}
                  >
                    {st === 'CURRENT' ? <Check size={13} /> : <Play size={13} />} Watching
                  </button>
                </div>
                {st && st !== 'PLANNING' && st !== 'CURRENT' && (
                  <span className={c.already}>already on your list · {STATUS_LABEL[st] || st}</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {sequels.length < 3 && <p className={c.chainEnd}>…and that's as far as the story goes, for now.</p>}
    </section>
  );
}

// ── the finale's discussion ──────────────────────────────────────────────────

function FinaleTalk({ thread, episode, media }) {
  const toast = useToast();
  const [started, setStarted] = useState(null);
  const id = thread?.id || started;
  if (id) {
    return (
      <>
        <p className={c.talkNote}>
          Episode {episode}{thread ? ` · ${thread.replies} ${thread.replies === 1 ? 'reply' : 'replies'}` : ''} — you've seen it, so spoilers are fair game.
        </p>
        <ThreadView threadId={id} variant="pane" composerFirst />
      </>
    );
  }
  const start = async (text) => {
    try {
      const res = await api('/anime/thread', {
        method: 'POST',
        body: JSON.stringify({
          title: `[Spoilers] ${media.title_romaji || media.title} - Episode ${episode} Discussion`,
          body: text,
          categories: [1, 5],
          media_ids: [media.id],
        }),
      });
      if (res?.id) setStarted(res.id);
      toast('Thread started on AniList', 'success');
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  };
  return (
    <div className={c.noThread}>
      <MessagesSquare size={26} />
      <h3>No one opened a thread for episode {episode}</h3>
      <p>Start it — your first thoughts become the opening post, filed under Release Discussion for this title.</p>
      <MarkdownComposer
        previewAs="thread"
        submitLabel="Start the discussion"
        placeholder="What did the finale do to you?"
        draftKey={`finale:${media.id}`}
        onSubmit={start}
      />
    </div>
  );
}

// ── the sheet ────────────────────────────────────────────────────────────────

function hoursLine(media, entry) {
  const eps = media.episodes || entry?.progress || 0;
  const min = eps * (media.duration || 24);
  if (!min) return null;
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}m` : `${min}m`;
}

function dayLine(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const SEASON = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };

export default function CurtainCall({ mediaId, manual, onShown, onDone }) {
  const res = useApi(`/anime/finale/${mediaId}`);
  const navigate = useNavigate();
  const { overlay, queueListEdit, syncState } = useAnimeSync();
  const [tab, setTab] = useState('talk');
  const d = res.data;
  const media = d?.media;
  // Only a season that's actually over gets a curtain call on its own.
  const eligible = !!media && (manual || media.status === 'FINISHED');

  useEffect(() => {
    if (res.loading) return;
    if (!eligible) onDone();
    else onShown?.();
  }, [res.loading, eligible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!eligible) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onDone(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.dataset.playerExpanded = document.body.dataset.playerExpanded || 'curtain';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (document.body.dataset.playerExpanded === 'curtain') delete document.body.dataset.playerExpanded;
    };
  }, [eligible, onDone]);

  const entry = useMemo(
    () => (media ? applyOverlay(media.id, media.list_entry, overlay) : null),
    [media, overlay],
  );

  if (!eligible) {
    if (!manual || !res.loading) return null;
    return createPortal(<div className={c.backdrop}><div className={c.loading}>raising the curtain…</div></div>, document.body);
  }

  const format = d.score_format;
  const score = entry?.score || 0;
  const setScore = (v) => queueListEdit({ id: media.id, list_entry: entry }, { score: v });
  const setSequel = (s, cur, status) => {
    queueListEdit({ id: s.id, list_entry: cur }, status === 'CURRENT' && !cur ? { status, progress: 0 } : { status });
  };
  const open = (id) => { onDone(); navigate(`/anime/${id}`); };
  const art = media.banner || media.cover_xl;
  const facts = [
    media.episodes ? { Icon: Play, text: `${media.episodes} episodes` } : null,
    hoursLine(media, entry) ? { Icon: Clock, text: `${hoursLine(media, entry)} watched` } : null,
    entry?.started_at ? { Icon: CalendarCheck, text: `${dayLine(entry.started_at)} → ${dayLine(entry.completed_at) || 'today'}` } : null,
  ].filter(Boolean);

  return createPortal(
    <div className={c.backdrop} onMouseDown={onDone} style={{ '--accent': media.color || 'var(--c-anime)' }}>
      <span className={`${c.drape} ${c.drapeL}`} aria-hidden="true" />
      <span className={`${c.drape} ${c.drapeR}`} aria-hidden="true" />
      <div className={c.sheet} role="dialog" aria-modal="true" aria-labelledby="cc-title" onMouseDown={(e) => e.stopPropagation()}>
        <header className={c.hero}>
          {art && <img className={c.heroArt} src={art} alt="" />}
          <span className={c.heroScrim} aria-hidden="true" />
          <button type="button" className={c.close} onClick={onDone} aria-label="Close (Esc)" title="Close (Esc)">
            <X size={18} />
          </button>
          {media.cover_xl && <img className={c.cover} src={media.cover_xl} alt="" />}
          <div className={c.heroText}>
            <span className={c.kicker}><Sparkles size={13} /> Curtain call · completed</span>
            <h1 id="cc-title" className={c.title}>{media.title}</h1>
            {media.title_native && <p className={c.native} lang="ja">{media.title_native}</p>}
            <ul className={c.facts}>
              {facts.map(({ Icon, text }) => <li key={text}><Icon size={13} /> {text}</li>)}
              {(media.season || media.year) && <li>{[SEASON[media.season], media.year].filter(Boolean).join(' ')}</li>}
              {media.studios?.[0] && <li>{media.studios[0]}</li>}
            </ul>
          </div>
        </header>

        <div className={c.body}>
          <aside className={c.side}>
            <Verdict media={media} format={format} score={score} onScore={setScore} sync={syncState?.[media.id]} />
            <NextUp sequels={d.sequels || []} onSet={setSequel} onOpen={open} />
          </aside>

          <section className={c.main}>
            <div className={c.tabs} role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'talk'} className={tab === 'talk' ? c.tabOn : c.tab} onClick={() => setTab('talk')}>
                <MessagesSquare size={15} /> The finale's discussion
                {d.thread?.replies ? <em>{d.thread.replies}</em> : null}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'review'} className={tab === 'review' ? c.tabOn : c.tab} onClick={() => setTab('review')}>
                <PenLine size={15} /> Review the series
              </button>
            </div>
            <div className={c.panel}>
              {tab === 'talk' ? (
                d.episode
                  ? <FinaleTalk thread={d.thread} episode={d.episode} media={media} />
                  : <p className={c.muted}>AniList doesn't know how many episodes this has, so there's no finale thread to find.</p>
              ) : (
                <ReviewForm
                  media={media}
                  initialScore={hundredOf(score, format)}
                  rows={12}
                />
              )}
            </div>
          </section>
        </div>

        <footer className={c.foot}>
          <button type="button" className={c.linkBtn} onClick={() => open(media.id)}>
            Open the title page <ArrowUpRight size={13} />
          </button>
          <button type="button" className={c.done} onClick={onDone}>Done</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
