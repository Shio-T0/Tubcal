// Saved — everything you bookmarked, filterable by room. Videos are rows you can
// play (or Play all); posts, stories and repos open their reading pages. Swipe a
// row left — or long-press it — to unsave.

import { useRef, useState } from 'react';
import { Bookmark, BookmarkX, Play } from 'lucide-react';

import { ago } from '@pc/lib/time.js';
import { useSaved } from '@pc/state.jsx';

import { ActionSheet, AppBar, Chips, Empty, useLongPress } from '../shell/Shell.jsx';
import { useOpener } from './discuss.jsx';
import { usePlayAll, VideoRow } from './video.jsx';
import l from './lists.module.css';
import s from './saved.module.css';

const ROOMS = [
  { key: 'all', label: 'Everything' },
  { key: 'youtube', label: 'Videos' },
  { key: 'hackernews', label: 'Hacker News' },
  { key: 'reddit', label: 'Reddit' },
  { key: 'github', label: 'GitHub' },
];
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
      <span className={s.tag}>{TAG[item.platform] || item.platform}</span>
      <b>{item.title}</b>
      <span className={s.meta}>{[item.source, item.author, item.published_at ? ago(item.published_at) : null].filter(Boolean).join(' · ')}</span>
    </button>
  );
}

export default function Saved() {
  const { saved, toggleSaved } = useSaved();
  const [room, setRoom] = useState('all');
  const [menu, setMenu] = useState(null);
  const [open, pages] = useOpener();
  const playAll = usePlayAll();
  const items = Object.values(saved).reverse();
  const counts = items.reduce((m, i) => ({ ...m, [i.platform]: (m[i.platform] || 0) + 1 }), {});
  const shown = room === 'all' ? items : items.filter((i) => i.platform === room);
  const videos = shown.filter((i) => i.platform === 'youtube');

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
          {item.platform === 'youtube'
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
