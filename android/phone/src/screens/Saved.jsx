// Saved — everything you bookmarked, filterable by room. Videos are rows you can
// play (or Play all); posts, stories and repos open their reading pages; anime
// titles, people, playlists, channels and subreddits open their own pages (the
// desktop saves those too, and a data sync brings them here). Swipe a row left —
// or long-press it — to unsave.

import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, BookmarkX, Play } from 'lucide-react';

import { hasModule } from '@pc/lib/modules.js';
import { KINDS, kindOf } from '@pc/lib/saveable.js';
import { ago } from '@pc/lib/time.js';
import { useSaved } from '@pc/state.jsx';

import { openExternal } from '../lib/bridge.js';

import { ActionSheet, AppBar, Chips, Empty, useLongPress } from '../shell/Shell.jsx';
import { useOpener } from './discuss.jsx';
import { usePlayAll, VideoRow } from './video.jsx';
import l from './lists.module.css';
import s from './saved.module.css';

const ROOMS = [
  { key: 'all', label: 'Everything' },
  { key: 'youtube', label: 'Videos' },
  { key: 'anime', label: 'Anime' },
  { key: 'hackernews', label: 'Hacker News' },
  { key: 'reddit', label: 'Reddit' },
  { key: 'github', label: 'GitHub' },
  { key: 'dev', label: 'Workbench' },
  { key: 'page', label: 'Pages' },
];
// Kinds that only make sense on the desktop (the editor isn't on the phone).
const DESKTOP_ONLY = new Set(['file']);
// Kinds that open in a reader rather than at an address.
const READERS = new Set(['video', 'post', 'story', 'repo', 'release', 'event', 'podcast', 'article', 'doc', 'link']);
const TAG = { youtube: 'Screening Room', reddit: 'The Dispatch', hackernews: 'The Wire', github: 'GitHub' };

function Swipe({ onRemove, children }) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const st = useRef(null);
  return (
    <div className={`${l.swipe} ${leaving ? l.leaving : ''}`} onAnimationEnd={(e) => { if (leaving && e.target === e.currentTarget) onRemove(); }}>
      <button type="button" className={l.forget} onClick={() => setLeaving(true)} tabIndex={dx ? 0 : -1}><BookmarkX size={18} /> Unsave</button>
      <div
        className={l.swipeFace}
        style={{ transform: `translateX(${dx}px)`, transition: st.current ? 'none' : undefined }}
        onTouchStart={(e) => { st.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, base: dx, lock: null }; }}
        onTouchMove={(e) => {
          const c = st.current;
          if (!c) return;
          const mx = e.touches[0].clientX - c.x;
          const my = e.touches[0].clientY - c.y;
          if (c.lock == null && Math.hypot(mx, my) > 8) c.lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
          if (c.lock === 'x') setDx(Math.max(-110, Math.min(0, c.base + mx)));
        }}
        onTouchEnd={() => { st.current = null; setDx((d) => (d < -55 ? -96 : 0)); }}
      >
        {children}
      </div>
    </div>
  );
}

function TextCard({ item, onOpen, onMenu }) {
  const lp = useLongPress(() => onMenu(item));
  return (
    <button type="button" className={s.card} onClick={() => onOpen(item)} {...lp} data-platform={item.platform} data-reveal>
      <span className={s.tag}>{(READERS.has(kindOf(item)) && TAG[item.platform]) || KINDS[kindOf(item)].label}</span>
      <b>{item.title}</b>
      <span className={s.meta}>{[item.source, item.author, item.published_at ? ago(item.published_at) : null].filter(Boolean).join(' · ')}</span>
    </button>
  );
}

export default function Saved() {
  const { saved, toggleSaved } = useSaved();
  const [room, setRoom] = useState('all');
  const [menu, setMenu] = useState(null);
  const [openReader, pages] = useOpener();
  const navigate = useNavigate();
  const open = useCallback((item) => {
    const kind = kindOf(item);
    if (kind === 'moment') openReader(item.extra?.video);
    else if (READERS.has(kind)) openReader(item);
    else if (item.url?.startsWith('/')) navigate(item.url);
    // GitHub issues, pull requests, commits and people have their pages on the
    // desktop only; here they open on github.com.
    else if (item.url) openExternal(item.url);
  }, [openReader, navigate]);
  const playAll = usePlayAll();
  const items = Object.values(saved).filter((i) => !DESKTOP_ONLY.has(kindOf(i))).reverse();
  const counts = items.reduce((m, i) => ({ ...m, [i.platform]: (m[i.platform] || 0) + 1 }), {});
  const shown = room === 'all' ? items : items.filter((i) => i.platform === room);
  // without the Screening Room on this phone, a saved video opens on YouTube
  const videos = hasModule('youtube') ? shown.filter((i) => kindOf(i) === 'video') : [];

  return (
    <div>
      <AppBar title="Saved" sub={items.length ? `${items.length} kept on this phone` : null} back backTo="/more" tone="var(--c-foryou)">
        {items.length > 0 && (
          <Chips items={ROOMS.filter((x) => x.key === 'all' || counts[x.key]).map((x) => ({ ...x, count: x.key === 'all' ? 0 : counts[x.key] }))} value={room} onChange={setRoom} />
        )}
      </AppBar>
      {!items.length && <Empty Icon={Bookmark} title="Nothing saved yet" text="Long-press any video, post or story and choose Save — it waits here." />}
      {videos.length > 1 && (
        <button type="button" className={s.playAll} onClick={() => playAll(videos)} data-reveal="pop"><Play size={16} fill="currentColor" /> Play all {videos.length} videos</button>
      )}
      {shown.map((item) => (
        <Swipe key={item.id} onRemove={() => toggleSaved(item)}>
          {kindOf(item) === 'video' && videos.length
            ? <VideoRow item={item} />
            : <TextCard item={item} onOpen={open} onMenu={setMenu} />}
        </Swipe>
      ))}
      <ActionSheet
        open={!!menu}
        onClose={() => setMenu(null)}
        title={menu?.title}
        actions={menu ? [
          { label: 'Open', Icon: Bookmark, onClick: () => open(menu) },
          { label: 'Unsave', Icon: BookmarkX, danger: true, onClick: () => toggleSaved(menu) },
        ] : []}
      />
      {pages}
    </div>
  );
}
