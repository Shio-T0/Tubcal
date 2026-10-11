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
// Accounts that score by category (AniList's advanced scoring) get a meter per
// category under the verdict, with their average one tap from becoming the score.
// On the phone those meters stay read-only until Edit and write only on Save.
//
// Raised by CurtainCallHost; data from /anime/finale/<id> (one call, mostly cache)
// plus /anime/me for the scoring categories (the viewer, cached server-side).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, Bookmark, CalendarCheck, Check, Clock, Flag, MessagesSquare, PenLine, Play, SlidersHorizontal,
  Sparkles, Star, X,
} from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { applyOverlay, useAnimeSync, useToast } from '../../state.jsx';
import { MarkdownComposer } from './Composer.jsx';
import { ReviewForm } from './Reviews.jsx';
import { ThreadView } from './Thread.jsx';
import { CategoryScores, ScoreDial } from './Scoring.jsx';
import { hundredOf, scoreText, wordFor } from './scoring.js';
import { STATUS_LABEL, SyncBadge, formatLabel } from './shared.jsx';
import c from './curtain.module.css';

// The phone build (its vite config defines this) confirms score edits explicitly.
/* global __TUBCAL_APP__ */
const PHONE = typeof __TUBCAL_APP__ !== 'undefined' && !!__TUBCAL_APP__.phone;

// ── your verdict, and the score by category ─────────────────────────────────

function Verdict({ media, format, score, onScore, sync }) {
  const [hover, setHover] = useState(0);
  const shown = hover || score;
  return (
    <section className={c.card}>
      <h2 className={c.cardHead}>
        <Star size={15} /> Your verdict
        {sync && <SyncBadge status={sync} />}
      </h2>
      <p className={c.word} aria-live="polite">
        {shown
          ? format === 'POINT_3'
            ? wordFor(shown, format)
            : <><b>{wordFor(shown, format)}</b><span>{scoreText(shown, format)}</span></>
          : 'How was it, all told?'}
      </p>

      <ScoreDial format={format} value={score} onSet={onScore} onPreview={setHover} />

      <div className={c.verdictFoot}>
        {media.score ? <span>AniList average <b>{media.score}%</b></span> : <span />}
        {score > 0 && <button type="button" className={c.linkBtn} onClick={() => onScore(0)}>clear</button>}
      </div>
    </section>
  );
}

/** Advanced scoring: a meter per category, or — when the account has it off — an
 *  offer to switch it on (AniList keeps the category names even while it's off). */
function ByCategory({ categories, entry, format, score, onScores, onScore, onEnabled }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!categories.length) {
    const enable = async () => {
      setBusy(true);
      try {
        const st = await api('/anime/settings', { method: 'POST', body: JSON.stringify({ advanced_scoring_enabled: true }) });
        if (!st?.advanced_scoring?.length) {
          await api('/anime/settings', {
            method: 'POST',
            body: JSON.stringify({ advanced_scoring: ['Story', 'Characters', 'Visuals', 'Audio', 'Enjoyment'] }),
          });
        }
        onEnabled();
      } catch (e) {
        toast(e.message, 'error');
        setBusy(false);
      }
    };
    return (
      <section className={`${c.card} ${c.catsOff}`}>
        <h2 className={c.cardHead}><SlidersHorizontal size={15} /> By category</h2>
        <p>Rate the story, characters, visuals and the rest one by one — AniList calls it advanced scoring, and it's off on your account.</p>
        <button type="button" className={c.linkBtn} disabled={busy} onClick={enable}>
          {busy ? 'switching it on…' : 'Turn on category scoring'}
        </button>
      </section>
    );
  }

  return (
    <section className={c.card}>
      <h2 className={c.cardHead}><SlidersHorizontal size={15} /> By category</h2>
      <CategoryScores
        categories={categories}
        scores={entry?.advanced_scores}
        format={format}
        verdict={score}
        onCommit={onScores}
        onUseAverage={onScore}
        confirm={PHONE}
      />
    </section>
  );
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
  const me = useApi('/anime/me');
  const navigate = useNavigate();
  const sheetRef = useRef(null);
  const sideRef = useRef(null);
  const footRef = useRef(null);
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

  // The side column (verdict, categories, what's next) can outgrow the sheet. Stuck
  // at the top it would hide its own foot behind the sheet's, so it sticks by its
  // bottom edge instead: it scrolls along until its last card is in view, then stays.
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const side = sideRef.current;
    if (!sheet || !side || typeof ResizeObserver === 'undefined') return undefined;
    const fit = () => {
      const room = sheet.clientHeight - (footRef.current?.offsetHeight || 0) - 16;
      side.style.top = `${Math.min(16, room - side.offsetHeight)}px`;
    };
    const ro = new ResizeObserver(fit);
    ro.observe(sheet);
    ro.observe(side);
    fit();
    return () => ro.disconnect();
  }, [eligible]);

  if (!eligible) {
    if (!manual || !res.loading) return null;
    return createPortal(<div className={c.backdrop}><div className={c.loading}>raising the curtain…</div></div>, document.body);
  }

  const format = d.score_format;
  const score = entry?.score || 0;
  const setScore = (v) => queueListEdit({ id: media.id, list_entry: entry }, { score: v });
  const setCategories = (scores) => queueListEdit({ id: media.id, list_entry: entry }, { advanced_scores: scores });
  const categories = me.data?.advanced_scoring;
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
      <div ref={sheetRef} className={c.sheet} role="dialog" aria-modal="true" aria-labelledby="cc-title" onMouseDown={(e) => e.stopPropagation()}>
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
          <aside ref={sideRef} className={c.side}>
            <Verdict media={media} format={format} score={score} onScore={setScore} sync={syncState?.[media.id]} />
            {categories && (
              <ByCategory
                categories={categories}
                entry={entry}
                format={format}
                score={score}
                onScores={setCategories}
                onScore={setScore}
                onEnabled={me.reload}
              />
            )}
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

        <footer ref={footRef} className={c.foot}>
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
