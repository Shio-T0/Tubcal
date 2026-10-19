// The three channel guides under the set — where to go, with a word on what's there.
//
//   SocialGuide  Channel 1: today's paper (its lead and two more headlines), then
//                the Social rooms as numbered keys
//   CodingGuide  Channel 2: the files open in the editor, the Workbench's languages,
//                what GitHub follows, then the Coding rooms
//   VideoGuide   Channel 3, the widest: the newest uploads from your channels on one
//                side; your AniList shelves, this season's most popular titles and
//                doors into the Anime on the other, over a drifting wall of covers
//
// Each guide's foot says how much you've saved in that channel (a door into the
// Saved page, filtered to it) and the keys that open the channel.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bookmark, FileCode2, Play, Radio, Search } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { isStill } from '../../lib/motion.js';
import { ANIME_HOME } from '../../lib/rooms.js';
import { channelOfItem } from '../../lib/saveable.js';
import { useShared } from '../../lib/useShared.js';
import { usePlayer, useSaved, useSubscriptions } from '../../state.jsx';
import { openPalette, useChannelHomes } from '../channels/common.jsx';
import { tallyShelves } from './lineup.js';
import g from './guides.module.css';

/** Count up to `target` on arrival (and glide between values after that). */
function useCountUp(target, ms = 900) {
  const [v, setV] = useState(0);
  const at = useRef(0);
  useEffect(() => {
    if (target == null) return undefined;
    if (isStill()) {
      at.current = target;
      setV(target);
      return undefined;
    }
    const from = at.current;
    const t0 = performance.now();
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      at.current = Math.round(from + (target - from) * (1 - (1 - k) ** 3));
      setV(at.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function Keys({ keys }) {
  return (
    <span className={g.keys}>
      {keys.map((k, i) => (k === 'or' ? <em key={i}>or</em> : <kbd key={i}>{k}</kbd>))}
    </span>
  );
}

function ChannelHead({ n, id, to, kicker, title, extra }) {
  return (
    <Link to={to} className={g.head} id={id}>
      <span className={g.dial}>{n}</span>
      <span className={g.headText}>
        <span className={g.kicker}>{kicker}</span>
        <span className={g.title}>{title}{extra}</span>
      </span>
      <ArrowRight size={20} className={g.arrow} />
    </Link>
  );
}

// ── Channel 1 ────────────────────────────────────────────────────────────────

const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function paperDate(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  if (!y) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Today's paper, folded: issue line, the lead (with its picture), two more. */
function Paper({ req, now }) {
  const p = req.data;
  if (!p) {
    return (
      <Link to="/edition" className={`${g.paper} ${g.paperBlank}`}>
        <span className={g.paperMast}>The Edition</span>
        <span className={g.paperNote}>
          {req.loading ? 'Fetching today’s paper…' : 'No paper yet. The press composes one in the background every day.'}
        </span>
      </Link>
    );
  }
  const stories = [p.lede, ...(p.columns || [])].filter(Boolean);
  const [lead, ...rest] = stories;
  const picture = lead?.items?.find((i) => i.thumbnail)?.thumbnail;
  const today = p.date === localDay(now);
  return (
    <Link to="/edition" className={g.paper} title="Read The Edition">
      <span className={g.paperMast}>
        <b>No {p.issue}</b>
        <span>{today ? 'Today' : paperDate(p.date)}</span>
        <span>{p.status === 'edited' ? 'composed' : 'wire edition'} · {p.sources} sources</span>
      </span>
      {lead && (
        <span className={g.lead}>
          {picture && <img src={picture} alt="" loading="lazy" />}
          <span className={g.headline}>{lead.headline}</span>
        </span>
      )}
      {rest.length > 0 && (
        <span className={g.more}>
          {rest.slice(0, 2).map((st, i) => <span key={i} className={g.moreLine}>{st.headline}</span>)}
        </span>
      )}
    </Link>
  );
}

/** A guide's foot: what you've saved in this channel, search, and its keys. */
function Foot({ channel, n, children }) {
  const { saved } = useSaved();
  const kept = Object.values(saved || {}).filter((it) => channelOfItem(it) === channel).length;
  const key = { social: 's', coding: 'c', video: 'v' }[channel];
  return (
    <footer className={g.foot}>
      <Link to={`/saved?ch=${channel}`}><Bookmark size={13} /> Saved here{kept ? <b>{kept}</b> : null}</Link>
      {children}
      <Keys keys={[String(n), 'or', 'Space', 'g', key]} />
    </footer>
  );
}

function RoomKeys({ rooms, badges = {}, label }) {
  return (
    <nav className={g.rooms} aria-label={label}>
      {rooms.map((r, i) => (
        <Link key={r.id} to={r.route} className={g.room} style={{ '--room-c': r.color, '--i': i }} data-kbd-tile>
          <span className={g.roomNo}>{String(i + 1).padStart(2, '0')}</span>
          <span className={g.roomName}>{r.label}</span>
          <span className={g.roomBadges}>{badges[r.id]}</span>
        </Link>
      ))}
    </nav>
  );
}

export function SocialGuide({ rooms, paper, now }) {
  const homes = useChannelHomes();
  return (
    <section className={`${g.guide} ${g.social}`} aria-labelledby="ch-social">
      <ChannelHead n={1} id="ch-social" to={homes.social} kicker="Channel 1 · Edition, Wire, Dispatch" title="Social" />
      <Paper req={paper} now={now} />
      <RoomKeys rooms={rooms} label="Social rooms" />
      <Foot channel="social" n={1}>
        <button type="button" onClick={openPalette}><Search size={13} /> Search</button>
      </Foot>
    </section>
  );
}

// ── Channel 2 ────────────────────────────────────────────────────────────────

/** The files left open in the editor, each a door straight back to it. */
function OpenFiles({ on }) {
  const state = useApi(on ? '/editor/state' : '', on);
  const status = useShared(on ? '/editor/status' : '', { enabled: on });
  if (!on) return null;
  const tabs = [...new Set((state.data?.session?.panes || []).flatMap((p) => p.tabs || []))].slice(0, 4);
  const root = status.data?.root?.replace(/^\/home\/[^/]+/, '~');
  return (
    <div className={g.block}>
      <div className={g.blockHead}>
        <span>Open in the editor</span>
        {root && <span className={g.blockNote}>{root}</span>}
      </div>
      {tabs.length > 0 ? (
        <ul className={g.files}>
          {tabs.map((t, i) => {
            const name = t.split('/').pop();
            const dir = t.slice(0, -name.length);
            return (
              <li key={t} style={{ '--i': i }}>
                <Link to={`/editor?open=${encodeURIComponent(t)}`} data-kbd-tile title={t}>
                  <FileCode2 size={13} />
                  <span className={g.fileDir}>{dir}</span>
                  <span className={g.fileName}>{name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={g.blockEmpty}>{state.loading ? 'Reading the session…' : 'Nothing open. Space f inside the editor finds a file.'}</p>
      )}
    </div>
  );
}

/** The Workbench's languages, as spines to pull. */
function Languages({ on }) {
  const langs = useApi(on ? '/dev/languages' : '', on);
  if (!on) return null;
  const list = langs.data?.languages || [];
  return (
    <div className={g.block}>
      <div className={g.blockHead}><span>On the Workbench</span></div>
      <div className={g.langs}>
        {list.map((l, i) => (
          <Link key={l.id} to={`/dev?l=${l.id}`} className={g.lang} style={{ '--lang-c': l.accent, '--i': i }} title={l.tagline} data-kbd-tile>
            <span aria-hidden="true">{l.mascot}</span>{l.name}
          </Link>
        ))}
        {langs.loading && !list.length && <span className={g.blockEmpty}>Pulling the manuals…</span>}
      </div>
    </div>
  );
}

export function CodingGuide({ rooms }) {
  const homes = useChannelHomes();
  const { subs } = useSubscriptions();
  const ids = new Set(rooms.map((r) => r.id));
  const following = subs?.github?.length || 0;
  const badges = {
    github: following > 0 ? <span className={g.badge}>{following} followed</span> : null,
  };
  return (
    <section className={`${g.guide} ${g.coding}`} aria-labelledby="ch-coding">
      <ChannelHead n={2} id="ch-coding" to={homes.coding} kicker="Channel 2 · Editor, Workbench, GitHub" title="Coding" />
      <OpenFiles on={ids.has('editor')} />
      <Languages on={ids.has('dev')} />
      <RoomKeys rooms={rooms} badges={badges} label="Coding rooms" />
      <Foot channel="coding" n={2}>
        {!ids.has('github') && <Link to="/settings?s=rooms">GitHub is off</Link>}
      </Foot>
    </section>
  );
}

// ── Channel 3 ────────────────────────────────────────────────────────────────

const DOORS = [
  ['Browse', '/anime'],
  ['Seasons', '/anime?tab=seasons'],
  ['Schedule', '/anime?tab=schedule'],
  ['My List', '/anime?tab=list'],
  ['Ledger', '/anime?tab=ledger'],
  ['Community', '/anime?tab=community'],
];

function Counter({ n, label, to, i }) {
  const v = useCountUp(n);
  return (
    <Link to={to} className={g.counter} style={{ '--i': i }} data-kbd-tile>
      <span className={g.count}>{v}</span>
      <span className={g.countLabel}>{label}</span>
    </Link>
  );
}

function Shelves({ entries }) {
  const tally = tallyShelves(entries);
  return (
    <div className={g.shelves}>
      <Counter i={0} n={tally.watching} label="Watching" to="/anime?tab=list&shelf=CURRENT" />
      <Counter i={1} n={tally.airing} label="Airing" to="/anime?tab=schedule" />
      <Counter i={2} n={tally.planning} label="Planned" to="/anime?tab=list&shelf=PLANNING" />
      <Counter i={3} n={tally.completed} label="Finished" to="/anime?tab=list&shelf=COMPLETED" />
    </div>
  );
}

const REEL = 6;

/** This season's most popular titles, each a door to its page. Ones already on
 *  your list carry a dot. */
function Reel({ covers }) {
  const first = covers[0];
  const name = first?.season ? `${first.season[0]}${first.season.slice(1).toLowerCase()} ${first.year || ''}` : 'This season';
  return (
    <div className={g.reel}>
      <div className={g.reelHead}>
        <span>{name.trim()} · most popular</span>
        <Link to="/anime?tab=seasons">The season <ArrowRight size={12} /></Link>
      </div>
      <div className={g.reelRow}>
        {covers.slice(0, REEL).map((m, i) => (
          <Link key={m.id} to={`/anime/${m.id}`} className={g.reelItem} style={{ '--i': i, '--cover-c': m.color || 'var(--ch)' }} title={m.title} data-kbd-tile>
            <span className={g.reelPic}>
              <img src={m.cover} alt="" loading="lazy" />
              {m.list_entry?.status && <i className={g.onList} title="On your list" />}
            </span>
            <span className={g.reelName}>{m.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** The newest uploads from your channels: press one and it plays. */
function Uploads({ feed, newUploads, liveNow }) {
  const { open } = usePlayer();
  const items = (feed.data?.items || []).filter((i) => !i.extra?.live_status).slice(0, 3);
  return (
    <div className={g.uploads}>
      {items.map((item, i) => (
        <button key={item.id} type="button" className={g.upload} style={{ '--i': i }} onClick={() => open(item)} title={item.title} data-kbd-tile>
          <span className={g.uploadPic}>
            <img src={item.thumbnail} alt="" loading="lazy" />
            <span className={g.uploadPlay}><Play size={14} fill="currentColor" /></span>
          </span>
          <span className={g.uploadText}>
            <span className={g.uploadTitle}>{item.title}</span>
            <span className={g.uploadFrom}>{item.source}</span>
          </span>
        </button>
      ))}
      {!items.length && (
        <p className={g.blockEmpty}>{feed.loading ? 'Tuning in…' : 'Follow a channel in the Screening Room and its uploads land here.'}</p>
      )}
      <span className={g.uploadBadges}>
        {liveNow > 0 && <span className={`${g.badge} ${g.badgeLive}`}><Radio size={10} /> {liveNow} live</span>}
        {newUploads > 0 && <span className={g.badge}>{newUploads} new</span>}
      </span>
    </div>
  );
}

export function VideoGuide({ rooms, anime, covers, feed, newUploads, liveNow }) {
  const homes = useChannelHomes();
  const behind = covers.slice(REEL);
  const archive = rooms.find((r) => r.id === 'archive');
  return (
    <section className={`${g.guide} ${g.video}`} aria-labelledby="ch-video">
      {behind.length > 0 && (
        <div className={g.mosaic} aria-hidden="true">
          {behind.map((m, i) => <img key={m.id} src={m.cover} alt="" loading="lazy" style={{ '--i': i }} />)}
        </div>
      )}
      <ChannelHead n={3} id="ch-video" to={homes.video} kicker="Channel 3 · Screening Room, Anime, Archive" title="Video" />
      <div className={g.halves}>
        <div className={g.half}>
          <Link to="/youtube" className={g.halfHead} style={{ '--room-c': 'var(--c-youtube)' }}>
            Screening Room <ArrowRight size={14} />
          </Link>
          <Uploads feed={feed} newUploads={newUploads} liveNow={liveNow} />
          {archive && (
            <Link to={archive.route} className={g.halfHead} style={{ '--room-c': archive.color }}>
              The Archive <ArrowRight size={14} />
            </Link>
          )}
        </div>
        <div className={g.half}>
          <Link to={ANIME_HOME} className={g.halfHead} style={{ '--room-c': 'var(--c-anime)' }}>
            The Anime <i lang="ja">アニメ</i> <ArrowRight size={14} />
          </Link>
          {anime.entries ? (
            <Shelves entries={anime.entries} />
          ) : !anime.loading && !anime.connected ? (
            <Link to="/settings?s=accounts" className={g.connect}>
              Connect AniList in Settings to bring your shelves, your next episodes and their air dates here.
            </Link>
          ) : (
            <div className={g.shelves} aria-hidden="true" />
          )}
          {covers.length > 0 && <Reel covers={covers} />}
          <nav className={g.doors} aria-label="Anime sections">
            {DOORS.map(([label, to], i) => (
              <Link key={label} to={to} className={g.door} style={{ '--i': i }} data-kbd-tile>{label}</Link>
            ))}
          </nav>
        </div>
      </div>
      <Foot channel="video" n={3} />
    </section>
  );
}
