// The Screening Room's index, hung under the room in the hub console.
//
// The views (the programme, every upload newest-first, what's on air, the
// logbook), then your channels — freshest first, each with a count of what's new
// since you last looked — and, when something's queued, the up-next list. One
// click to any of it from anywhere in the room, a channel page included.
//
// On a phone the console is a bar, so this collapses to one row of chips.

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { History, ListVideo, Plus, Radio, Rows3, Tv, X } from 'lucide-react';

import AddSubscriptionModal from '../modals/AddSubscriptionModal.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { usePlayer } from '../../state.jsx';
import { useChannelFeed, useChannelRoster, useSeen } from './feed.js';
import x from './index.module.css';

const SHOWN = 12;

function usePlaces() {
  const { pathname, search } = useLocation();
  const view = pathname === '/youtube' ? new URLSearchParams(search).get('v') || 'programme' : null;
  const { feed, live } = useChannelFeed();
  const items = feed.data?.items;
  const { newCount } = useSeen();
  const liveItems = live.data?.items || [];
  const onAir = liveItems.filter((i) => i.extra?.live_status === 'is_live').length;
  const places = [
    { key: 'programme', label: 'Programme', to: '/youtube', Icon: Tv, on: view === 'programme' },
    { key: 'latest', label: 'Latest uploads', to: '/youtube?v=latest', Icon: Rows3, on: view === 'latest', count: newCount(items) },
    liveItems.length > 0 && {
      key: 'live', label: onAir ? 'On air now' : 'Coming up', to: '/youtube?v=live', Icon: Radio, on: view === 'live',
      count: liveItems.length, hot: onAir > 0,
    },
    { key: 'history', label: 'History', to: '/youtube/history', Icon: History, on: pathname === '/youtube/history' },
  ].filter(Boolean);
  return { places, items, pathname };
}

function Count({ n, hot }) {
  if (!n) return null;
  return <em className={`${x.count} ${hot ? x.hot : ''}`}>{n > 99 ? '99+' : n}</em>;
}

function UpNext() {
  const { queue, open, dequeue } = usePlayer();
  if (!queue.length) return null;
  return (
    <div className={x.block}>
      <span className={x.head}><ListVideo size={11} /> Up next · {queue.length}</span>
      <ol className={x.queue}>
        {queue.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={x.qItem}
              onClick={() => { dequeue(item.id); open(item); }}
              title={`Play now — ${item.title}`}
            >
              <img src={item.thumbnail} alt="" loading="lazy" />
              <span>{item.title}</span>
            </button>
            <button type="button" className={x.qDrop} onClick={() => dequeue(item.id)} aria-label="Remove from Up next">
              <X size={12} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ScreeningIndex({ compact = false }) {
  const { places, items, pathname } = usePlaces();
  const roster = useChannelRoster(items);
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);

  // On a phone the room's own bar already switches views, so the chips here are
  // the rest of the index: the logbook and every channel.
  if (compact) {
    return (
      <nav className={x.chips} aria-label="Screening Room">
        {places.filter((p) => p.key === 'history').map(({ key, label, to, Icon, on }) => (
          <Link key={key} to={to} className={`${x.chip} ${on ? x.chipOn : ''}`}>
            <Icon size={13} /> {label}
          </Link>
        ))}
        {roster.map(({ sub, fresh }) => (
          <Link
            key={sub.id}
            to={`/youtube/c/${sub.source_id}`}
            className={`${x.chip} ${pathname === `/youtube/c/${sub.source_id}` ? x.chipOn : ''}`}
          >
            <Avatar src={sub.thumbnail} name={sub.display_name} imgClass={x.face} letterClass={x.faceLetter} />
            {sub.display_name} <Count n={fresh} />
          </Link>
        ))}
      </nav>
    );
  }

  const shown = all ? roster : roster.slice(0, SHOWN);
  return (
    <div className={x.index}>
      <ul className={x.places}>
        {places.map(({ key, label, to, Icon, on, count, hot }) => (
          <li key={key}>
            <Link to={to} className={`${x.place} ${on ? x.placeOn : ''}`} aria-current={on ? 'page' : undefined}>
              <Icon size={13} />
              <span>{label}</span>
              <Count n={count} hot={hot} />
            </Link>
          </li>
        ))}
      </ul>

      <UpNext />

      <div className={x.block}>
        <span className={x.head}>
          Channels · {roster.length}
          <button type="button" className={x.add} onClick={() => setAdding(true)} title="Add a channel">
            <Plus size={12} />
          </button>
        </span>
        {!roster.length && (
          <button type="button" className={x.empty} onClick={() => setAdding(true)}>Add your first channel →</button>
        )}
        <ul className={x.channels}>
          {shown.map(({ sub, fresh }) => {
            const on = pathname === `/youtube/c/${sub.source_id}`;
            return (
              <li key={sub.id}>
                <Link to={`/youtube/c/${sub.source_id}`} className={`${x.channel} ${on ? x.placeOn : ''}`}>
                  <Avatar src={sub.thumbnail} name={sub.display_name} imgClass={x.face} letterClass={x.faceLetter} />
                  <span className={x.name}>{sub.display_name}</span>
                  <Count n={fresh} />
                </Link>
              </li>
            );
          })}
        </ul>
        {roster.length > SHOWN && (
          <button type="button" className={x.more} onClick={() => setAll((v) => !v)}>
            {all ? 'fewer' : `all ${roster.length} channels`}
          </button>
        )}
      </div>

      <AddSubscriptionModal open={adding} onClose={() => setAdding(false)} initialPlatform="youtube" />
    </div>
  );
}
