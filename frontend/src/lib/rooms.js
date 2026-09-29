// Canonical room registry for the hub — frontend and backend should agree on ids.
// Index labels are computed dynamically from position, not hardcoded per room.
//
// "/" is not a room: it's the channel chooser (Hub or Anime). The Anime is not a
// room either — it's a whole section of its own beside the hub, with its own top
// bar, reached from "/" or with Space g a (the hub is Space g h).

export const HUB_HOME = '/edition';
export const ANIME_HOME = '/anime';

export const ROOMS = [
  { id: 'edition',   label: 'The Edition', color: 'var(--c-foryou)', route: '/edition', default_enabled: true },
  { id: 'youtube',   label: 'Screening Room', color: 'var(--c-youtube)', route: '/youtube', default_enabled: true },
  { id: 'reddit',    label: 'The Dispatch', color: 'var(--c-reddit)', route: '/reddit', default_enabled: true },
  { id: 'hackernews',label: 'The Wire', color: 'var(--c-hn)', route: '/hackernews', default_enabled: true },
  { id: 'archive',   label: 'The Archive', color: 'var(--signal)', route: '/archive', default_enabled: true },
  { id: 'editor',    label: 'The Composing Room', color: 'var(--c-editor)', route: '/editor', default_enabled: true },
  { id: 'github',    label: 'GitHub', color: 'var(--c-github)', route: '/github', default_enabled: false },
  { id: 'dev',       label: 'The Workbench', color: 'var(--c-dev)', route: '/dev', default_enabled: true },
];

export const ROOM_IDS = ROOMS.map(r => r.id);

export function getRoomById(id) {
  return ROOMS.find(r => r.id === id) || null;
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