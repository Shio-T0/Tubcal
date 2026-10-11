// "Your list" on a title's page: everything AniList keeps about you and this title,
// laid out as one deck.
//
//   the shelf rail      Watching · Planning · Completed · Paused · Dropped ·
//                       Rewatching; one tap adds the title or moves it
//   where you are       a counter you can type into, a tape of every episode (click
//                       one to mark up to it), −/+1, play or resume the next one,
//                       finish, and what's left in hours or when the next one airs
//   your score          the words for it, ten tiles (or stars / faces, in your own
//                       format), a fine-tune, and how it sits against AniList's
//   the record          an index card with tabs: By category (advanced scoring),
//                       Journal (dates, rewatches, time spent), Notes, Lists & privacy
//
// Edits apply locally at once and flush to AniList on a debounce (state.jsx), so
// nothing here waits on the network. Desktop only — the phone has its own title page.

import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays, Check, Flag, Loader2, Lock, Minus, NotebookPen, Play, Plus, Repeat, RotateCcw, SlidersHorizontal,
  Sparkles, Star, Trash2, Tv, X,
} from 'lucide-react';

import { fetchShared } from '../../lib/useShared.js';
import { ago, clock } from '../../lib/time.js';
import { applyOverlay, useAnimeSync, useProgress } from '../../state.jsx';
import { openCurtainCall } from './CurtainCallHost.jsx';
import { CategoryScores, ScoreDial } from './Scoring.jsx';
import { categoryAverage, fmtScore, hundredOf, scaleOf, wordFor } from './scoring.js';
import {
  MONTH_SHORT, STATUS_META, SyncBadge, airingDateLabel, fmtCountdown, fmtDuration, useCountdownTick, useParamState,
} from './shared.jsx';
import { usePlayEpisode, watchState } from './WatchList.jsx';
import s from '../../pages/anime.module.css';
import k from './listpanel.module.css';

// The tape draws one cell per episode up to this many; past it, a continuous strip.
const TAPE_CELLS = 52;

/** "2026-03-14" → "14 Mar 2026". */
function dayLabel(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y) return null;
  return [d, m && MONTH_SHORT[m - 1], y].filter(Boolean).join(' ');
}
const todayIso = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86_400_000);

// ── the shelf rail ───────────────────────────────────────────────────────────

function ShelfRail({ status, onPick }) {
  return (
    <div className={k.rail} role="radiogroup" aria-label="Shelf">
      {STATUS_META.map(([v, label, Icon]) => {
        const on = status === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            className={k.shelf}
            data-on={on ? '' : undefined}
            onClick={() => !on && onPick(v)}
            title={on ? `On your ${label} shelf` : `Move to ${label}`}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── where you are ────────────────────────────────────────────────────────────

/** Every episode as a cell: watched, out and waiting, or not aired yet. Hovering
 *  previews "watched up to here"; a click sets it (clicking the last watched one
 *  steps back by one). Long-runners get a continuous strip instead. */
function EpisodeTape({ watched, aired, total, onSet }) {
  const [hover, setHover] = useState(0);
  const n = Math.max(total || 0, aired || 0, watched || 0);
  if (!n) return null;
  const pick = (i) => onSet(i === watched ? i - 1 : i);

  if (n > TAPE_CELLS) {
    const at = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      return Math.min(n, Math.max(1, Math.ceil(((e.clientX - r.left) / r.width) * n)));
    };
    return (
      <div
        className={k.strip}
        onMouseMove={(e) => setHover(at(e))}
        onMouseLeave={() => setHover(0)}
        onClick={(e) => pick(at(e))}
        role="presentation"
        style={{ '--seen': watched / n, '--out': Math.min(aired, n) / n, '--hov': hover / n }}
      >
        <i className={k.stripOut} />
        <i className={k.stripSeen} />
        {hover > 0 && <i className={k.stripHover} />}
        {hover > 0 && <span className={k.tapeTip}>ep {hover}</span>}
      </div>
    );
  }

  return (
    <div className={k.tape} data-dense={n > 26 ? '' : undefined} onMouseLeave={() => setHover(0)} style={{ '--n': n }}>
      {Array.from({ length: n }, (_, j) => {
        const i = j + 1;
        const state = i <= watched ? 'seen' : i <= aired ? 'out' : 'later';
        const pre = hover && (hover >= watched ? i > watched && i <= hover : i > hover && i <= watched);
        return (
          <button
            key={i}
            type="button"
            className={k.cell}
            data-state={state}
            data-next={i === watched + 1 ? '' : undefined}
            data-pre={pre ? (hover >= watched ? 'add' : 'drop') : undefined}
            onMouseEnter={() => setHover(i)}
            onClick={() => pick(i)}
            aria-label={i === watched ? `Episode ${i} — unmark it` : `Mark episodes up to ${i} watched`}
            title={`Episode ${i}${state === 'later' ? ' · not aired yet' : ''}`}
          />
        );
      })}
    </div>
  );
}

/** The episode counter: a big number you can also type into (One Piece is not a
 *  thing to click +1 on 1,100 times). Commits on Enter or when you click away. */
function Counter({ value, max, onCommit }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    if (draft == null) return;
    const n = Math.max(0, Math.min(max || Infinity, Math.floor(Number(draft) || 0)));
    setDraft(null);
    if (n !== value) onCommit(n);
  };
  const shown = draft ?? value;
  // The input sizes itself to its digits through a twin in the same grid cell.
  return (
    <span className={k.countBox} data-value={shown}>
      <input
        className={k.count}
        type="number"
        inputMode="numeric"
        min={0}
        max={max || undefined}
        value={shown}
        size={1}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
        }}
        aria-label="Episodes watched"
        title="Episodes watched — type a number"
      />
    </span>
  );
}

function stateLine(w, entry, media) {
  const soon = w.airingAt ? `ep ${w.airingEp} in ${fmtCountdown(w.airingAt * 1000 - Date.now())}` : null;
  switch (w.status) {
    case 'CURRENT':
    case 'REPEATING':
      if (w.left > 0) return <><b>{w.left}</b> to go · {fmtDuration(w.catchUp)} of watching</>;
      if (soon) return <>Caught up · <b>{soon}</b></>;
      return w.total && w.watched >= w.total ? <>All {w.total} watched</> : <>Caught up</>;
    case 'PAUSED':
    case 'DROPPED':
      return <>Stopped at {w.watched}{w.left > 0 ? <> · <b>{w.left}</b> left · {fmtDuration(w.catchUp)}</> : null}</>;
    case 'PLANNING':
      if (w.aired > 0) return <>{w.aired} out · {fmtDuration(w.aired * (media.duration || 24))} to watch</>;
      if (soon) return w.airingEp === 1 ? <>Premieres in <b>{fmtCountdown(w.airingAt * 1000 - Date.now())}</b></> : <>{soon}</>;
      return <>Not aired yet</>;
    case 'COMPLETED':
      return <><Check size={13} /> All {w.total || w.watched} watched{entry.repeat ? ` · seen ${entry.repeat + 1}×` : ''}</>;
    default:
      return null;
  }
}

function ProgressWell({ media, entry, save }) {
  const { progress } = useProgress();
  const play = usePlayEpisode();
  const [busy, setBusy] = useState(false);
  const w = watchState(media, entry, progress);
  const total = media.episodes || null;
  const prog = entry.progress || 0;
  const pct = total ? Math.min(100, Math.round((prog / total) * 100)) : null;

  const go = async () => {
    setBusy(true);
    await play(media, w.nextN);
    setBusy(false);
  };
  const playLabel = w.resumeAt != null ? <>Resume ep {w.nextN} <i>{clock(w.resumeAt)}</i></>
    : w.status === 'PLANNING' || prog === 0 ? <>Start ep 1</> : <>Play ep {w.nextN}</>;

  return (
    <section className={k.well} aria-label="Where you are">
      <header className={k.wellHead}>
        <span className={k.wellLabel}><Tv size={13} /> Where you are</span>
        {pct != null && <span className={k.wellAside}>{pct}%</span>}
      </header>

      <div className={k.counterRow}>
        <Counter value={prog} max={total} onCommit={(n) => save({ progress: n })} />
        <span className={k.countOf}>/ {total || (w.aired > prog ? w.aired : '?')}</span>
        <span className={k.countUnit}>{total ? (total === 1 ? 'episode' : 'episodes') : w.aired > prog ? 'aired so far' : 'episodes'}</span>
      </div>

      <EpisodeTape watched={prog} aired={w.aired} total={total} onSet={(n) => save({ progress: n })} />

      <p className={k.stateLine}>{stateLine(w, entry, media)}</p>

      <div className={k.transport}>
        <span className={k.stepPair}>
          <button type="button" className={k.step} disabled={prog <= 0} onClick={() => save({ progress: prog - 1 })} aria-label="One fewer" title="One fewer">
            <Minus size={15} />
          </button>
          <button
            type="button"
            className={k.bump}
            disabled={!!total && prog >= total}
            onClick={() => save({ progress: prog + 1 })}
            title={`Mark episode ${prog + 1} watched`}
          >
            <Plus size={15} /> 1
          </button>
        </span>
        {w.canPlay && (
          <button
            type="button"
            className={k.play}
            onClick={go}
            disabled={busy}
            onMouseEnter={() => fetchShared(`/anime/episodes/${media.id}`, 600_000).catch(() => {})}
            title={w.resumeAt != null ? `Resume episode ${w.nextN} at ${clock(w.resumeAt)}` : `Play episode ${w.nextN}`}
          >
            {busy ? <Loader2 size={14} className={s.spin} /> : w.resumeAt != null ? <RotateCcw size={14} /> : <Play size={14} fill="currentColor" />}
            <span>{playLabel}</span>
          </button>
        )}
        {!w.canPlay && w.airingAt && (w.status === 'CURRENT' || w.status === 'REPEATING') && (
          <span className={k.airs} title={airingDateLabel(w.airingAt)}>ep {w.airingEp} · {airingDateLabel(w.airingAt)}</span>
        )}
        {total > 0 && prog < total && entry.status !== 'COMPLETED' && entry.status !== 'PLANNING' && (
          <button
            type="button"
            className={k.ghostBtn}
            onClick={() => save({ status: 'COMPLETED', progress: total })}
            title={`Mark all ${total} watched and complete it`}
          >
            <Flag size={13} /> Finish
          </button>
        )}
        {entry.status === 'COMPLETED' && media.status === 'FINISHED' && (
          <button type="button" className={k.ghostBtn} onClick={() => openCurtainCall(media.id)} title="Rate it, talk the finale, see what's next">
            <Sparkles size={13} /> Curtain call
          </button>
        )}
      </div>
    </section>
  );
}

// ── your score ───────────────────────────────────────────────────────────────

/** How your score sits against AniList's average (both on 0–100). */
function crowdLine(mine, format, avg) {
  const h = hundredOf(mine, format);
  if (!h || !avg) return avg ? <>AniList average <b>{avg}%</b></> : null;
  const d = Math.round(h - avg);
  if (Math.abs(d) <= 2) return <>In step with AniList's <b>{avg}%</b></>;
  return <><b>{Math.abs(d)}</b> {d > 0 ? 'above' : 'below'} AniList's {avg}%</>;
}

function ScoreWell({ media, entry, format, save }) {
  const [hover, setHover] = useState(0);
  const score = entry.score || 0;
  const shown = hover || score;
  const { max } = scaleOf(format);
  return (
    <section className={k.well} aria-label="Your score">
      <header className={k.wellHead}>
        <span className={k.wellLabel}><Star size={13} /> Your score</span>
        {score > 0 && (
          <button type="button" className={k.clear} onClick={() => save({ score: 0 })}>clear</button>
        )}
      </header>

      <p className={k.verdict} aria-live="polite" data-preview={hover ? '' : undefined}>
        {shown ? (
          <>
            <b>{wordFor(shown, format)}</b>
            {format !== 'POINT_3' && <span>{fmtScore(shown, format)}<small>/ {max}</small></span>}
          </>
        ) : (
          <em>{entry.status === 'PLANNING' ? 'Not seen yet — score it once you have' : 'Not scored yet'}</em>
        )}
      </p>

      <ScoreDial format={format} value={score} onSet={(v) => v !== score && save({ score: v })} onPreview={setHover} />

      <p className={k.crowd}>{crowdLine(score, format, media.score)}</p>
    </section>
  );
}

// ── the record: categories, journal, notes, lists & privacy ──────────────────

function DateRow({ label, value, onSet }) {
  return (
    <div className={k.dateRow}>
      <span className={k.fieldLabel}>{label}</span>
      <input
        type="date"
        className={k.date}
        value={value || ''}
        max={todayIso()}
        // Typing a year digit by digit passes through 0002, 0020…; only a real date
        // goes out. Clearing is the × beside it.
        onChange={(e) => { const v = e.target.value; if (v && Number(v.slice(0, 4)) >= 1900) onSet(v); }}
        aria-label={`${label} on`}
      />
      <span className={k.dateActs}>
        {value !== todayIso() && (
          <button type="button" onClick={() => onSet(todayIso())}>today</button>
        )}
        {value && (
          <button type="button" onClick={() => onSet('')} aria-label={`Clear the ${label.toLowerCase()} date`} title="Clear">
            <X size={13} />
          </button>
        )}
      </span>
    </div>
  );
}

function Journal({ media, entry, save }) {
  const repeat = entry.repeat || 0;
  const per = media.duration || 24;
  const minutes = (entry.progress || 0) * per + repeat * (media.episodes || 0) * per;
  const took = entry.started_at && entry.completed_at ? daysBetween(entry.started_at, entry.completed_at) : null;
  return (
    <div className={k.journal}>
      <div className={k.dates}>
        <DateRow label="Started" value={entry.started_at} onSet={(v) => save({ started_at: v })} />
        <DateRow label="Finished" value={entry.completed_at} onSet={(v) => save({ completed_at: v })} />
        <div className={k.dateRow}>
          <span className={k.fieldLabel}>Rewatches</span>
          <span className={k.stepPair}>
            <button type="button" className={k.step} disabled={repeat <= 0} onClick={() => save({ repeat: repeat - 1 })} aria-label="One fewer rewatch">
              <Minus size={14} />
            </button>
            <span className={k.repeatVal}><Repeat size={13} /> {repeat}×</span>
            <button type="button" className={k.step} onClick={() => save({ repeat: repeat + 1 })} aria-label="One more rewatch">
              <Plus size={14} />
            </button>
          </span>
        </div>
      </div>

      <dl className={k.facts}>
        <div>
          <dt>Time watched</dt>
          <dd>{minutes ? fmtDuration(minutes) : '—'}{!media.duration && minutes ? <small> est.</small> : null}</dd>
        </div>
        {took != null && took >= 0 && (
          <div>
            <dt>Took</dt>
            <dd>{took === 0 ? 'one day' : `${took + 1} days`}</dd>
          </div>
        )}
        {entry.created_at && (
          <div>
            <dt>On your list since</dt>
            <dd>{new Date(entry.created_at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function Notes({ entry, save }) {
  const saved = entry.notes || '';
  const [draft, setDraft] = useState(saved);
  const dirty = draft !== saved;
  // A note that changes underneath (a sync echo, another tab) replaces an untouched box.
  const last = useRef(saved);
  useEffect(() => {
    if (draft === last.current) setDraft(saved);
    last.current = saved;
  }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => { if (dirty) save({ notes: draft }); };
  return (
    <div className={k.notes}>
      <textarea
        className={k.noteBox}
        rows={4}
        value={draft}
        placeholder="A note on this title — where you left off, who recommended it, what to look out for…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); } }}
      />
      <span className={k.noteState} data-dirty={dirty ? '' : undefined}>
        {dirty ? 'unsaved — click away or Ctrl+Enter to keep it' : saved ? 'kept on your AniList entry' : ''}
      </span>
    </div>
  );
}

function Toggle({ on, onChange, label, hint, disabled }) {
  return (
    <label className={k.toggle} data-disabled={disabled ? '' : undefined}>
      <input type="checkbox" checked={!!on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={k.switch} aria-hidden="true" />
      <span className={k.toggleText}><b>{label}</b><small>{hint}</small></span>
    </label>
  );
}

function ListsPrivacy({ entry, customLists, save }) {
  const mine = entry.custom_lists || [];
  return (
    <div className={k.lists}>
      <div className={k.listsBlock}>
        <span className={k.fieldLabel}>Custom lists</span>
        {customLists.length ? (
          <div className={k.chips}>
            {customLists.map((c) => {
              const on = mine.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  className={k.chip}
                  data-on={on ? '' : undefined}
                  aria-pressed={on}
                  onClick={() => save({ custom_lists: on ? mine.filter((x) => x !== c) : [...mine, c] })}
                >
                  {on ? <Check size={12} /> : <Plus size={12} />} {c}
                </button>
              );
            })}
          </div>
        ) : (
          <p className={k.muted}>You have no custom lists on AniList. Make them under your profile's settings and they'll show up here.</p>
        )}
      </div>
      <div className={k.listsBlock}>
        <Toggle
          on={entry.private}
          onChange={(v) => save({ private: v })}
          label="Private"
          hint="Hidden from your public list and from activity"
        />
        {customLists.length > 0 && (
          <Toggle
            on={entry.hidden}
            onChange={(v) => save({ hidden: v })}
            label="Hide from status lists"
            hint="Shown only under its custom lists"
          />
        )}
      </div>
    </div>
  );
}

function Record({ media, entry, cats, format, customLists, save }) {
  const finished = ['COMPLETED', 'REPEATING', 'DROPPED', 'PAUSED'].includes(entry.status);
  const fallback = cats.length && finished ? 'cats' : 'journal';
  const [tab, setTab] = useParamState('rec', fallback);
  const avg = categoryAverage(entry.advanced_scores, cats, format);
  const scored = cats.filter((c) => Number(entry.advanced_scores?.[c]) > 0).length;
  const firstLine = (entry.notes || '').split('\n')[0];

  const tabs = [
    cats.length > 0 && {
      id: 'cats', label: 'By category', Icon: SlidersHorizontal,
      note: avg != null ? `average ${fmtScore(avg, format)} · ${scored}/${cats.length}` : 'not scored yet',
    },
    {
      id: 'journal', label: 'Journal', Icon: CalendarDays,
      note: entry.started_at
        ? `${dayLabel(entry.started_at)}${entry.completed_at ? ` → ${dayLabel(entry.completed_at)}` : ' → …'}`
        : entry.repeat ? `seen ${entry.repeat + 1}×` : 'no dates yet',
    },
    { id: 'notes', label: 'Notes', Icon: NotebookPen, note: firstLine || 'empty' },
    {
      id: 'lists', label: 'Lists & privacy', Icon: Lock,
      note: [entry.private ? 'private' : 'public', ...(entry.custom_lists || [])].join(' · '),
    },
  ].filter(Boolean);
  const cur = tabs.some((t) => t.id === tab) ? tab : fallback;
  // Arrow keys walk the tabs, as a tab strip should.
  const onKey = (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === cur);
    const next = tabs[(i + step + tabs.length) % tabs.length];
    setTab(next.id);
    e.currentTarget.querySelector(`#rec-${next.id}`)?.focus();
  };

  return (
    <div className={k.record}>
      <div className={k.tabs} role="tablist" aria-label="The record" onKeyDown={onKey}>
        {tabs.map(({ id, label, Icon, note }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`rec-${id}`}
            aria-selected={cur === id}
            tabIndex={cur === id ? 0 : -1}
            aria-controls="rec-panel"
            className={k.tab}
            data-on={cur === id ? '' : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={14} />
            <span className={k.tabText}>
              <b>{label}</b>
              <small>{note}</small>
            </span>
          </button>
        ))}
      </div>

      <div className={k.page} role="tabpanel" id="rec-panel" aria-labelledby={`rec-${cur}`} key={cur}>
        {cur === 'cats' && (
          <div className={k.catsPage}>
            <CategoryScores
              categories={cats}
              scores={entry.advanced_scores}
              format={format}
              verdict={entry.score || 0}
              onCommit={(scores) => save({ advanced_scores: scores })}
              onUseAverage={(v) => save({ score: v })}
            />
          </div>
        )}
        {cur === 'journal' && <Journal media={media} entry={entry} save={save} />}
        {cur === 'notes' && <Notes key={media.id} entry={entry} save={save} />}
        {cur === 'lists' && <ListsPrivacy entry={entry} customLists={customLists} save={save} />}
      </div>
    </div>
  );
}

/** Removing takes two presses: the entry's score, dates and notes go with it. */
function RemoveButton({ onRemove }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);
  if (!armed) {
    return (
      <button type="button" className={k.remove} onClick={() => setArmed(true)}>
        <Trash2 size={13} /> Remove from list
      </button>
    );
  }
  return (
    <span className={k.removeAsk} role="alert">
      Remove it, with its score, dates and notes?
      <button type="button" className={k.removeYes} onClick={onRemove}>Remove</button>
      <button type="button" className={k.removeNo} onClick={() => setArmed(false)}>Keep</button>
    </span>
  );
}

// ── the deck ─────────────────────────────────────────────────────────────────

/** `viewer` is /anime/me: score format, custom lists and scoring categories. */
export default function ListPanel({ media, viewer }) {
  const { overlay, syncState, queueListEdit, removeListEntry } = useAnimeSync();
  const entry = applyOverlay(media.id, media.list_entry, overlay);
  const format = viewer.score_format;
  const cats = viewer.advanced_scoring || [];
  const sync = syncState[media.id];
  useCountdownTick(media.next_airing_at ? media.next_airing_at * 1000 : 0);

  const save = (patch) => queueListEdit(media, patch);
  // Completing from the rail marks every episode watched, as Finish does.
  const pick = (status) => save(status === 'COMPLETED' && media.episodes ? { status, progress: media.episodes } : { status });

  return (
    <section className={k.wrap}>
      <div className={k.labelRow}>
        <h3 className={s.blockLabel}>Your list</h3>
        <SyncBadge status={sync} className={k.sync} />
      </div>

      <div className={k.deck} data-on={entry ? '' : undefined}>
        <ShelfRail status={entry?.status} onPick={pick} />

        {!entry ? (
          <p className={k.empty}>
            <b>Not on your list yet.</b> Pick a shelf — Planning to keep it for later, Watching to start
            counting episodes, Completed if you've already seen it.
          </p>
        ) : (
          <>
            <div className={k.wells}>
              <ProgressWell media={media} entry={entry} save={save} />
              <ScoreWell media={media} entry={entry} format={format} save={save} />
            </div>

            <Record
              media={media}
              entry={entry}
              cats={cats}
              format={format}
              customLists={viewer.custom_lists || []}
              save={save}
            />

            <footer className={k.foot}>
              <span className={k.touched}>
                {entry.updated_at ? <>last changed on AniList {ago(entry.updated_at)}</> : null}
              </span>
              <RemoveButton onRemove={() => removeListEntry(media, entry.id)} />
            </footer>
          </>
        )}
      </div>
    </section>
  );
}
