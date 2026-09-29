// "/" — the channel chooser.
//
// The set has two channels now. Channel 1 is the Hub: The Edition and every room
// you've switched on in Settings → Rooms, reached from here in one click (or the
// channel's title takes you to The Edition). Channel 2 is The Anime, which lives
// beside the hub as a section of its own. From anywhere: Space g h / Space g a.

import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Bookmark, Settings } from 'lucide-react';

import { useApi } from '../api/client.js';
import { useSettings } from '../state.jsx';
import { themeMeta } from '../lib/themes.js';
import { ANIME_HOME, HUB_HOME, getActiveRooms, knownActiveIds } from '../lib/rooms.js';
import h from './home.module.css';

// The Anime's own tabs, as quick doors from the chooser.
const ANIME_DOORS = [
  ['Browse', '/anime'],
  ['Seasons', '/anime?tab=seasons'],
  ['Schedule', '/anime?tab=schedule'],
  ['My List', '/anime?tab=list'],
  ['Ledger', '/anime?tab=ledger'],
  ['Community', '/anime?tab=community'],
];

function todayLine() {
  return new Date()
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .replace(/,/g, ' ·');
}

function Keys({ keys }) {
  return (
    <span className={h.keys}>
      {keys.map((k, i) => (k === 'or' ? <em key={i}>or</em> : <kbd key={i}>{k}</kbd>))}
    </span>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const rooms = getActiveRooms(knownActiveIds(settings?.active_rooms));
  // This season's covers behind Channel 2 — the browse shelf is cached server-side
  // for half an hour, so the home screen costs AniList next to nothing.
  const season = useApi('/anime/browse?kind=seasonal');
  const covers = (season.data?.items || []).filter((m) => m.cover).slice(0, 18);

  // Channel numbers: 1 → Hub, 2 → Anime (plain keys, only on this screen).
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '1') { e.preventDefault(); navigate(HUB_HOME); }
      if (e.key === '2') { e.preventDefault(); navigate(ANIME_HOME); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className={h.home}>
      <div className={h.topline}>
        <span>{todayLine()}</span>
        <span>{themeMeta(settings?.theme || 'dark').label}</span>
        <span className={h.power}><span className={h.led} /> select a channel</span>
      </div>

      <h1 className={h.wordmark}>Tubcal<em>.</em></h1>

      <div className={h.channels}>
        {/* ── Channel 1: the Hub ─────────────────────────────────────────── */}
        <section className={`${h.set} ${h.hub}`} aria-labelledby="ch-hub">
          <div className={h.screen}>
            <span className={h.scan} aria-hidden="true" />
            <Link to={HUB_HOME} className={h.head} id="ch-hub" title="Go to The Edition">
              <span className={h.dial}>1</span>
              <span className={h.headText}>
                <span className={h.kicker}>Channel 1 · the broadsheet</span>
                <span className={h.title}>Hub</span>
                <span className={h.note}>Today's edition, your videos, the wire, the archive and the workshop.</span>
              </span>
              <ArrowRight size={22} className={h.arrow} />
            </Link>

            <nav className={h.rooms} aria-label="Hub rooms">
              {rooms.map((r, i) => (
                <Link key={r.id} to={r.route} className={h.room} style={{ '--room-c': r.color, '--i': i }}>
                  <span className={h.roomNo}>No {String(i + 1).padStart(2, '0')}</span>
                  <span className={h.roomName}>{r.label}</span>
                </Link>
              ))}
            </nav>

            <footer className={h.foot}>
              <Link to="/saved"><Bookmark size={13} /> Saved</Link>
              <Link to="/settings"><Settings size={13} /> Settings</Link>
              <Keys keys={['1', 'or', 'Space', 'g', 'h']} />
            </footer>
          </div>
        </section>

        {/* ── Channel 2: The Anime ───────────────────────────────────────── */}
        <section className={`${h.set} ${h.anime}`} aria-labelledby="ch-anime">
          <div className={h.screen}>
            {covers.length > 0 && (
              <div className={h.mosaic} aria-hidden="true">
                {covers.map((m, i) => (
                  <img key={m.id} src={m.cover} alt="" loading="lazy" style={{ '--i': i }} />
                ))}
              </div>
            )}
            <span className={h.scan} aria-hidden="true" />
            <Link to={ANIME_HOME} className={h.head} id="ch-anime" title="Go to The Anime">
              <span className={h.dial}>2</span>
              <span className={h.headText}>
                <span className={h.kicker}>Channel 2 · the picture scroll</span>
                <span className={h.title}>Anime <i lang="ja">アニメ</i></span>
                <span className={h.note}>All of AniList — the season, the week's schedule, your list and its ledger.</span>
              </span>
              <ArrowRight size={22} className={h.arrow} />
            </Link>

            <nav className={h.doors} aria-label="Anime sections">
              {ANIME_DOORS.map(([label, to], i) => (
                <Link key={label} to={to} className={h.door} style={{ '--i': i }}>{label}</Link>
              ))}
            </nav>

            <footer className={h.foot}>
              <span className={h.footNote}>its own section, beside the hub</span>
              <Keys keys={['2', 'or', 'Space', 'g', 'a']} />
            </footer>
          </div>
        </section>
      </div>

      <p className={h.hint}>
        <kbd>Space</kbd><kbd>g</kbd><kbd>h</kbd> and <kbd>Space</kbd><kbd>g</kbd><kbd>a</kbd> switch channels from anywhere
        · <kbd>Ctrl</kbd><kbd>K</kbd> searches everything
      </p>
    </div>
  );
}
