// Channel 2, Coding — laid out like an editor window.
//
// Down the left, an activity bar: the rooms (the Composing Room, the Workbench,
// GitHub) as icon keys with a short name under each, the room you're in marked
// by a bar in its colour, and the three channel keys at the foot. Across the top
// of the page, a title bar: where you are as a path (coding / workbench / rust),
// and on the right search, Saved, Settings and the skin. In the Composing Room
// the title bar also carries the workspace root and which tools it found (git,
// rg, a terminal, language servers), so the editor gets the whole height below.
// On a phone the activity bar lies flat across the top.

import { Link, NavLink, useLocation } from 'react-router-dom';
import { Code2, GitBranch, Search, Wrench } from 'lucide-react';

import { useShared } from '../../lib/useShared.js';
import { useMedia } from '../../lib/useMedia.js';
import { ChannelKnobs, PocketButtons, SkinButton, openPalette, useChannelRooms } from './common.jsx';
import c from './coding.module.css';

const ICONS = {
  editor: Code2,
  dev: Wrench,
  github: GitBranch,
};
// the names under the icons, short enough for the bar
const SHORT = { editor: 'Editor', dev: 'Bench', github: 'GitHub' };

/** The rest of the path after the room: the Workbench's language, a search. */
function crumbsFor(room, search) {
  const q = new URLSearchParams(search);
  if (room?.id === 'dev') return [q.get('l') || 'rust'];
  if (room?.id === 'github' && q.get('q')) return [`“${q.get('q')}”`];
  return [];
}

function shortHome(p) {
  const home = p.match(/^\/home\/[^/]+/);
  return home ? p.replace(home[0], '~') : p;
}

/** The Composing Room's workspace root and the tools it found. */
function EditorColophon() {
  const status = useShared('/editor/status');
  const d = status.data;
  if (!d) return null;
  const caps = [
    ['git', d.git],
    ['rg', d.rg],
    ['tty', d.terminal],
    ['lsp', Object.values(d.lsp || {}).some(Boolean)],
  ];
  return (
    <span className={c.colophon}>
      <span className={c.root} title="Workspace root — TUBCAL_EDITOR_ROOT">{shortHome(d.root)}</span>
      {caps.map(([label, on]) => (
        <span key={label} className={on ? c.capOn : c.cap} title={on ? `${label} available` : `${label} unavailable`}>{label}</span>
      ))}
    </span>
  );
}

function ActivityBar({ rooms, current, flat }) {
  return (
    <aside className={`${flat ? c.flat : c.activity} tc-console`} aria-label="Coding">
      <Link to="/" className={`${c.mark} tc-wordmark`} title="Home — choose a channel">
        {flat ? <>Tubcal<em>.</em></> : <>T<em>.</em></>}
      </Link>
      <nav className={`${c.acts} tc-nav`} aria-label="Coding rooms">
        {rooms.map((room, i) => {
          const on = current?.id === room.id;
          const Icon = ICONS[room.id] || Code2;
          return (
            <NavLink
              key={room.id}
              to={room.route}
              end={false}
              className={`${c.act} tc-navitem ${on ? `${c.actOn} tc-navitem-on` : ''}`}
              style={{ '--room-c': room.color }}
              aria-current={on ? 'page' : undefined}
              title={`${room.label} (${i + 1})`}
            >
              <span className={`${c.actIcon} tc-navno`}><Icon size={19} /></span>
              <span className={c.actLabel}>{SHORT[room.id] || room.short}</span>
            </NavLink>
          );
        })}
      </nav>
      {!flat && <span className={c.spacer} />}
      <ChannelKnobs className={c.knobs} itemClass={c.knob} onClass={c.knobOn} labels={false} />
    </aside>
  );
}

export function CodingFrame({ children }) {
  const { rooms, current } = useChannelRooms('coding');
  const { search } = useLocation();
  const phone = useMedia('(max-width: 900px)');
  const crumbs = crumbsFor(current, search);
  return (
    <div className={c.frame} data-channel="coding">
      <ActivityBar rooms={rooms} current={current} flat={phone} />
      <div className={c.work}>
        <div className={c.titlebar}>
          <span className={c.path}>
            <Link to="/">~</Link>
            <i>/</i>
            <span className={c.channel}>coding</span>
            {current && (
              <>
                <i>/</i>
                <Link to={current.route} className={c.here} style={{ '--room-c': current.color }}>{current.label.replace(/^The /, '').toLowerCase()}</Link>
              </>
            )}
            {crumbs.map((x) => <span key={x}><i>/</i>{x}</span>)}
          </span>
          {current?.id === 'editor' && !phone && <EditorColophon />}
          <span className={c.tools}>
            <button type="button" className={c.search} onClick={openPalette} title="Search everything (Ctrl K or /)">
              <Search size={14} />
              {!phone && <span>Search</span>}
              {!phone && <kbd>Ctrl K</kbd>}
            </button>
            <PocketButtons btnClass={c.tool} countClass={c.count} />
            <SkinButton className={c.tool} />
          </span>
        </div>
        <main className={`${c.main} tc-main`}>{children}</main>
      </div>
    </div>
  );
}
