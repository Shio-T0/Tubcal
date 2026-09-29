// The Anime section's own top bar. The Anime isn't a hub room — it's Channel 2, a
// section of its own — so it carries its own slim masthead instead of the hub's
// room nav: the brand (back to the chooser), your AniList account at a glance
// (sync state, inbox, profile), and the ways out (Home, Hub, skin, Settings).
// Moving between the Anime's own views is the index on the left's job.

import { Link } from 'react-router-dom';
import { House, LayoutGrid, Palette, Settings } from 'lucide-react';

import { useApi } from '../../api/client.js';
import { useAnimeSync, useSettings } from '../../state.jsx';
import { nextTheme, themeMeta } from '../../lib/themes.js';
import { HUB_HOME } from '../../lib/rooms.js';
import { InboxBell } from './Inbox.jsx';
import { asPerson, PersonAvatar } from './Person.jsx';
import { SyncBadge } from './shared.jsx';
import b from './animemasthead.module.css';

/** Worst-of sync status across every title with a pending/in-flight edit — at a
 *  glance you know whether everything has reached AniList or is still flushing. */
function SyncStatus() {
  const { syncState } = useAnimeSync();
  const vals = Object.values(syncState || {});
  const status = vals.includes('syncing') ? 'syncing'
    : vals.includes('pending') ? 'pending'
      : vals.includes('error') ? 'error' : null;
  if (!status) return null;
  const n = vals.filter((v) => v === status).length;
  return (
    <span className={b.sync}>
      <SyncBadge status={status} />
      {n > 1 && <em>{n}</em>}
    </span>
  );
}

/** The connected AniList account — your face; opens your profile page (where the
 *  profile studio, your AniList settings, is one button away). */
function ProfileChip() {
  const me = useApi('/anime/me');
  const u = asPerson(me.data);
  if (!u) return null;
  return (
    <Link to={`/anime/user/${encodeURIComponent(u.name)}`} className={b.profile} title="Your AniList profile">
      <PersonAvatar user={u} size="sm" />
      <span className={b.profileName}>{u.name}</span>
    </Link>
  );
}

export default function AnimeMasthead() {
  const { settings, updateSettings } = useSettings();
  const theme = settings?.theme || 'dark';
  const upcoming = themeMeta(nextTheme(theme));
  return (
    <header className={b.bar}>
      <Link to="/" className={b.brand} title="Home — choose Hub or Anime">
        <span className={b.word}>Tubcal<em>.</em></span>
        <span className={b.channel}>
          <span className={b.chNo}>CH 2</span>
          <span className={b.chName}>Anime <i lang="ja">アニメ</i></span>
        </span>
      </Link>
      <div className={b.account}>
        <SyncStatus />
        <InboxBell />
        <ProfileChip />
      </div>
      <nav className={b.actions} aria-label="Leave the Anime">
        <Link to="/" className={b.btn}><House size={14} /> Home</Link>
        <Link to={HUB_HOME} className={b.btn} title="Go to the Hub (Space g h)">
          <LayoutGrid size={14} /> Hub
          <span className={b.keys} aria-hidden="true"><kbd>Space</kbd><kbd>g</kbd><kbd>h</kbd></span>
        </Link>
        <button
          type="button"
          className={b.icon}
          title={`Skin: ${themeMeta(theme).label} — switch to ${upcoming.label}`}
          onClick={() => updateSettings({ theme: nextTheme(theme) })}
        >
          <Palette size={16} />
        </button>
        <Link to="/settings" className={b.icon} title="Settings — the AniList connection lives here">
          <Settings size={16} />
        </Link>
      </nav>
    </header>
  );
}
