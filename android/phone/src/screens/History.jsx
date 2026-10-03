// What you've watched, by day. Swipe a row left (or long-press it) to forget it;
// the bin in the bar clears the lot. History stays on the phone.

import { useRef, useState } from 'react';
import { History as HistoryIcon, Search, Trash2, X } from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';

import { AppBar, Empty, ErrorNote, IconBtn, Sheet, Skeleton } from '../shell/Shell.jsx';
import { byDay, VideoRow } from './video.jsx';
import l from './lists.module.css';

export function historyItem(row) {
  const videoId = row.item_id.startsWith('yt:') ? row.item_id.slice(3) : row.item_id;
  return {
    id: row.item_id,
    platform: 'youtube',
    title: row.title || 'Untitled',
    url: row.url || `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail: row.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    source: row.source_name || '',
    published_at: 0,
    extra: { video_id: videoId, channel_id: row.source_id },
  };
}

const atTime = (sec) => new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** A row you can swipe left to reveal "Forget". Forgetting slides the row away
 *  and closes the gap it leaves, then tells the caller. */
function Swipeable({ onForget, children }) {
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const st = useRef(null);
  const forget = () => setLeaving(true);
  return (
    <div className={`${l.swipe} ${leaving ? l.leaving : ''}`} onAnimationEnd={(e) => { if (leaving && e.target === e.currentTarget) onForget(); }}>
      <button type="button" className={l.forget} onClick={forget} tabIndex={dx ? 0 : -1}><Trash2 size={18} /> Forget</button>
      <div
        className={l.swipeFace}
        style={{ transform: `translateX(${dx}px)`, transition: st.current ? 'none' : undefined }}
        onTouchStart={(e) => { st.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, base: dx, lock: null }; }}
        onTouchMove={(e) => {
          const s = st.current;
          if (!s) return;
          const mx = e.touches[0].clientX - s.x;
          const my = e.touches[0].clientY - s.y;
          if (s.lock == null && Math.hypot(mx, my) > 8) s.lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
          if (s.lock === 'x') setDx(Math.max(-110, Math.min(0, s.base + mx)));
        }}
        onTouchEnd={() => { st.current = null; setDx((d) => (d < -55 ? -96 : 0)); }}
      >
        {children}
      </div>
    </div>
  );
}

export default function History() {
  const hist = useApi('/history?platform=youtube');
  const [gone, setGone] = useState(() => new Set());
  const [find, setFind] = useState(null);
  const [confirm, setConfirm] = useState(false);

  const rows = (hist.data?.items || []).filter((r) => !gone.has(r.item_id));
  const ql = (find || '').trim().toLowerCase();
  const shown = ql
    ? rows.filter((r) => (r.title || '').toLowerCase().includes(ql) || (r.source_name || '').toLowerCase().includes(ql))
    : rows;
  const days = byDay(shown, (r) => r.watched_at);

  const forget = async (row) => {
    setGone((g) => new Set(g).add(row.item_id));
    try { await api(`/history?item_id=${encodeURIComponent(row.item_id)}`, { method: 'DELETE' }); } catch { /* best-effort */ }
  };
  const clearAll = async () => {
    setConfirm(false);
    try { await api('/history?platform=youtube', { method: 'DELETE' }); } catch { /* best-effort */ }
    hist.reload();
  };

  return (
    <div>
      <AppBar
        title={find != null ? '' : 'History'}
        sub={find != null ? null : rows.length ? `${rows.length} watched · kept on this phone` : null}
        back
        backTo="/youtube"
        tone="var(--c-youtube)"
        actions={rows.length > 0 && (
          <>
            <IconBtn label="Search history" active={find != null} onClick={() => setFind(find != null ? null : '')}><Search size={20} /></IconBtn>
            <IconBtn label="Clear history" onClick={() => setConfirm(true)}><Trash2 size={20} /></IconBtn>
          </>
        )}
      >
        {find != null && (
          <label className={l.find}>
            <Search size={16} />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search your history…" autoFocus />
            {find && <button type="button" onClick={() => setFind('')} aria-label="Clear"><X size={16} /></button>}
          </label>
        )}
      </AppBar>

      {hist.error && <ErrorNote message={hist.error} onRetry={hist.reload} />}
      {hist.loading && !hist.data && <Skeleton kind="rows" n={5} />}
      {hist.data && !rows.length && <Empty Icon={HistoryIcon} title="Nothing watched yet" text="Play a video anywhere and it shows up here." />}
      {rows.length > 0 && !shown.length && <Empty Icon={Search} title="No matches" text={`Nothing in your history matches “${find}”.`} />}

      {days.map((d) => (
        <section key={d.label}>
          <h3 className={l.day}>{d.label} <em>{d.items.length}</em></h3>
          {d.items.map((row) => (
            <Swipeable key={row.item_id} onForget={() => forget(row)}>
              <VideoRow
                item={historyItem(row)}
                meta={<>{row.source_name && <span>{row.source_name}</span>}<span>{atTime(row.watched_at)}</span>{row.watch_count > 1 && <span>{row.watch_count}×</span>}</>}
              />
            </Swipeable>
          ))}
        </section>
      ))}

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Clear your watch history?"
        footer={
          <div className={l.confirm}>
            <button type="button" className={l.ghost} onClick={() => setConfirm(false)}>Keep it</button>
            <button type="button" className={l.danger} onClick={clearAll}><Trash2 size={16} /> Clear all</button>
          </div>
        }
      >
        <p className={l.note}>All {rows.length} videos leave your history. Progress bars and The Projection's picks start over.</p>
      </Sheet>
    </div>
  );
}
