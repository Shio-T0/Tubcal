// More — the rooms that don't get a tab (The Archive, The Workbench), your
// library (Saved, history, the up-next queue), search, the skin switcher, and
// Settings. A launcher, not a menu: big tiles, one tap each.

import { Link } from 'react-router-dom';
import {
  Bookmark, BrainCircuit, ChevronRight, History, ListVideo, Palette, Search, Settings, Wrench, X,
} from 'lucide-react';

import { DEFAULT_ACTIVE_ROOMS } from '@pc/lib/rooms.js';
import { THEMES } from '@pc/lib/themes.js';
import { usePlayer, useSaved, useSettings } from '@pc/state.jsx';

import { appVersion, haptic } from '../lib/bridge.js';
import { morph } from '../lib/motion.js';
import { AppBar, SectionTitle } from '../shell/Shell.jsx';
import m from './more.module.css';

const ROOMS = [
  { id: 'archive', to: '/archive', label: 'The Archive', blurb: 'Ask everything you’ve watched', Icon: BrainCircuit, c: 'var(--signal)' },
  { id: 'dev', to: '/dev', label: 'The Workbench', blurb: 'One language per service manual', Icon: Wrench, c: 'var(--c-dev)' },
];

export default function More() {
  const { settings, updateSettings } = useSettings();
  const { saved } = useSaved();
  const { queue, dequeue, open } = usePlayer();
  const active = settings?.active_rooms || DEFAULT_ACTIVE_ROOMS;
  const theme = settings?.theme || 'dark';
  const version = appVersion();
  const nSaved = Object.keys(saved).length;

  // A new skin washes over the screen in a circle that grows from your finger.
  const switchSkin = (value, e) => {
    if (value === theme) return;
    haptic('tick');
    const x = e.clientX || window.innerWidth / 2;
    const y = e.clientY || window.innerHeight / 2;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const t = morph(() => { document.documentElement.dataset.theme = value; }, { kind: 'theme' });
    updateSettings({ theme: value });
    t?.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 680, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
  };

  return (
    <div className={m.screen}>
      <AppBar title={<h1 className={m.word}>Tub<i>cal</i></h1>} sub={version ? `v${version} · running on this phone` : 'running on this phone'} />

      <Link to="/search" className={m.search} data-reveal="fade"><Search size={18} /> Search everything…</Link>

      <div className={m.rooms}>
        {ROOMS.filter((r) => active.includes(r.id)).map(({ id, to, label, blurb, Icon, c }) => (
          <Link key={id} to={to} className={m.room} style={{ '--c': c }} data-reveal="pop">
            <span className={m.roomIcon}><Icon size={22} /></span>
            <b>{label}</b>
            <span>{blurb}</span>
          </Link>
        ))}
      </div>

      <div className={m.list}>
        <Link to="/saved" data-reveal="side"><Bookmark size={19} /> Saved {nSaved > 0 && <em key={nSaved} className="ph-pop">{nSaved}</em>}<ChevronRight size={18} /></Link>
        <Link to="/youtube/history" data-reveal="side"><History size={19} /> Watch history<ChevronRight size={18} /></Link>
        <Link to="/settings" data-reveal="side"><Settings size={19} /> Settings<ChevronRight size={18} /></Link>
      </div>

      {queue.length > 0 && (
        <>
          <SectionTitle><ListVideo size={14} /> Up next · {queue.length}</SectionTitle>
          <div className={m.queue}>
            {queue.map((it) => (
              <div key={it.id} className={m.qRow} data-reveal="side">
                <button type="button" onClick={() => { dequeue(it.id); open(it); }}>
                  {it.thumbnail && <img src={it.thumbnail} alt="" loading="lazy" />}
                  <span><b>{it.title}</b><em>{it.source}</em></span>
                </button>
                <button type="button" className={m.qX} onClick={() => dequeue(it.id)} aria-label="Remove from up next"><X size={17} /></button>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionTitle><Palette size={14} /> Skin</SectionTitle>
      <div className={m.skins}>
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={theme === t.value ? m.skinOn : m.skin}
            onClick={(e) => switchSkin(t.value, e)}
            data-reveal="pop"
            aria-pressed={theme === t.value}
          >
            <span className={m.swatch}>{t.swatch.map((c) => <i key={c} style={{ background: c }} />)}</span>
            <b>{t.label}</b>
          </button>
        ))}
      </div>

      <p className={m.foot}>Everything runs on this phone. The only traffic is straight to YouTube, Reddit, Hacker News, GitHub and AniList.</p>
    </div>
  );
}
