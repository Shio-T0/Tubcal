// Settings — an index and one section at a time.
//
// Wide (the desktop): the index sits on the left. It has "Find a setting" and the
// sections in groups, each with a line saying where it's set now. The open section
// fills the right. Narrow (the phone, a narrow window): the index is the page;
// a section opens as its own page, and Back returns to the index (`?s=` pushes
// history). The phone build reuses this file as it is. `__TUBCAL_APP__.phone`
// drops what has no place there (the Composing Room).
//
// Every setting is a Row: label and hint on the left, its control on the right.
// Switches are for on/off, Choices for a few named options, sliders and selects for
// the rest. Rows sit in Groups (a card per topic).

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Check, ChevronLeft, ChevronRight, Copy, ExternalLink, FileText, Minus, Plus, RotateCw, Search, Trash2, X,
} from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { Avatar } from '../components/ui/Avatar.jsx';
import AddSubscriptionModal from '../components/modals/AddSubscriptionModal.jsx';
import { useSettings, useSubscriptions, useToast } from '../state.jsx';
import { THEMES } from '../lib/themes.js';
import { ROOMS, knownActiveIds } from '../lib/rooms.js';
import { latestParams } from '../lib/urlState.js';
import { subtitleStyle, SUBTITLE_FONTS } from '../lib/subtitleStyle.js';
import { SubtitleStyleEditor } from '../components/player/Subtitles.jsx';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from './settingsSections.js';
import s from './settings.module.css';

// Which build this is: the desktop app or the phone one (set by each vite.config).
/* global __TUBCAL_APP__ */
const APP = typeof __TUBCAL_APP__ !== 'undefined'
  ? __TUBCAL_APP__
  : { name: 'Tubcal', year: '2026', author: 'shio-t0', source: 'https://github.com/Shio-T0/Tubcal' };

const SECTION_IDS = SETTINGS_GROUPS.flatMap((g) => g.ids).filter((id) => !(APP.phone && SETTINGS_SECTIONS[id].desktopOnly));

// ── the pieces every section is made of ──────────────────────────────────────

function Group({ title, note, children, actions }) {
  return (
    <section className={s.group}>
      {(title || actions) && (
        <header className={s.groupHead}>
          {title && <h3>{title}</h3>}
          {actions && <span className={s.groupActions}>{actions}</span>}
        </header>
      )}
      {note && <p className={s.groupNote}>{note}</p>}
      <div className={s.groupBody}>{children}</div>
    </section>
  );
}

/** One setting: label + hint on the left, its control on the right (`stack` puts
 *  a wide control underneath). */
function Row({ label, hint, children, stack = false }) {
  return (
    <div className={stack ? `${s.row} ${s.rowStack}` : s.row}>
      <div className={s.rowText}>
        <span className={s.rowLabel}>{label}</span>
        {hint && <span className={s.rowHint}>{hint}</span>}
      </div>
      <div className={s.rowControl}>{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={s.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={s.switchKnob} />
    </button>
  );
}

function Choice({ options, value, onChange, label }) {
  return (
    <div className={s.choice} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        return (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={v === value}
            className={v === value ? s.choiceOn : s.choiceOff}
            onClick={() => onChange(v)}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

function Select({ value, onChange, children, label }) {
  return (
    <select className={s.select} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {children}
    </select>
  );
}

// ── Accounts ─────────────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: 'anilist',
    name: 'AniList',
    unlocks: 'Your anime list, progress sync, reviews and the social pages.',
    setup: 'Create a client at anilist.co/settings/developer and register the redirect URL below.',
  },
  {
    id: 'google',
    name: 'Google · YouTube',
    unlocks: 'Your real YouTube subscriptions feed.',
    setup: 'Create an OAuth client (type: Web application) in Google Cloud Console with the YouTube Data API v3 enabled.',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    unlocks: 'Your home feed, scores and full comment threads.',
    setup: 'Create a “web app” at reddit.com/prefs/apps.',
  },
];

function Connection({ provider, status, onChanged }) {
  const toast = useToast();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [editing, setEditing] = useState(false);
  const connected = status?.connected;
  const configured = status?.configured;
  const redirect = `${window.location.origin}/api/oauth/${provider.id}/callback`;

  const save = async () => {
    try {
      await api(`/oauth/${provider.id}/credentials`, {
        method: 'PUT',
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
      });
      toast(`${provider.name}: credentials saved`, 'success');
      setEditing(false);
      setClientId('');
      setClientSecret('');
      onChanged();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const disconnect = async () => {
    try {
      await api(`/oauth/${provider.id}`, { method: 'DELETE' });
      toast(`${provider.name} disconnected`, 'success');
      onChanged();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirect);
      toast('Redirect URL copied', 'success');
    } catch {
      toast(redirect, 'info');
    }
  };
  const form = editing || !configured;

  return (
    <div className={s.account}>
      <div className={s.accountHead}>
        <span className={connected ? s.dotOn : configured ? s.dotHalf : s.dot} aria-hidden="true" />
        <span className={s.accountText}>
          <b>{provider.name}</b>
          <em>{connected ? 'Connected' : configured ? 'Ready to connect' : 'Not set up'}</em>
        </span>
        <span className={s.accountActs}>
          {configured && !connected && !editing && (
            <a className={s.btnSolid} href={`/api/oauth/${provider.id}/start`}>Connect</a>
          )}
          {configured && !editing && (
            <button type="button" className={s.btnGhost} onClick={() => setEditing(true)}>Credentials</button>
          )}
          {configured && !editing && (
            <button type="button" className={s.btnDanger} onClick={disconnect}>
              {connected ? 'Disconnect' : 'Remove'}
            </button>
          )}
        </span>
      </div>
      <p className={s.accountNote}>{provider.unlocks}</p>
      {form && (
        <div className={s.creds}>
          <p className={s.accountNote}>{provider.setup}</p>
          <div className={s.redirect}>
            <code>{redirect}</code>
            <button type="button" onClick={copy} aria-label="Copy the redirect URL"><Copy size={14} /></button>
          </div>
          <input className={s.input} placeholder="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <input className={s.input} placeholder="Client secret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          <div className={s.credActs}>
            <button type="button" className={s.btnSolid} onClick={save} disabled={!clientId || !clientSecret}>Save credentials</button>
            {editing && <button type="button" className={s.btnGhost} onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountsSection({ oauth }) {
  return (
    <>
      {PROVIDERS.map((p) => (
        <Group key={p.id}>
          <Connection provider={p} status={oauth.data?.[p.id]} onChanged={oauth.reload} />
        </Group>
      ))}
    </>
  );
}

// ── Subscriptions ────────────────────────────────────────────────────────────

const SUB_GROUPS = [
  { platform: 'youtube', label: 'YouTube channels', color: 'var(--c-youtube)' },
  { platform: 'reddit', label: 'Subreddits', color: 'var(--c-reddit)' },
  { platform: 'github', label: 'GitHub repos and users', color: 'var(--c-github)' },
];

function SubscriptionsSection() {
  const { subs, refreshSubs } = useSubscriptions();
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const remove = async (row) => {
    try {
      await api(`/subscriptions/${row.id}`, { method: 'DELETE' });
      toast(`Removed ${row.display_name}`, 'success');
      refreshSubs();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <>
      <div className={s.sectionActs}>
        <button type="button" className={s.btnSolid} onClick={() => setAddOpen(true)}><Plus size={15} /> Add a subscription</button>
      </div>
      {SUB_GROUPS.map((g) => {
        const rows = subs[g.platform] || [];
        return (
          <Group key={g.platform} title={<>{g.label} <span className={s.count}>{rows.length}</span></>}>
            {rows.length === 0 && <p className={s.empty}>None yet.</p>}
            <ul className={s.subs} style={{ '--group-c': g.color }}>
              {rows.map((row) => (
                <li key={row.id}>
                  <Avatar src={row.thumbnail} name={row.display_name} imgClass={s.subFace} letterClass={s.subLetter} />
                  <span className={s.subName}>{row.display_name}</span>
                  <button type="button" className={s.iconBtn} onClick={() => remove(row)} aria-label={`Remove ${row.display_name}`} title="Remove">
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </Group>
        );
      })}
      <AddSubscriptionModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

// ── Watch history ────────────────────────────────────────────────────────────

function HistorySection() {
  const toast = useToast();
  const history = useApi('/history');
  const [sure, setSure] = useState(false);
  const count = history.data?.items.length ?? 0;
  useEffect(() => {
    if (!sure) return undefined;
    const t = setTimeout(() => setSure(false), 4000);
    return () => clearTimeout(t);
  }, [sure]);
  const clear = async () => {
    if (!sure) { setSure(true); return; }
    try {
      await api('/history', { method: 'DELETE' });
      toast('Watch history cleared', 'success');
      setSure(false);
      history.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <Group>
      <Row label="Remembered" hint={history.loading ? 'Counting…' : `${count} video${count === 1 ? '' : 's'} on this machine`}>
        <button type="button" className={s.btnDanger} onClick={clear} disabled={count === 0}>
          <Trash2 size={14} /> {sure ? 'Tap again to clear' : 'Clear history'}
        </button>
      </Row>
    </Group>
  );
}

// ── Appearance ───────────────────────────────────────────────────────────────

function AppearanceSection() {
  const { settings, updateSettings } = useSettings();
  const value = settings?.theme || 'dark';
  return (
    <div className={s.skins} role="radiogroup" aria-label="Skin">
      {THEMES.map((t) => {
        const on = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={on ? s.skinOn : s.skin}
            onClick={() => updateSettings({ theme: t.value })}
          >
            <span className={s.skinPreview} style={{ background: t.swatch[0] }}>
              <i style={{ background: t.swatch[1] }} />
              <i style={{ background: t.swatch[2] }} />
              {on && <Check size={14} className={s.skinCheck} />}
            </span>
            <span className={s.skinName}>{t.label}</span>
            <span className={s.skinBlurb}>{t.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Rooms ────────────────────────────────────────────────────────────────────

function RoomsSection() {
  const { settings, updateSettings } = useSettings();
  const toast = useToast();
  // Retired ids (the old Front Page, The Anime) are ignored so they can't eat the cap.
  const active = knownActiveIds(settings?.active_rooms);
  const max = settings?.max_active_rooms ?? 6;
  const rooms = ROOMS.filter((r) => !(APP.phone && r.id === 'editor'));
  const toggle = (id) => {
    const next = new Set(active);
    if (next.has(id)) next.delete(id);
    else {
      if (next.size >= max) { toast(`The hub holds ${max} rooms — raise the limit first`, 'error'); return; }
      next.add(id);
    }
    updateSettings({ active_rooms: ROOMS.filter((r) => next.has(r.id)).map((r) => r.id) });
  };
  const setMax = (v) => updateSettings({ max_active_rooms: Math.max(1, Math.min(12, v)) });
  let n = 0;
  return (
    <>
      <Group>
        <Row label="Rooms in the hub" hint={`${active.length} of ${max} places taken`}>
          <div className={s.stepper}>
            <button type="button" disabled={max <= 1} onClick={() => setMax(max - 1)} aria-label="Fewer"><Minus size={14} /></button>
            <span>{max}</span>
            <button type="button" disabled={max >= 12} onClick={() => setMax(max + 1)} aria-label="More"><Plus size={14} /></button>
          </div>
        </Row>
      </Group>
      <Group>
        {rooms.map((room) => {
          const on = active.includes(room.id);
          const full = active.length >= max && !on;
          if (on) n += 1;
          return (
            <Row
              key={room.id}
              label={(
                <span className={s.room} style={{ '--room-c': room.color }} data-off={on ? undefined : ''}>
                  <span className={s.roomNo}>{on ? String(n).padStart(2, '0') : '—'}</span>
                  {room.label}
                </span>
              )}
              hint={full ? 'The hub is full' : null}
            >
              <Switch checked={on} onChange={() => (full ? toast(`The hub holds ${max} rooms — raise the limit first`, 'error') : toggle(room.id))} label={room.label} />
            </Row>
          );
        })}
      </Group>
    </>
  );
}

// ── Playback ─────────────────────────────────────────────────────────────────

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

function PlaybackSection() {
  const { settings, updateSettings } = useSettings();
  return (
    <Group>
      <Row label="Sound from" hint="One: only the video you're watching plays sound, the corner players stay muted. All: every player plays sound.">
        <Choice
          label="Sound from"
          options={[{ value: true, label: 'One' }, { value: false, label: 'All' }]}
          value={settings?.solo_audio !== false}
          onChange={(v) => updateSettings({ solo_audio: v })}
        />
      </Row>
      <Row label="Speed" hint="Every video starts at this speed. A player's own menu changes it too.">
        <Choice
          label="Speed"
          options={SPEEDS.map((v) => ({ value: v, label: v === 1 ? 'Normal' : `${v}×` }))}
          value={settings?.playback_rate || 1}
          onChange={(v) => updateSettings({ playback_rate: v })}
        />
      </Row>
    </Group>
  );
}

// ── Anime ────────────────────────────────────────────────────────────────────

const THEME_LENGTHS = [
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '1 min' },
  { value: 0, label: 'Whole song' },
];

function AnimeSection() {
  const { settings, updateSettings } = useSettings();
  const themeOn = settings?.anime_theme_audio !== false;
  const saved = Math.round((settings?.anime_theme_volume ?? 0.35) * 100);
  const [vol, setVol] = useState(saved);
  useEffect(() => setVol(saved), [saved]);
  const commit = () => vol !== saved && updateSettings({ anime_theme_volume: vol / 100 });
  return (
    <>
      <Group title="Episodes">
        <Row label="Audio" hint="Which version plays when an episode has both. The player switches per episode too.">
          <Choice
            label="Audio"
            options={[{ value: 'sub', label: 'Sub' }, { value: 'dub', label: 'Dub' }]}
            value={settings?.anime_sub_pref || 'sub'}
            onChange={(v) => updateSettings({ anime_sub_pref: v })}
          />
        </Row>
        <Row label="Update AniList" hint="Finishing an episode marks it watched on your AniList list.">
          <Switch checked={settings?.anime_autosync !== false} onChange={(v) => updateSettings({ anime_autosync: v })} label="Update AniList" />
        </Row>
        <Row label="Skip openings" hint="Jump past an episode's opening by itself. A button brings it back.">
          <Switch checked={settings?.anime_auto_skip === true} onChange={(v) => updateSettings({ anime_auto_skip: v })} label="Skip openings" />
        </Row>
      </Group>
      <Group title="Opening theme" note="A title's page plays its opening (from AnimeThemes). The song button under the poster plays it any time.">
        <Row label="Play when a title opens">
          <Switch checked={themeOn} onChange={(v) => updateSettings({ anime_theme_audio: v })} label="Play the opening when a title opens" />
        </Row>
        {themeOn && (
          <>
            <Row label="Play for">
              <Choice label="Play for" options={THEME_LENGTHS} value={settings?.anime_theme_seconds ?? 30} onChange={(v) => updateSettings({ anime_theme_seconds: v })} />
            </Row>
            <Row label="Volume">
              <label className={s.slider}>
                <input
                  type="range" min="5" max="100" step="5" value={vol}
                  onChange={(e) => setVol(Number(e.target.value))}
                  onPointerUp={commit} onKeyUp={commit} onBlur={commit}
                  aria-label="Opening theme volume"
                />
                <output>{vol}%</output>
              </label>
            </Row>
          </>
        )}
      </Group>
    </>
  );
}

// ── The Edition ──────────────────────────────────────────────────────────────

function EditionSection() {
  const { settings, updateSettings } = useSettings();
  const toast = useToast();
  const status = useApi('/brain/status');
  const installed = status.data?.models || [];
  const enabled = settings?.edition_enabled !== false;
  const recompose = async () => {
    try {
      await api('/edition/rebuild', { method: 'POST' });
      toast('The presses are running — the paper will recompose shortly.');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <Group>
      <Row label="Daily paper" hint="Compose a new paper each day in the background.">
        <Switch checked={enabled} onChange={(v) => updateSettings({ edition_enabled: v })} label="Daily paper" />
      </Row>
      {enabled && (
        <Row label="Goes to press after" hint="The local hour from which today's paper may be composed.">
          <Select label="Goes to press after" value={settings?.edition_hour ?? 6} onChange={(v) => updateSettings({ edition_hour: Number(v) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </Select>
        </Row>
      )}
      <Row label="Writer" hint={status.data?.ollama ? 'The Ollama model that writes the stories.' : 'Ollama is offline: the paper comes out as a wire edition.'}>
        <Select label="Writer" value={settings?.edition_llm_model || ''} onChange={(v) => updateSettings({ edition_llm_model: v })}>
          <option value="">Same as The Archive</option>
          {installed.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
      </Row>
      <Row label="Recompose" hint="Print a fresh paper from what's out now.">
        <button type="button" className={s.btnGhost} onClick={recompose}><RotateCw size={14} /> Recompose now</button>
      </Row>
    </Group>
  );
}

// ── The Archive ──────────────────────────────────────────────────────────────

function ModelRow({ label, value, installed, onChange }) {
  const ok = installed.some((m) => m === value || m === `${value}:latest` || m.split(':')[0] === value.split(':')[0]);
  return (
    <Row label={label} hint={ok ? 'Installed' : <>Not pulled yet: run <code>ollama pull {value}</code></>}>
      <Select label={label} value={value} onChange={onChange}>
        {[value, ...installed.filter((m) => m !== value)].map((m) => <option key={m} value={m}>{m}</option>)}
      </Select>
    </Row>
  );
}

function ArchiveSection() {
  const { settings, updateSettings } = useSettings();
  const status = useApi('/brain/status');
  const b = status.data;
  const installed = b?.models || [];
  const queued = b?.queue ? (b.queue.queued || 0) + (b.queue.transcribing || 0) : 0;
  return (
    <>
      {b && (
        <div className={s.status}>
          <span className={b.whisper ? s.statusOn : s.statusOff}>{b.whisper ? 'Transcription ready' : 'Transcription not installed'}</span>
          <span className={b.ollama ? s.statusOn : s.statusOff}>{b.ollama ? `Ollama online · ${installed.length} models` : 'Ollama offline'}</span>
          {queued > 0 && <span className={s.statusOn}>{queued} in the queue</span>}
        </div>
      )}
      <Group>
        <Row label="Archive" hint="Run the background transcription worker.">
          <Switch checked={settings?.brain_enabled !== false} onChange={(v) => updateSettings({ brain_enabled: v })} label="Archive" />
        </Row>
        <Row label="What gets archived" hint="Only what you add, or every video you watch.">
          <Choice
            label="What gets archived"
            options={[{ value: false, label: 'What I add' }, { value: true, label: 'Everything' }]}
            value={!!settings?.brain_auto_index}
            onChange={(v) => updateSettings({ brain_auto_index: v })}
          />
        </Row>
        <Row label="Transcription quality" hint="Larger is more accurate, and slower. Uses the GPU when there is one.">
          <Choice
            label="Transcription quality"
            options={['tiny', 'base', 'small', 'medium'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))}
            value={settings?.brain_whisper_model || 'base'}
            onChange={(v) => updateSettings({ brain_whisper_model: v })}
          />
        </Row>
      </Group>
      <Group title="Models">
        <ModelRow label="Summaries and answers" value={settings?.brain_llm_model || 'qwen3.5:9b'} installed={installed} onChange={(v) => updateSettings({ brain_llm_model: v })} />
        <ModelRow label="Search" value={settings?.brain_embed_model || 'nomic-embed-text'} installed={installed} onChange={(v) => updateSettings({ brain_embed_model: v })} />
      </Group>
    </>
  );
}

// ── The Composing Room ───────────────────────────────────────────────────────

function EditorSection() {
  const { settings, updateSettings } = useSettings();
  const editorStatus = useApi('/editor/status');
  const root = editorStatus.data?.root;
  return (
    <>
      {root && (
        <p className={s.sectionNote}>
          Workspace: <code>{root}</code>. Change it with <code>TUBCAL_EDITOR_ROOT</code> in .env.
        </p>
      )}
      <Group>
        <Row label="Language servers" hint="Attach pyright, tsserver, rust-analyzer or clangd when they're installed.">
          <Switch checked={settings?.editor_lsp_enabled !== false} onChange={(v) => updateSettings({ editor_lsp_enabled: v })} label="Language servers" />
        </Row>
        <Row label="Autosave" hint="Write files shortly after you stop typing, not only on :w.">
          <Switch checked={!!settings?.editor_autosave} onChange={(v) => updateSettings({ editor_autosave: v })} label="Autosave" />
        </Row>
        <Row label="Line numbers" hint="Relative numbers make vim counts easy to read (the current line stays absolute).">
          <Choice
            label="Line numbers"
            options={[{ value: false, label: 'Absolute' }, { value: true, label: 'Relative' }]}
            value={!!settings?.editor_relative_lines}
            onChange={(v) => updateSettings({ editor_relative_lines: v })}
          />
        </Row>
        <Row label="Leader key" hint="The which-key menu opens on this key in normal mode.">
          <Choice
            label="Leader key"
            options={[{ value: ' ', label: 'Space' }, { value: ',', label: ',' }, { value: '\\', label: '\\' }]}
            value={settings?.editor_leader ?? ' '}
            onChange={(v) => updateSettings({ editor_leader: v })}
          />
        </Row>
      </Group>
    </>
  );
}

// ── About ────────────────────────────────────────────────────────────────────

const LEGAL = [
  { path: '/legal/LICENSE.txt', label: 'Licence', note: 'GNU GPL v3' },
  { path: '/legal/THIRD_PARTY_NOTICES.md', label: 'Notices', note: 'ani-cli, anipy-api, weeb-cli…' },
  { path: '/legal/third-party-licenses.txt', label: 'Bundled libraries', note: 'Every package in this build' },
  ...(APP.legal || []),
];

/** One of the legal texts, read in place. */
function LegalViewer({ doc, onClose }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(doc.path)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then((t) => alive && setText(t))
      .catch(() => alive && setText('This text is part of a full build (npm run build) and was not found here.'));
    return () => { alive = false; };
  }, [doc.path]);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className={s.legalScrim} onMouseDown={onClose}>
      <div className={s.legalSheet} role="dialog" aria-label={doc.label} onMouseDown={(e) => e.stopPropagation()}>
        <div className={s.legalHead}>
          <b>{doc.label}</b>
          <a href={doc.path} target="_blank" rel="noreferrer" title="Open as a file"><ExternalLink size={15} /></a>
          <button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <pre className={s.legalText}>{text ?? 'Loading…'}</pre>
      </div>
    </div>
  );
}

/** The program's notices (GPL-3.0 §5d asks an interactive program to show them):
 *  copyright, the licence and the absence of warranty, where the source is, and
 *  what it builds on. */
function AboutSection() {
  const [doc, setDoc] = useState(null);
  return (
    <>
      <Group>
        <div className={s.about}>
          <p className={s.aboutName}>{APP.name}</p>
          <p>Copyright © {APP.year} {APP.author}</p>
          <p>
            This program is free software: you can redistribute it and/or modify it under the terms of
            the GNU General Public License as published by the Free Software Foundation, either version
            3 of the License, or (at your option) any later version. It comes with <b>absolutely no
            warranty</b>; see the licence for details.
          </p>
          <p>
            Anime playback follows ani-cli's method and uses anipy-api and weeb-cli, all GPL-3.0. The
            notices credit them, and the bundled-libraries list carries the licence of every package in
            this build.
          </p>
        </div>
      </Group>
      <div className={s.legalLinks}>
        {LEGAL.map((d) => (
          <button key={d.path} type="button" className={s.legalLink} onClick={() => setDoc(d)}>
            <FileText size={16} />
            <span><b>{d.label}</b><em>{d.note}</em></span>
            <ChevronRight size={16} className={s.legalChevron} />
          </button>
        ))}
        <a className={s.legalLink} href={APP.source} target="_blank" rel="noreferrer">
          <ExternalLink size={16} />
          <span><b>Source code</b><em>{APP.source.replace(/^https?:\/\//, '')}</em></span>
          <ChevronRight size={16} className={s.legalChevron} />
        </a>
      </div>
      {doc && <LegalViewer doc={doc} onClose={() => setDoc(null)} />}
    </>
  );
}

// ── the index ────────────────────────────────────────────────────────────────

/** Each section's line in the index: where it's set right now. */
function useSummaries(oauth) {
  const { settings } = useSettings();
  const { subs } = useSubscriptions();
  return useMemo(() => {
    const st = settings || {};
    const linked = PROVIDERS.filter((p) => oauth.data?.[p.id]?.connected).map((p) => p.name.split(' ')[0]);
    const nSubs = Object.values(subs || {}).reduce((n, l) => n + (l?.length || 0), 0);
    const sub = subtitleStyle(st.subtitle_style);
    const active = knownActiveIds(st.active_rooms);
    return {
      accounts: linked.length ? `${linked.join(', ')} connected` : 'None connected',
      subscriptions: `${nSubs} followed`,
      history: 'Kept on this machine',
      appearance: THEMES.find((t) => t.value === (st.theme || 'dark'))?.label || st.theme,
      rooms: `${active.length} of ${st.max_active_rooms ?? 6} in the hub`,
      playback: `${st.solo_audio === false ? 'Sound from all' : 'Sound from one'} · ${(st.playback_rate || 1) === 1 ? 'normal speed' : `${st.playback_rate}×`}`,
      subtitles: sub.show
        ? `${SUBTITLE_FONTS.find((f) => f.value === sub.font)?.label} · ${Math.round(sub.size * 100)}%`
        : 'Off when a video starts',
      anime: `${st.anime_sub_pref === 'dub' ? 'Dub' : 'Sub'} · ${st.anime_autosync !== false ? 'AniList synced' : 'not synced'}`,
      edition: st.edition_enabled !== false ? `Daily after ${String(st.edition_hour ?? 6).padStart(2, '0')}:00` : 'Off',
      archive: st.brain_enabled !== false ? (st.brain_auto_index ? 'On · everything' : 'On · what you add') : 'Off',
      editor: `${st.editor_lsp_enabled !== false ? 'LSP on' : 'LSP off'} · ${st.editor_autosave ? 'autosave' : 'save on :w'}`,
      about: 'GPL-3.0 · licences',
    };
  }, [settings, subs, oauth.data]);
}

function useNarrow() {
  const q = '(max-width: 820px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setNarrow(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return narrow;
}

const BODIES = {
  accounts: AccountsSection,
  subscriptions: SubscriptionsSection,
  history: HistorySection,
  appearance: AppearanceSection,
  rooms: RoomsSection,
  playback: PlaybackSection,
  subtitles: () => <SubtitleStyleEditor sample className={s.subtitleEditor} />,
  anime: AnimeSection,
  edition: EditionSection,
  archive: ArchiveSection,
  editor: EditorSection,
  about: AboutSection,
};

export default function SettingsPage() {
  const toast = useToast();
  const oauth = useApi('/oauth/status');
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const narrow = useNarrow();
  const summaries = useSummaries(oauth);

  // Coming back from an OAuth sign-in: say how it went, and land on Accounts.
  useEffect(() => {
    const connected = params.get('connected');
    const oauthError = params.get('oauth_error');
    if (!connected && !oauthError) return;
    if (connected) toast(`${connected} connected`, 'success');
    if (oauthError) toast(`Sign-in failed: ${oauthError}`, 'error');
    const next = latestParams();
    next.delete('connected');
    next.delete('oauth_error');
    next.set('s', 'accounts');
    setParams(next, { replace: true });
  }, [params, setParams, toast]);

  const asked = params.get('s');
  const open = SECTION_IDS.includes(asked) ? asked : narrow ? null : SECTION_IDS[0];
  // A section is a destination: picking one pushes, so Back returns to the index.
  const go = (id) => {
    const next = latestParams();
    if (id) next.set('s', id); else next.delete('s');
    setParams(next);
    setQ('');
    window.scrollTo?.({ top: 0 });
  };

  const needle = q.trim().toLowerCase();
  const matches = (id) => {
    if (!needle) return true;
    const sec = SETTINGS_SECTIONS[id];
    return `${sec.title} ${sec.blurb} ${sec.find}`.toLowerCase().includes(needle);
  };
  const groups = SETTINGS_GROUPS
    .map((g) => ({ ...g, ids: g.ids.filter((id) => SECTION_IDS.includes(id) && matches(id)) }))
    .filter((g) => g.ids.length);

  const index = (
    <nav className={s.index} aria-label="Settings">
      {!narrow && <h1 className={s.indexTitle}>Settings</h1>}
      <label className={s.find}>
        <Search size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a setting" spellCheck={false} />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Clear"><X size={14} /></button>}
      </label>
      {groups.length === 0 && <p className={s.empty}>Nothing matches “{q}”.</p>}
      {groups.map((g) => (
        <div key={g.ids[0]} className={s.indexGroup}>
          {g.title && <span className={s.indexGroupTitle}>{g.title}</span>}
          {g.ids.map((id) => {
            const sec = SETTINGS_SECTIONS[id];
            const Icon = sec.icon;
            return (
              <button
                key={id}
                type="button"
                className={id === open ? s.indexItemOn : s.indexItem}
                aria-current={id === open ? 'page' : undefined}
                onClick={() => go(id)}
              >
                <span className={s.indexIcon}><Icon size={16} /></span>
                <span className={s.indexText}>
                  <b>{sec.title}</b>
                  <em>{summaries[id]}</em>
                </span>
                {narrow && <ChevronRight size={18} className={s.indexChevron} />}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const sec = open ? SETTINGS_SECTIONS[open] : null;
  const Body = open ? BODIES[open] : null;
  const panel = sec && (
    <main className={s.panel} key={open}>
      {/* the phone's own app bar already names the section and goes back */}
      {narrow && !APP.phone && (
        <button type="button" className={s.back} onClick={() => go(null)}>
          <ChevronLeft size={18} /> All settings
        </button>
      )}
      <header className={s.panelHead}>
        {!APP.phone && <h2>{sec.title}</h2>}
        <p>{sec.blurb}</p>
      </header>
      <Body oauth={oauth} />
    </main>
  );

  return (
    <div className={s.shell} data-narrow={narrow || undefined}>
      {(!narrow || !open) && index}
      {panel}
    </div>
  );
}
