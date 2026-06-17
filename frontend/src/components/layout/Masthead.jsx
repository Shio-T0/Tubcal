import { Moon, Settings, Sun } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';

import { useSettings } from '../../state.jsx';
import s from './Masthead.module.css';

const NAV = [
  { to: '/', index: 'No 01', label: 'Front Page', color: 'var(--c-foryou)' },
  { to: '/youtube', index: 'No 02', label: 'Screening Room', color: 'var(--c-youtube)' },
  { to: '/reddit', index: 'No 03', label: 'The Dispatch', color: 'var(--c-reddit)' },
  { to: '/hackernews', index: 'No 04', label: 'The Wire', color: 'var(--c-hn)' },
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

  return (
    <header className={s.masthead}>
      <div className={s.topline}>
        <span>{todayLine()}</span>
        <span>{theme === 'dark' ? 'Night Edition' : 'Day Edition'}</span>
        <span className={s.onair}>
          <span className={s.onairDot} />
          on air · local only
        </span>
      </div>

      <div className={s.titleRow}>
        <div className={s.wordmark}>
          Tubcal<em>.</em>
        </div>
        <div className={s.actions}>
          <button
            className={s.actionBtn}
            title={theme === 'dark' ? 'Day Edition' : 'Night Edition'}
            onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <NavLink
            to="/settings"
            className={`${s.actionBtn} ${pathname === '/settings' ? s.actionActive : ''}`}
            title="Settings"
          >
            <Settings size={16} />
          </NavLink>
        </div>
      </div>

      <nav className={s.nav}>
        {NAV.map(({ to, index, label, color }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `${s.navItem} ${isActive || (to !== '/' && pathname.startsWith(to)) ? s.navItemActive : ''}`
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
