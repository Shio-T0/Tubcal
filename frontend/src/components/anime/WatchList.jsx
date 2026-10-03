// My List's titles, made for watching from. Each title says where you are (watched
// of aired of total, what's left and how long that takes, the next airing) and plays
// the next episode in one press: in Tubcal's own player, resuming if you'd started
// it. Two views of the same thing:
//
//   WatchPoster   the poster wall: art, a progress strip at its foot, then the title,
//                 one line of where you are, and the buttons
//   WatchRow      the register: one line per title under column headings (Title ·
//                 Progress · Next · Score · Touched), the buttons at the end
//
// What a title can do follows its shelf. Watching (and Rewatching, Paused, Dropped)
// get the next episode and +1. Planning gets Start once something has aired.
// Completed shows your score. A show you've caught up on counts down to its next
// episode instead of offering one.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock, Loader2, Play, Plus, RotateCcw, Tv } from 'lucide-react';

import { fetchShared } from '../../lib/useShared.js';
import { clock, timeAgo } from '../../lib/time.js';
import { applyOverlay, COMPLETE_RATIO, useAnimeSync, usePlayer, useProgress, useToast } from '../../state.jsx';
import {
  CoverRatings, MONTH_SHORT, SyncBadge, airingDateLabel, fmtCountdown, fmtDuration, formatLabel,
  personalScore, seasonLabel, useCountdownTick,
} from './shared.jsx';
import { episodeItem } from './episodeList.js';
import { audioFor } from '../player/anime/useAnimeShow.js';
import { useAnimeCalc } from './WatchCalculator.jsx';
import s from '../../pages/anime.module.css';
import k from './watchlist.module.css';

const ACTIVE = new Set(['CURRENT', 'REPEATING']);
const RESUMABLE = new Set(['CURRENT', 'REPEATING', 'PAUSED', 'DROPPED']);

/** Where you are with a title: what's aired, what's left and how long that takes,
 *  which episode is next and whether you'd started it here (`resumeAt`). */
export function watchState(m, eff, progress) {
  const status = eff.status;
  const watched = eff.progress || 0;
  const total = m.episodes || null;
  let aired;
  if (m.next_episode) aired = m.next_episode - 1;
  else if (m.status === 'NOT_YET_RELEASED') aired = 0;
  else aired = total || watched;
  const left = Math.max(0, aired - watched);
  const nextN = status === 'PLANNING' ? 1 : watched + 1;
  const canPlay = status !== 'COMPLETED' && nextN <= aired;
  const p = progress[`anime:${m.id}:${nextN}`];
  const ratio = p?.duration ? p.position / p.duration : 0;
  const resumeAt = canPlay && ratio > 0.02 && ratio < COMPLETE_RATIO ? p.position : null;
  const per = m.duration || 24;
  return {
    status,
    watched,
    total,
    aired,
    left,
    nextN,
    canPlay,
    resumeAt,
    remainingOfNext: resumeAt != null && p.duration ? p.duration - p.position : null,
    catchUp: left * per,
    airingAt: m.next_airing_at && m.next_airing_at * 1000 > Date.now() ? m.next_airing_at : null,
    airingEp: m.next_episode || null,
    canBump: RESUMABLE.has(status) && (!total || watched < total),
  };
}

/** Play episode `n` of `m` in the anime player. Its stream key comes from the
 *  title's episode list (shared, so a second press is instant). */
export function usePlayEpisode() {
  const { open } = usePlayer();
  const toast = useToast();
  return async (m, n) => {
    try {
      const d = await fetchShared(`/anime/episodes/${m.id}`, 600_000);
      const ep = (d?.episodes || []).find((x) => x.number === n);
      if (!ep?.key) {
        toast(`Episode ${n} of ${m.title} isn't available to play yet`, 'error');
        return false;
      }
      open(episodeItem(m, { number: n, key: ep.key }, { audio: audioFor(m.id) }));
      return true;
    } catch (e) {
      toast(`Couldn't find ${m.title} on the episode source — ${e.message}`, 'error');
      return false;
    }
  };
}

/** "2026-03-14" → "Mar 2026". */
const monthYear = (iso) => {
  const [y, mo] = (iso || '').split('-').map(Number);
  return y && mo ? `${MONTH_SHORT[mo - 1]} ${y}` : null;
};

/** One line of where you are, in the shelf's own terms. In the register (`table`)
 *  the score has its own column, so a finished title doesn't repeat it. */
function stateLine(w, m, eff, scoreFormat, table = false) {
  const of = w.total ? `${w.watched} / ${w.total}` : `${w.watched} watched`;
  const soon = w.airingAt ? `ep ${w.airingEp} in ${fmtCountdown(w.airingAt * 1000 - Date.now())}` : null;
  switch (w.status) {
    case 'CURRENT':
    case 'REPEATING':
      if (w.left > 0) return `${of} · ${w.left} to go · ${fmtDuration(w.catchUp)}`;
      if (soon) return `Caught up · ${soon}`;
      return `Caught up at ${of}`;
    case 'PAUSED':
    case 'DROPPED':
      return `Stopped at ${of}${w.left > 0 ? ` · ${w.left} left` : ''}`;
    case 'PLANNING':
      if (w.aired > 0) {
        return `${w.aired}${w.total && w.total !== w.aired ? ` of ${w.total}` : ''} eps out · ${fmtDuration(w.aired * (m.duration || 24))}`;
      }
      if (soon) return w.airingEp === 1 ? `Premieres in ${fmtCountdown(w.airingAt * 1000 - Date.now())}` : soon;
      return m.start_date ? `Starts ${m.start_date}` : 'Not aired yet';
    case 'COMPLETED': {
      if (table) return `${of} · all watched${eff.repeat ? ` · seen ${eff.repeat + 1}×` : ''}`;
      const mine = personalScore({ list_entry: eff }, scoreFormat);
      return `Finished${mine ? ` · you gave ${mine}` : ''}${eff.repeat ? ` · seen ${eff.repeat + 1}×` : ''}`;
    }
    default:
      return of;
  }
}

/** Watched / aired / total as one strip: what you've seen, what's out waiting for
 *  you, and the rest still to air. */
function Strip({ w, className }) {
  const n = Math.max(w.total || 0, w.aired, w.watched, 1);
  return (
    <span className={`${k.strip} ${className || ''}`} aria-hidden="true">
      <i className={k.stripAired} style={{ width: `${(Math.min(w.aired, n) / n) * 100}%` }} />
      <i className={k.stripSeen} style={{ width: `${(Math.min(w.watched, n) / n) * 100}%` }} />
    </span>
  );
}

/** The main button: the next episode (or Resume / Start), a countdown when you're
 *  caught up on something airing, nothing otherwise. */
function PlayButton({ m, w, compact = false }) {
  const play = usePlayEpisode();
  const [busy, setBusy] = useState(false);
  if (!w.canPlay) {
    if (w.airingAt && ACTIVE.has(w.status)) {
      return (
        <span className={compact ? k.waitIcon : k.wait} title={`Episode ${w.airingEp} · ${airingDateLabel(w.airingAt)}`}>
          <Clock size={13} />
          {!compact && <>Ep {w.airingEp} · {fmtCountdown(w.airingAt * 1000 - Date.now())}</>}
        </span>
      );
    }
    return null;
  }
  const label = w.resumeAt != null ? `Resume ep ${w.nextN}` : w.status === 'PLANNING' || w.watched === 0 ? 'Start' : `Ep ${w.nextN}`;
  const go = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    await play(m, w.nextN);
    setBusy(false);
  };
  return (
    <button
      type="button"
      className={compact ? k.playIcon : k.play}
      onClick={go}
      // warm the episode list on intent, so the press itself is instant
      onMouseEnter={() => fetchShared(`/anime/episodes/${m.id}`, 600_000).catch(() => {})}
      title={w.resumeAt != null
        ? `Resume episode ${w.nextN} at ${clock(w.resumeAt)} (${clock(w.remainingOfNext)} left)`
        : `Play episode ${w.nextN}`}
      aria-label={label}
      disabled={busy}
    >
      {busy ? <Loader2 size={14} className={k.spin} /> : w.resumeAt != null ? <RotateCcw size={13} /> : <Play size={13} fill="currentColor" />}
      {!compact && <span>{label}</span>}
    </button>
  );
}

function BumpButton({ m, w, compact = false }) {
  const { queueListEdit } = useAnimeSync();
  if (!w.canBump) return null;
  return (
    <button
      type="button"
      className={compact ? k.bumpIcon : k.bump}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); queueListEdit(m, { progress: w.watched + 1 }); }}
      title={`Mark episode ${w.watched + 1} watched`}
      aria-label={`Mark episode ${w.watched + 1} watched`}
    >
      <Plus size={13} />1
    </button>
  );
}

export function WatchPoster({ entry, scoreFormat, showSeen = false, select = null }) {
  const { overlay, syncState } = useAnimeSync();
  const { progress } = useProgress();
  const { hoverProps } = useAnimeCalc();
  const m = entry.media;
  const eff = applyOverlay(m.id, entry, overlay);
  useCountdownTick(m.next_airing_at ? m.next_airing_at * 1000 : 0);
  if (!eff) return null; // removed locally from elsewhere
  const w = watchState(m, eff, progress);
  const sync = syncState[m.id];
  const behind = RESUMABLE.has(w.status) && w.left > 0 ? w.left : 0;
  return (
    <article
      className={`${k.poster} ${select?.on ? k.picked : ''}`}
      style={{ '--cover-c': m.color || 'var(--c-anime)' }}
      {...hoverProps(m)}
    >
      <div className={k.art}>
        <Link to={`/anime/${m.id}`} className={k.artLink} aria-label={m.title}>
          {m.cover_xl || m.cover ? <img src={m.cover_xl || m.cover} alt="" loading="lazy" /> : <Tv size={26} />}
        </Link>
        {select && (
          <label className={k.pick} title="Select for bulk edit">
            <input type="checkbox" checked={select.on} onChange={select.toggle} aria-label={`Select ${m.title}`} />
          </label>
        )}
        {behind > 0 && !select && (
          <span className={k.behind}>{behind} {m.status === 'RELEASING' ? 'new' : 'left'}</span>
        )}
        <CoverRatings media={{ ...m, list_entry: eff }} scoreFormat={scoreFormat} className={s.ratingsTR} />
        {w.status !== 'COMPLETED' && <Strip w={w} className={k.artStrip} />}
      </div>
      <div className={k.body}>
        <Link to={`/anime/${m.id}`} className={k.title} title={m.title}>{m.title}</Link>
        <p className={k.state}>
          {stateLine(w, m, eff, scoreFormat)}
          {showSeen && entry.updated_at && <span className={k.seen}> · {timeAgo(entry.updated_at)}</span>}
        </p>
        <div className={k.acts}>
          <PlayButton m={m} w={w} />
          <BumpButton m={m} w={w} />
          {sync && <SyncBadge status={sync} label={false} className={k.sync} />}
        </div>
      </div>
    </article>
  );
}

/** The register's column headings. */
export function WatchRowsHead({ selectable }) {
  return (
    <div className={`${k.row} ${k.head}`} data-select={selectable || undefined} aria-hidden="true">
      {selectable && <span />}
      <span />
      <span>Title</span>
      <span>Progress</span>
      <span className={k.rowNext}>Next</span>
      <span className={k.num}>Score</span>
      <span className={k.num}>Touched</span>
      <span />
    </div>
  );
}

export function WatchRow({ entry, scoreFormat, selectable, selected, onSelect }) {
  const { overlay, syncState } = useAnimeSync();
  const { progress } = useProgress();
  const { hoverProps } = useAnimeCalc();
  const m = entry.media;
  const eff = applyOverlay(m.id, entry, overlay);
  useCountdownTick(m.next_airing_at ? m.next_airing_at * 1000 : 0);
  if (!eff) return null;
  const w = watchState(m, eff, progress);
  const mine = personalScore({ list_entry: eff }, scoreFormat);
  const sync = syncState[m.id];
  const meta = [formatLabel(m.format), m.episodes && `${m.episodes} eps`, seasonLabel(m.season, m.year), m.studios?.[0]]
    .filter(Boolean).join(' · ');

  let next;
  if (w.canPlay) {
    next = w.resumeAt != null
      ? <><b>Ep {w.nextN}</b> · {clock(w.remainingOfNext)} left</>
      : <><b>Ep {w.nextN}</b>{w.left > 1 ? ` · then ${w.left - 1} more` : ''}</>;
  } else if (w.airingAt) {
    next = <><b>Ep {w.airingEp}</b> · {fmtCountdown(w.airingAt * 1000 - Date.now())}<em>{airingDateLabel(w.airingAt)}</em></>;
  } else if (w.status === 'COMPLETED') {
    const when = monthYear(eff.completed_at);
    next = <span className={k.done}><Check size={13} /> {when ? `Finished ${when}` : 'Finished'}</span>;
  } else {
    next = <span className={k.dim}>—</span>;
  }

  return (
    <div
      className={`${k.row} ${selected ? k.rowPicked : ''}`}
      data-select={selectable || undefined}
      style={{ '--cover-c': m.color || 'var(--c-anime)' }}
      {...hoverProps(m)}
    >
      {selectable && (
        <input type="checkbox" className={k.rowCheck} checked={selected} onChange={() => onSelect(entry.entry_id)} aria-label={`Select ${m.title}`} />
      )}
      <Link to={`/anime/${m.id}`} className={k.rowCover} tabIndex={-1} aria-hidden="true">
        {m.cover && <img src={m.cover} alt="" loading="lazy" />}
      </Link>
      <span className={k.rowTitle}>
        <Link to={`/anime/${m.id}`}>{m.title}</Link>
        <em>
          {meta}
          {entry.private ? ' · private' : ''}
          {entry.custom_lists?.length ? ` · ${entry.custom_lists.join(', ')}` : ''}
        </em>
      </span>
      <span className={k.rowProg}>
        <Strip w={w} />
        <span className={k.rowProgText}>{stateLine(w, m, eff, scoreFormat, true)}</span>
      </span>
      <span className={k.rowNext}>{next}</span>
      <span className={`${k.num} ${mine ? '' : k.dim}`} title="Your score">{mine || '—'}</span>
      <span className={`${k.num} ${k.dim}`} title={entry.updated_at ? 'Last activity on AniList' : undefined}>
        {entry.updated_at ? timeAgo(entry.updated_at) : '—'}
      </span>
      <span className={k.rowActs}>
        {sync && <SyncBadge status={sync} label={false} className={k.sync} />}
        <BumpButton m={m} w={w} compact />
        <PlayButton m={m} w={w} compact />
      </span>
    </div>
  );
}
