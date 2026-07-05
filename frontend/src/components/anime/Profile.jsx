import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Bell, Check, Clock, ExternalLink, Film, Loader2, Star, Tv, X } from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { useToast } from '../../state.jsx';
import { Receiving } from '../layout/Section.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { compact } from '../../lib/format.js';
import p from './profile.module.css';

// AniList stores a named profile accent (or a hex); map the names to warm-ish hexes.
const PROFILE_COLORS = {
  blue: '#5fb4e6', purple: '#b06ae0', pink: '#e68fc4', orange: '#e6883a',
  red: '#d6533f', green: '#7bab54', gray: '#8a7c66', grey: '#8a7c66',
};
function accentOf(color) {
  if (!color) return 'var(--c-anime)';
  if (color[0] === '#') return color;
  return PROFILE_COLORS[color.toLowerCase()] || 'var(--c-anime)';
}

// minutesWatched → days, one decimal.
const daysWatched = (mins) => Math.round((mins / 1440) * 10) / 10;

// AniList "about" is markdown with image/spoiler tokens — flatten to readable prose.
function cleanAbout(s) {
  if (!s) return '';
  return s
    .replace(/~!.*?!~/gs, '')
    .replace(/img\d*\(.*?\)/gi, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#>*_~`]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 700);
}

function Stat({ icon, label, value }) {
  return (
    <div className={p.stat}>
      <span className={p.statIcon}>{icon}</span>
      <span className={p.statValue}>{value}</span>
      <span className={p.statLabel}>{label}</span>
    </div>
  );
}

/** A detailed AniList profile, opened by clicking a username anywhere in the room. */
export function ProfileModal({ name, onClose }) {
  const prof = useApi(`/anime/user/${encodeURIComponent(name)}`);
  const u = prof.data;
  const accent = accentOf(u?.color);
  const about = cleanAbout(u?.about);
  const maxGenre = u?.stats?.genres?.[0]?.count || 1;

  return createPortal(
    <div className={p.overlay} onMouseDown={onClose}>
      <div className={p.modal} style={{ '--accent': accent }} onMouseDown={(e) => e.stopPropagation()}>
        <button className={p.close} onClick={onClose} aria-label="Close"><X size={18} /></button>

        {prof.loading && !u && <div className={p.loading}><Receiving label={`opening ${name}'s profile`} /></div>}
        {prof.error && <p className={p.err}>Couldn't load this profile.</p>}

        {u && (
          <>
            <div
              className={p.banner}
              style={u.banner ? { backgroundImage: `url(${u.banner})` } : undefined}
            />
            <header className={p.head}>
              <Avatar src={u.avatar} name={u.name} imgClass={p.avatar} letterClass={p.avatarFallback} />
              <div className={p.headMeta}>
                <h2 className={p.name}>
                  {u.name}
                  {u.donator > 0 && <span className={p.badge}>Supporter</span>}
                </h2>
                <div className={p.sub}>
                  {u.created_at && <span>Joined {new Date(u.created_at * 1000).getFullYear()}</span>}
                  {u.site_url && (
                    <a className={p.anilistLink} href={u.site_url} target="_blank" rel="noreferrer">
                      AniList <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </div>
            </header>

            <div className={p.stats}>
              <Stat icon={<Tv size={15} />} label="Anime" value={compact(u.stats.count)} />
              <Stat icon={<Film size={15} />} label="Episodes" value={compact(u.stats.episodes)} />
              <Stat icon={<Clock size={15} />} label="Days" value={daysWatched(u.stats.minutes)} />
              <Stat icon={<Star size={15} />} label="Mean" value={u.stats.mean_score ? Math.round(u.stats.mean_score) : '—'} />
            </div>

            {u.stats.genres?.length > 0 && (
              <section className={p.section}>
                <h3 className={p.h3}>Most-watched genres</h3>
                <div className={p.genres}>
                  {u.stats.genres.map((g) => (
                    <div key={g.genre} className={p.genreRow}>
                      <span className={p.genreName}>{g.genre}</span>
                      <span className={p.genreTrack}>
                        <span className={p.genreFill} style={{ width: `${Math.max(7, (g.count / maxGenre) * 100)}%` }} />
                      </span>
                      <span className={p.genreCount}>{g.count}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {u.favourites?.length > 0 && (
              <section className={p.section}>
                <h3 className={p.h3}>Favorites</h3>
                <div className={p.favs}>
                  {u.favourites.map((f) => (
                    <Link key={f.id} to={`/anime/${f.id}`} className={p.fav} onClick={onClose} title={f.title}>
                      {f.cover ? (
                        <img src={f.cover} alt="" loading="lazy" />
                      ) : (
                        <span className={p.favFallback}><Tv size={18} /></span>
                      )}
                      <span className={p.favTitle}>{f.title}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {about && (
              <section className={p.section}>
                <h3 className={p.h3}>About</h3>
                <p className={p.about}>{about}</p>
              </section>
            )}

            {!u.stats.genres?.length && !u.favourites?.length && (
              <p className={p.emptyNote}>
                AniList hasn’t published a genre breakdown or favorites for this
                profile yet — they appear once the account’s detailed statistics
                are generated.
              </p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// The editable subset of AniList account settings the studio exposes.
const COLORS = ['blue', 'purple', 'pink', 'orange', 'red', 'green', 'gray'];
const TITLE_LANGS = [['ROMAJI', 'Romaji'], ['ENGLISH', 'English'], ['NATIVE', 'Native']];
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
    });
  }, [d]);

  const accent = accentOf(form?.profile_color || d?.profile_color);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const dirty = form && d && (
    form.profile_color !== (d.profile_color || 'blue') ||
    form.score_format !== (d.score_format || 'POINT_10') ||
    form.title_language !== baseLang(d.title_language) ||
    form.adult_content !== !!d.adult_content ||
    form.airing_notifications !== !!d.airing_notifications ||
    form.about !== (d.about || '')
  );

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await api('/anime/settings', { method: 'POST', body: JSON.stringify(form) });
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
              <Avatar src={d.avatar} name={d.name} imgClass={p.avatar} letterClass={p.avatarFallback} />
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
