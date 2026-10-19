import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Bookmark, Clapperboard, Code2, CornerDownLeft, GitBranch, Hash, History, House, Library, Play, Radio, ScrollText,
  Search, Settings, Tv, Wrench,
} from 'lucide-react';

import { api } from '../../api/client.js';
import { CHANNELS, channelHome, getRoomById } from '../../lib/rooms.js';
import { usePlayer, useSaved, useSettings } from '../../state.jsx';
import { openPocket } from '../channels/common.jsx';
import { KindIcon, kindLine } from '../saved/kinds.jsx';
import { useOpenSaved } from '../saved/useOpenSaved.jsx';
import s from './CommandPalette.module.css';

// The channels, then every room in the registry by channel (whether or not it's
// switched on — the palette is the way in either way), then the places that
// aren't rooms. Typing also finds what you've saved.
const ROOM_ICONS = {
  edition: ScrollText, youtube: Clapperboard, reddit: Radio, hackernews: Hash, archive: Library,
  editor: Code2, github: GitBranch, dev: Wrench, anime: Tv,
};
const ROOM_NAV = CHANNELS.flatMap((ch) => ch.rooms.map(getRoomById).filter(Boolean).map((r) => {
  const Icon = ROOM_ICONS[r.id] || ScrollText;
  return { id: `nav:${r.route}`, label: r.label, sub: ch.label, icon: <Icon size={15} />, to: r.route };
}));
const PLACE_NAV = [
  { id: 'nav:/youtube/history', label: 'Screening Room — watch history', icon: <History size={15} />, to: '/youtube/history' },
  { id: 'nav:/youtube?v=latest', label: 'Screening Room — latest uploads', icon: <Clapperboard size={15} />, to: '/youtube?v=latest' },
  { id: 'nav:/', label: 'Home', sub: 'Choose a channel', icon: <House size={15} />, to: '/' },
  { id: 'pocket:saved', label: 'Saved', sub: 'Open the drawer · Space s', icon: <Bookmark size={15} />, pocket: 'saved' },
  { id: 'nav:/saved', label: 'Saved page', sub: 'Everything you kept', icon: <Bookmark size={15} />, to: '/saved' },
  { id: 'pocket:settings', label: 'Settings', sub: 'Open the drawer · Space ,', icon: <Settings size={15} />, pocket: 'settings' },
  { id: 'nav:/settings', label: 'Settings page', icon: <Settings size={15} />, to: '/settings' },
];
const SAVED_MAX = 6;

const typingInField = (el) =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

export default function CommandPalette() {
  const navigate = useNavigate();
  const { open: playVideo } = usePlayer();
  const { saved } = useSaved();
  const { settings } = useSettings();
  const { openItem, modals } = useOpenSaved();
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
    const channelNav = CHANNELS.map((ch) => ({
      id: `channel:${ch.id}`,
      label: `${ch.label}`,
      sub: `Channel ${ch.n} · ${ch.rooms.map((id) => getRoomById(id)?.label).filter(Boolean).join(', ')}`,
      icon: <span className={s.chNo} style={{ '--ch-c': ch.color }}>{ch.n}</span>,
      to: channelHome(ch.id, settings?.active_rooms),
    }));
    [...channelNav, ...ROOM_NAV, ...PLACE_NAV]
      .filter((n) => !ql || `${n.label} ${n.sub || ''}`.toLowerCase().includes(ql))
      .forEach((n) => out.push({
        key: n.id, label: n.label, sub: n.sub, icon: n.icon, hint: n.pocket ? 'Open' : 'Go',
        run: () => (n.pocket ? openPocket(n.pocket) : navigate(n.to)),
      }));
    if (ql) {
      Object.values(saved || {})
        .filter((it) => `${it.title} ${it.source || ''} ${it.note || ''}`.toLowerCase().includes(ql))
        .slice(0, SAVED_MAX)
        .forEach((it) => out.push({
          key: `saved:${it.id}`, label: it.title, sub: `Saved · ${kindLine(it)}`,
          icon: <KindIcon item={it} size={14} />, hint: 'Open', run: () => openItem(it),
        }));
    }
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
  }, [results, q, navigate, playVideo, saved, settings?.active_rooms, openItem]);

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
    // The channel frames' search buttons (and anything else) can ask for it too.
    const onAsk = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('tubcal:palette', onAsk);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('tubcal:palette', onAsk);
    };
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return modals;

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

  return (
    <>
      {modals}
      {createPortal(
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
                placeholder="Search YouTube, Reddit, HN and your saved things — or jump to a room…"
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
      )}
    </>
  );
}
