// Watch — the Screening Room on a phone.
//
// Your channels sit in a strip of faces under the bar (a dot says something's
// new; tap one for its page). Below, four views on chips: For you (the newest
// upload big, what you were halfway through, what just came in, picks from your
// history and a random reel), Latest (every upload, by day, filterable to one
// channel, watched ones hideable), Live, and History. Pull down to refresh; long-
// press any video for its actions.

import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, CheckCheck, Eye, EyeOff, History as HistoryIcon, Plus, Radio, Rows3, Search, Sparkles, Tv } from 'lucide-react';

import { api, useApi } from '@pc/api/client.js';
import AddSubscriptionModal from '@pc/components/modals/AddSubscriptionModal.jsx';
import { Avatar } from '@pc/components/ui/Avatar.jsx';
import {
  markSeen, useChannelFeed, useChannelRoster, useSeen, useShared, useWatched,
} from '@pc/components/screening/feed.js';
import { clock } from '@pc/lib/time.js';
import { useParamState } from '@pc/lib/urlState.js';
import { useProgress, useSubscriptions } from '@pc/state.jsx';

import { AppBar, Chips, Empty, ErrorNote, IconBtn, SectionTitle, Sheet, Skeleton, usePullToRefresh } from '../shell/Shell.jsx';
import { byDay, Strip, VideoCard, VideoRow } from './video.jsx';
import w from './watch.module.css';

/** The faces of your channels, freshest first, with a dot for what's new. */
function FaceStrip({ roster, onAdd, filter, onFilter }) {
  const navigate = useNavigate();
  if (!roster.length) return null;
  return (
    <div className={w.faces}>
      {roster.map(({ sub, fresh }) => {
        const on = filter === sub.source_id;
        return (
          <button
            key={sub.id}
            type="button"
            className={`${w.faceBtn} ${on ? w.faceOn : ''}`}
            data-reveal="pop"
            onClick={() => (onFilter ? onFilter(on ? '' : sub.source_id) : navigate(`/youtube/c/${sub.source_id}`))}
          >
            <span className={w.faceRing}>
              <Avatar src={sub.thumbnail} name={sub.display_name} imgClass={w.faceImg} letterClass={w.faceLetter} />
              {fresh > 0 && <em className={w.faceDot}>{fresh > 9 ? '9+' : fresh}</em>}
            </span>
            <span className={w.faceName}>{sub.display_name}</span>
          </button>
        );
      })}
      <button type="button" className={w.faceBtn} onClick={onAdd} data-reveal="pop">
        <span className={`${w.faceRing} ${w.faceAdd}`}><Plus size={22} /></span>
        <span className={w.faceName}>Add</span>
      </button>
    </div>
  );
}

function ForYou({ items, liveItems, hasSubs, onAdd, reloaders }) {
  const { isNew } = useSeen();
  const watched = useWatched();
  const { progress } = useProgress();
  const cont = useApi('/youtube/continue');
  const discover = useShared('/youtube/discover', { enabled: hasSubs, maxAge: 300_000 });
  const trending = useShared('/youtube/trending', { maxAge: 600_000 });
  reloaders.current = [cont.reload, discover.reload, trending.reload];

  const feature = items.find((i) => !watched(i).done) || items[0];
  const justIn = items.filter((i) => i !== feature).slice(0, 6);
  const resumable = (cont.data?.items || []).slice(0, 12);
  const picks = (discover.data?.items || []).slice(0, 18);
  const random = (trending.data?.items || []).slice(0, 14);
  const onAir = liveItems.filter((i) => i.extra?.live_status === 'is_live');

  return (
    <>
      {!hasSubs && (
        <Empty
          Icon={Tv}
          title="No channels yet"
          text="Add YouTube channels by handle or link and their uploads land here. Meanwhile, a random reel below."
          action={<button type="button" className={w.cta} onClick={onAdd}><Plus size={16} /> Add a channel</button>}
        />
      )}
      {onAir.length > 0 && (
        <>
          <SectionTitle><span className={w.liveDot} /> On air now</SectionTitle>
          {onAir.map((i) => <VideoCard key={i.id} item={i} />)}
        </>
      )}
      {feature && <VideoCard item={feature} fresh={isNew(feature)} />}
      {resumable.length > 0 && (
        <>
          <SectionTitle>Pick up where you left off</SectionTitle>
          <Strip
            items={resumable}
            meta={(i) => {
              const pr = progress[i.id];
              return <>{i.source && <span>{i.source}</span>}{pr?.duration ? <span>{clock(pr.duration - pr.position)} left</span> : null}</>;
            }}
          />
        </>
      )}
      {justIn.length > 0 && (
        <>
          <SectionTitle>Just in</SectionTitle>
          {justIn.map((i) => <VideoCard key={i.id} item={i} fresh={isNew(i)} />)}
        </>
      )}
      {picks.length > 0 && (
        <>
          <SectionTitle>The Projection — picked for you</SectionTitle>
          <Strip items={picks} />
        </>
      )}
      {random.length > 0 && (
        <>
          <SectionTitle action="reshuffle" onAction={() => trending.reload()}>Off the air</SectionTitle>
          <Strip items={random} />
        </>
      )}
      {(discover.loading || trending.loading) && !picks.length && !random.length && <Skeleton kind="cards" n={1} />}
    </>
  );
}

function Latest({ items, roster }) {
  const [ch, setCh] = useParamState('ch', '');
  const [hide, setHide] = useState(false);
  const { isNew, newCount } = useSeen();
  const watched = useWatched();
  const [pick, setPick] = useState(false);
  const shown = items.filter((i) => (!ch || i.extra?.channel_id === ch) && (!hide || !watched(i).done));
  const days = byDay(shown);
  const fresh = newCount(items);
  const chName = roster.find((r) => r.sub.source_id === ch)?.sub.display_name;
  return (
    <>
      <div className={w.tools}>
        <button type="button" className={`${w.tool} ${ch ? w.toolOn : ''}`} onClick={() => setPick(true)}>
          <Tv size={15} /> {chName || 'All channels'}
        </button>
        <button type="button" className={`${w.tool} ${hide ? w.toolOn : ''}`} onClick={() => setHide((x) => !x)}>
          {hide ? <EyeOff size={15} /> : <Eye size={15} />} {hide ? 'Watched hidden' : 'Hide watched'}
        </button>
        {fresh > 0 && (
          <button type="button" className={w.tool} onClick={() => markSeen()}>
            <CheckCheck size={15} /> Mark {fresh} seen
          </button>
        )}
      </div>
      {!shown.length && <Empty Icon={Rows3} title="Nothing here" text={hide ? "You've watched everything here." : 'No recent uploads.'} />}
      {days.map((d) => (
        <section key={d.label}>
          <h3 className={w.day} data-reveal="fade">{d.label} <em>{d.items.length}</em></h3>
          {d.items.map((i) => <VideoCard key={i.id} item={i} fresh={isNew(i)} />)}
        </section>
      ))}
      <Sheet open={pick} onClose={() => setPick(false)} title="Show uploads from">
        <div className={w.pickList}>
          <button type="button" className={!ch ? w.pickOn : ''} onClick={() => { setCh(''); setPick(false); }}>
            <span className={w.pickAll}><Tv size={18} /></span> All channels <em>{items.length}</em>
            {!ch && <Check size={18} />}
          </button>
          {roster.filter((r) => r.latest).map(({ sub, fresh: n }) => (
            <button key={sub.id} type="button" className={ch === sub.source_id ? w.pickOn : ''} onClick={() => { setCh(sub.source_id); setPick(false); }}>
              <Avatar src={sub.thumbnail} name={sub.display_name} imgClass={w.pickFace} letterClass={w.pickLetter} />
              {sub.display_name}
              {n > 0 && <em className={w.pickNew}>{n} new</em>}
              {ch === sub.source_id && <Check size={18} />}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

export default function Watch() {
  const navigate = useNavigate();
  const [view, setView] = useParamState('v', 'programme');
  const [adding, setAdding] = useState(false);
  const { subs } = useSubscriptions();
  const { feed, live, hasSubs } = useChannelFeed();
  const items = useMemo(() => feed.data?.items || [], [feed.data]);
  const liveItems = live.data?.items || [];
  const roster = useChannelRoster(items);
  const { newCount } = useSeen();
  const reloaders = useRef([]);
  const fresh = newCount(items);

  const refresh = async () => {
    try { await api('/refresh?scope=youtube', { method: 'POST' }); } catch { /* best-effort */ }
    await Promise.allSettled([feed.reload(), live.reload(), ...reloaders.current.map((f) => f())]);
  };
  const pull = usePullToRefresh(refresh);

  const views = [
    { key: 'programme', label: 'For you', Icon: Sparkles },
    { key: 'latest', label: 'Latest', Icon: Rows3, count: fresh },
    liveItems.length ? { key: 'live', label: 'Live', Icon: Radio, count: liveItems.length } : null,
    { key: 'history', label: 'History', Icon: HistoryIcon },
  ];
  const onView = (k) => (k === 'history' ? navigate('/youtube/history') : setView(k));

  return (
    <div className={w.screen}>
      <AppBar
        title="Watch"
        sub={hasSubs ? `${subs.youtube.length} channels${fresh ? ` · ${fresh} new` : ''}` : 'Screening Room'}
        tone="var(--c-youtube)"
        actions={
          <>
            <IconBtn label="Search YouTube" onClick={() => navigate('/search?in=videos')}><Search size={21} /></IconBtn>
            <IconBtn label="Add a channel" onClick={() => setAdding(true)}><Plus size={22} /></IconBtn>
          </>
        }
      >
        <Chips items={views} value={view} onChange={onView} />
      </AppBar>
      {pull}

      {view !== 'latest' && <FaceStrip roster={roster} onAdd={() => setAdding(true)} />}

      {feed.error && <ErrorNote message={feed.error} onRetry={feed.reload} />}
      {feed.loading && !feed.data && hasSubs && <Skeleton kind="cards" n={3} />}

      {view === 'programme' && <ForYou items={items} liveItems={liveItems} hasSubs={hasSubs} onAdd={() => setAdding(true)} reloaders={reloaders} />}
      {view === 'latest' && <Latest items={items} roster={roster} />}
      {view === 'live' && (
        liveItems.length
          ? [...liveItems].sort((a, b) => (a.extra?.live_status === 'is_live' ? -1 : 1) - (b.extra?.live_status === 'is_live' ? -1 : 1)).map((i) => <VideoCard key={i.id} item={i} />)
          : <Empty Icon={Radio} title="Nothing on air" text="Live streams and premieres from your channels show up here." />
      )}

      <AddSubscriptionModal open={adding} onClose={() => setAdding(false)} initialPlatform="youtube" />
    </div>
  );
}

export { byDay, VideoRow };
