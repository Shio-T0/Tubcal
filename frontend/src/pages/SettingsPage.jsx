import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Captions, Code2, ExternalLink, FileText, KeyRound, Library, Minus, Newspaper, Palette, Plus, Scale, Settings, Trash2, Rss, Tv, Volume2, Layout, X } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { SectionHead } from '../components/layout/Section.jsx';
import { Avatar } from '../components/ui/Avatar.jsx';
import AddSubscriptionModal from '../components/modals/AddSubscriptionModal.jsx';
import { Button, SegmentedControl } from '../components/ui/index.jsx';
import { useSettings, useSubscriptions, useToast } from '../state.jsx';
import { THEMES } from '../lib/themes.js';
import { ROOMS, knownActiveIds } from '../lib/rooms.js';
import { SubtitleStyleEditor } from '../components/player/Subtitles.jsx';
import s from './settings.module.css';

function SkinPicker({ value, onChange }) {
  return (
    <div className={s.skinGrid} role="radiogroup" aria-label="Skin">
      {THEMES.map((t) => {
        const on = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={`${s.skinCard} ${on ? s.skinCardOn : ''}`}
            onClick={() => onChange(t.value)}
          >
            <span className={s.skinSwatch}>
              {t.swatch.map((c, i) => (
                <span key={i} className={s.skinDot} style={{ background: c }} />
              ))}
            </span>
            <span className={s.skinName}>{t.label}</span>
            <span className={s.skinBlurb}>{t.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}

const GROUPS = [
  { platform: 'youtube', label: 'YouTube channels', color: 'var(--c-youtube)' },
  { platform: 'reddit', label: 'Subreddits', color: 'var(--c-reddit)' },
  { platform: 'github', label: 'GitHub repos/users', color: 'var(--c-github)' },
];

const PROVIDERS = [
  {
    id: 'google',
    name: 'Google / YouTube',
    hint: 'Create an OAuth client (type: Web application) in Google Cloud Console with the YouTube Data API v3 enabled. Unlocks your real subscriptions feed.',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    hint: 'Create a "web app" at reddit.com/prefs/apps. Unlocks your home feed, scores, and full comment threads.',
  },
  {
    id: 'anilist',
    name: 'AniList',
    hint: 'Create a client at anilist.co/settings/developer (set the redirect URL below). Unlocks your anime list, progress sync, recommendations, and discussions in The Anime.',
  },
];

function SubscriptionRows({ group }) {
  const { subs, refreshSubs } = useSubscriptions();
  const toast = useToast();
  const rows = subs[group.platform];

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
    <div style={{ '--group-c': group.color }}>
      <div className={s.groupLabel}>{group.label}</div>
      {rows.length === 0 && <div className={s.rowHint} style={{ padding: '8px 0' }}>None yet.</div>}
      {rows.map((row) => (
        <div key={row.id} className={s.subRow}>
          <Avatar
            src={row.thumbnail}
            name={row.display_name}
            imgClass={s.subRowAvatar}
            letterClass={s.subRowAvatarLetter}
          />
          <span className={s.subRowName}>{row.display_name}</span>
          <button className={s.removeBtn} onClick={() => remove(row)} title="Remove">
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Connection({ provider, status, onChanged }) {
  const toast = useToast();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [editing, setEditing] = useState(false);
  const connected = status?.connected;
  const configured = status?.configured;

  const save = async () => {
    try {
      const res = await api(`/oauth/${provider.id}/credentials`, {
        method: 'PUT',
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
      });
      toast(`Saved. Redirect URI: ${res.redirect_uri}`, 'success');
      setEditing(false);
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

  return (
    <div className={s.connection}>
      <div className={s.connectionHead}>
        <span className={`${s.statusDot} ${connected ? s.statusDotOn : ''}`} />
        <span className={s.connectionName}>{provider.name}</span>
        <span className={s.rowHint}>
          {connected ? 'connected' : configured ? 'credentials saved' : 'not configured'}
        </span>
      </div>
      <p className={s.credHint}>{provider.hint}</p>
      {(editing || !configured) && (
        <>
          <input
            className={s.credInput}
            placeholder="client_id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <input
            className={s.credInput}
            placeholder="client_secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
          <p className={s.credHint}>
            Redirect URI to register with the provider:{' '}
            <code>http://127.0.0.1:5000/api/oauth/{provider.id}/callback</code>
          </p>
        </>
      )}
      <div className={s.connectionActions}>
        {(editing || !configured) && (
          <Button onClick={save} disabled={!clientId || !clientSecret}>
            Save credentials
          </Button>
        )}
        {configured && !editing && (
          <>
            {!connected && (
              <Button onClick={() => (window.location.href = `/api/oauth/${provider.id}/start`)}>
                Connect
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit credentials
            </Button>
            <Button variant="danger" onClick={disconnect}>
              {connected ? 'Disconnect' : 'Remove'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function HistoryRow() {
  const toast = useToast();
  const history = useApi('/history');
  const count = history.data?.items.length ?? 0;

  const clear = async () => {
    try {
      await api('/history', { method: 'DELETE' });
      toast('Watch history cleared', 'success');
      history.reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className={s.row}>
      <span className={s.rowHint}>
        {count} item{count === 1 ? '' : 's'} remembered
      </span>
      <Button variant="danger" onClick={clear} disabled={count === 0}>
        Clear history
      </Button>
    </div>
  );
}

function ModelLine({ label, value, installed, onChange, pullHint }) {
  const ok = installed.some((m) => m === value || m === `${value}:latest` || m.split(':')[0] === value.split(':')[0]);
  return (
    <div className={s.row}>
      <div>
        <div className={s.rowLabel}>{label}</div>
        <div className={s.rowHint}>
          {ok ? 'installed' : <>not pulled — run <code>ollama pull {value}</code></>}
        </div>
      </div>
      <select className={s.select} value={value} onChange={(e) => onChange(e.target.value)}>
        {[value, ...installed.filter((m) => m !== value)].map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  );
}

function EditionSettings() {
  const { settings, updateSettings } = useSettings();
  const toast = useToast();
  const status = useApi('/brain/status');
  const installed = status.data?.models || [];
  const enabled = settings?.edition_enabled !== false;
  const hour = settings?.edition_hour ?? 6;

  const recompose = async () => {
    try {
      await api('/edition/rebuild', { method: 'POST' });
      toast('The presses are running — the paper will recompose shortly.');
    } catch (e) {
      toast(e.message);
    }
  };

  return (
    <section className={`${s.section} glass`}>
      <h2 className={s.sectionTitle}>
        <Newspaper size={17} /> The Edition
      </h2>
      <p className={s.sectionSub}>
        A daily paper composed from everything you follow — the same story found across
        YouTube, Reddit, and Hacker News, clustered and written up on this machine. Works
        without any AI installed (wire edition); Ollama upgrades it to synthesized prose.
      </p>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Daily paper</div>
          <div className={s.rowHint}>Turn the background composer on or off.</div>
        </div>
        <SegmentedControl
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          value={enabled ? 'on' : 'off'}
          onChange={(v) => updateSettings({ edition_enabled: v === 'on' })}
        />
      </div>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Composed after</div>
          <div className={s.rowHint}>
            The local hour from which today&rsquo;s paper may go to press.
          </div>
        </div>
        <select
          className={s.select}
          value={hour}
          onChange={(e) => updateSettings({ edition_hour: Number(e.target.value) })}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
          ))}
        </select>
      </div>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Writer model</div>
          <div className={s.rowHint}>The Ollama model that writes the stories.</div>
        </div>
        <select
          className={s.select}
          value={settings?.edition_llm_model || ''}
          onChange={(e) => updateSettings({ edition_llm_model: e.target.value })}
        >
          <option value="">Same as The Archive</option>
          {installed.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Presses</div>
          <div className={s.rowHint}>Force a fresh paper from the current signals.</div>
        </div>
        <Button onClick={recompose}>Recompose now</Button>
      </div>
    </section>
  );
}

function ArchiveSettings() {
  const { settings, updateSettings } = useSettings();
  const status = useApi('/brain/status');
  const b = status.data;
  const installed = b?.models || [];
  const enabled = settings?.brain_enabled !== false;

  return (
    <section className={`${s.section} glass`}>
      <h2 className={s.sectionTitle}>
        <Library size={17} /> The Archive
      </h2>
      <p className={s.sectionSub}>
        Transcribe the videos you watch into a private, searchable memory with on-device AI
        summaries. Everything stays on this machine.
      </p>

      {b && (
        <p className={s.rowHint} style={{ marginTop: -4 }}>
          {b.whisper ? 'Transcription engine ready' : 'Transcription engine not installed'} ·{' '}
          {b.ollama ? `Ollama online (${installed.length} models)` : 'Ollama offline'}
          {b.queue && (b.queue.queued || b.queue.transcribing)
            ? ` · ${(b.queue.queued || 0) + (b.queue.transcribing || 0)} in queue`
            : ''}
        </p>
      )}

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Archive</div>
          <div className={s.rowHint}>Turn the background transcription worker on or off.</div>
        </div>
        <SegmentedControl
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          value={enabled ? 'on' : 'off'}
          onChange={(v) => updateSettings({ brain_enabled: v === 'on' })}
        />
      </div>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Indexing</div>
          <div className={s.rowHint}>
            Manual adds only what you choose; Auto indexes every video you watch.
          </div>
        </div>
        <SegmentedControl
          options={[{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' }]}
          value={settings?.brain_auto_index ? 'auto' : 'manual'}
          onChange={(v) => updateSettings({ brain_auto_index: v === 'auto' })}
        />
      </div>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Transcription quality</div>
          <div className={s.rowHint}>Larger is more accurate but slower. GPU-accelerated.</div>
        </div>
        <SegmentedControl
          options={['tiny', 'base', 'small', 'medium']}
          value={settings?.brain_whisper_model || 'base'}
          onChange={(v) => updateSettings({ brain_whisper_model: v })}
        />
      </div>

      <ModelLine
        label="LLM (summaries & answers)"
        value={settings?.brain_llm_model || 'qwen3.5:9b'}
        installed={installed}
        onChange={(v) => updateSettings({ brain_llm_model: v })}
      />
      <ModelLine
        label="Embedding model (search)"
        value={settings?.brain_embed_model || 'nomic-embed-text'}
        installed={installed}
        onChange={(v) => updateSettings({ brain_embed_model: v })}
      />
    </section>
  );
}

function AnimeSettings() {
  const { settings, updateSettings } = useSettings();
  const [url, setUrl] = useState('');
  const [provider, setProvider] = useState('');
  useEffect(() => {
    if (settings) {
      setUrl(settings.anime_source_url || '');
      setProvider(settings.anime_provider || '');
    }
  }, [settings?.anime_source_url, settings?.anime_provider]);

  return (
    <section className={`${s.section} glass`}>
      <h2 className={s.sectionTitle}>
        <Tv size={17} /> The Anime
      </h2>
      <p className={s.sectionSub}>
        Connect AniList above to sync your list. To watch locally, run an AniList-id-mapped
        episode aggregator on this machine and point Tubcal at it. Nothing leaves localhost.
      </p>

      <div>
        <div className={s.rowLabel} style={{ marginBottom: 4 }}>Episode source URL</div>
        <div className={s.rowHint} style={{ marginBottom: 8 }}>
          The base URL of your local aggregator (e.g. <code>http://127.0.0.1:3000</code>). Blank uses the default.
        </div>
        <input
          className={s.credInput}
          placeholder="http://127.0.0.1:3000"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url !== (settings?.anime_source_url || '') && updateSettings({ anime_source_url: url.trim() })}
        />
      </div>

      <div>
        <div className={s.rowLabel} style={{ marginBottom: 4 }}>Provider hint (optional)</div>
        <div className={s.rowHint} style={{ marginBottom: 8 }}>
          Adapter-specific source, if yours needs one (e.g. <code>zoro</code>, <code>gogoanime</code>).
        </div>
        <input
          className={s.credInput}
          placeholder="(default)"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          onBlur={() => provider !== (settings?.anime_provider || '') && updateSettings({ anime_provider: provider.trim() })}
        />
      </div>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Prefer</div>
          <div className={s.rowHint}>Subbed or dubbed episodes when both exist.</div>
        </div>
        <SegmentedControl
          options={[{ value: 'sub', label: 'Sub' }, { value: 'dub', label: 'Dub' }]}
          value={settings?.anime_sub_pref || 'sub'}
          onChange={(v) => updateSettings({ anime_sub_pref: v })}
        />
      </div>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Sync progress to AniList</div>
          <div className={s.rowHint}>Finishing an episode bumps your AniList progress automatically.</div>
        </div>
        <SegmentedControl
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          value={settings?.anime_autosync !== false ? 'on' : 'off'}
          onChange={(v) => updateSettings({ anime_autosync: v === 'on' })}
        />
      </div>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Skip openings</div>
          <div className={s.rowHint}>Jump past an episode's opening by itself. A button brings it back.</div>
        </div>
        <SegmentedControl
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          value={settings?.anime_auto_skip === true ? 'on' : 'off'}
          onChange={(v) => updateSettings({ anime_auto_skip: v === 'on' })}
        />
      </div>

      <ThemeAudioSettings />
    </section>
  );
}

const THEME_LENGTHS = [
  { value: '15', label: '15s' },
  { value: '30', label: '30s' },
  { value: '60', label: '1 min' },
  { value: '0', label: 'Whole song' },
];

/** The title page's opening theme: whether it plays, for how long, how loud. */
function ThemeAudioSettings() {
  const { settings, updateSettings } = useSettings();
  const on = settings?.anime_theme_audio !== false;
  const saved = Math.round((settings?.anime_theme_volume ?? 0.35) * 100);
  const [vol, setVol] = useState(saved);
  useEffect(() => setVol(saved), [saved]);
  const commit = () => vol !== saved && updateSettings({ anime_theme_volume: vol / 100 });

  return (
    <>
      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Opening theme</div>
          <div className={s.rowHint}>
            Play a show's opening when its page opens. The song button under the poster plays it any time.
          </div>
        </div>
        <SegmentedControl
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          value={on ? 'on' : 'off'}
          onChange={(v) => updateSettings({ anime_theme_audio: v === 'on' })}
        />
      </div>
      {on && (
        <>
          <div className={s.row}>
            <div>
              <div className={s.rowLabel}>Play for</div>
              <div className={s.rowHint}>How much of the opening plays before it fades.</div>
            </div>
            <SegmentedControl
              options={THEME_LENGTHS}
              value={String(settings?.anime_theme_seconds ?? 30)}
              onChange={(v) => updateSettings({ anime_theme_seconds: Number(v) })}
            />
          </div>
          <div className={s.row}>
            <div>
              <div className={s.rowLabel}>Volume</div>
              <div className={s.rowHint}>How loud the opening plays.</div>
            </div>
            <label className={s.rangeField}>
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                value={vol}
                onChange={(e) => setVol(Number(e.target.value))}
                onPointerUp={commit}
                onKeyUp={commit}
                onBlur={commit}
                aria-label="Opening theme volume"
              />
              <span>{vol}%</span>
            </label>
          </div>
        </>
      )}
    </>
  );
}

function SubtitleSettings() {
  return (
    <section className={`${s.section} glass`} id="subtitles">
      <h2 className={s.sectionTitle}>
        <Captions size={17} /> Subtitles
      </h2>
      <p className={s.sectionSub}>
        How subtitles look in every player, here and on the phone. A player's subtitle menu has the
        same controls, with the episode as the sample.
      </p>
      <SubtitleStyleEditor sample />
    </section>
  );
}

// Which build this is: the desktop app or the phone one (set by each vite.config).
/* global __TUBCAL_APP__ */
const APP = typeof __TUBCAL_APP__ !== 'undefined'
  ? __TUBCAL_APP__
  : { name: 'Tubcal', year: '2026', author: 'shio-t0', source: 'https://github.com/Shio-T0/Tubcal' };

const LEGAL = [
  { path: '/legal/LICENSE.txt', label: 'Licence', note: 'GNU GPL v3' },
  { path: '/legal/THIRD_PARTY_NOTICES.md', label: 'Notices', note: 'ani-cli, anipy-api, weeb-cli…' },
  { path: '/legal/third-party-licenses.txt', label: 'Bundled libraries', note: 'every package in this build' },
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
function AboutSettings() {
  const [doc, setDoc] = useState(null);
  return (
    <section className={`${s.section} glass`} id="about">
      <h2 className={s.sectionTitle}>
        <Scale size={17} /> About
      </h2>
      <div className={s.about}>
        <p>
          <b>{APP.name}</b> · Copyright © {APP.year} {APP.author}
        </p>
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
      <div className={s.legalLinks}>
        {LEGAL.map((d) => (
          <button key={d.path} type="button" className={s.legalLink} onClick={() => setDoc(d)}>
            <FileText size={15} />
            <span><b>{d.label}</b><em>{d.note}</em></span>
          </button>
        ))}
        <a className={s.legalLink} href={APP.source} target="_blank" rel="noreferrer">
          <ExternalLink size={15} />
          <span><b>Source code</b><em>{APP.source.replace(/^https?:\/\//, '')}</em></span>
        </a>
      </div>
      {doc && <LegalViewer doc={doc} onClose={() => setDoc(null)} />}
    </section>
  );
}

function EditorSettings() {
  const { settings, updateSettings } = useSettings();
  const editorStatus = useApi('/editor/status');
  const root = editorStatus.data?.root;

  return (
    <section className={`${s.section} glass`}>
      <h2 className={s.sectionTitle}>
        <Code2 size={17} /> The Composing Room
      </h2>
      <p className={s.sectionSub}>
        The code editor over your local workspace{root ? <> (<code>{root}</code>)</> : null}.
        Change the root with <code>TUBCAL_EDITOR_ROOT</code> in .env. Nothing leaves this machine.
      </p>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Language servers</div>
          <div className={s.rowHint}>
            Attach pyright / tsserver / rust-analyzer / clangd when they exist on PATH.
            Off keeps the in-editor smarts only.
          </div>
        </div>
        <SegmentedControl
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          value={settings?.editor_lsp_enabled !== false ? 'on' : 'off'}
          onChange={(v) => updateSettings({ editor_lsp_enabled: v === 'on' })}
        />
      </div>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Autosave</div>
          <div className={s.rowHint}>Write buffers shortly after you stop typing, instead of only on :w.</div>
        </div>
        <SegmentedControl
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          value={settings?.editor_autosave ? 'on' : 'off'}
          onChange={(v) => updateSettings({ editor_autosave: v === 'on' })}
        />
      </div>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Line numbers</div>
          <div className={s.rowHint}>Relative numbers make vim counts legible (current line stays absolute).</div>
        </div>
        <SegmentedControl
          options={[{ value: 'abs', label: 'Absolute' }, { value: 'rel', label: 'Relative' }]}
          value={settings?.editor_relative_lines ? 'rel' : 'abs'}
          onChange={(v) => updateSettings({ editor_relative_lines: v === 'rel' })}
        />
      </div>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Leader key</div>
          <div className={s.rowHint}>The which-key menu opens on this key in normal mode.</div>
        </div>
        <SegmentedControl
          options={[{ value: ' ', label: 'Space' }, { value: ',', label: ',' }, { value: '\\', label: '\\' }]}
          value={settings?.editor_leader ?? ' '}
          onChange={(v) => updateSettings({ editor_leader: v })}
        />
      </div>
    </section>
  );
}

function RoomsSettings() {
  const { settings, updateSettings } = useSettings();
  const toast = useToast();

  // Retired ids (the old Front Page, The Anime) are ignored so they can't eat the cap.
  const activeRoomIds = knownActiveIds(settings?.active_rooms);
  const maxActive = settings?.max_active_rooms ?? 6;

  const toggleRoom = (roomId) => {
    const current = new Set(activeRoomIds);
    if (current.has(roomId)) {
      current.delete(roomId);
    } else {
      if (current.size >= maxActive) {
        toast(`Maximum ${maxActive} rooms active`, 'error');
        return;
      }
      current.add(roomId);
    }
    // Preserve the original order from ROOMS registry
    const ordered = ROOMS.filter((r) => current.has(r.id)).map((r) => r.id);
    updateSettings({ active_rooms: ordered });
  };

  const setMaxRooms = (val) => {
    const clamped = Math.max(1, Math.min(12, val));
    updateSettings({ max_active_rooms: clamped });
  };

  const activeCount = activeRoomIds.length;

  return (
    <section className={`${s.section} glass`}>
      <h2 className={s.sectionTitle}>
        <Layout size={17} /> Rooms
      </h2>
      <p className={s.sectionSub}>
        Choose which rooms appear in the hub's masthead (and on the home screen's Hub card). Disabled rooms are still accessible via direct URL. The Anime lives beside the hub, not in it.
      </p>

      <div className={s.row}>
        <div>
          <div className={s.rowLabel}>Max active rooms</div>
          <div className={s.rowHint}>How many rooms can be shown at once (1–12).</div>
        </div>
        <div className={s.stepper}>
          <button className={s.stepperBtn} disabled={maxActive <= 1} onClick={() => setMaxRooms(maxActive - 1)}>
            <Minus size={13} />
          </button>
          <span className={s.stepperValue}>{maxActive}</span>
          <button className={s.stepperBtn} disabled={maxActive >= 12} onClick={() => setMaxRooms(maxActive + 1)}>
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className={s.rowHint} style={{ marginBottom: 8 }}>
        {activeCount}/{maxActive} rooms active
      </div>

      {ROOMS.map((room) => {
        const enabled = activeRoomIds.includes(room.id);
        const atCap = activeCount >= maxActive && !enabled;
        return (
          <div key={room.id} className={s.subRow}>
            <span
              className={s.subRowAvatarLetter}
              style={{ '--group-c': room.color, opacity: enabled ? 1 : 0.4 }}
            >
              {room.label.charAt(0)}
            </span>
            <span className={s.subRowName} style={{ opacity: enabled ? 1 : 0.5 }}>
              {room.label}
            </span>
            <button
              className={`${s.stepperBtn} ${enabled ? s.skinCardOn : ''}`}
              style={{
                width: 36,
                height: 28,
                opacity: atCap ? 0.35 : 1,
                cursor: atCap ? 'not-allowed' : 'pointer',
              }}
              disabled={atCap}
              onClick={() => toggleRoom(room.id)}
              title={enabled ? 'Disable room' : atCap ? `Max ${maxActive} rooms` : 'Enable room'}
            >
              {enabled ? 'ON' : 'OFF'}
            </button>
          </div>
        );
      })}
    </section>
  );
}

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const toast = useToast();
  const oauth = useApi('/oauth/status');
  const [addOpen, setAddOpen] = useState(false);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    const connected = params.get('connected');
    const oauthError = params.get('oauth_error');
    if (connected) toast(`${connected} connected successfully`, 'success');
    if (oauthError) toast(`OAuth failed: ${oauthError}`, 'error');
    if (connected || oauthError) setParams({}, { replace: true });
  }, [params, setParams, toast]);

  return (
    <>
      <SectionHead
        kicker="Back office"
        title="Station settings"
        note="Subscriptions, the edition's look, and optional account connections."
        color="var(--signal)"
      />

      <div className={s.sections}>
        <section className={`${s.section} glass`}>
          <h2 className={s.sectionTitle}>
            <Rss size={17} /> Subscriptions
          </h2>
          <p className={s.sectionSub}>Everything Tubcal follows for you. Stored only on this machine.</p>
          {GROUPS.map((g) => (
            <SubscriptionRows key={g.platform} group={g} />
          ))}
          <div>
            <Button variant="ghost" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add subscription
            </Button>
          </div>
        </section>

        <section className={`${s.section} glass`}>
          <h2 className={s.sectionTitle}>
            <Palette size={17} /> Appearance
          </h2>
          <div>
            <div className={s.rowLabel} style={{ marginBottom: 4 }}>Skin</div>
            <div className={s.rowHint} style={{ marginBottom: 12 }}>
              Repaint the whole station. The Shōwa set is home; the rest are other machines.
            </div>
            <SkinPicker value={settings?.theme || 'dark'} onChange={(theme) => updateSettings({ theme })} />
          </div>
        </section>

        <RoomsSettings />

        <section className={`${s.section} glass`}>
          <h2 className={s.sectionTitle}>
            <Volume2 size={17} /> Playback
          </h2>
          <div className={s.row}>
            <div>
              <div className={s.rowLabel}>Audio focus</div>
              <div className={s.rowHint}>
                Solo keeps sound on the video you're watching and mutes the rest of the corner
                stack. Mix lets every mini-player play at once.
              </div>
            </div>
            <SegmentedControl
              options={[
                { value: 'solo', label: 'Solo' },
                { value: 'mix', label: 'Mix' },
              ]}
              value={settings?.solo_audio === false ? 'mix' : 'solo'}
              onChange={(v) => updateSettings({ solo_audio: v === 'solo' })}
            />
          </div>
        </section>

        <EditionSettings />

        <ArchiveSettings />

        <AnimeSettings />

        <SubtitleSettings />

        <EditorSettings />

        <section className={`${s.section} glass`}>
          <h2 className={s.sectionTitle}>
            <Trash2 size={17} /> Private history
          </h2>
          <p className={s.sectionSub}>
            Watched videos are remembered locally to power “The Projection” picks. Nothing is sent
            anywhere.
          </p>
          <HistoryRow />
        </section>

        <section className={`${s.section} glass`}>
          <h2 className={s.sectionTitle}>
            <KeyRound size={17} /> Connections
          </h2>
          <p className={s.sectionSub}>
            Optional. Tubcal works without any accounts — connecting unlocks your real
            subscription/home feeds. Credentials and tokens never leave this machine.
          </p>
          {PROVIDERS.map((p) => (
            <Connection
              key={p.id}
              provider={p}
              status={oauth.data?.[p.id]}
              onChanged={oauth.reload}
            />
          ))}
        </section>

        <AboutSettings />
      </div>

      <AddSubscriptionModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}