import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Library, Minus, Palette, Plus, Settings, Trash2, Rss, Tv, Volume2 } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { SectionHead } from '../components/layout/Section.jsx';
import { Avatar } from '../components/ui/Avatar.jsx';
import AddSubscriptionModal from '../components/modals/AddSubscriptionModal.jsx';
import { Button, SegmentedControl } from '../components/ui/index.jsx';
import { useSettings, useSubscriptions, useToast } from '../state.jsx';
import { THEMES } from '../lib/themes.js';
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

function WeightStepper({ label, value, onChange }) {
  return (
    <div className={s.row}>
      <span className={s.rowLabel}>{label}</span>
      <div className={s.stepper}>
        <button className={s.stepperBtn} disabled={value <= 0} onClick={() => onChange(value - 1)}>
          <Minus size={13} />
        </button>
        <span className={s.stepperValue}>{value}</span>
        <button className={s.stepperBtn} disabled={value >= 5} onClick={() => onChange(value + 1)}>
          <Plus size={13} />
        </button>
      </div>
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
        value={settings?.brain_llm_model || 'llama3.1:8b'}
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

  const weights = settings?.foryou_weights || { youtube: 2, reddit: 2, hackernews: 1 };
  const setWeight = (key, value) =>
    updateSettings({ foryou_weights: { ...weights, [key]: value } });

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
          <div>
            <div className={s.rowLabel} style={{ marginBottom: 4 }}>For You mix</div>
            <div className={s.rowHint} style={{ marginBottom: 12 }}>
              How many items each platform contributes per cycle of the mixed feed.
            </div>
            <WeightStepper label="YouTube" value={weights.youtube ?? 2} onChange={(v) => setWeight('youtube', v)} />
            <WeightStepper label="Reddit" value={weights.reddit ?? 2} onChange={(v) => setWeight('reddit', v)} />
            <WeightStepper label="Hacker News" value={weights.hackernews ?? 1} onChange={(v) => setWeight('hackernews', v)} />
          </div>
        </section>

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

        <ArchiveSettings />

        <AnimeSettings />

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
      </div>

      <AddSubscriptionModal open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
