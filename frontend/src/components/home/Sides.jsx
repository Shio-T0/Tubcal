// The box's channel sides (TheBox.jsx): one per channel, each built like the set
// on the front — the channel's guide (Guides.jsx) where the screen would be, and
// down the right a strip of its rooms, every room with doors to the places inside
// it: the Wire's lists, the subreddits you follow, GitHub's views, the Screening
// Room's views, the Anime's sections.

import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { useGhAccount } from '../../lib/gh.js';
import { useSubscriptions } from '../../state.jsx';
import x from './sides.module.css';

// The places inside each room, as [label, address]. A room without any is just
// its own door.
const PLACES = {
  edition: [['Today’s paper', '/edition'], ['Settings', '/settings?s=edition']],
  hackernews: [
    ['Top', '/hackernews?l=top'], ['Best', '/hackernews?l=best'], ['New', '/hackernews?l=new'],
    ['Ask HN', '/hackernews?l=ask'], ['Show HN', '/hackernews?l=show'], ['Jobs', '/hackernews?l=job'],
  ],
  editor: [['Your session', '/editor'], ['Settings', '/settings?s=editor']],
  github: [
    ['Activity', '/github'], ['Releases', '/github?v=releases'], ['Trending', '/github?v=trending'],
    ['Following', '/github?v=following'], ['Clones', '/github?v=clones'],
  ],
  youtube: [
    ['Programme', '/youtube'], ['Latest', '/youtube?v=latest'], ['On air', '/youtube?v=live'],
    ['History', '/youtube/history'],
  ],
  anime: [
    ['Browse', '/anime'], ['Seasons', '/anime?tab=seasons'], ['Schedule', '/anime?tab=schedule'],
    ['My List', '/anime?tab=list'], ['Ledger', '/anime?tab=ledger'], ['Community', '/anime?tab=community'],
    ['Social', '/anime?tab=discuss'],
  ],
};

const GH_MINE = [['Inbox', '/github?v=inbox'], ['Your work', '/github?v=work'], ['Stars', '/github?v=stars']];
const SUBREDDITS = 6;

function Places({ places }) {
  if (!places.length) return null;
  return (
    <div className={x.places}>
      {places.map(([label, to]) => (
        <Link key={to} to={to} className={x.place} data-kbd-tile>{label}</Link>
      ))}
    </div>
  );
}

/** The Dispatch's places are the subreddits you follow. */
function RedditPlaces() {
  const { subs } = useSubscriptions();
  const list = (subs?.reddit || []).slice(0, SUBREDDITS);
  return (
    <Places
      places={[
        ['Front page', '/reddit'],
        ...list.map((s) => [s.display_name || `r/${s.source_id}`, `/reddit/r/${s.source_id}`]),
      ]}
    />
  );
}

/** GitHub's views, and with an account linked, your inbox, work and stars. */
function GithubPlaces() {
  const { linked } = useGhAccount();
  return <Places places={linked ? [...GH_MINE, ...PLACES.github] : PLACES.github} />;
}

function RoomDoor({ room, n, i }) {
  let places = <Places places={PLACES[room.id] || []} />;
  if (room.id === 'reddit') places = <RedditPlaces />;
  if (room.id === 'github') places = <GithubPlaces />;
  return (
    <div className={x.room} style={{ '--room-c': room.color, '--i': i }}>
      <Link to={room.route} className={x.roomHead} data-kbd-tile>
        <span className={x.roomNo}>{String(n).padStart(2, '0')}</span>
        <span className={x.roomName}>{room.label}</span>
        <ArrowRight size={14} className={x.roomArrow} />
      </Link>
      {places}
    </div>
  );
}

/** A channel's side of the box: `children` is its guide. */
export function ChannelSide({ ch, rooms, children }) {
  return (
    <section className={x.side} style={{ '--ch': ch.color }} aria-label={`Channel ${ch.n}, ${ch.label}`}>
      <div className={x.main}>{children}</div>
      <aside className={x.strip} aria-label={`${ch.label} rooms`}>
        <div className={x.stripHead}>
          <span>Rooms</span>
          <span>Channel {ch.n}</span>
        </div>
        {rooms.map((r, i) => <RoomDoor key={r.id} room={r} n={i + 1} i={i} />)}
        <div className={x.grille} aria-hidden="true">
          <span className={x.plate}>{ch.label}<em>.</em></span>
        </div>
      </aside>
    </section>
  );
}
