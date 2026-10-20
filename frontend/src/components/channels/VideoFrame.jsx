// Channel 3, Video — the side panel of the set, where the knobs are.
//
// A wood-cabinet console down the left: the date and an on-air lamp, the three
// channel keys, search, then the Video rooms (the Screening Room, the Anime, the
// Archive) as a column of preset keys. The room you're in opens up in place to
// show its own index — the Screening Room its views and channels, the Anime its
// whole file tree with your AniList account on top — so getting around *inside* a
// room is one click from anywhere in it. A room opts in by adding its index to
// PLACES. Saved and Settings at the foot open the drawer.
//
// On wide screens the console hangs in the shell's empty left margin, so a page
// keeps the full shell width; it folds to a rail of icons (remembered), and on a
// phone it becomes a compact bar across the top.

import { Suspense } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, Clapperboard, Library, Search, Tv } from 'lucide-react';

import { moduleLazyNamed } from '../../lib/modules.js';
import { useMedia } from '../../lib/useMedia.js';
import { useStoredFlag } from '../../lib/useStoredFlag.js';
import { ChannelKnobs, PocketButtons, SkinButton, dateLine, openPalette, useChannelRooms } from './common.jsx';
import c from './video.module.css';

const ICONS = {
  youtube: Clapperboard,
  anime: Tv,
  archive: Library,
};

// A room's own index, shown under it in the console while you're inside it.
// Each belongs to its room's module, so it loads with it (lib/modules.js).
const PLACES = {
  youtube: moduleLazyNamed('youtube', () => import('../screening/ScreeningIndex.jsx'), 'ScreeningIndex'),
  anime: moduleLazyNamed('anime', () => import('../anime/AnimeTree.jsx'), 'AnimePlaces'),
};

function Knobs({ rail }) {
  return <ChannelKnobs className={c.channels} itemClass={c.ch} onClass={c.chOn} labels={!rail} />;
}

function Console({ rail, onRail }) {
  const { rooms, current } = useChannelRooms('video');
  return (
    <aside className={`${c.console} tc-console`} aria-label="Video">
      {!rail && (
        <div className={`${c.topline} tc-topline`}>
          <span>{dateLine()}</span>
          <span className={c.onair}><span className={c.led} /> Video</span>
        </div>
      )}

      <div className={c.brandRow}>
        <Link to="/" className={`${c.wordmark} tc-wordmark`} title="Home — choose a channel">
          {rail ? <>T<em>.</em></> : <>Tubcal<em>.</em></>}
        </Link>
        <button
          type="button"
          className={c.fold}
          onClick={() => onRail(!rail)}
          title={rail ? 'Unfold the console' : 'Fold the console to icons'}
          aria-label={rail ? 'Unfold the console' : 'Fold the console'}
        >
          {rail ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
        </button>
      </div>

      <Knobs rail={rail} />

      <button type="button" className={c.search} onClick={openPalette} title="Search everything (Ctrl K or /)">
        <Search size={15} />
        {!rail && <span>Search everything</span>}
        {!rail && <kbd>Ctrl K</kbd>}
      </button>

      <nav className={`${c.rooms} tc-nav`} aria-label="Video rooms">
        {!rail && <span className={c.label}>Rooms</span>}
        {rooms.map((room, i) => {
          const on = current?.id === room.id;
          const Icon = ICONS[room.id] || Clapperboard;
          const Places = on && !rail ? PLACES[room.id] : null;
          const no = String(i + 1).padStart(2, '0');
          return (
            <div key={room.id} className={c.room} style={{ '--room-c': room.color }}>
              <NavLink
                to={room.route}
                end={false}
                className={`${c.roomLink} tc-navitem ${on ? `${c.roomOn} tc-navitem-on` : ''}`}
                title={rail ? `${no} — ${room.label}` : undefined}
                aria-current={on ? 'page' : undefined}
              >
                <span className={`${c.plate} tc-navno`}>{rail ? <Icon size={16} /> : no}</span>
                {!rail && <span className={c.roomName}>{room.label}</span>}
                {!rail && <Icon size={14} className={c.roomIcon} aria-hidden="true" />}
              </NavLink>
              {Places && (
                <div className={c.places}>
                  <Suspense fallback={null}><Places /></Suspense>
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className={c.foot}>
        <PocketButtons btnClass={c.footBtn} countClass={c.footCount} labels={!rail} />
        <SkinButton className={c.footBtn} />
      </div>
    </aside>
  );
}

/** Phones: the console as a bar across the top — brand and knobs, then the rooms
 *  as one scrolling row, then the room's own places if it has any. */
function PhoneBar() {
  const { rooms, current } = useChannelRooms('video');
  const Places = current ? PLACES[current.id] : null;
  return (
    <header className={`${c.phone} tc-console`}>
      <div className={c.phoneTop}>
        <Link to="/" className={`${c.wordmark} tc-wordmark`}>Tubcal<em>.</em></Link>
        <ChannelKnobs className={c.channels} itemClass={c.ch} onClass={c.chOn} labels={false} />
        <span className={c.phoneKnobs}>
          <button type="button" className={c.footBtn} onClick={openPalette} aria-label="Search everything"><Search size={16} /></button>
          <PocketButtons btnClass={c.footBtn} countClass={c.footCount} size={16} />
        </span>
      </div>
      <nav className={`${c.phoneRooms} tc-nav`} aria-label="Video rooms">
        {rooms.map((room, i) => {
          const on = current?.id === room.id;
          return (
            <NavLink
              key={room.id}
              to={room.route}
              className={`${c.phoneRoom} tc-navitem ${on ? `${c.roomOn} tc-navitem-on` : ''}`}
              style={{ '--room-c': room.color }}
            >
              <span className={`${c.plate} tc-navno`}>{String(i + 1).padStart(2, '0')}</span>
              {room.label}
            </NavLink>
          );
        })}
      </nav>
      {Places && <Suspense fallback={null}><Places compact /></Suspense>}
    </header>
  );
}

/** The Video channel's frame: the console beside whatever room the route names. */
export function VideoFrame({ children }) {
  const [rail, setRail] = useStoredFlag('tubcal.hub.console.rail');
  const phone = useMedia('(max-width: 900px)');
  return (
    <div className={`${c.frame} ${rail && !phone ? c.frameRail : ''}`} data-channel="video">
      {phone ? <PhoneBar /> : <Console rail={rail} onRail={setRail} />}
      <main className={`${c.main} tc-main`}>{children}</main>
    </div>
  );
}
