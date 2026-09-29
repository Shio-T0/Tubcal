// The profile studio: your own AniList account settings, edited in place. (Other
// people's profiles — and your public one — are a page: pages/AnimeUser.jsx.)

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, ExternalLink, ListPlus, Loader2, Star, Trash2, X } from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { useToast } from '../../state.jsx';
import { Receiving } from '../layout/Section.jsx';
import { accentOf, PersonAvatar } from './Person.jsx';
import p from './profile.module.css';

// The editable subset of AniList account settings the studio exposes.
const COLORS = ['blue', 'purple', 'pink', 'orange', 'red', 'green', 'gray'];
const TITLE_LANGS = [['ROMAJI', 'Romaji'], ['ENGLISH', 'English'], ['NATIVE', 'Native']];
// How people's names read everywhere. ROMAJI_WESTERN puts the given name first
// ("Luffy D. Monkey"); ROMAJI keeps the Japanese family-name-first order.
const NAME_ORDERS = [
  ['ROMAJI', 'Romaji, Japanese order (Monkey D. Luffy)'],
  ['ROMAJI_WESTERN', 'Romaji, Western order (Luffy D. Monkey)'],
  ['NATIVE', 'Native (モンキー・D・ルフィ)'],
];
const MERGE_TIMES = [
  [0, 'Never'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [180, '3 hours'], [360, '6 hours'],
  [720, '12 hours'], [1440, '1 day'], [2880, '2 days'], [4320, '3 days'], [10080, '1 week'], [20160, '2 weeks'],
];
const NOTIF_LABEL = {
  ACTIVITY_MESSAGE: 'Someone messages you', ACTIVITY_REPLY: 'Replies to your activity',
  FOLLOWING: 'Someone follows you', ACTIVITY_MENTION: 'You’re mentioned in activity',
  THREAD_COMMENT_MENTION: 'You’re mentioned in a thread', THREAD_SUBSCRIBED: 'Replies in threads you follow',
  THREAD_COMMENT_REPLY: 'Replies to your forum comments', AIRING: 'An episode on your list airs',
  ACTIVITY_LIKE: 'Likes on your activity', ACTIVITY_REPLY_LIKE: 'Likes on your replies',
  THREAD_LIKE: 'Likes on your threads', THREAD_COMMENT_LIKE: 'Likes on your forum comments',
  ACTIVITY_REPLY_SUBSCRIBED: 'Replies on activity you follow', RELATED_MEDIA_ADDITION: 'Related titles added to AniList',
  MEDIA_DATA_CHANGE: 'Data changes on titles you track', MEDIA_MERGE: 'Titles you track are merged',
  MEDIA_DELETION: 'Titles you track are deleted',
};

/** Custom lists: add one, or remove one (its entries stay on their shelves). */
function CustomLists({ lists, onChange }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      onChange(await api('/anime/customlists', { method: 'POST', body: JSON.stringify({ name: name.trim() }) }));
      setName('');
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  };
  const remove = async (n) => {
    if (!window.confirm(`Delete the custom list “${n}”? Its titles stay on your list.`)) return;
    setBusy(true);
    try {
      onChange(await api(`/anime/customlists/${encodeURIComponent(n)}`, { method: 'DELETE' }));
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  };
  return (
    <div className={p.customLists}>
      {lists.map((n) => (
        <span key={n} className={p.customChip}>
          {n}
          <button type="button" onClick={() => remove(n)} disabled={busy} aria-label={`Delete ${n}`}><Trash2 size={11} /></button>
        </span>
      ))}
      <span className={p.customAdd}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="new list…" maxLength={60}
               onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) add(); }} />
        <button type="button" onClick={add} disabled={busy || !name.trim()}><ListPlus size={13} /></button>
      </span>
    </div>
  );
}
const SCORE_FORMATS = [
  ['POINT_10', '10 point (5)'],
  ['POINT_10_DECIMAL', '10 point decimal (4.5)'],
  ['POINT_100', '100 point (50)'],
  ['POINT_5', '5 stars (★★★)'],
  ['POINT_3', '3 smileys'],
];

// AniList stores e.g. ROMAJI_STYLISED; the studio only offers the base languages.
const baseLang = (l) => (l ? l.replace('_STYLISED', '') : 'ROMAJI');

function Toggle({ label, hint, icon, checked, onChange }) {
  return (
    <label className={p.toggle}>
      <span className={p.toggleText}>
        <span className={p.toggleLabel}>{icon}{label}</span>
        {hint && <span className={p.toggleHint}>{hint}</span>}
      </span>
      <button
        type="button"
        className={p.switch}
        role="switch"
        aria-checked={!!checked}
        data-on={checked ? '' : undefined}
        onClick={() => onChange(!checked)}
      >
        <span className={p.knob} />
      </button>
    </label>
  );
}

/** The active-profile studio: edit your own AniList account settings, beautifully. */
export function ProfileStudio({ onClose, onView }) {
  const settings = useApi('/anime/settings');
  const toast = useToast();
  const d = settings.data;
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!d) return;
    setForm({
      profile_color: d.profile_color || 'blue',
      score_format: d.score_format || 'POINT_10',
      title_language: baseLang(d.title_language),
      adult_content: !!d.adult_content,
      airing_notifications: !!d.airing_notifications,
      about: d.about || '',
      staff_name_language: d.staff_name_language || 'ROMAJI_WESTERN',
      restrict_messages: !!d.restrict_messages,
      activity_merge_time: d.activity_merge_time ?? 0,
      split_completed: !!d.split_completed,
      advanced_scoring_enabled: !!d.advanced_scoring_enabled,
      advanced_scoring: (d.advanced_scoring || []).join(', '),
      notification_options: Object.fromEntries((d.notification_options || []).map((n) => [n.type, n.enabled])),
    });
  }, [d]);

  const accent = accentOf(form?.profile_color || d?.profile_color);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const notifMap = Object.fromEntries((d?.notification_options || []).map((n) => [n.type, n.enabled]));
  const cats = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const dirty = form && d && (
    form.profile_color !== (d.profile_color || 'blue') ||
    form.score_format !== (d.score_format || 'POINT_10') ||
    form.title_language !== baseLang(d.title_language) ||
    form.adult_content !== !!d.adult_content ||
    form.airing_notifications !== !!d.airing_notifications ||
    form.about !== (d.about || '') ||
    form.staff_name_language !== (d.staff_name_language || 'ROMAJI_WESTERN') ||
    form.restrict_messages !== !!d.restrict_messages ||
    Number(form.activity_merge_time) !== (d.activity_merge_time ?? 0) ||
    form.split_completed !== !!d.split_completed ||
    form.advanced_scoring_enabled !== !!d.advanced_scoring_enabled ||
    cats(form.advanced_scoring).join('|') !== (d.advanced_scoring || []).join('|') ||
    Object.keys(form.notification_options).some((k) => form.notification_options[k] !== notifMap[k])
  );

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await api('/anime/settings', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          activity_merge_time: Number(form.activity_merge_time),
          advanced_scoring: cats(form.advanced_scoring),
          notification_options: Object.entries(form.notification_options).map(([type, enabled]) => ({ type, enabled })),
        }),
      });
      toast('Profile saved to AniList', 'success');
      settings.reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className={p.overlay} onMouseDown={onClose}>
      <div className={p.modal} style={{ '--accent': accent }} onMouseDown={(e) => e.stopPropagation()}>
        <button className={p.close} onClick={onClose} aria-label="Close"><X size={18} /></button>

        {settings.loading && !d && <div className={p.loading}><Receiving label="opening your profile" /></div>}
        {settings.error && <p className={p.err}>Couldn't load your settings. Connect AniList in Settings.</p>}

        {d && form && (
          <>
            <div
              className={p.banner}
              style={d.banner ? { backgroundImage: `url(${d.banner})` } : undefined}
            />
            <header className={p.head}>
              <PersonAvatar user={{ name: d.name, avatar: d.avatar, color: form.profile_color }} size="lg" className={p.studioAv} />
              <div className={p.headMeta}>
                <h2 className={p.name}>{d.name}</h2>
                <div className={p.sub}>
                  <span className={p.studioTag}>Active profile</span>
                  {onView && (
                    <button type="button" className={p.linkBtn} onClick={() => onView(d.name)}>
                      View public profile
                    </button>
                  )}
                  {d.site_url && (
                    <a className={p.anilistLink} href={d.site_url} target="_blank" rel="noreferrer">
                      AniList <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </div>
            </header>

            <section className={p.section}>
              <h3 className={p.h3}>Profile color</h3>
              <div className={p.swatches}>
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={p.swatch}
                    data-on={form.profile_color === c ? '' : undefined}
                    style={{ '--sw': accentOf(c) }}
                    onClick={() => set('profile_color', c)}
                    aria-label={c}
                  >
                    {form.profile_color === c && <Check size={14} />}
                  </button>
                ))}
              </div>
            </section>

            <section className={p.section}>
              <div className={p.fieldGrid}>
                <label className={p.field}>
                  <span className={p.fieldLabel}>Scoring</span>
                  <select
                    className={p.select}
                    value={form.score_format}
                    onChange={(e) => set('score_format', e.target.value)}
                  >
                    {SCORE_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className={p.field}>
                  <span className={p.fieldLabel}>Title language</span>
                  <select
                    className={p.select}
                    value={form.title_language}
                    onChange={(e) => set('title_language', e.target.value)}
                  >
                    {TITLE_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
            </section>

            <section className={p.section}>
              <Toggle
                icon={<Bell size={14} />}
                label="Airing notifications"
                hint="Get notified when anime on your list airs"
                checked={form.airing_notifications}
                onChange={(v) => set('airing_notifications', v)}
              />
              <Toggle
                label="Show adult content"
                hint="Include 18+ titles in browse & search"
                checked={form.adult_content}
                onChange={(v) => set('adult_content', v)}
              />
            </section>

            <section className={p.section}>
              <div className={p.fieldGrid}>
                <label className={p.field}>
                  <span className={p.fieldLabel}>People's names</span>
                  <select className={p.select} value={form.staff_name_language} onChange={(e) => set('staff_name_language', e.target.value)}>
                    {NAME_ORDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className={p.field}>
                  <span className={p.fieldLabel}>Merge list activity within</span>
                  <select className={p.select} value={form.activity_merge_time} onChange={(e) => set('activity_merge_time', e.target.value)}>
                    {MERGE_TIMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
              <Toggle
                label="Only people I follow can message me"
                checked={form.restrict_messages}
                onChange={(v) => set('restrict_messages', v)}
              />
              <Toggle
                label="Split Completed by format"
                hint="Separate TV, movies, OVAs… on your AniList completed shelf"
                checked={form.split_completed}
                onChange={(v) => set('split_completed', v)}
              />
            </section>

            <section className={p.section}>
              <h3 className={p.h3}>Scoring by category</h3>
              <Toggle
                icon={<Star size={14} />}
                label="Advanced scoring"
                hint="Score each title per category; the list editor then shows a slider for each"
                checked={form.advanced_scoring_enabled}
                onChange={(v) => set('advanced_scoring_enabled', v)}
              />
              {form.advanced_scoring_enabled && (
                <input
                  className={p.catsInput}
                  value={form.advanced_scoring}
                  onChange={(e) => set('advanced_scoring', e.target.value)}
                  placeholder="Story, Characters, Visuals, Audio, Enjoyment"
                />
              )}
            </section>

            <section className={p.section}>
              <h3 className={p.h3}>Custom lists</h3>
              <CustomLists lists={d.custom_lists || []} onChange={() => settings.reload()} />
            </section>

            {Object.keys(form.notification_options).length > 0 && (
              <section className={p.section}>
                <h3 className={p.h3}><Bell size={13} /> Notify me when…</h3>
                <div className={p.notifGrid}>
                  {Object.keys(NOTIF_LABEL).filter((k) => k in form.notification_options).map((k) => (
                    <label key={k} className={p.notifRow}>
                      <input
                        type="checkbox"
                        checked={!!form.notification_options[k]}
                        onChange={(e) => set('notification_options', { ...form.notification_options, [k]: e.target.checked })}
                      />
                      {NOTIF_LABEL[k]}
                    </label>
                  ))}
                </div>
              </section>
            )}

            <section className={p.section}>
              <h3 className={p.h3}>About you</h3>
              <textarea
                className={p.bio}
                rows={4}
                maxLength={4000}
                placeholder="A few words for your AniList bio… (markdown supported)"
                value={form.about}
                onChange={(e) => set('about', e.target.value)}
              />
            </section>

            <div className={p.actions}>
              <button
                type="button"
                className={p.saveBtn}
                disabled={!dirty || saving}
                onClick={save}
              >
                {saving ? <Loader2 size={15} className={p.spin} /> : <Check size={15} />}
                {saving ? 'Saving…' : dirty ? 'Save to AniList' : 'Saved'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
