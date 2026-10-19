// What every channel's frame shares, however differently each one draws it:
//
//   openPalette()        the command palette (Ctrl K, /)
//   openPocket(tab)      the Saved & Settings drawer, from anywhere (Space s, Space ,)
//   useChannelRooms(id)  a channel's switched-on rooms and the one you're in
//   ChannelKnobs         the three channels as numbered keys: 1 Social, 2 Coding, 3 Video
//   PocketButtons        Saved (with its count) and Settings, both opening the drawer
//   SkinButton           steps to the next skin

import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bookmark, Palette, Settings } from 'lucide-react';

import { useSaved, useSettings } from '../../state.jsx';
import { nextTheme, themeMeta } from '../../lib/themes.js';
import { CHANNELS, channelHome, channelOfPath, channelRooms, roomOfPath } from '../../lib/rooms.js';

/** Ask the command palette to open (it owns Ctrl-K and `/` too). */
export function openPalette() {
  window.dispatchEvent(new Event('tubcal:palette'));
}

/** Open the Saved & Settings drawer on `tab` ('saved' or 'settings'). Asking for
 *  the tab that's already showing closes it. */
export function openPocket(tab = 'saved') {
  window.dispatchEvent(new CustomEvent('tubcal:pocket', { detail: { tab } }));
}

/** A channel's rooms that are switched on, and the room the address is inside. */
export function useChannelRooms(channelId) {
  const { settings } = useSettings();
  const { pathname } = useLocation();
  const rooms = channelRooms(channelId, settings?.active_rooms);
  const here = roomOfPath(pathname);
  const current = rooms.find((r) => r.id === here?.id) || null;
  return { rooms, current, pathname };
}

/** Where each channel opens, given the rooms that are switched on. */
export function useChannelHomes() {
  const { settings } = useSettings();
  const active = settings?.active_rooms;
  return useMemo(
    () => Object.fromEntries(CHANNELS.map((ch) => [ch.id, channelHome(ch.id, active)])),
    [active],
  );
}

/** The three channels as numbered keys. The frame decides the look through the
 *  class names; `labels` adds the channel's name beside its number. */
export function ChannelKnobs({ className, itemClass, onClass, labels = true }) {
  const { pathname } = useLocation();
  const homes = useChannelHomes();
  const here = channelOfPath(pathname)?.id;
  return (
    <nav className={className} aria-label="Channels">
      {CHANNELS.map((ch) => {
        const on = ch.id === here;
        return (
          <Link
            key={ch.id}
            to={homes[ch.id]}
            className={`${itemClass || ''} ${on ? onClass || '' : ''}`}
            style={{ '--ch-c': ch.color }}
            aria-current={on ? 'true' : undefined}
            title={`Channel ${ch.n} — ${ch.label} (Space g ${ch.key})`}
          >
            <b>{ch.n}</b>
            {labels && <span>{ch.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Saved and Settings: both open the drawer, so neither takes you off the page. */
export function PocketButtons({ btnClass, countClass, labels = false, size = 15 }) {
  const { saved } = useSaved();
  const n = Object.keys(saved || {}).length;
  return (
    <>
      <button type="button" className={btnClass} onClick={() => openPocket('saved')} title="Saved (Space s)">
        <Bookmark size={size} />
        {labels && <span>Saved</span>}
        {n > 0 && <span className={countClass}>{n}</span>}
      </button>
      <button type="button" className={btnClass} onClick={() => openPocket('settings')} title="Settings (Space ,)">
        <Settings size={size} />
        {labels && <span>Settings</span>}
      </button>
    </>
  );
}

export function SkinButton({ className, showLabel = false, size = 15 }) {
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
      <Palette size={size} />
      {showLabel && <span>{themeMeta(theme).label}</span>}
    </button>
  );
}

/** "Mon 19 Oct" — the frames' date lines. */
export function dateLine(d = new Date()) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
