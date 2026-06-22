import { Bookmark, Palette, Settings } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';

import { useSettings } from '../../state.jsx';
import { nextTheme, themeMeta } from '../../lib/themes.js';
import s from './Masthead.module.css';

const NAV = [
  { to: '/', index: 'No 01', label: 'Front Page', color: 'var(--c-foryou)' },
  { to: '/youtube', index: 'No 02', label: 'Screening Room', color: 'var(--c-youtube)' },
  { to: '/reddit', index: 'No 03', label: 'The Dispatch', color: 'var(--c-reddit)' },
  { to: '/hackernews', index: 'No 04', label: 'The Wire', color: 'var(--c-hn)' },
  { to: '/archive', index: 'No 05', label: 'The Archive', color: 'var(--signal)' },
  { to: '/anime', index: 'No 06', label: 'The Anime', color: 'var(--c-anime)' },
];

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
        {NAV.map(({ to, index, label, color }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `${s.navItem} tc-navitem ${isActive || (to !== '/' && pathname.startsWith(to)) ? s.navItemActive + ' tc-navitem-on' : ''}`
            }
            style={{ '--nav-c': color }}
          >
            <span className={s.navIndex}>{index}</span>
            <span className={s.navLabel}>{label}</span>
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
