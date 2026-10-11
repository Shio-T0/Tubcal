// The two channel guides under the set — where to go, with a word on what's there.
//
//   HubGuide     Channel 1: today's paper (its lead and two more headlines), then the
//                rooms you have switched on as numbered keys, each with what's new in it
//   AnimeGuide   Channel 2: your AniList shelves at a glance, this season's most
//                popular titles (the rest of the season drifts behind), and doors
//                straight into the Anime's views

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bookmark, Radio, Search, Settings } from 'lucide-react';

import { isStill } from '../../lib/motion.js';
import { ANIME_HOME, HUB_HOME } from '../../lib/rooms.js';
import { openPalette } from '../layout/HubConsole.jsx';
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

export function HubGuide({ rooms, paper, now, newUploads, liveNow, savedCount }) {
  const badges = {
    youtube: (
      <>
        {liveNow > 0 && <span className={`${g.badge} ${g.badgeLive}`}><Radio size={10} /> live</span>}
        {newUploads > 0 && <span className={g.badge}>{newUploads} new</span>}
      </>
    ),
  };
  return (
    <section className={`${g.guide} ${g.hub}`} aria-labelledby="ch-hub">
      <ChannelHead n={1} id="ch-hub" to={HUB_HOME} kicker="Channel 1 · the broadsheet" title="Hub" />
      <Paper req={paper} now={now} />
      <nav className={g.rooms} aria-label="Hub rooms">
        {rooms.map((r, i) => (
          <Link key={r.id} to={r.route} className={g.room} style={{ '--room-c': r.color, '--i': i }} data-kbd-tile>
            <span className={g.roomNo}>No {String(i + 1).padStart(2, '0')}</span>
            <span className={g.roomName}>{r.label}</span>
            <span className={g.roomBadges}>{badges[r.id]}</span>
          </Link>
        ))}
      </nav>
      <footer className={g.foot}>
        <Link to="/saved"><Bookmark size={13} /> Saved{savedCount ? <b>{savedCount}</b> : null}</Link>
        <Link to="/settings"><Settings size={13} /> Settings</Link>
        <button type="button" onClick={openPalette}><Search size={13} /> Search</button>
        <Keys keys={['1', 'or', 'Space', 'g', 'h']} />
      </footer>
    </section>
  );
}

// ── Channel 2 ────────────────────────────────────────────────────────────────

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

export function AnimeGuide({ anime, covers }) {
  const behind = covers.slice(REEL);
  return (
    <section className={`${g.guide} ${g.anime}`} aria-labelledby="ch-anime">
      {behind.length > 0 && (
        <div className={g.mosaic} aria-hidden="true">
          {behind.map((m, i) => <img key={m.id} src={m.cover} alt="" loading="lazy" style={{ '--i': i }} />)}
        </div>
      )}
      <ChannelHead
        n={2} id="ch-anime" to={ANIME_HOME} kicker="Channel 2 · the picture scroll" title="Anime"
        extra={<i lang="ja">アニメ</i>}
      />
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
      <footer className={g.foot}>
        <span className={g.footNote}>its own section, beside the hub</span>
        <Keys keys={['2', 'or', 'Space', 'g', 'a']} />
      </footer>
    </section>
  );
}
