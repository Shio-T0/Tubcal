// Episodes — the title page's episode section.
//
// It answers "what do I watch now?" first. The desk works that out from both
// records of where you are: your AniList progress and the local player's own
// resume points. It offers that episode with one press — locally when the source
// has it, else on the official site — over a reel of the whole run (watched / aired
// / still to come, one cell per episode).
//
// Under the desk is a contact sheet. It uses AniList's stills where it has them and
// otherwise a slate: the episode number set large on the show's own colour. That
// reads far better than the series poster repeated down the page. An image the
// source hands back for more than one episode is the series art, not a still, so
// it gets a slate too. Long-runners page in fifties, opening on the stretch you're
// in. Past your progress the spoiler guard veils stills and titles.

import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Eye, EyeOff, Play, RotateCcw } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { Receiving } from '../layout/Section.jsx';
import { clock } from '../../lib/time.js';
import { applyOverlay, COMPLETE_RATIO, useAnimeSync, usePlayer, useProgress } from '../../state.jsx';
import { airingDateLabel, fmtCountdown, useCountdownTick, useParamState } from './shared.jsx';
import { buildEpisodeList, episodeItem } from './episodeList.js';
import s from '../../pages/anime.module.css';
import k from './episodes.module.css';

const SPOILER_KEY = 'tubcal.anime.spoilerGuard';
const CHUNK = 50; // a long-runner pages in stretches of this many
const PAGE_AT = 60; // …once it runs longer than this
const REEL_CELLS = 120; // past this many episodes the reel is a bar, not cells
const DEAL_MAX = 18; // only the first screenful of tiles is dealt in

/** AniList's streaming URLs are often insecure (http) or missing a scheme, which
 *  makes window.open treat them as relative. Force https and add a scheme when
 *  missing — but keep the full path/slug (the id alone can 404; the original
 *  full URL is the form that resolves). */
function normalizeOfficialUrl(url) {
  if (!url) return url;
  let u = url.trim();
  if (u.startsWith('//')) u = `https:${u}`;
  else if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
  return u.replace(/^http:\/\//i, 'https://');
}

/** Open an official source in a centered popup window — closest thing to an
 *  embed for a site that forbids framing + uses DRM. Falls back to a tab when
 *  the popup is blocked. */
function launchOfficial(url) {
  const target = normalizeOfficialUrl(url);
  if (!target) return;
  const w = 1100;
  const h = 720;
  const left = Math.round(window.screenX + Math.max(0, (window.outerWidth - w) / 2));
  const top = Math.round(window.screenY + Math.max(0, (window.outerHeight - h) / 2));
  const win = window.open(target, 'tubcal-watch', `width=${w},height=${h},left=${left},top=${top}`);
  if (!win) window.open(target, '_blank', 'noopener,noreferrer');
}

/** Where you are, from both records: the furthest episode you've finished (AniList
 *  progress or the local player), a local episode left half-watched past that, and
 *  so the one to offer. */
function whereYouAre(list, listProgress, ratioOf) {
  let localDone = 0;
  let resume = null;
  for (const x of list) {
    const r = ratioOf(x.number);
    if (r <= 0) continue;
    if (r >= COMPLETE_RATIO) localDone = Math.max(localDone, x.number);
    else if (!resume || x.number > resume.number) resume = x;
  }
  const seen = Math.max(listProgress, localDone);
  if (resume && resume.number > seen) return { seen, ep: resume, mode: 'resume' };
  const ep = list.find((x) => x.number === seen + 1);
  if (ep) return { seen, ep, mode: seen ? 'next' : 'start' };
  return { seen, ep: null, mode: 'caught' };
}

const shortDate = (at) =>
  new Date(at * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

function Countdown({ at }) {
  useCountdownTick(at * 1000);
  const ms = at * 1000 - Date.now();
  return ms > 0 ? <>{fmtCountdown(ms)}</> : <>any moment</>;
}

/** The whole run at a glance: one cell per episode (a bar for long-runners). */
function Reel({ seen, aired, total, next }) {
  const n = Math.max(total || 0, aired, next || 0);
  if (!n) return null;
  const watched = Math.min(seen, n);
  const caption = (
    <span className={k.reelText}>
      <b>{watched}</b> watched · {aired} aired{total ? ` · ${total} in all` : ''}
    </span>
  );
  if (n > REEL_CELLS) {
    return (
      <div className={k.reel}>
        <span className={k.reelBar} role="img" aria-label={`${watched} of ${aired} aired episodes watched`}>
          <i className={k.reelAired} style={{ width: `${(aired / n) * 100}%` }} />
          <i className={k.reelSeen} style={{ width: `${(watched / n) * 100}%` }} />
        </span>
        {caption}
      </div>
    );
  }
  return (
    <div className={k.reel}>
      <span className={k.cells} role="img" aria-label={`${watched} of ${aired} aired episodes watched`}>
        {Array.from({ length: n }, (_, i) => {
          const ep = i + 1;
          const state = ep <= watched ? 'seen' : ep === next ? 'next' : ep <= aired ? 'aired' : 'later';
          return <i key={ep} data-s={state} />;
        })}
      </span>
      {caption}
    </div>
  );
}

function Slate({ n, still, veiled, big = false }) {
  if (still) {
    return <img src={still} alt="" loading="lazy" className={veiled ? k.veiled : undefined} />;
  }
  return (
    <span className={big ? `${k.slate} ${k.slateBig}` : k.slate} aria-hidden="true">
      <b>{n}</b>
    </span>
  );
}

export default function Episodes({ media }) {
  const eps = useApi(`/anime/episodes/${media.id}`);
  const { open } = usePlayer();
  const { progress } = useProgress();
  const { overlay, queueListEdit } = useAnimeSync();
  const entry = applyOverlay(media.id, media.list_entry, overlay);
  // Spoiler guard: past your progress, stills and titles stay veiled (they
  // routinely give the plot away). Remembered on this machine, on by default.
  const [guard, setGuard] = useState(() => {
    try { return localStorage.getItem(SPOILER_KEY) !== '0'; } catch { return true; }
  });
  const toggleGuard = () => setGuard((g) => {
    try { localStorage.setItem(SPOILER_KEY, g ? '0' : '1'); } catch { /* private mode */ }
    return !g;
  });
  const [range, setRange] = useParamState('eps', '');
  // Tiles are dealt in with the page's opening cascade; ones that arrive later (a
  // new range) shouldn't wait a second for a cascade that has already happened.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), 2200);
    return () => clearTimeout(id);
  }, []);

  // Playback state per episode, keyed exactly like the player reports it, so the
  // tiles' progress bars match the Screening Room's resume indicator.
  const progOf = (n) => progress[`anime:${media.id}:${n}`];
  const ratioOf = (n) => {
    const p = progOf(n);
    return p && p.duration ? Math.min(1, p.position / p.duration) : 0;
  };

  // AniList's streaming episodes with the local source's keys folded in by number
  // (episodeList.js — the player's episode rail reads the very same list).
  const list = useMemo(() => buildEpisodeList(media, eps.data?.episodes), [media, eps.data]);

  const aired = list.length ? list[list.length - 1].number : 0;
  const links = media.external_links || [];
  const seriesLink = links[0] || null;
  const next = media.next_airing?.airing_at * 1000 > Date.now() ? media.next_airing : null;
  const where = whereYouAre(list, entry?.progress || 0, ratioOf);
  const veiled = (n) => guard && !!entry && n > where.seen;

  const playLocal = (e) => open(episodeItem(media, e));
  // Launch an official source; watching an episode there advances AniList progress.
  const launch = (url, epNumber) => {
    launchOfficial(url);
    if (epNumber != null && entry && epNumber > (entry.progress || 0)) {
      queueListEdit(media, { progress: epNumber });
    }
  };
  const officialOf = (e) => (e.url ? { url: e.url, site: e.site } : seriesLink);
  const primaryOf = (e) => {
    if (e.key) return () => playLocal(e);
    const o = officialOf(e);
    return o ? () => launch(o.url, e.number) : null;
  };

  // Long-runners page in stretches; open on the one holding the episode you're on.
  const paged = list.length > PAGE_AT;
  const chunks = paged ? Math.ceil(list.length / CHUNK) : 1;
  const home = where.ep ? Math.floor((where.ep.number - 1) / CHUNK) : Math.max(0, chunks - 1);
  const chunk = paged ? Math.min(chunks - 1, Math.max(0, range === '' ? home : Number(range) || 0)) : 0;
  const shown = paged ? list.slice(chunk * CHUNK, chunk * CHUNK + CHUNK) : list;
  const lastChunk = chunk === chunks - 1;
  const rangeLabel = (i) => `${i * CHUNK + 1}–${Math.min(list.length, (i + 1) * CHUNK)}`;

  const deskEp = where.ep;
  const deskP = deskEp ? progOf(deskEp.number) : null;
  const deskOfficial = deskEp ? officialOf(deskEp) : null;
  const kicker = {
    resume: 'Continue watching',
    next: 'Up next',
    start: 'Start here',
    caught: next ? (aired ? 'You’re caught up' : 'Not on air yet') : 'All watched',
  }[where.mode];
  const showDesk = deskEp || (where.mode === 'caught' && (next || (aired > 0 && entry)));

  return (
    <section className={`${s.relBlock} ${k.section}`}>
      <div className={k.head}>
        <h3 className={s.blockLabel}>Episodes</h3>
        <div className={k.headTools}>
          {paged && (chunks <= 8 ? (
            <div className={k.ranges} role="group" aria-label="Episodes shown">
              {Array.from({ length: chunks }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  className={i === chunk ? k.rangeOn : k.range}
                  aria-pressed={i === chunk}
                  onClick={() => setRange(i === home ? '' : String(i))}
                >
                  {rangeLabel(i)}
                </button>
              ))}
            </div>
          ) : (
            <select
              className={k.rangeSelect}
              value={chunk}
              onChange={(ev) => setRange(Number(ev.target.value) === home ? '' : ev.target.value)}
              aria-label="Episodes shown"
            >
              {Array.from({ length: chunks }, (_, i) => (
                <option key={i} value={i}>Episodes {rangeLabel(i)}</option>
              ))}
            </select>
          ))}
          {entry && (
            <button
              type="button"
              className={guard ? k.guardOn : k.guard}
              onClick={toggleGuard}
              aria-pressed={guard}
              title="Hide stills and titles of episodes you haven't watched yet"
            >
              {guard ? <EyeOff size={13} /> : <Eye size={13} />} Spoiler guard
            </button>
          )}
        </div>
      </div>

      {showDesk && (
        <div className={k.desk} data-mode={where.mode}>
          <button
            type="button"
            className={k.deskArt}
            onClick={deskEp ? primaryOf(deskEp) || undefined : undefined}
            disabled={!deskEp || !primaryOf(deskEp)}
            tabIndex={-1}
            aria-hidden="true"
          >
            {deskEp ? (
              <>
                <Slate n={deskEp.number} still={deskEp.still} veiled={veiled(deskEp.number)} big />
                {deskP?.duration > 0 && (
                  <span className={k.bar}><i style={{ width: `${Math.max(3, ratioOf(deskEp.number) * 100)}%` }} /></span>
                )}
                <span className={k.deskPlay}><Play size={22} fill="currentColor" /></span>
              </>
            ) : next || !list.length ? (
              <span className={`${k.slate} ${k.slateBig} ${k.slateWait}`}>
                <b>{next?.episode}</b>
              </span>
            ) : (
              // all watched: the finale, with the mark
              <>
                <Slate n={list[list.length - 1].number} still={list[list.length - 1].still} big />
                <span className={k.deskDone}><Check size={26} strokeWidth={3} /></span>
              </>
            )}
          </button>

          <div className={k.deskBody}>
            <span className={k.kicker}>{kicker}</span>
            {deskEp ? (
              <>
                <h4 className={k.deskTitle}>Episode {deskEp.number}</h4>
                {deskEp.title && (veiled(deskEp.number) && where.mode !== 'resume'
                  ? <p className={`${k.deskSub} ${k.hidden}`}>Title hidden by the spoiler guard</p>
                  : <p className={k.deskSub}>{deskEp.title}</p>)}
                {where.mode === 'resume' && deskP?.duration > 0 && (
                  <p className={k.deskNote}>
                    Stopped at {clock(deskP.position)} of {clock(deskP.duration)}
                  </p>
                )}
              </>
            ) : next ? (
              <>
                <h4 className={k.deskTitle}>
                  {next.episode === 1 ? 'Premieres' : `Episode ${next.episode} airs`} in <Countdown at={next.airing_at} />
                </h4>
                <p className={k.deskNote}>{airingDateLabel(next.airing_at)}</p>
              </>
            ) : (
              <h4 className={k.deskTitle}>All {aired} episodes watched</h4>
            )}

            <Reel seen={where.seen} aired={aired} total={media.episodes} next={deskEp?.number || next?.episode} />

            <div className={k.deskActions}>
              {deskEp?.key && (
                <button type="button" className={k.primary} onClick={() => playLocal(deskEp)}>
                  <Play size={14} fill="currentColor" />
                  {where.mode === 'resume' ? 'Resume' : 'Play'} episode {deskEp.number}
                </button>
              )}
              {deskEp && !deskEp.key && deskOfficial && (
                <button type="button" className={k.primary} onClick={() => launch(deskOfficial.url, deskEp.number)}>
                  <ExternalLink size={14} /> Watch on {deskOfficial.site || 'the official site'}
                </button>
              )}
              {!deskEp && where.mode === 'caught' && !next && list[0] && primaryOf(list[0]) && (
                <button type="button" className={k.secondary} onClick={primaryOf(list[0])}>
                  <RotateCcw size={13} /> Watch episode 1 again
                </button>
              )}
              {links.length > 0 && (
                <span className={k.sites}>
                  {deskEp?.key || !deskEp ? 'Watch on' : 'Also on'}
                  {links
                    .filter((l) => !(deskEp && !deskEp.key && deskOfficial && l.url === deskOfficial.url))
                    .map((l) => (
                      <button
                        key={l.url}
                        type="button"
                        className={k.site}
                        style={l.color ? { '--ext-c': l.color } : undefined}
                        onClick={() => launch(l.url, null)}
                        title={`Open ${media.title} on ${l.site}`}
                      >
                        {l.icon ? <img src={l.icon} alt="" /> : <ExternalLink size={11} />}
                        {l.site}
                      </button>
                    ))}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {!list.length && eps.loading && <Receiving label="finding episodes" />}
      {!list.length && !eps.loading && !next && (
        <p className={s.muted}>No episodes listed for this title yet.</p>
      )}

      {(shown.length > 0 || (next && lastChunk)) && (
        <ol
          className={k.sheet}
          start={shown[0]?.number || 1}
          style={settled ? { '--deal': '0s' } : undefined}
        >
          {shown.map((e, i) => {
            const r = ratioOf(e.number);
            const p = progOf(e.number);
            const done = e.number <= where.seen || r >= COMPLETE_RATIO;
            const isNext = deskEp?.number === e.number;
            const go = primaryOf(e);
            const official = officialOf(e);
            const hide = veiled(e.number);
            return (
              <li
                key={e.number}
                className={k.tile}
                data-state={isNext ? 'next' : done ? 'seen' : undefined}
                style={i < DEAL_MAX ? { '--i': i } : { animation: 'none' }}
              >
                <button type="button" className={k.tileMain} onClick={go || undefined} disabled={!go}>
                  <span className={k.frame}>
                    <Slate n={e.number} still={e.still} veiled={hide} />
                    {e.still && <span className={k.frameNum}>{e.number}</span>}
                    <span className={k.tilePlay}>
                      {e.key ? <Play size={18} fill="currentColor" /> : <ExternalLink size={16} />}
                    </span>
                    {done && <span className={k.seenMark} title="Watched"><Check size={12} strokeWidth={3} /></span>}
                    {isNext && <span className={k.nextMark}>{where.mode === 'resume' ? 'Resume' : 'Up next'}</span>}
                    {r > 0 && (
                      <>
                        {p?.duration > 0 && !done && (
                          <span className={k.time}>{clock(p.position)} / {clock(p.duration)}</span>
                        )}
                        <span className={k.bar}><i style={{ width: `${Math.max(4, r * 100)}%` }} data-done={r >= COMPLETE_RATIO || undefined} /></span>
                      </>
                    )}
                  </span>
                  <span className={k.cap}>
                    <span className={k.capNum}>Episode {e.number}</span>
                    {e.title && (hide
                      ? <span className={`${k.capTitle} ${k.hidden}`}>Title hidden</span>
                      : <span className={k.capTitle}>{e.title}</span>)}
                  </span>
                </button>
                {/* When the local source plays it, the official site is the second way in. */}
                {e.key && official && (
                  <button
                    type="button"
                    className={k.ext}
                    title={`Watch episode ${e.number} on ${official.site || 'the official site'}`}
                    aria-label={`Watch episode ${e.number} on ${official.site || 'the official site'}`}
                    onClick={() => launch(official.url, e.number)}
                  >
                    <ExternalLink size={13} />
                  </button>
                )}
              </li>
            );
          })}
          {next && lastChunk && next.episode > aired && (
            <li className={`${k.tile} ${k.tileWait}`} style={{ '--i': Math.min(shown.length, DEAL_MAX) }}>
              <div className={k.tileMain}>
                <span className={k.frame}>
                  <span className={k.slate} aria-hidden="true"><b>{next.episode}</b></span>
                </span>
                <span className={k.cap}>
                  <span className={k.capNum}>Episode {next.episode}</span>
                  <span className={k.capTitle}>
                    in <Countdown at={next.airing_at} /> · {shortDate(next.airing_at)}
                  </span>
                </span>
              </div>
            </li>
          )}
        </ol>
      )}
    </section>
  );
}
