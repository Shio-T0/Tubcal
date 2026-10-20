// Canonical room registry — frontend and backend should agree on ids.
//
// Rooms are grouped into three channels, chosen at "/" (the home screen):
//   1 Social   The Edition, The Wire (HN), The Dispatch (Reddit)
//   2 Coding   The Composing Room, The Workbench, GitHub
//   3 Video    The Screening Room, The Anime, The Archive
// Each channel has its own frame (components/channels/): Social a newspaper bar
// across the top, Coding an editor's activity bar and title bar, Video the TV
// cabinet's side console. Room numbers are their position inside the channel,
// computed, never hardcoded.
//
// ROOMS are the rooms Settings → Rooms can switch off (their ids are
// config.ROOM_IDS on the server). The Anime is always on, so it isn't one of them;
// it sits in the Video channel through FIXED.
//
// Every room is also a module (modules.ini): an install can leave it out. ROOMS,
// FIXED and CHANNELS hold only what this copy has (lib/modules.js), so everything
// built on them — the frames, Home, the palette, the keys — rearranges itself. A
// channel left with no rooms disappears and the others are numbered 1, 2…
// ALL_ROOMS keeps the full list, for Settings to say what was left out.

import { hasModule } from './modules.js';

export const ANIME_HOME = '/anime';

export const ALL_ROOMS = [
  { id: 'edition',   label: 'The Edition', short: 'Edition', color: 'var(--c-foryou)', route: '/edition', default_enabled: true },
  { id: 'youtube',   label: 'Screening Room', short: 'YouTube', color: 'var(--c-youtube)', route: '/youtube', default_enabled: true },
  { id: 'reddit',    label: 'The Dispatch', short: 'Reddit', color: 'var(--c-reddit)', route: '/reddit', default_enabled: true },
  { id: 'hackernews',label: 'The Wire', short: 'HN', color: 'var(--c-hn)', route: '/hackernews', default_enabled: true },
  { id: 'archive',   label: 'The Archive', short: 'Archive', color: 'var(--signal)', route: '/archive', default_enabled: true },
  { id: 'editor',    label: 'The Composing Room', short: 'Editor', color: 'var(--c-editor)', route: '/editor', default_enabled: true },
  { id: 'github',    label: 'GitHub', short: 'GitHub', color: 'var(--c-github)', route: '/github', default_enabled: false },
  { id: 'dev',       label: 'The Workbench', short: 'Workbench', color: 'var(--c-dev)', route: '/dev', default_enabled: true },
];

/** Rooms that are always on (not in Settings → Rooms). */
export const ALL_FIXED = [
  { id: 'anime', label: 'The Anime', short: 'Anime', color: 'var(--c-anime)', route: ANIME_HOME, fixed: true },
];

export const ALL_CHANNELS = [
  { id: 'social', key: 's', label: 'Social', color: 'var(--c-social)', rooms: ['edition', 'hackernews', 'reddit'] },
  { id: 'coding', key: 'c', label: 'Coding', color: 'var(--c-coding)', rooms: ['editor', 'dev', 'github'] },
  { id: 'video', key: 'v', label: 'Video', color: 'var(--c-video)', rooms: ['youtube', 'anime', 'archive'] },
];

// What this copy has.
export const ROOMS = ALL_ROOMS.filter((r) => hasModule(r.id));
export const FIXED = ALL_FIXED.filter((r) => hasModule(r.id));
export const CHANNELS = ALL_CHANNELS
  .map((ch) => ({ ...ch, rooms: ch.rooms.filter(hasModule) }))
  .filter((ch) => ch.rooms.length)
  .map((ch, i) => ({ ...ch, n: i + 1 }));

export const ROOM_IDS = ROOMS.map(r => r.id);

/** The channels saved things sort into: this copy's, plus any it left out that
 *  still holds something you saved (`has(id)`), so nothing saved goes missing. */
export function savedChannels(has = () => false) {
  return ALL_CHANNELS
    .map((ch) => CHANNELS.find((c) => c.id === ch.id) || (has(ch.id) ? ch : null))
    .filter(Boolean);
}

const ALL = [...ROOMS, ...FIXED];

export function getRoomById(id) {
  return ALL.find(r => r.id === id) || null;
}

export function getChannel(id) {
  return CHANNELS.find(c => c.id === id) || null;
}

/** The channel a room belongs to. */
export function channelOfRoom(roomId) {
  return CHANNELS.find(c => c.rooms.includes(roomId)) || null;
}

/** The room a path is inside, if any (`/youtube/c/x` → youtube). */
export function roomOfPath(pathname) {
  return ALL.find(r => pathname === r.route || pathname.startsWith(`${r.route}/`)) || null;
}

/** The room a path belongs to, installed or not (for "X isn't installed"). */
export function anyRoomOfPath(pathname) {
  return [...ALL_ROOMS, ...ALL_FIXED].find((r) => pathname === r.route || pathname.startsWith(`${r.route}/`)) || null;
}

/** The channel a path is inside, if any. */
export function channelOfPath(pathname) {
  const room = roomOfPath(pathname);
  return room ? channelOfRoom(room.id) : null;
}

// Used when settings haven't loaded yet (and mirrors db.DEFAULT_SETTINGS).
export const DEFAULT_ACTIVE_ROOMS = ['edition', 'youtube', 'reddit', 'hackernews', 'archive', 'editor', 'dev'];

export function getActiveRooms(activeRoomIds) {
  const set = new Set(activeRoomIds || []);
  return ROOMS.filter(r => set.has(r.id));
}

/** The saved active-room ids that still name a room (retired ids dropped). */
export function knownActiveIds(activeRoomIds) {
  return (activeRoomIds || DEFAULT_ACTIVE_ROOMS).filter((id) => ROOM_IDS.includes(id));
}

/** A channel's rooms in channel order: the switched-on ones plus the fixed ones.
 *  `skip` leaves out ids this build can't show (the phone has no editor). */
export function channelRooms(channelId, activeRoomIds, skip = []) {
  const ch = getChannel(channelId);
  if (!ch) return [];
  const on = new Set(knownActiveIds(activeRoomIds));
  return ch.rooms
    .map(getRoomById)
    .filter((r) => r && (r.fixed || on.has(r.id)) && !skip.includes(r.id));
}

/** Where a channel opens: its first room that's on (or its first room at all). */
export function channelHome(channelId, activeRoomIds) {
  const rooms = channelRooms(channelId, activeRoomIds);
  return (rooms[0] || getRoomById(getChannel(channelId)?.rooms[0]))?.route || '/';
}
