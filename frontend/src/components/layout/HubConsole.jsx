// The Hub's console — the side panel of the set, where the knobs are.
//
// It replaces the old masthead (a date line, a poster-sized wordmark and a strip
// of room tabs, ~230px of every page before any content). Everything that bar did
// is here, down the left and out of the way: the rooms as a column of channel
// presets, the way to the other channel (the Anime), search, Saved, Settings and
// the skin. Pages start at the top of the screen.
//
// The room you're in opens up in place to show its own index — its views, its
// channels, what's queued — so getting around *inside* a room is one click from
// anywhere in it too. A room opts in by adding its index to PLACES.
//
// On wide screens the console hangs in the shell's empty left margin, so a page
// keeps the full shell width; it folds to a rail of icons (remembered), and on a
// phone it becomes a compact bar across the top.

import { NavLink, Link, useLocation } from 'react-router-dom';
import {
  Bookmark, ChevronsLeft, ChevronsRight, Clapperboard, Code2, GitBranch, Hash, Library, Palette, Radio,
  ScrollText, Search, Settings, Wrench,
} from 'lucide-react';

import { useSettings } from '../../state.jsx';
import { nextTheme, themeMeta } from '../../lib/themes.js';
import { ANIME_HOME, getActiveRooms, knownActiveIds } from '../../lib/rooms.js';
import { useMedia } from '../../lib/useMedia.js';
import { useStoredFlag } from '../../lib/useStoredFlag.js';
import { ScreeningIndex } from '../screening/ScreeningIndex.jsx';
import c from './hubconsole.module.css';

const ICONS = {
  edition: ScrollText,
  youtube: Clapperboard,
  reddit: Radio,
  hackernews: Hash,
  archive: Library,
  editor: Code2,
  github: GitBranch,
  dev: Wrench,
};

// A room's own index, shown under it in the console while you're inside it.
const PLACES = {
  youtube: ScreeningIndex,
};

/** Ask the command palette to open (it owns Ctrl-K and `/` too). */
export function openPalette() {
  window.dispatchEvent(new Event('tubcal:palette'));
}

function dateLine() {
  return new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function useRooms() {
  const { settings } = useSettings();
  const { pathname } = useLocation();
  const rooms = getActiveRooms(knownActiveIds(settings?.active_rooms));
  const current = rooms.find((r) => pathname === r.route || pathname.startsWith(`${r.route}/`)) || null;
  return { rooms, current, pathname };
}

function SkinButton({ className, showLabel = false }) {
  const { settings, updateSettings } = useSettings();
  const theme = settings?.theme || 'dark';
  const upcoming = themeMeta(nextTheme(theme));
  return (
    <button
      type="button"
      className={className}
      title={`Skin: ${themeMeta(theme).label} — switch to ${upcoming.label}`}
      onClick={() => updateSettings({ theme: nextTheme(theme) })}
    >
      <Palette size={15} />
      {showLabel && <span>{themeMeta(theme).label}</span>}
    </button>
  );
}

/** The two channels of the set: the Hub (lit, you're in it) and the Anime. */
function ChannelSwitch({ rail }) {
  return (
    <div className={c.channels} aria-label="Channels">
      <Link to="/" className={`${c.ch} ${c.chOn}`} title="Channel 1 — the Hub (Home: choose a channel)">
        <b>1</b>{!rail && <span>Hub</span>}
      </Link>
      <Link to={ANIME_HOME} className={c.ch} title="Channel 2 — the Anime (Space g a)">
        <b>2</b>{!rail && <span>Anime</span>}
      </Link>
    </div>
  );
}

function Console({ rail, onRail }) {
  const { rooms, current, pathname } = useRooms();
  return (
    <aside className={`${c.console} tc-console`} aria-label="The Hub">
      {!rail && (
        <div className={`${c.topline} tc-topline`}>
          <span>{dateLine()}</span>
          <span className={c.onair}><span className={c.led} /> on air</span>
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

      <ChannelSwitch rail={rail} />

      <button type="button" className={c.search} onClick={openPalette} title="Search everything (Ctrl K or /)">
        <Search size={15} />
        {!rail && <span>Search everything</span>}
        {!rail && <kbd>Ctrl K</kbd>}
      </button>

      <nav className={`${c.rooms} tc-nav`} aria-label="Rooms">
        {!rail && <span className={c.label}>Rooms</span>}
        {rooms.map((room, i) => {
          const on = current?.id === room.id;
          const Icon = ICONS[room.id] || ScrollText;
          const Places = on && !rail ? PLACES[room.id] : null;
          const no = String(i + 1).padStart(2, '0');
          return (
            <div key={room.id} className={c.room} style={{ '--room-c': room.color }}>
              <NavLink
                to={room.route}
                end={false}
                className={`${c.roomLink} tc-navitem ${on ? `${c.roomOn} tc-navitem-on` : ''}`}
                title={rail ? `No ${no} — ${room.label}` : undefined}
                aria-current={on ? 'page' : undefined}
              >
                <span className={`${c.plate} tc-navno`}>{rail ? <Icon size={16} /> : no}</span>
                {!rail && <span className={c.roomName}>{room.label}</span>}
                {!rail && <Icon size={14} className={c.roomIcon} aria-hidden="true" />}
              </NavLink>
              {Places && (
                <div className={c.places}>
                  <Places />
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className={c.foot}>
        <NavLink to="/saved" className={`${c.footBtn} ${pathname === '/saved' ? c.footOn : ''}`} title="Saved">
          <Bookmark size={15} />{!rail && <span>Saved</span>}
        </NavLink>
        <NavLink to="/settings" className={`${c.footBtn} ${pathname === '/settings' ? c.footOn : ''}`} title="Settings">
          <Settings size={15} />{!rail && <span>Settings</span>}
        </NavLink>
        <SkinButton className={c.footBtn} />
      </div>
    </aside>
  );
}

/** Phones: the console as a bar across the top — brand and knobs, then the rooms
 *  as one scrolling row, then the room's own places if it has any. */
function PhoneBar() {
  const { rooms, current } = useRooms();
  const Places = current ? PLACES[current.id] : null;
  return (
    <header className={`${c.phone} tc-console`}>
      <div className={c.phoneTop}>
        <Link to="/" className={`${c.wordmark} tc-wordmark`}>Tubcal<em>.</em></Link>
        <ChannelSwitch rail />
        <span className={c.phoneKnobs}>
          <button type="button" className={c.footBtn} onClick={openPalette} aria-label="Search everything"><Search size={16} /></button>
          <NavLink to="/saved" className={c.footBtn} aria-label="Saved"><Bookmark size={16} /></NavLink>
          <NavLink to="/settings" className={c.footBtn} aria-label="Settings"><Settings size={16} /></NavLink>
          <SkinButton className={c.footBtn} />
        </span>
      </div>
      <nav className={`${c.phoneRooms} tc-nav`} aria-label="Rooms">
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
      {Places && <Places compact />}
    </header>
  );
}

/** The Hub's frame: the console beside whatever room the route names. */
export function HubFrame({ children }) {
  const [rail, setRail] = useStoredFlag('tubcal.hub.console.rail');
  const phone = useMedia('(max-width: 900px)');
  return (
    <div className={`${c.frame} ${rail && !phone ? c.frameRail : ''}`}>
      {phone ? <PhoneBar /> : <Console rail={rail} onRail={setRail} />}
      <main className={c.main}>{children}</main>
    </div>
  );
}
