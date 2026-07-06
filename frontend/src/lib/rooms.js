// Canonical room registry — frontend and backend should agree on ids.
// Index labels are computed dynamically from position, not hardcoded per room.

export const ROOMS = [
  { id: 'edition',   label: 'The Edition', color: 'var(--c-foryou)', route: '/edition', default_enabled: true },
  { id: 'frontpage', label: 'Front Page', color: 'var(--c-foryou)', route: '/', default_enabled: true },
  { id: 'youtube',   label: 'Screening Room', color: 'var(--c-youtube)', route: '/youtube', default_enabled: true },
  { id: 'reddit',    label: 'The Dispatch', color: 'var(--c-reddit)', route: '/reddit', default_enabled: true },
  { id: 'hackernews',label: 'The Wire', color: 'var(--c-hn)', route: '/hackernews', default_enabled: true },
  { id: 'archive',   label: 'The Archive', color: 'var(--signal)', route: '/archive', default_enabled: true },
  { id: 'anime',     label: 'The Anime', color: 'var(--c-anime)', route: '/anime', default_enabled: true },
  { id: 'editor',    label: 'The Composing Room', color: 'var(--c-editor)', route: '/editor', default_enabled: true },
  { id: 'github',    label: 'GitHub', color: 'var(--c-github)', route: '/github', default_enabled: false },
];

export const ROOM_IDS = ROOMS.map(r => r.id);

export function getRoomById(id) {
  return ROOMS.find(r => r.id === id) || null;
}

export function getActiveRooms(activeRoomIds) {
  const set = new Set(activeRoomIds || []);
  return ROOMS.filter(r => set.has(r.id));
}