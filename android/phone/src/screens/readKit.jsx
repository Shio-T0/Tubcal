// What Read's rooms share: the search field in the app bar, a paged feed loader,
// the save/share actions of a line's menu and the row of faces (your subreddits,
// the repos and people you follow). Read.jsx is the frame; each room is a file of
// its own (readWire, readDispatch, readGithub), in the split APK of its room.

import { useCallback, useEffect, useState } from 'react';
import { Bookmark, BookmarkCheck, Plus, Search, Share2, X } from 'lucide-react';

import { api } from '@pc/api/client.js';
import { Avatar } from '@pc/components/ui/Avatar.jsx';
import { useSaved } from '@pc/state.jsx';

import { share } from '../lib/bridge.js';
import r from './read.module.css';

/** A search field that lives in the app bar. */
export function BarSearch({ value, onChange, placeholder, onClose }) {
  return (
    <label className={r.search}>
      <Search size={16} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus spellCheck={false} enterKeyHint="search" />
      <button type="button" onClick={() => (value ? onChange('') : onClose())} aria-label={value ? 'Clear' : 'Close search'}><X size={17} /></button>
    </label>
  );
}

/** Paged feed loader: `/feed/<x>?page=N` with has_more. */
export function usePaged(url, enabled = true) {
  const [items, setItems] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(null);
  const load = useCallback(async (p, append) => {
    if (append) setMore(true); else setLoading(true);
    setError(null);
    try {
      const d = await api(`${url}${url.includes('?') ? '&' : '?'}page=${p}`);
      setItems((prev) => (append && prev ? [...prev, ...d.items.filter((x) => !prev.some((y) => y.id === x.id))] : d.items));
      setHasMore(!!d.has_more);
      setPage(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setMore(false);
    }
  }, [url]);
  useEffect(() => {
    if (!enabled) return;
    setItems(null);
    load(0, false);
  }, [load, enabled]);
  return { items, loading, more, error, hasMore, reload: () => load(0, false), next: () => load(page + 1, true) };
}

export function SaveShareActions(item, saved, toggleSaved) {
  const on = !!saved[item.id];
  return [
    { label: on ? 'Remove from Saved' : 'Save for later', Icon: on ? BookmarkCheck : Bookmark, onClick: () => toggleSaved(item) },
    { label: 'Share', Icon: Share2, onClick: () => share({ title: item.title, url: item.url }) },
  ];
}

export function FaceRow({ subs, onAdd, onPick, current, label = 'Add' }) {
  return (
    <div className={r.faces}>
      {subs.map((s) => (
        <button key={s.id} type="button" className={`${r.face} ${current === s.source_id ? r.faceOn : ''}`} onClick={() => onPick(s)} data-reveal="pop">
          <Avatar src={s.thumbnail} name={s.display_name} imgClass={r.faceImg} letterClass={r.faceLetter} />
          <span>{s.display_name.replace(/^r\//, '')}</span>
        </button>
      ))}
      {onAdd && (
        <button type="button" className={r.face} onClick={onAdd} data-reveal="pop">
          <span className={`${r.faceLetter} ${r.faceAdd}`}><Plus size={20} /></span>
          <span>{label}</span>
        </button>
      )}
    </div>
  );
}

/** A line's long-press menu: the item it's open for, and the saved state. */
export function useItemMenu() {
  const { saved, toggleSaved } = useSaved();
  const [menu, setMenu] = useState(null);
  return [menu, setMenu, saved, toggleSaved];
}
