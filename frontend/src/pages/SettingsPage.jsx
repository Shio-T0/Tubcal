import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Minus, Palette, Plus, Settings, Trash2, Rss } from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { SectionHead } from '../components/layout/Section.jsx';
import AddSubscriptionModal from '../components/modals/AddSubscriptionModal.jsx';
import { Button, SegmentedControl } from '../components/ui/index.jsx';
import { useSettings, useSubscriptions, useToast } from '../state.jsx';
import s from './settings.module.css';

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
          {row.thumbnail ? (
            <img className={s.subRowAvatar} src={row.thumbnail} alt="" />
          ) : (
            <span className={s.subRowAvatarLetter}>
              {row.display_name.replace(/^r\//, '').charAt(0).toUpperCase()}
            </span>
          )}
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
          <div className={s.row}>
            <div>
              <div className={s.rowLabel}>Edition</div>
              <div className={s.rowHint}>Night is ink and ember; Day is true newsprint.</div>
            </div>
            <SegmentedControl
              options={[
                { value: 'dark', label: 'Night' },
                { value: 'light', label: 'Day' },
              ]}
              value={settings?.theme || 'dark'}
              onChange={(theme) => updateSettings({ theme })}
            />
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
