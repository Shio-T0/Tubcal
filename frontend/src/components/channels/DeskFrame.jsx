// The frame for Saved and Settings, which belong to no channel: a slim bar with
// the wordmark, a way back to the page you came from (named, so you know where it
// goes), the two pages as tabs, and the three channel keys.
//
// `useRememberPlace()` (mounted once in App) notes the last page you were on
// inside a channel; the Back button returns there.

import { useEffect } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ArrowLeft, Bookmark, Settings } from 'lucide-react';

import { useSaved } from '../../state.jsx';
import { roomOfPath } from '../../lib/rooms.js';
import { useMedia } from '../../lib/useMedia.js';
import RadioChip from '../radio/RadioChip.jsx';
import { ChannelKnobs, SkinButton } from './common.jsx';
import d from './desk.module.css';

const PLACE_KEY = 'tubcal.desk.from';

/** Remember the last channel page visited (per tab), for Saved/Settings' Back. */
export function useRememberPlace() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    if (!roomOfPath(pathname)) return;
    try { sessionStorage.setItem(PLACE_KEY, `${pathname}${search}`); } catch { /* private mode */ }
  }, [pathname, search]);
}

function lastPlace() {
  try { return sessionStorage.getItem(PLACE_KEY); } catch { return null; }
}

export function DeskFrame({ children }) {
  const { saved } = useSaved();
  const from = lastPlace();
  const room = from ? roomOfPath(from.split('?')[0]) : null;
  const n = Object.keys(saved || {}).length;
  const narrow = useMedia('(max-width: 1279px)'); // the radio's title would squeeze Back
  return (
    <div className={d.frame}>
      <header className={`${d.bar} tc-bar`}>
        <Link to="/" className={`${d.wordmark} tc-wordmark`} title="Home — choose a channel">Tubcal<em>.</em></Link>
        <Link to={room ? from : '/'} className={d.back}>
          <ArrowLeft size={15} />
          <span>Back to {room ? room.label : 'Home'}</span>
        </Link>
        <nav className={d.tabs} aria-label="Saved and Settings">
          <NavLink to="/saved" className={({ isActive }) => (isActive ? d.tabOn : d.tab)}>
            <Bookmark size={15} /> Saved {n > 0 && <b>{n}</b>}
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? d.tabOn : d.tab)}>
            <Settings size={15} /> Settings
          </NavLink>
        </nav>
        <span className={d.right}>
          <RadioChip compact={narrow} />
          <SkinButton className={d.skin} />
          <ChannelKnobs className={d.knobs} itemClass={d.knob} />
        </span>
      </header>
      <main className={`${d.main} tc-main`}>{children}</main>
    </div>
  );
}
