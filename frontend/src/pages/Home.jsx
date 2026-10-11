// "/" — the living room. The set is switched on before you sit down.
//
// The home screen answers "what now?" before "where to?". A greeting says in one
// line what's waiting (new uploads, episodes of shows still airing, whoever's live,
// what airs next, today's paper), each part a link. Under it the set (TheSet.jsx)
// is tuned to whatever you'd pick up next, with the rest of that queue as presets,
// a clock, the two channel knobs and a slip of what's coming up. Under the set the
// two channel guides (Guides.jsx) say what's in each channel: Channel 1 is the
// Hub (today's paper, then every room you've switched on in Settings → Rooms),
// Channel 2 is The Anime. Keys: 1 and 2 here, Space g h and Space g a from
// anywhere, h j k l to walk the screen.
//
// Everything is read from what the rooms already fetch and cache, so the front of
// the set costs next to nothing (components/home/lineup.js).

import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

import { useApi } from '../api/client.js';
import { useProgress, useSaved, useSettings } from '../state.jsx';
import { themeMeta } from '../lib/themes.js';
import { ANIME_HOME, HUB_HOME, getActiveRooms, knownActiveIds } from '../lib/rooms.js';
import { openPalette } from '../components/layout/HubConsole.jsx';
import { useChannelFeed, useSeen } from '../components/screening/feed.js';
import TheSet from '../components/home/TheSet.jsx';
import { AnimeGuide, HubGuide } from '../components/home/Guides.jsx';
import {
  airingBacklog, slotLabel, tallyShelves, useAnimeEntries, useComingUp, useMinute, usePickUp,
} from '../components/home/lineup.js';
import h from './home.module.css';

function daypart(d) {
  const hr = d.getHours();
  if (hr < 5) return { hello: 'Late night', part: 'night' };
  if (hr < 12) return { hello: 'Good morning', part: 'morning' };
  if (hr < 18) return { hello: 'Good afternoon', part: 'afternoon' };
  return { hello: 'Good evening', part: 'evening' };
}

function dateLine(d) {
  return d
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .replace(/,/g, ' ·');
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "at 21:40", "tomorrow at 09:00" — for the greeting's next-airing clause. */
function whenWords(at, now) {
  const { day, time } = slotLabel(at, now);
  if (day === 'Today') return `at ${time}`;
  if (day === 'Tmrw') return `tomorrow at ${time}`;
  return `${day} at ${time}`;
}

/** What's waiting, as one sentence of links. Each clause keeps its own key so a
 *  clause that arrives late fades in without the others replaying. */
function Summary({ ready, part, live, newUploads, backlog, soon, paperToday, now }) {
  const clauses = [];
  if (live.length) {
    const first = live[0].item;
    clauses.push(['live', (
      <><Link to="/youtube?v=live">{first.source}</Link>{live.length > 1 ? ` and ${plural(live.length - 1, 'other')} are` : ' is'} live now</>
    )]);
  }
  if (newUploads) {
    clauses.push(['uploads', (
      <><Link to="/youtube?v=latest">{plural(newUploads, 'new upload')}</Link> from your channels</>
    )]);
  }
  if (backlog.eps) {
    clauses.push(['backlog', (
      <><Link to="/anime?tab=list&shelf=CURRENT">{plural(backlog.eps, 'episode')}</Link> waiting on {backlog.shows === 1 ? 'a show still airing' : `${backlog.shows} airing shows`}</>
    )]);
  }
  if (soon) {
    clauses.push(['soon', soon.kind === 'stream' ? (
      <><Link to="/youtube?v=live">{soon.item.source}</Link> goes live {whenWords(soon.at, now)}</>
    ) : (
      <><Link to={`/anime/${soon.m.id}`}>{soon.m.title}</Link> {soon.kind === 'premiere' ? 'premieres' : `episode ${soon.m.next_episode} airs`} {whenWords(soon.at, now)}</>
    )]);
  }
  if (paperToday && clauses.length < 4) {
    clauses.push(['paper', <>{clauses.length ? 'today’s ' : 'Today’s '}<Link to="/edition">paper</Link> is out</>]);
  }
  const shown = clauses.slice(0, 4);

  let body = null;
  if (shown.length) {
    body = shown.map(([key, node], i) => (
      <span key={key} className={h.clause} style={{ '--i': i }}>
        {i > 0 && (i === shown.length - 1 ? ' and ' : ', ')}
        {node}
        {i === shown.length - 1 && '.'}
      </span>
    ));
  } else if (ready) {
    body = <span className={h.clause}>Nothing new since you last looked. A quiet {part} in.</span>;
  }
  return <p className={`${h.summary} tc-strip`} aria-live="polite">{body}</p>;
}

export default function Home() {
  const navigate = useNavigate();
  const now = useMinute();
  const { settings } = useSettings();
  const { progress } = useProgress();
  const { saved } = useSaved();
  const rooms = getActiveRooms(knownActiveIds(settings?.active_rooms));

  const anime = useAnimeEntries();
  const pickUp = usePickUp(anime.entries);
  const { feed, live, hasSubs } = useChannelFeed();
  const comingUp = useComingUp(anime.entries, live, now);
  const { newCount } = useSeen();
  const paper = useApi('/edition/latest');
  // This season's covers behind Channel 2 — the browse shelf is cached server-side
  // for half an hour, so the home screen costs AniList next to nothing.
  const season = useApi('/anime/browse?kind=seasonal');
  const covers = (season.data?.items || []).filter((m) => m.cover).slice(0, 30);

  const newUploads = newCount(feed.data?.items);
  const liveRows = comingUp.filter((r) => r.kind === 'live');
  const backlog = airingBacklog(anime.entries, progress);
  const t = now.getTime() / 1000;
  const soon = comingUp.find((r) => r.kind !== 'live' && r.at - t < 86400) || null;
  const paperToday = !!paper.data && paper.data.date === now.toLocaleDateString('en-CA');
  const ready = !anime.loading && !(hasSubs && feed.loading && !feed.data) && !paper.loading;
  const comingReady = !anime.loading && !(hasSubs && live.loading && !live.data);
  const { hello, part } = daypart(now);

  // Channel numbers: 1 → Hub, 2 → Anime (plain keys, only on this screen — and
  // never while the player or the editor has the keyboard).
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.defaultPrevented) return;
      if (document.body.dataset.playerExpanded || document.body.dataset.editorFocused) return;
      const el = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.key === '1') { e.preventDefault(); navigate(HUB_HOME); }
      if (e.key === '2') { e.preventDefault(); navigate(ANIME_HOME); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const hubSub = rooms.length ? plural(rooms.length, 'room') : 'no rooms on';
  const animeSub = anime.entries ? `${tallyShelves(anime.entries).watching} watching` : 'AniList';

  return (
    <div className={h.home}>
      <div className={`${h.topline} tc-strip`}>
        <span>{dateLine(now)}</span>
        <span className={h.skin}>{themeMeta(settings?.theme || 'dark').label}</span>
        <span className={h.power}>
          <span className={`${h.led} ${liveRows.length ? h.ledLive : ''}`} />
          {liveRows.length ? `${liveRows.length} live now` : 'on the air'}
        </span>
      </div>

      <header className={h.hello}>
        <h1 className={`${h.greeting} tc-hero`} aria-label={`${hello}.`}>
          {hello.split(' ').map((w, i) => (
            <span key={`${w}${i}`} className={h.word} style={{ '--i': i }} aria-hidden="true">{w}</span>
          ))}
          <em aria-hidden="true">.</em>
        </h1>
        <button type="button" className={`${h.search} tc-float`} onClick={openPalette} title="Search YouTube, Reddit, HN and GitHub at once">
          <Search size={15} />
          <span>Search everything</span>
          <kbd>Ctrl</kbd><kbd>K</kbd>
        </button>
        <Summary
          ready={ready} part={part} live={liveRows} newUploads={newUploads} backlog={backlog}
          soon={soon} paperToday={paperToday} now={now}
        />
      </header>

      <TheSet
        pickUp={pickUp} comingUp={comingUp} comingReady={comingReady} now={now}
        hubSub={hubSub} animeSub={animeSub}
      />

      <div className={h.guides}>
        <HubGuide
          rooms={rooms} paper={paper} now={now} newUploads={newUploads} liveNow={liveRows.length}
          savedCount={Object.keys(saved || {}).length}
        />
        <AnimeGuide anime={anime} covers={covers} />
      </div>

      <p className={`${h.hint} tc-strip`}>
        <kbd>Space</kbd><kbd>g</kbd><kbd>h</kbd> and <kbd>Space</kbd><kbd>g</kbd><kbd>a</kbd> switch channels from anywhere
        · <kbd>h</kbd><kbd>j</kbd><kbd>k</kbd><kbd>l</kbd> walk the screen
        · <kbd>Ctrl</kbd><kbd>K</kbd> searches everything
      </p>
    </div>
  );
}
