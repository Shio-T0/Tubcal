import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Clapperboard, CornerDownLeft, Hash, Newspaper, Play, Radio, Search, Settings } from 'lucide-react';

import { api } from '../../api/client.js';
import { usePlayer } from '../../state.jsx';
import s from './CommandPalette.module.css';

const NAV = [
  { id: 'nav:/', label: 'Front Page', icon: <Newspaper size={15} />, to: '/' },
  { id: 'nav:/youtube', label: 'Screening Room', icon: <Clapperboard size={15} />, to: '/youtube' },
  { id: 'nav:/reddit', label: 'The Dispatch', icon: <Radio size={15} />, to: '/reddit' },
  { id: 'nav:/hackernews', label: 'The Wire', icon: <Hash size={15} />, to: '/hackernews' },
  { id: 'nav:/saved', label: 'Saved', icon: <Bookmark size={15} />, to: '/saved' },
  { id: 'nav:/settings', label: 'Settings', icon: <Settings size={15} />, to: '/settings' },
];

const typingInField = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

export default function CommandPalette() {
  const navigate = useNavigate();
  const { open: playVideo } = usePlayer();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState({ youtube: [], reddit: [], hackernews: [] });
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const reqRef = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setQ('');
    setResults({ youtube: [], reddit: [], hackernews: [] });
    setActive(0);
  }, []);

  // Debounced unified search across all three rooms.
  useEffect(() => {
    if (!open) return undefined;
    const query = q.trim();
    if (query.length < 2) {
      setResults({ youtube: [], reddit: [], hackernews: [] });
      return undefined;
    }
    const id = ++reqRef.current;
    const t = setTimeout(() => {
      api(`/search/all?q=${encodeURIComponent(query)}`)
        .then((d) => {
          if (id === reqRef.current) setResults(d || { youtube: [], reddit: [], hackernews: [] });
        })
        .catch(() => {});
    }, 320);
    return () => clearTimeout(t);
  }, [q, open]);

  // Flatten nav + results into one selectable list (the order arrows traverse).
  const flat = useMemo(() => {
    const out = [];
    const ql = q.trim().toLowerCase();
    NAV.filter((n) => !ql || n.label.toLowerCase().includes(ql)).forEach((n) =>
      out.push({ key: n.id, label: n.label, icon: n.icon, hint: 'Go', run: () => navigate(n.to) }),
    );
    results.youtube.forEach((item) =>
      out.push({
        key: item.id,
        label: item.title,
        sub: item.source,
        icon: <Play size={14} />,
        hint: 'Play',
        run: () => playVideo(item),
      }),
    );
    [...results.reddit, ...results.hackernews].forEach((item) =>
      out.push({
        key: item.id,
        label: item.title,
        sub: item.source,
        icon: item.platform === 'reddit' ? <Radio size={14} /> : <Hash size={14} />,
        hint: 'Open',
        run: () => window.open(item.url, '_blank', 'noopener'),
      }),
    );
    return out;
  }, [results, q, navigate, playVideo]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  // Global hotkeys: Ctrl/Cmd-K toggles, "/" opens (when not already typing).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === '/' && !open && !typingInField(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[active];
      if (item) {
        item.run();
        close();
      }
    }
  };

  return createPortal(
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={s.palette} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className={s.inputRow}>
          <Search size={17} className={s.searchIcon} />
          <input
            ref={inputRef}
            className={s.input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search YouTube, Reddit, HN — or jump to a room…"
            spellCheck={false}
          />
          <kbd className={s.kbd}>esc</kbd>
        </div>

        <div className={s.list}>
          {flat.length === 0 && (
            <div className={s.empty}>
              {q.trim().length < 2 ? 'Type to search across every room.' : 'No matches.'}
            </div>
          )}
          {flat.map((item, i) => (
            <button
              key={item.key}
              className={`${s.row} ${i === active ? s.rowActive : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                item.run();
                close();
              }}
            >
              <span className={s.rowIcon}>{item.icon}</span>
              <span className={s.rowText}>
                <span className={s.rowLabel}>{item.label}</span>
                {item.sub && <span className={s.rowSub}>{item.sub}</span>}
              </span>
              <span className={s.rowHint}>
                {item.hint}
                {i === active && <CornerDownLeft size={12} />}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
