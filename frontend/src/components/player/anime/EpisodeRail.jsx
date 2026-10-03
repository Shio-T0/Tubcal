// The episode rail: every episode of the show beside the picture (a sheet over it
// on narrower screens) — the anime player's answer to YouTube's notes panel, which
// has nothing to say about an episode. The one playing is marked and scrolled into
// view; watched ones recede; any you've started carry their bar. Pressing one
// plays it here. Past your AniList progress the spoiler guard (the same switch as
// the title page) keeps stills and titles veiled.

import { useEffect, useRef } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';

import { COMPLETE_RATIO, useProgress } from '../../../state.jsx';
import a from './anime.module.css';

const SPOILER_KEY = 'tubcal.anime.spoilerGuard';
const guardOn = () => { try { return localStorage.getItem(SPOILER_KEY) !== '0'; } catch { return true; } };

export default function EpisodeRail({ item, show, onEpisode, onClose, className, style, bare = false }) {
  const { progress } = useProgress();
  const listRef = useRef(null);
  const m = show.media;
  const cur = item.extra?.episode;
  const seen = show.entry?.progress || 0;
  const guard = guardOn() && !!show.entry;

  // Bring the playing episode into view — in the rail's own scroller only; a bare
  // list (the phone's watch page) sits in its page, which mustn't jump.
  useEffect(() => {
    if (bare) return;
    const el = listRef.current?.querySelector('[data-current]');
    el?.scrollIntoView({ block: 'center' });
  }, [cur, show.list.length, bare]);

  const ratio = (n) => {
    const p = progress[`anime:${show.aid}:${n}`];
    return p && p.duration ? Math.min(1, p.position / p.duration) : 0;
  };

  return (
    <aside
      className={`${bare ? a.railBare : a.rail} ${className || ''}`}
      style={{ ...style, ...(m?.color ? { '--show-c': m.color } : null) }}
      aria-label="Episodes"
    >
      {!bare && (
      <header className={a.railHead}>
        {m?.banner && <img className={a.railArt} src={m.banner} alt="" />}
        <div className={a.railHeadText}>
          <span className={a.railTitle}>{m?.title || item.extra?.show}</span>
          <span className={a.railSub}>
            {show.list.length ? `${show.list.length} episodes` : 'Episodes'}
            {show.entry ? ` · ${seen} watched` : ''}
          </span>
        </div>
        {onClose && (
          <button type="button" className={a.railClose} onClick={onClose} aria-label="Hide the episode list">
            <X size={16} />
          </button>
        )}
      </header>
      )}

      <ol className={a.railList} ref={listRef}>
        {show.list.map((e) => {
          const r = ratio(e.number);
          const done = e.number <= seen || r >= COMPLETE_RATIO;
          const here = e.number === cur;
          const hide = guard && e.number > seen && !here;
          const playable = !!e.key;
          return (
            <li key={e.number} data-current={here || undefined} data-seen={done || undefined}>
              <button
                type="button"
                className={a.railItem}
                onClick={() => (playable ? onEpisode(e) : e.url && window.open(e.url, '_blank', 'noopener'))}
                disabled={here || (!playable && !e.url)}
                aria-current={here ? 'true' : undefined}
              >
                <span className={a.railThumb}>
                  {e.still ? (
                    <img src={e.still} alt="" loading="lazy" className={hide ? a.veiled : undefined} />
                  ) : (
                    <span className={a.railSlate}><b>{e.number}</b></span>
                  )}
                  {here && <span className={a.nowPlaying} aria-hidden="true"><i /><i /><i /></span>}
                  {!here && done && <span className={a.railSeen}><Check size={11} strokeWidth={3} /></span>}
                  {r > 0 && !done && <span className={a.railBar}><i style={{ width: `${Math.max(4, r * 100)}%` }} /></span>}
                </span>
                <span className={a.railText}>
                  <b>Episode {e.number}</b>
                  {e.title && (hide ? <em className={a.hidden}>Title hidden</em> : <em>{e.title}</em>)}
                  {!playable && e.url && <small><ExternalLink size={11} /> {e.site || 'Official site'}</small>}
                </span>
              </button>
            </li>
          );
        })}
        {!show.list.length && <li className={a.railEmpty}>Finding the episodes…</li>}
      </ol>
    </aside>
  );
}
