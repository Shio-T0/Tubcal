// The drawer: Saved and Settings, a key away from any page.
//
// Every channel's frame has a Saved and a Settings button, and Space s / Space ,
// work everywhere the keyboard isn't busy; all of them open this drawer over the
// page you're on instead of taking you away from it.
//
//   Saved     saves the page you're on, finds anything you've kept (by words or
//             channel), opens it in place, ticks it done or takes it off — and
//             leads on to the full Saved page.
//   Settings  the skins, the switches people reach for most, and every section
//             of the Settings page one click away.
//
// Mounted once at the app root; `openPocket(tab)` (components/channels/common.jsx)
// opens it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Bookmark, BookmarkCheck, Check, ChevronRight, Search, X } from 'lucide-react';

import { useSaved, useSettings } from '../../state.jsx';
import { CHANNELS } from '../../lib/rooms.js';
import { THEMES } from '../../lib/themes.js';
import { channelOfItem, kindOf, pageItem, pageTitle, toneOf } from '../../lib/saveable.js';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from '../../pages/settingsSections.js';
import { KindIcon, keptAgo, kindLine } from '../saved/kinds.jsx';
import { useOpenSaved } from '../saved/useOpenSaved.jsx';
import p from './pocket.module.css';

const PORTRAIT = new Set(['anime', 'character', 'staff']);
const LIST_MAX = 80;

// ── Saved ────────────────────────────────────────────────────────────────────

function ThisPage() {
  const { pathname, search } = useLocation();
  const { saved, toggleSaved } = useSaved();
  const path = `${pathname}${search}`;
  const item = useMemo(() => pageItem(path, pageTitle(pathname, search)), [path, pathname, search]);
  const on = !!saved[item.id];
  if (pathname === '/saved' || pathname === '/settings') return null;
  return (
    <div className={p.page}>
      <span className={p.pageText}>
        <span className={p.pageLabel}>This page</span>
        <span className={p.pageTitle}>{item.title}</span>
      </span>
      <button
        type="button"
        className={`${p.pageSave} ${on ? p.pageSaveOn : ''}`}
        onClick={() => toggleSaved(item, { undo: true })}
        aria-pressed={on}
      >
        {on ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
        {on ? 'Saved' : 'Save page'}
      </button>
    </div>
  );
}

function Thumb({ item }) {
  const kind = kindOf(item);
  if (item.thumbnail) {
    return (
      <span className={`${p.thumb} ${PORTRAIT.has(kind) ? p.thumbTall : ''}`}>
        <img src={item.thumbnail} alt="" loading="lazy" />
      </span>
    );
  }
  return (
    <span className={`${p.thumb} ${p.thumbIcon}`}>
      <KindIcon item={item} size={15} />
    </span>
  );
}

function SavedTab({ onDone, openItem }) {
  const { saved, removeSaved, updateSaved } = useSaved();
  const [q, setQ] = useState('');
  const [ch, setCh] = useState('all');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const items = useMemo(() => Object.values(saved).sort((a, b) => (
    (!!a.done_at - !!b.done_at) || (b.saved_at || 0) - (a.saved_at || 0)
  )), [saved]);
  const counts = useMemo(() => {
    const c = { all: items.length };
    for (const it of items) {
      const id = channelOfItem(it) || 'other';
      c[id] = (c[id] || 0) + 1;
    }
    return c;
  }, [items]);
  const needle = q.trim().toLowerCase();
  const shown = items.filter((it) => (
    (ch === 'all' || channelOfItem(it) === ch)
    && (!needle || `${it.title} ${it.source || ''} ${it.author || ''} ${it.note || ''}`.toLowerCase().includes(needle))
  ));

  const open = (it) => { onDone(); openItem(it); };

  return (
    <>
      <ThisPage />
      <div className={p.find}>
        <Search size={14} className={p.findIcon} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={items.length ? `Find in ${items.length} saved…` : 'Nothing saved yet'}
          spellCheck={false}
          aria-label="Find in saved"
        />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Clear"><X size={13} /></button>}
      </div>
      <div className={p.chips} role="group" aria-label="Channel">
        <button type="button" className={ch === 'all' ? p.chipOn : p.chip} onClick={() => setCh('all')} aria-pressed={ch === 'all'}>
          All <b>{counts.all || 0}</b>
        </button>
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={ch === c.id ? p.chipOn : p.chip}
            style={{ '--ch-c': c.color }}
            onClick={() => setCh(ch === c.id ? 'all' : c.id)}
            aria-pressed={ch === c.id}
            disabled={!counts[c.id]}
          >
            <i aria-hidden="true" />{c.label} <b>{counts[c.id] || 0}</b>
          </button>
        ))}
      </div>

      <ul className={p.list}>
        {shown.slice(0, LIST_MAX).map((it, i) => (
          <li key={it.id} className={`${p.row} ${it.done_at ? p.rowDone : ''}`} style={{ '--tone': toneOf(it), '--i': Math.min(i, 14) }}>
            <button type="button" className={p.rowOpen} onClick={() => open(it)} data-kbd-tile title={it.title}>
              <Thumb item={it} />
              <span className={p.rowText}>
                <span className={p.rowTitle}>{it.title || it.url}</span>
                <span className={p.rowMeta}>{kindLine(it)}{it.saved_at ? ` · ${keptAgo(it)}` : ''}</span>
                {it.note && <span className={p.rowNote}>{it.note}</span>}
              </span>
            </button>
            <span className={p.rowActs}>
              <button
                type="button"
                className={it.done_at ? p.actOn : p.act}
                onClick={() => updateSaved(it.id, { done: !it.done_at })}
                title={it.done_at ? 'Mark not done' : 'Mark done'}
                aria-pressed={!!it.done_at}
              >
                <Check size={13} />
              </button>
              <button type="button" className={p.act} onClick={() => removeSaved([it.id], { undo: true })} title="Remove from Saved">
                <X size={13} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {items.length === 0 && (
        <p className={p.empty}>
          The bookmark on a video, post, title, repo or file keeps it here. So does “Save page” above, for any page at all.
        </p>
      )}
      {items.length > 0 && shown.length === 0 && <p className={p.empty}>Nothing saved matches that.</p>}

      <Link to={ch === 'all' ? '/saved' : `/saved?ch=${ch}`} className={p.more} onClick={onDone}>
        Open the Saved page
        {shown.length > LIST_MAX && <span>{shown.length - LIST_MAX} more there</span>}
        <ArrowRight size={14} />
      </Link>
    </>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────

const SWITCHES = [
  { key: 'fast_mode', label: 'Fast mode', hint: 'Nothing animates', fallback: false },
  { key: 'solo_audio', label: 'One sound at a time', hint: 'Only the video in front plays sound', fallback: true },
  { key: 'notify_live', label: 'Live alerts', hint: 'A desktop note before a stream starts', fallback: true },
  { key: 'anime_auto_skip', label: 'Skip anime openings', hint: 'The player jumps them by itself', fallback: false },
  { key: 'anime_theme_audio', label: 'Opening on title pages', hint: 'Plays a show’s theme when its page opens', fallback: true },
];

function Toggle({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`${p.switch} ${on ? p.switchOn : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function SettingsTab({ onDone }) {
  const { settings, updateSettings } = useSettings();
  const navigate = useNavigate();
  const theme = settings?.theme || 'dark';
  const firstRef = useRef(null);
  useEffect(() => { firstRef.current?.focus(); }, []);

  return (
    <div className={p.settings}>
      <section>
        <h3 className={p.label}>Skin</h3>
        <div className={p.skins}>
          {THEMES.map((t, i) => (
            <button
              key={t.value}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className={`${p.skin} ${t.value === theme ? p.skinOn : ''}`}
              onClick={() => updateSettings({ theme: t.value })}
              aria-pressed={t.value === theme}
              title={t.blurb}
            >
              <span className={p.swatch} style={{ background: t.swatch[0] }}>
                <i style={{ background: t.swatch[1] }} />
                <i style={{ background: t.swatch[2] }} />
              </span>
              <span className={p.skinName}>{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className={p.label}>Switches</h3>
        <ul className={p.switches}>
          {SWITCHES.map((sw) => {
            const on = settings?.[sw.key] ?? sw.fallback;
            return (
              <li key={sw.key}>
                <span className={p.swText}>
                  <span>{sw.label}</span>
                  <small>{sw.hint}</small>
                </span>
                <Toggle on={!!on} label={sw.label} onChange={(v) => updateSettings({ [sw.key]: v })} />
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h3 className={p.label}>Everything else</h3>
        <div className={p.sections}>
          {SETTINGS_GROUPS.flatMap((g) => g.ids).map((id) => {
            const sec = SETTINGS_SECTIONS[id];
            const Icon = sec.icon;
            return (
              <button
                key={id}
                type="button"
                className={p.section}
                onClick={() => { onDone(); navigate(`/settings?s=${id}`); }}
                data-kbd-tile
              >
                <Icon size={15} />
                <span>{sec.title}</span>
                <ChevronRight size={13} className={p.sectionGo} />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ── the drawer ───────────────────────────────────────────────────────────────

export default function Pocket() {
  const [state, setState] = useState({ open: false, tab: 'saved' });
  const { saved } = useSaved();
  const { pathname } = useLocation();
  // Opening an entry closes the drawer, so the readers it opens live out here.
  const { openItem, modals } = useOpenSaved();
  const back = useRef(null);
  const n = Object.keys(saved || {}).length;

  useEffect(() => {
    const onOpen = (e) => {
      const tab = e.detail?.tab === 'settings' ? 'settings' : 'saved';
      setState((s) => {
        if (s.open && s.tab === tab) return { ...s, open: false };
        if (!s.open) back.current = document.activeElement;
        return { open: true, tab };
      });
    };
    window.addEventListener('tubcal:pocket', onOpen);
    return () => window.removeEventListener('tubcal:pocket', onOpen);
  }, []);

  const close = () => setState((s) => ({ ...s, open: false }));

  // Going somewhere closes it.
  useEffect(() => { setState((s) => (s.open ? { ...s, open: false } : s)); }, [pathname]);

  useEffect(() => {
    if (!state.open) {
      if (back.current?.isConnected) back.current.focus({ preventScroll: true });
      back.current = null;
      return undefined;
    }
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.open]);

  if (!state.open) return modals;
  const tab = (id, label, extra) => (
    <button
      type="button"
      role="tab"
      aria-selected={state.tab === id}
      className={state.tab === id ? p.tabOn : p.tab}
      onClick={() => setState({ open: true, tab: id })}
    >
      {label}{extra}
    </button>
  );
  return (
    <>
      {modals}
      {createPortal(
        <div className={p.layer}>
          <div className={p.backdrop} onMouseDown={close} aria-hidden="true" />
          <aside className={`${p.drawer} tc-float`} role="dialog" aria-modal="true" aria-label="Saved and settings" data-kbd-scope>
            <header className={p.head}>
              <div className={p.tabs} role="tablist">
                {tab('saved', 'Saved', n ? <b>{n}</b> : null)}
                {tab('settings', 'Settings')}
              </div>
              <span className={p.keys} aria-hidden="true"><kbd>Space</kbd><kbd>{state.tab === 'saved' ? 's' : ','}</kbd></span>
              <button type="button" className={p.close} onClick={close} aria-label="Close"><X size={16} /></button>
            </header>
            <div className={p.body}>
              {state.tab === 'saved' ? <SavedTab onDone={close} openItem={openItem} /> : <SettingsTab onDone={close} />}
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}
