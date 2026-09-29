// Community — what everyone else on AniList is saying and loving.
//
// Four rooms off one hallway: the letters page (reviews), the pairings board
// (people's "if you liked X, try Y" recommendations, which you can vote on), the
// birthday pinboard, and the hall of fame (the most-favourited characters,
// voices and studios of all time).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Plus, ThumbsDown, ThumbsUp } from 'lucide-react';

import { api, useApi } from '../../api/client.js';
import { ErrorBox, Receiving } from '../layout/Section.jsx';
import { SegmentedControl } from '../ui/index.jsx';
import { applyOverlay, useAnimeSync, useToast } from '../../state.jsx';
import { BirthdayBoard, PeopleGrid } from './People.jsx';
import { ReviewCard, ReviewModal } from './Reviews.jsx';
import { UserLink } from './Person.jsx';
import { InfiniteSentinel, STATUS_LABEL, metaLine, useInfinite, useParamState } from './shared.jsx';
import cm from './community.module.css';

const SECTIONS = [
  { value: 'reviews', label: 'Reviews' },
  { value: 'recs', label: 'Pairings' },
  { value: 'birthdays', label: 'Birthdays' },
  { value: 'fame', label: 'Hall of fame' },
];

function Footer({ feed, doneText }) {
  const n = feed.items?.length || 0;
  if (!n) return null;
  return (
    <>
      <InfiniteSentinel onReach={feed.loadMore} active={feed.hasMore && !feed.error} count={n} />
      {feed.loadingMore && <p className={cm.more}>more on the way…</p>}
      {!feed.hasMore && !feed.loadingMore && <p className={cm.end}>· {doneText} ·</p>}
    </>
  );
}

function ReviewsSection() {
  const [sort, setSort] = useParamState('rsort', 'recent');
  const [open, setOpen] = useState(null);
  const feed = useInfinite(`r|${sort}`, (p) => `/anime/reviews?sort=${sort}&page=${p}`);
  const items = feed.items || [];
  return (
    <>
      <div className={cm.bar}>
        <SegmentedControl
          options={[{ value: 'recent', label: 'Newest' }, { value: 'top', label: 'Most helpful' }, { value: 'score', label: 'Highest scored' }]}
          value={sort}
          onChange={setSort}
        />
        <span className={cm.caption}>letters from AniList's reviewers</span>
      </div>
      {feed.error && <ErrorBox message={feed.error} />}
      {feed.loading && !items.length && <Receiving label="sorting the post" />}
      <div className={cm.letters}>
        {items.map((r, i) => <ReviewCard key={r.id} review={r} index={i % 12} onOpen={() => setOpen(r.id)} />)}
      </div>
      <Footer feed={feed} doneText="that's the whole mailbag" />
      {open && <ReviewModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Pairing({ rec, index }) {
  const toast = useToast();
  const { overlay, queueListEdit } = useAnimeSync();
  const [vote, setVote] = useState(rec.user_rating || 'NO_RATING');
  const [rating, setRating] = useState(rec.rating || 0);
  const [busy, setBusy] = useState(false);
  const a = rec.media;
  const b = rec.recommendation;
  const bEntry = applyOverlay(b.id, b.list_entry, overlay);

  const cast = async (want) => {
    const next = vote === want ? 'NO_RATING' : want;
    setBusy(true);
    try {
      const res = await api('/anime/recommend', {
        method: 'POST',
        body: JSON.stringify({ media_id: a.id, recommend_id: b.id, rating: next }),
      });
      setVote(res.user_rating || next);
      setRating(res.rating);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  };

  return (
    <article className={cm.pair} style={{ '--a-c': a.color || 'var(--c-anime)', '--b-c': b.color || 'var(--c-anime)', '--i': Math.min(index, 12) }}>
      <Link to={`/anime/${a.id}`} className={cm.pairFrom}>
        {a.cover && <img src={a.cover} alt="" loading="lazy" />}
        <span className={cm.pairKicker}>if you liked</span>
        <span className={cm.pairTitle}>{a.title}</span>
      </Link>
      <span className={cm.arrow} aria-hidden="true"><ArrowRight size={18} /></span>
      <Link to={`/anime/${b.id}`} className={cm.pairTo}>
        {(b.cover_xl || b.cover) && <img src={b.cover_xl || b.cover} alt="" loading="lazy" />}
        <span className={cm.pairKicker}>try</span>
        <span className={cm.pairTitle}>{b.title}</span>
        <span className={cm.pairMeta}>{metaLine(b)}{b.score ? ` · ${b.score}%` : ''}</span>
      </Link>
      <footer className={cm.pairFoot}>
        <span className={cm.agree} title="Net agreement on AniList">{rating > 0 ? `+${rating}` : rating}</span>
        <button type="button" className={vote === 'RATE_UP' ? cm.voteOn : cm.vote} disabled={busy} onClick={() => cast('RATE_UP')} aria-pressed={vote === 'RATE_UP'} title="Good pairing">
          <ThumbsUp size={13} />
        </button>
        <button type="button" className={vote === 'RATE_DOWN' ? cm.voteOn : cm.vote} disabled={busy} onClick={() => cast('RATE_DOWN')} aria-pressed={vote === 'RATE_DOWN'} title="Doesn't fit">
          <ThumbsDown size={13} />
        </button>
        {rec.user && <span className={cm.by}>by <UserLink user={rec.user} size="xs" /></span>}
        {bEntry?.status ? (
          <span className={cm.listed}><Check size={11} /> {STATUS_LABEL[bEntry.status]}</span>
        ) : (
          <button
            type="button"
            className={cm.plan}
            onClick={() => { queueListEdit(b, { status: 'PLANNING' }); toast(`“${b.title}” → Planning`, 'success'); }}
          >
            <Plus size={11} /> Plan
          </button>
        )}
      </footer>
    </article>
  );
}

function PairingsSection() {
  const me = useApi('/anime/me');
  const connected = !!me.data;
  const [scope, setScope] = useParamState('rscope', 'mine');
  const onList = connected && scope === 'mine';
  const feed = useInfinite(`p|${onList}`, (p) => `/anime/recommendations?page=${p}${onList ? '&on_list=1' : ''}`,
    { enabled: !me.loading });
  const items = feed.items || [];
  return (
    <>
      <div className={cm.bar}>
        {connected && (
          <SegmentedControl
            options={[{ value: 'mine', label: 'For your list' }, { value: 'all', label: 'Everyone’s' }]}
            value={scope}
            onChange={setScope}
          />
        )}
        <span className={cm.caption}>
          {onList ? 'fresh pairings for titles you have on your list' : 'the newest pairings people have suggested'}
        </span>
      </div>
      {feed.error && <ErrorBox message={feed.error} />}
      {feed.loading && !items.length && <Receiving label="matching pairs" />}
      <div className={cm.pairs}>
        {items.map((rec, i) => <Pairing key={rec.id} rec={rec} index={i % 12} />)}
      </div>
      <Footer feed={feed} doneText="no more pairings" />
    </>
  );
}

function BirthdaysSection() {
  const b = useApi('/anime/birthdays');
  if (b.loading && !b.data) return <Receiving label="checking the calendar" />;
  if (b.error) return <ErrorBox message={b.error} />;
  return <BirthdayBoard data={b.data} />;
}

function FameSection() {
  const [kind, setKind] = useParamState('fame', 'characters');
  const feed = useInfinite(`f|${kind}`, (p) => `/anime/people?kind=${kind}&page=${p}`);
  const items = feed.items || [];
  return (
    <>
      <div className={cm.bar}>
        <SegmentedControl
          options={[{ value: 'characters', label: 'Characters' }, { value: 'staff', label: 'Voices & staff' }, { value: 'studios', label: 'Studios' }]}
          value={kind}
          onChange={setKind}
        />
        <span className={cm.caption}>the most favourited on AniList, all time</span>
      </div>
      {feed.error && <ErrorBox message={feed.error} />}
      {feed.loading && !items.length && <Receiving label="hanging the portraits" />}
      {items.length > 0 && <PeopleGrid kind={kind} items={items} ranked />}
      <Footer feed={feed} doneText="that's the whole hall" />
    </>
  );
}

export default function Community() {
  const [section] = useParamState('c', 'reviews');
  const active = SECTIONS.some((x) => x.value === section) ? section : 'reviews';
  // Reviews / Pairings / Birthdays / Hall of fame are chosen from the index.
  return (
    <div className={cm.community}>
      {active === 'reviews' && <ReviewsSection />}
      {active === 'recs' && <PairingsSection />}
      {active === 'birthdays' && <BirthdaysSection />}
      {active === 'fame' && <FameSection />}
    </div>
  );
}
