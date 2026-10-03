// The strip under the picture when an episode plays — the anime player's own,
// not YouTube's channel-and-subscribe row. The show (its poster and name, both a
// way back to its page), which episode this is and what it's called, Sub/Dub when
// the source has both, whether AniList has it as watched, the episodes either side,
// and the window controls.

import { Link } from 'react-router-dom';
import {
  Check, ChevronLeft, ChevronRight, ListVideo, Minimize2, RefreshCw, X,
} from 'lucide-react';

import { usePlayer } from '../../../state.jsx';
import a from './anime.module.css';

const AUDIO_LABEL = { sub: 'Sub', dub: 'Dub' };

export default function AnimeStrip({ item, show, audio, audioOptions, onAudio, synced, onEpisode, rail, onMinimize, onClose }) {
  const { minimize } = usePlayer();
  const ex = item.extra || {};
  const m = show.media;
  const ep = ex.episode;
  const title = m?.title || ex.show || item.source;
  const cover = m?.cover_xl || m?.cover || ex.cover;
  const epTitle = show.current?.title || ex.episode_title;
  const total = m?.episodes;
  const watched = synced || (show.entry?.progress || 0) >= ep;

  return (
    <div className={a.strip}>
      <Link to={`/anime/${ex.anilist_id}`} className={a.cover} onClick={minimize} title={`Open ${title}`} tabIndex={-1}>
        {cover && <img src={cover} alt="" />}
      </Link>

      <div className={a.what}>
        <Link to={`/anime/${ex.anilist_id}`} className={a.show} onClick={minimize}>{title}</Link>
        <h2 className={a.ep}>
          <span className={a.epNo}>Episode {ep}</span>
          {total ? <span className={a.of}>of {total}</span> : null}
          {epTitle && <span className={a.epTitle}>{epTitle}</span>}
        </h2>
        <div className={a.meta}>
          {audioOptions?.length > 1 ? (
            <span className={a.audio} role="group" aria-label="Audio">
              {audioOptions.map((o) => (
                <button
                  key={o}
                  type="button"
                  className={o === audio ? a.audioOn : undefined}
                  aria-pressed={o === audio}
                  onClick={() => o !== audio && onAudio(o)}
                  title={o === 'dub' ? 'Dubbed audio' : 'Original Japanese audio, subtitled'}
                >
                  {AUDIO_LABEL[o] || o}
                </button>
              ))}
            </span>
          ) : audio ? (
            <span className={a.audioOne} title={audio === 'dub' ? 'Only the dub is available' : 'Only the subbed version is available'}>
              {AUDIO_LABEL[audio] || audio}
            </span>
          ) : null}
          {show.entry && (
            <span className={watched ? a.syncOn : a.sync}>
              {watched
                ? <><Check size={13} strokeWidth={3} /> Watched on AniList</>
                : <><RefreshCw size={12} /> AniList updates when you finish</>}
            </span>
          )}
        </div>
      </div>

      <div className={a.side}>
        <div className={a.window}>
          {rail.available && (
            <button
              type="button"
              className={`${a.winBtn} ${rail.open ? a.winOn : ''}`}
              onClick={rail.toggle}
              title={rail.open ? 'Hide the episode list' : 'Show every episode'}
              aria-label="Toggle the episode list"
            >
              <ListVideo size={16} />
            </button>
          )}
          <button type="button" className={a.winBtn} onClick={onMinimize} title="Keep playing in the corner (Esc)" aria-label="Minimize to corner">
            <Minimize2 size={15} />
          </button>
          <button type="button" className={a.winBtn} onClick={onClose} title="Stop and close" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className={a.nav}>
          <button type="button" disabled={!show.prev} onClick={() => onEpisode(show.prev)} title={show.prev ? `Episode ${show.prev.number}` : undefined}>
            <ChevronLeft size={15} /> {show.prev ? `Ep ${show.prev.number}` : 'First'}
          </button>
          <button type="button" disabled={!show.next} onClick={() => onEpisode(show.next)} title={show.next ? `Episode ${show.next.number} (Shift N)` : undefined}>
            {show.next ? `Ep ${show.next.number}` : m?.status === 'FINISHED' ? 'Last' : 'Latest'} <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
