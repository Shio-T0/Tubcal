import { Bookmark, Palette, Settings } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';

import { useSettings } from '../../state.jsx';
import { nextTheme, themeMeta } from '../../lib/themes.js';
import { getActiveRooms } from '../../lib/rooms.js';
import s from './Masthead.module.css';

function todayLine() {
  return new Date()
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .replace(/,/g, ' ·');
}

export default function Masthead() {
  const { settings, updateSettings } = useSettings();
  const theme = settings?.theme || 'dark';
  const { pathname } = useLocation();
  const upcoming = themeMeta(nextTheme(theme));

  // Derive nav from the ROOMS registry filtered/ordered by settings.active_rooms.
  const activeRoomIds = settings?.active_rooms || ['edition', 'frontpage', 'youtube', 'reddit', 'hackernews', 'archive', 'anime'];
  const navItems = getActiveRooms(activeRoomIds);

  return (
    <header className={`${s.masthead} tc-masthead`}>
      <div className={`${s.topline} tc-topline`}>
        <span>{todayLine()}</span>
        <span>{themeMeta(theme).label}</span>
        <span className={s.onair}>
          <span className={s.onairDot} />
          tube warm · private
        </span>
      </div>

      <div className={s.titleRow}>
        <div className={`${s.wordmark} tc-wordmark`}>
          Tubcal<em>.</em>
        </div>
        <div className={s.actions}>
          <button
            className={s.actionBtn}
            title={`Skin: ${themeMeta(theme).label} — switch to ${upcoming.label}`}
            onClick={() => updateSettings({ theme: nextTheme(theme) })}
          >
            <Palette size={16} />
          </button>
          <NavLink
            to="/saved"
            className={`${s.actionBtn} ${pathname === '/saved' ? s.actionActive : ''}`}
            title="Saved"
          >
            <Bookmark size={16} />
          </NavLink>
          <NavLink
            to="/settings"
            className={`${s.actionBtn} ${pathname === '/settings' ? s.actionActive : ''}`}
            title="Settings"
          >
            <Settings size={16} />
          </NavLink>
        </div>
      </div>

      <nav className={`${s.nav} tc-nav`}>
        {navItems.map((room, i) => {
          const indexLabel = `No ${String(i + 1).padStart(2, '0')}`;
          return (
            <NavLink
              key={room.id}
              to={room.route}
              end={room.route === '/'}
              className={({ isActive }) =>
                `${s.navItem} tc-navitem ${isActive || (room.route !== '/' && pathname.startsWith(room.route)) ? s.navItemActive + ' tc-navitem-on' : ''}`
              }
              style={{ '--nav-c': room.color }}
            >
              <span className={s.navIndex}>{indexLabel}</span>
              <span className={s.navLabel}>{room.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </header>
  );
}