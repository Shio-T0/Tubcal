// Channel 1, Social — a newspaper's section bar across the top of the page.
//
// One slim row, ruled off underneath like a broadsheet's masthead: the wordmark
// and the date on the left, the channel's rooms as the paper's sections (The
// Edition, The Wire, The Dispatch) in the middle, and on the right search, Saved,
// Settings, the skin and the three channel keys. It stays at the top while you
// read; pages under it start at its foot (`--chrome-top` tells sticky things
// inside how much room it takes). On a phone it wraps to two rows and scrolls
// away with the page.
//
// With 3D objects on and the Wire here, one more section follows the rooms,
// unnumbered: By topic, the front page sorted into five topics by the local AI
// (pages/ByTopic.jsx, the `topics` module).

import { Link, NavLink } from 'react-router-dom';
import { Pentagon, Search } from 'lucide-react';

import { hasModule } from '../../lib/modules.js';
import { useObjects3d } from '../../lib/objects3d.js';
import { useMedia } from '../../lib/useMedia.js';
import { ChannelKnobs, PocketButtons, SkinButton, openPalette, useChannelRooms } from './common.jsx';
import s from './social.module.css';

function longDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const BY_TOPIC = '/hackernews/topics';

function Sections({ rooms, current, pathname }) {
  const objects3d = useObjects3d();
  const topics = objects3d && hasModule('topics') && rooms.some((r) => r.id === 'hackernews');
  const onTopics = pathname === BY_TOPIC || pathname.startsWith(`${BY_TOPIC}/`);
  return (
    <nav className={`${s.sections} tc-nav`} aria-label="Social sections">
      {rooms.map((room, i) => {
        const on = current?.id === room.id && !onTopics;
        return (
          <NavLink
            key={room.id}
            to={room.route}
            end={false}
            className={`${s.section} tc-navitem ${on ? `${s.sectionOn} tc-navitem-on` : ''}`}
            style={{ '--room-c': room.color }}
            aria-current={on ? 'page' : undefined}
          >
            <span className={`${s.no} tc-navno`}>{i + 1}</span>
            <span className={s.name}>{room.label}</span>
          </NavLink>
        );
      })}
      {topics && (
        <Link
          to={BY_TOPIC}
          className={`${s.section} tc-navitem ${onTopics ? `${s.sectionOn} tc-navitem-on` : ''}`}
          style={{ '--room-c': 'var(--c-hn)' }}
          aria-current={onTopics ? 'page' : undefined}
          title="The front page sorted into five topics by the local AI"
        >
          <span className={`${s.no} tc-navno`}><Pentagon size={11} /></span>
          <span className={s.name}>By topic</span>
        </Link>
      )}
    </nav>
  );
}

export function SocialFrame({ children }) {
  const { rooms, current, pathname } = useChannelRooms('social');
  const phone = useMedia('(max-width: 900px)');
  return (
    <div className={s.frame} data-channel="social">
      <header className={`${s.bar} tc-bar`}>
        <div className={s.flag}>
          <Link to="/" className={`${s.wordmark} tc-wordmark`} title="Home — choose a channel">Tubcal<em>.</em></Link>
          <span className={s.dateline}>
            <b>Social</b>
            <span>{longDate()}</span>
          </span>
        </div>
        {!phone && <Sections rooms={rooms} current={current} pathname={pathname} />}
        <div className={s.tools}>
          <button type="button" className={s.search} onClick={openPalette} title="Search everything (Ctrl K or /)">
            <Search size={15} />
            {!phone && <kbd>Ctrl K</kbd>}
          </button>
          <PocketButtons btnClass={s.tool} countClass={s.count} />
          <SkinButton className={s.tool} />
          <ChannelKnobs className={s.knobs} itemClass={s.knob} onClass={s.knobOn} labels={false} />
        </div>
        {phone && <Sections rooms={rooms} current={current} pathname={pathname} />}
      </header>
      <main className={`${s.main} tc-main`}>{children}</main>
    </div>
  );
}
