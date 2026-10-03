// Pieces the phone's anime screens share: a poster card, the score control in the
// viewer's own format, the merged episode list (AniList's streaming episodes +
// the local source's playable keys), and "play episode n" from anywhere — the
// list's ▶ button resolves the source's keys on demand, so the shelf never
// spends a request on a title you don't play.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Frown, Meh, Smile, Star, Tv } from 'lucide-react';

import { api } from '@pc/api/client.js';
import { fetchShared } from '@pc/lib/useShared.js';
import { CoverRatings, metaLine, NextEpBadge, SCORE_MAX, SCORE_STEP } from '@pc/components/anime/shared.jsx';
import { episodeItem as pcEpisodeItem } from '@pc/components/anime/episodeList.js';
import { audioFor } from '@pc/components/player/anime/useAnimeShow.js';

import k from './animekit.module.css';

/** Strip AniList's "Episode N - " prefix down to the real subtitle. */
export function epSubtitle(title, number) {
  if (!title) return null;
  const cleaned = title.replace(/^\s*episode\s+\d+\s*[-:–—]?\s*/i, '').trim();
  return cleaned && cleaned !== String(number) ? cleaned : null;
}

/** AniList's streaming URLs are often http or scheme-less. */
export function officialUrl(url) {
  if (!url) return url;
  let u = url.trim();
  if (u.startsWith('//')) u = `https:${u}`;
  else if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
  return u.replace(/^http:\/\//i, 'https://');
}

/** AniList's streaming episodes + the local source's keys, by number, gap-filled
 *  up to what has actually aired. */
export function mergeEpisodes(media, local) {
  const merged = {};
  for (const se of media.streaming || []) {
    if (se.number == null) continue;
    const e = (merged[se.number] ||= { number: se.number });
    if (!e.image) e.image = se.thumbnail;
    if (!e.url) { e.url = se.url; e.site = se.site; }
    if (!e.title) e.title = epSubtitle(se.title, se.number);
  }
  for (const ep of local || []) {
    if (ep.number == null) continue;
    const e = (merged[ep.number] ||= { number: ep.number });
    if (!e.key) e.key = ep.key;
    if (!e.image) e.image = ep.image;
    if (!e.title) e.title = epSubtitle(ep.title, ep.number);
  }
  let aired = Object.keys(merged).length ? Math.max(...Object.keys(merged).map(Number)) : 0;
  if (media.next_episode) aired = Math.max(aired, media.next_episode - 1);
  else if (media.next_airing?.episode) aired = Math.max(aired, media.next_airing.episode - 1);
  else if (media.episodes && media.status !== 'NOT_YET_RELEASED') aired = Math.max(aired, media.episodes);
  for (let n = 1; n <= aired; n++) merged[n] ||= { number: n };
  return Object.values(merged).sort((a, b) => a.number - b.number);
}

/** The player item for one episode: the desktop's own (@pc episodeList.js), so the
 *  phone player gets the same extras (show, cover, colour, the episode's title) and
 *  a Sub/Dub choice made in the player carries on to the next episode. */
export function episodeItem(media, e) {
  return pcEpisodeItem(media, { ...e, still: e.still || e.image || null }, { audio: audioFor(media.id) });
}

/** Find episode `n`'s stream key and play it. Resolves to false when the local
 *  source has no such episode (the caller says so). */
export async function playEpisode(media, n, open) {
  try {
    const d = await fetchShared(`/anime/episodes/${media.id}`, 600_000);
    const ep = (d?.episodes || []).find((x) => x.number === n);
    if (!ep?.key) return false;
    open(episodeItem(media, { number: n, key: ep.key, image: ep.image }));
    return true;
  } catch {
    return false;
  }
}

/** A poster card: 2:3 cover, its rating and next-episode badge, title + meta. */
export function Poster({ media, corner, scoreFormat, rank, sub }) {
  return (
    <Link to={`/anime/${media.id}`} className={k.poster} style={{ '--cover-c': media.color || 'var(--c-anime)' }} data-reveal="pop">
      <span className={k.cover}>
        {media.cover ? <img src={media.cover} alt="" loading="lazy" /> : <Tv size={24} />}
        {rank != null && <b className={k.rank}>{rank}</b>}
        {corner && <em className={k.corner}>{corner}</em>}
        <CoverRatings media={media} scoreFormat={scoreFormat} className={k.ratings} />
        <NextEpBadge media={media} />
      </span>
      <span className={k.posterTitle}>{media.title}</span>
      <span className={k.posterMeta}>{sub ?? metaLine(media)}</span>
    </Link>
  );
}

/** A sideways strip of posters. */
export function PosterStrip({ items, scoreFormat, corner }) {
  if (!items?.length) return null;
  return (
    <div className={k.strip}>
      {items.map((x) => {
        const media = x.media || x;
        return <Poster key={media.id} media={media} scoreFormat={scoreFormat} corner={corner ? corner(x) : null} />;
      })}
    </div>
  );
}

/** The viewer's score, in their format: stars, faces, or a big-number dial. */
export function ScoreControl({ scoreFormat, value, onSet }) {
  const max = SCORE_MAX[scoreFormat] || 10;
  const [drag, setDrag] = useState(null);
  if (scoreFormat === 'POINT_5') {
    return (
      <div className={k.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" data-on={value >= n ? '' : undefined} onClick={() => onSet(value === n ? 0 : n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} style={{ '--n': n }}>
            <Star size={30} fill={value >= n ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
    );
  }
  if (scoreFormat === 'POINT_3') {
    return (
      <div className={k.stars}>
        {[[1, Frown, 'Bad'], [2, Meh, 'Meh'], [3, Smile, 'Good']].map(([n, Icon, label]) => (
          <button key={n} type="button" data-on={value === n ? '' : undefined} onClick={() => onSet(value === n ? 0 : n)} aria-label={label}>
            <Icon size={32} />
          </button>
        ))}
      </div>
    );
  }
  const step = SCORE_STEP[scoreFormat] || 1;
  const shown = drag ?? value;
  // A point scale is a slider with the number big beside it; it commits on release
  // (each commit is an AniList write).
  return (
    <div className={k.dial}>
      <input
        type="range"
        min="0"
        max={max}
        step={max === 100 ? 1 : step}
        value={shown}
        style={{ '--pct': `${(shown / max) * 100}%` }}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={() => { if (drag != null && drag !== value) onSet(drag); setDrag(null); }}
        onTouchEnd={() => { if (drag != null && drag !== value) onSet(drag); setDrag(null); }}
        onKeyUp={() => { if (drag != null && drag !== value) onSet(drag); setDrag(null); }}
        aria-label="Your score"
      />
      <b><span key={shown} className="ph-tick">{shown || '—'}</span><small>/{max}</small></b>
    </div>
  );
}

/** The score as it stands, read-only, in the viewer's own format. */
export function ScoreShown({ scoreFormat, value }) {
  const max = SCORE_MAX[scoreFormat] || 10;
  if (!value) return <span className={k.unrated}>Not rated yet</span>;
  if (scoreFormat === 'POINT_5') {
    return (
      <span className={k.shownStars} aria-label={`${value} of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={20} fill={value >= n ? 'currentColor' : 'none'} data-on={value >= n ? '' : undefined} />)}
      </span>
    );
  }
  if (scoreFormat === 'POINT_3') {
    const [Icon, label] = [[Frown, 'Bad'], [Meh, 'Meh'], [Smile, 'Good']][value - 1] || [Meh, ''];
    return <span className={k.shownFace}><Icon size={24} /> {label}</span>;
  }
  return <span className={k.shownNum}><b>{value}</b><small>/{max}</small></span>;
}

/** "3h 12m" from minutes. */
export function hm(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

/** Fire-and-forget ping so the Anime tab badge clears once the inbox is read. */
export function inboxRead() {
  window.dispatchEvent(new Event('anime-inbox-read'));
  api('/anime/notifications/count').catch(() => {});
}
