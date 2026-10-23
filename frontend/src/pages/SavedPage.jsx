// Saved — everything you kept, from every channel, in one place.
//
// Anything with a bookmark can be kept: videos and moments in them, playlists and
// channels, anime titles, characters, voice actors, studios and forum threads, HN
// stories, Reddit posts and subreddits, repos, releases, Workbench posts, podcast
// episodes and manuals, files from the editor, and any page at all (the drawer's
// "Save page"). It all lives in this machine's database.
//
// The catalogue down the left sorts it by channel and then by kind, with counts;
// To do / Done split what you've dealt with from what's still waiting. The bar on
// top finds by words (titles, sources and your notes), sorts, switches between
// shelves (each kind laid out its own way) and a dense list, and turns on
// selection for clearing many at once. Every entry can carry a note and a done
// mark; taking one off offers an Undo. All view state lives in the URL
// (`?ch= &k= &q= &sort= &view= &st=`), so opening something and coming back keeps
// the view.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUp, Bookmark, Check, CheckCheck, Download, LayoutGrid, List, MessageSquare, PenLine, Play, Search, Square,
  SquareCheck, Star, Trash2, X,
} from 'lucide-react';

import { compact } from '../lib/format.js';
import { clock } from '../lib/time.js';
import { useParamState } from '../lib/urlState.js';
import { ALL_CHANNELS, CHANNELS, getRoomById, savedChannels } from '../lib/rooms.js';
import { KINDS, KIND_ORDER, channelOfItem, kindOf, toneOf } from '../lib/saveable.js';
import { EXPORT_FORMATS, download, exportSaved } from '../lib/savedExport.js';
import { api } from '../api/client.js';
import { useSaved, useToast } from '../state.jsx';
import { KindIcon, keptAgo, kindLine } from '../components/saved/kinds.jsx';
import { useOpenSaved } from '../components/saved/useOpenSaved.jsx';
import s from './saved.module.css';

// Where the empty page sends you in each channel: rooms full of things to save.
const DOORS = ['edition', 'dev', 'youtube'];

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// How each kind is laid out on the shelves.
const LAYOUT = {
  video: 'media', moment: 'media', playlist: 'media', ytchannel: 'media',
  anime: 'poster', character: 'poster', staff: 'poster', studio: 'poster',
  file: 'mono', page: 'mono', commit: 'mono',
};
const layoutOf = (kind) => LAYOUT[kind] || 'card';

/** Export what's shown (a bookmarks file, Markdown or JSON), made in the page and
 *  handed to the browser's download: nothing leaves this machine. */
function ExportMenu({ items, scope, label = 'Export', importOnly = false }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const file = useRef(null);
  const toast = useToast();
  const { reloadSaved } = useSaved();
  // Bring back a JSON export (from this machine, another, or the phone). What's
  // already here stays as it is, notes included.
  const bringBack = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    setOpen(false);
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await api('/saved/import', { method: 'POST', body: JSON.stringify(data) });
      await reloadSaved();
      const parts = [`${plural(r.added, 'thing')} brought back`];
      if (r.already) parts.push(`${r.already} already here`);
      if (r.skipped) parts.push(`${r.skipped} couldn’t be read`);
      toast(parts.join(' · '), r.added ? 'success' : 'info');
    } catch (err) {
      toast(err instanceof SyntaxError ? 'That file isn’t a Tubcal export (it isn’t JSON)' : err.message, 'error');
    }
  };
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const save = (format) => {
    download(exportSaved(format, items, { origin: window.location.origin }));
    setOpen(false);
  };
  return (
    <span className={s.exportWrap} ref={wrap}>
      <button
        type="button"
        className={open ? s.selectOn : s.select}
        onClick={() => (importOnly ? file.current?.click() : setOpen((o) => !o))}
        aria-expanded={importOnly ? undefined : open}
        aria-haspopup={importOnly ? undefined : 'menu'}
        title="Take these with you, or bring some back"
      >
        <Download size={14} /> {label}
      </button>
      {open && (
        <div className={s.exportMenu} role="menu">
          <p>{plural(items.length, 'thing')} · {scope}</p>
          {EXPORT_FORMATS.map((f) => (
            <button key={f.id} type="button" role="menuitem" onClick={() => save(f.id)} disabled={!items.length}>
              <b>{f.label}</b>
              <span>.{f.ext}</span>
            </button>
          ))}
          <button type="button" role="menuitem" className={s.exportImport} onClick={() => file.current?.click()}>
            <b>Bring back an export…</b>
            <span>.json</span>
          </button>
          <small>Made right here and saved by your browser. Nothing is uploaded.</small>
        </div>
      )}
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={bringBack} />
    </span>
  );
}

const SORTS = [
  ['new', 'Newest kept'],
  ['old', 'Oldest kept'],
  ['az', 'A to Z'],
];

/** A sentence or two of the item's own words, when the platform gave any. */
function excerptOf(item) {
  if (kindOf(item) === 'moment') return item.extra?.quote || '';
  const raw = item.extra?.description || item.extra?.selftext_preview || item.description || '';
  return String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── one entry's own controls: done, note, remove ─────────────────────────────

function NoteEditor({ item, onClose }) {
  const { updateSaved } = useSaved();
  const [text, setText] = useState(item.note || '');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const commit = () => {
    if ((item.note || '') !== text.trim()) updateSaved(item.id, { note: text.trim() });
    onClose();
  };
  return (
    <textarea
      ref={ref}
      className={s.noteEdit}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      }}
      onBlur={commit}
      placeholder="Why you kept it, what to look for…"
      rows={2}
      maxLength={2000}
    />
  );
}

function Acts({ item, onNote }) {
  const { updateSaved, removeSaved } = useSaved();
  const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
  return (
    <span className={s.acts}>
      <button
        type="button"
        className={item.done_at ? s.actOn : s.act}
        onClick={stop(() => updateSaved(item.id, { done: !item.done_at }))}
        onKeyDown={(e) => e.stopPropagation()}
        title={item.done_at ? 'Mark not done' : 'Mark done'}
        aria-pressed={!!item.done_at}
      >
        <Check size={14} />
      </button>
      <button type="button" className={s.act} onClick={stop(onNote)} onKeyDown={(e) => e.stopPropagation()} title={item.note ? 'Edit the note' : 'Add a note'}>
        <PenLine size={14} />
      </button>
      <button type="button" className={s.act} onClick={stop(() => removeSaved([item.id], { undo: true }))} onKeyDown={(e) => e.stopPropagation()} title="Remove from Saved">
        <X size={14} />
      </button>
    </span>
  );
}

// ── an entry, as it sits on a shelf ──────────────────────────────────────────

function Entry({ item, i, selecting, selected, onToggle, onOpen }) {
  const [noting, setNoting] = useState(false);
  const kind = kindOf(item);
  const layout = layoutOf(kind);
  const activate = () => (selecting ? onToggle(item.id) : onOpen(item));
  const excerpt = layout === 'card' || kind === 'moment' ? excerptOf(item) : '';
  const repo = kind === 'repo';

  let face = null;
  if (layout === 'media') {
    face = (
      <span className={`${s.pic} ${kind === 'ytchannel' ? s.picRound : ''}`}>
        {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <KindIcon item={item} size={22} />}
        {(kind === 'video' || kind === 'moment') && <span className={s.play}><Play size={16} fill="currentColor" /></span>}
        {kind === 'moment' && <span className={s.stamp}>{clock(item.extra?.t || 0)}</span>}
        {item.extra?.length_seconds ? <span className={s.stamp}>{clock(item.extra.length_seconds)}</span> : null}
      </span>
    );
  } else if (layout === 'poster') {
    face = (
      <span className={s.cover} style={item.extra?.color ? { '--cover-c': item.extra.color } : undefined}>
        {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <span className={s.coverBlank}>{(item.title || '?')[0]}</span>}
      </span>
    );
  }

  return (
    <article
      className={`${s.entry} ${s[layout]} ${item.done_at ? s.done : ''} ${selected ? s.selected : ''}`}
      style={{ '--tone': toneOf(item), '--i': Math.min(i, 16) }}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${item.title} — ${KINDS[kind].one}`}
      data-kbd-tile
    >
      {selecting && (
        <span className={s.check} aria-hidden="true">{selected ? <SquareCheck size={17} /> : <Square size={17} />}</span>
      )}
      {face}
      <span className={s.body}>
        <span className={s.tag}>
          <KindIcon item={item} size={12} />
          {kindLine(item)}
        </span>
        <span className={s.title}>{item.title || item.url}</span>
        {layout === 'poster' && item.extra?.native && <span className={s.native} lang="ja">{item.extra.native}</span>}
        {excerpt && <span className={s.excerpt}>{kind === 'moment' ? `“${excerpt}”` : excerpt}</span>}
        {kind === 'podcast' && item.extra?.audio && (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio className={s.audio} controls preload="none" src={item.extra.audio} onClick={(e) => e.stopPropagation()} />
        )}
        {noting ? (
          <NoteEditor item={item} onClose={() => setNoting(false)} />
        ) : item.note ? (
          <span className={s.note}>{item.note}</span>
        ) : null}
        <span className={s.foot}>
          {item.score != null && (
            <span title={repo ? 'Stars' : 'Points'}>{repo ? <Star size={11} /> : <ArrowUp size={11} />}{compact(item.score)}</span>
          )}
          {item.comments_count != null && <span title="Comments"><MessageSquare size={11} />{compact(item.comments_count)}</span>}
          <span className={s.kept} title={item.saved_at ? new Date(item.saved_at * 1000).toLocaleString() : undefined}>{keptAgo(item)}</span>
          {item.done_at && <span className={s.doneMark}><CheckCheck size={12} /> done</span>}
        </span>
      </span>
      {!selecting && <Acts item={item} onNote={() => setNoting(true)} />}
    </article>
  );
}

/** The dense list: one line each, for going through a lot at once. */
function Line({ item, selecting, selected, onToggle, onOpen }) {
  const [noting, setNoting] = useState(false);
  const activate = () => (selecting ? onToggle(item.id) : onOpen(item));
  return (
    <li
      className={`${s.line} ${item.done_at ? s.done : ''} ${selected ? s.selected : ''}`}
      style={{ '--tone': toneOf(item) }}
    >
      <button type="button" className={s.lineOpen} onClick={activate} data-kbd-tile>
        {selecting && <span className={s.check}>{selected ? <SquareCheck size={16} /> : <Square size={16} />}</span>}
        <span className={s.lineIcon}><KindIcon item={item} size={14} /></span>
        <span className={s.lineTitle}>{item.title || item.url}</span>
        <span className={s.lineKind}>{kindLine(item)}</span>
        <span className={s.lineKept}>{keptAgo(item).replace('kept ', '')}</span>
      </button>
      {noting ? (
        <NoteEditor item={item} onClose={() => setNoting(false)} />
      ) : item.note ? (
        <span className={s.lineNote}>{item.note}</span>
      ) : null}
      {!selecting && <Acts item={item} onNote={() => setNoting(true)} />}
    </li>
  );
}

// ── the catalogue ────────────────────────────────────────────────────────────

function Catalogue({ items, ch, k, st, setFilter, setSt }) {
  const tally = useMemo(() => {
    const t = { all: items.length, todo: 0, done: 0, channel: {}, kind: {} };
    for (const it of items) {
      if (it.done_at) t.done += 1; else t.todo += 1;
      const c = channelOfItem(it) || 'other';
      t.channel[c] = (t.channel[c] || 0) + 1;
      const kk = `${c}:${kindOf(it)}`;
      t.kind[kk] = (t.kind[kk] || 0) + 1;
    }
    return t;
  }, [items]);
  const groups = [...savedChannels((id) => tally.channel[id]), { id: 'other', label: 'Elsewhere', color: 'var(--paper-faint)' }];
  return (
    <nav className={s.catalogue} aria-label="Sort saved by channel and kind">
      <div className={s.catGroup}>
        {[['all', 'Everything', tally.all], ['todo', 'To do', tally.todo], ['done', 'Done', tally.done]].map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            className={st === id ? s.catOn : s.cat}
            onClick={() => setSt(id)}
            aria-pressed={st === id}
          >
            {id === 'done' ? <CheckCheck size={14} /> : id === 'todo' ? <Square size={14} /> : <Bookmark size={14} />}
            <span>{label}</span>
            <b>{n}</b>
          </button>
        ))}
      </div>
      {groups.filter((g) => tally.channel[g.id]).map((g) => (
        <div key={g.id} className={s.catGroup} style={{ '--ch-c': g.color }}>
          <button
            type="button"
            className={`${s.catHead} ${ch === g.id && !k ? s.catHeadOn : ''}`}
            onClick={() => setFilter(ch === g.id && !k ? 'all' : g.id, '')}
            aria-pressed={ch === g.id && !k}
          >
            <i aria-hidden="true" />
            <span>{g.label}</span>
            <b>{tally.channel[g.id]}</b>
          </button>
          {KIND_ORDER.filter((kind) => tally.kind[`${g.id}:${kind}`]).map((kind) => (
            <button
              key={kind}
              type="button"
              className={ch === g.id && k === kind ? s.catOn : s.cat}
              onClick={() => setFilter(g.id, k === kind && ch === g.id ? '' : kind)}
              aria-pressed={ch === g.id && k === kind}
            >
              <KindIcon kind={kind} size={13} />
              <span>{KINDS[kind].label}</span>
              <b>{tally.kind[`${g.id}:${kind}`]}</b>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────

export default function SavedPage() {
  const { saved, removeSaved, updateSaved } = useSaved();
  const { openItem, modals } = useOpenSaved();
  const [ch, setCh] = useParamState('ch', 'all');
  const [k, setK] = useParamState('k', '');
  const [q, setQ] = useParamState('q', '');
  const [sort, setSort] = useParamState('sort', 'new');
  const [view, setView] = useParamState('view', 'shelves');
  const [st, setSt] = useParamState('st', 'all');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState(() => new Set());

  const items = useMemo(() => Object.values(saved), [saved]);
  const setFilter = (nextCh, nextK) => { setCh(nextCh); setK(nextK); };

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const out = items.filter((it) => (
      (ch === 'all' || (channelOfItem(it) || 'other') === ch)
      && (!k || kindOf(it) === k)
      && (st === 'all' || (st === 'done' ? !!it.done_at : !it.done_at))
      && (!needle || `${it.title} ${it.source || ''} ${it.author || ''} ${it.note || ''} ${excerptOf(it)}`.toLowerCase().includes(needle))
    ));
    const by = {
      new: (a, b) => (b.saved_at || 0) - (a.saved_at || 0),
      old: (a, b) => (a.saved_at || 0) - (b.saved_at || 0),
      az: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }),
    }[sort] || ((a, b) => (b.saved_at || 0) - (a.saved_at || 0));
    // what's still to do comes before what's done
    return out.sort((a, b) => (!!a.done_at - !!b.done_at) || by(a, b));
  }, [items, ch, k, st, needle, sort]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const it of shown) {
      const kind = kindOf(it);
      if (!m.has(kind)) m.set(kind, []);
      m.get(kind).push(it);
    }
    return KIND_ORDER.filter((kind) => m.has(kind)).map((kind) => [kind, m.get(kind)]);
  }, [shown]);

  const oldest = items.reduce((m, it) => (it.saved_at && (!m || it.saved_at < m) ? it.saved_at : m), 0);
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const endSelect = () => { setSelecting(false); setPicked(new Set()); };
  const allPicked = shown.length > 0 && shown.every((it) => picked.has(it.id));

  // Esc leaves selection.
  useEffect(() => {
    if (!selecting) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') endSelect(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  if (items.length === 0) {
    return (
      <div className={s.empty}>
        <Bookmark size={34} />
        <h1>Nothing saved yet</h1>
        <p>
          Press the bookmark on anything you want to come back to: a video, a moment in an archived video, an anime title or
          character, an HN story, a Reddit post, a repo, a podcast episode, a file in the editor. To keep a whole page,
          open the drawer (<kbd>Space</kbd> <kbd>s</kbd>) and press Save page.
        </p>
        <div className={s.emptyDoors}>
          {CHANNELS.map((c) => (
            <Link key={c.id} to={getRoomById(c.rooms.find((r) => DOORS.includes(r)) || c.rooms[0])?.route || '/'} style={{ '--ch-c': c.color }}>
              <b>{c.n}</b> {c.label}
            </Link>
          ))}
        </div>
        <p className={s.emptyMove}>
          Coming from another machine?
          <ExportMenu items={[]} label="Bring back an export" importOnly />
        </p>
      </div>
    );
  }

  const scopeLabel = k ? KINDS[k].label : ch === 'all' ? 'Everything' : ch === 'other' ? 'Elsewhere' : ALL_CHANNELS.find((c) => c.id === ch)?.label;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div className={s.headText}>
          <h1 className={s.h1}>Saved</h1>
          <p className={s.sub}>
            {plural(items.length, 'thing')} kept
            {oldest > 0 && <> since {new Date(oldest * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</>}
            {items.some((it) => it.done_at) && <> · {items.filter((it) => !it.done_at).length} to do</>}
          </p>
        </div>
        <div className={s.tools}>
          <label className={s.find}>
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find in titles, sources and notes…"
              spellCheck={false}
            />
            {q && <button type="button" onClick={() => setQ('')} aria-label="Clear"><X size={13} /></button>}
          </label>
          <select className={s.sort} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className={s.views} role="group" aria-label="View">
            <button type="button" className={view === 'shelves' ? s.viewOn : s.view} onClick={() => setView('shelves')} title="Shelves" aria-pressed={view === 'shelves'}>
              <LayoutGrid size={15} />
            </button>
            <button type="button" className={view === 'list' ? s.viewOn : s.view} onClick={() => setView('list')} title="List" aria-pressed={view === 'list'}>
              <List size={15} />
            </button>
          </span>
          <button type="button" className={selecting ? s.selectOn : s.select} onClick={() => (selecting ? endSelect() : setSelecting(true))}>
            {selecting ? 'Done selecting' : 'Select'}
          </button>
          <ExportMenu
            items={selecting && picked.size ? shown.filter((it) => picked.has(it.id)) : shown}
            scope={selecting && picked.size ? 'the ones selected' : `${scopeLabel}${needle ? `, matching “${q.trim()}”` : ''}`}
          />
        </div>
      </header>

      {selecting && (
        <div className={s.selbar} role="toolbar" aria-label="Selected">
          <span><b>{picked.size}</b> selected</span>
          <button type="button" onClick={() => setPicked(allPicked ? new Set() : new Set(shown.map((it) => it.id)))}>
            {allPicked ? 'Select none' : `Select all ${shown.length}`}
          </button>
          <button type="button" disabled={!picked.size} onClick={() => { picked.forEach((id) => updateSaved(id, { done: true })); endSelect(); }}>
            <CheckCheck size={14} /> Mark done
          </button>
          <button type="button" className={s.danger} disabled={!picked.size} onClick={() => { removeSaved([...picked], { undo: true }); endSelect(); }}>
            <Trash2 size={14} /> Remove
          </button>
        </div>
      )}

      <div className={s.layout}>
        <Catalogue items={items} ch={ch} k={k} st={st} setFilter={setFilter} setSt={setSt} />

        <div className={s.content}>
          <p className={s.scope}>
            <b>{scopeLabel}</b>
            {st !== 'all' && <span>{st === 'done' ? 'done' : 'to do'}</span>}
            {needle && <span>“{q.trim()}”</span>}
            <em>{plural(shown.length, 'thing')}</em>
          </p>

          {shown.length === 0 && (
            <p className={s.none}>
              Nothing saved matches that.{' '}
              <button type="button" onClick={() => { setQ(''); setFilter('all', ''); setSt('all'); }}>Show everything</button>
            </p>
          )}

          {view === 'list' ? (
            shown.length > 0 && (
              <ul className={s.lines}>
                {shown.map((it) => (
                  <Line key={it.id} item={it} selecting={selecting} selected={picked.has(it.id)} onToggle={toggle} onOpen={openItem} />
                ))}
              </ul>
            )
          ) : (
            groups.map(([kind, list]) => (
              <section key={kind} className={s.group}>
                <h2 className={s.groupHead} style={{ '--tone': toneOf(list[0]) }}>
                  <KindIcon kind={kind} size={15} />
                  {KINDS[kind].label}
                  <span>{list.length}</span>
                </h2>
                <div className={`${s.shelf} ${s[`shelf_${layoutOf(kind)}`]}`}>
                  {list.map((it, i) => (
                    <Entry key={it.id} item={it} i={i} selecting={selecting} selected={picked.has(it.id)} onToggle={toggle} onOpen={openItem} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
      {modals}
    </div>
  );
}
