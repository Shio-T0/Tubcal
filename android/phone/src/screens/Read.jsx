// Read — the text rooms on one tab: The Wire (Hacker News), The Dispatch
// (Reddit) and GitHub, switched from the bar. Each keeps the desktop room's
// reach: HN's six lists and its whole archive search; your subreddits (or your
// Reddit home feed when connected), hot/new/top and a search of all of Reddit;
// trending repos, your repos' activity, and repo search. Lines are thumb-sized:
// tap a story for the article (or the post), the comment pill for the
// discussion, long-press for everything else.
//
// This is the frame (the bar, the room switch, search, pull-to-refresh). Each
// room is its own file (readWire, readDispatch, readGithub) in its room's split
// APK, loaded only when this phone has the room.

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';

import AddSubscriptionModal from '@pc/components/modals/AddSubscriptionModal.jsx';
import { hasModule, moduleLazy } from '@pc/lib/modules.js';
import { DEFAULT_ACTIVE_ROOMS } from '@pc/lib/rooms.js';
import { useParamState } from '@pc/lib/urlState.js';
import { useSettings } from '@pc/state.jsx';

import { AppBar, IconBtn, Skeleton, usePullToRefresh } from '../shell/Shell.jsx';
import { BarSearch } from './readKit.jsx';
import r from './read.module.css';

// the ones on this phone (`tubcal phone` chose them)
const ROOMS = [
  { key: 'wire', id: 'hackernews', label: 'The Wire', path: '/hackernews', c: 'var(--c-hn)', Pane: moduleLazy('hackernews', () => import('./readWire.jsx')) },
  { key: 'dispatch', id: 'reddit', label: 'Dispatch', path: '/reddit', c: 'var(--c-reddit)', Pane: moduleLazy('reddit', () => import('./readDispatch.jsx')) },
  { key: 'github', id: 'github', label: 'GitHub', path: '/github', c: 'var(--c-github)', Pane: moduleLazy('github', () => import('./readGithub.jsx')) },
].filter((x) => hasModule(x.id));

// Switching rooms changes the route (and remounts the page), so the switch
// remembers where its pill was and glides it over from there.
let lastRoomIdx = null;

function RoomSwitch({ rooms, cur, onPick }) {
  const idx = Math.max(0, rooms.findIndex((x) => x.key === cur.key));
  const [shown, setShown] = useState(lastRoomIdx ?? idx);
  useEffect(() => {
    lastRoomIdx = idx;
    const f = requestAnimationFrame(() => setShown(idx));
    return () => cancelAnimationFrame(f);
  }, [idx]);
  return (
    <div className={r.rooms} role="tablist" style={{ '--rn': rooms.length, '--ri': shown, '--pc': rooms[shown]?.c || cur.c }}>
      <span className={r.roomPill} aria-hidden="true" />
      {rooms.map((x) => (
        <button key={x.key} type="button" role="tab" aria-selected={x.key === cur.key} className={x.key === cur.key ? r.roomOn : ''} onClick={() => onPick(x)}>
          {x.label}
        </button>
      ))}
    </div>
  );
}

export default function Read({ room = 'wire' }) {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const active = settings?.active_rooms || DEFAULT_ACTIVE_ROOMS;
  const rooms = ROOMS.filter((x) => active.includes(x.id) || x.key === room);
  const cur = ROOMS.find((x) => x.key === room) || ROOMS[0];
  const [q] = useParamState('q', '');
  const [search, setSearch] = useState(q ? q : null);
  const [adding, setAdding] = useState(false);
  // the room on screen hands up its refresh as it renders; pull-to-refresh calls it
  const refresher = useRef(null);
  const registerRefresh = useCallback((f) => { refresher.current = f; }, []);
  const pull = usePullToRefresh(async () => { await refresher.current?.(); });
  const lastRoom = useRef(room);
  useEffect(() => {
    if (lastRoom.current !== room) { lastRoom.current = room; setSearch(null); }
  }, [room]);

  const placeholder = { wire: 'Search every story on HN…', dispatch: 'Search all of Reddit…', github: 'Search GitHub repositories…' }[cur.key];

  return (
    <div className={r.screen} style={{ '--c': cur.c }}>
      <AppBar
        title={search != null ? <BarSearch value={search} onChange={setSearch} placeholder={placeholder} onClose={() => { setSearch(null); }} /> : 'Read'}
        sub={search != null ? null : cur.label}
        tone={cur.c}
        actions={search == null && (
          <>
            <IconBtn label="Search" onClick={() => setSearch('')}><Search size={21} /></IconBtn>
            {cur.key !== 'wire' && <IconBtn label={cur.key === 'github' ? 'Follow a repo or user' : 'Add a subreddit'} onClick={() => setAdding(true)}><Plus size={22} /></IconBtn>}
          </>
        )}
      >
        {search == null && rooms.length > 1 && (
          <RoomSwitch rooms={rooms} cur={cur} onPick={(x) => navigate(x.path, { replace: true })} />
        )}
      </AppBar>
      {pull}

      <Suspense fallback={<Skeleton kind="lines" n={6} />}>
        <cur.Pane key={cur.key} search={search} registerRefresh={registerRefresh} onAdd={() => setAdding(true)} />
      </Suspense>

      <AddSubscriptionModal open={adding} onClose={() => setAdding(false)} initialPlatform={cur.key === 'github' ? 'github' : 'reddit'} />
    </div>
  );
}
