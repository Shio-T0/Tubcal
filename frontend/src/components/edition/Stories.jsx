// The Edition's stories: the lead, the columns, the rail and In Brief, and the
// small parts every one of them is built from — where it's from, what you can do
// with it, whether you've read it.
//
// Every story says where it came from (the kicker) and offers what its platform
// can do: watch or queue a video, read a Reddit post, read the article and open
// the HN discussion. A model-written ("edited") story carries a dek and body; a
// wire story carries its numbers where the dek would go, and at most a short
// excerpt of its source text, labelled as such and cleaned of links and tags.

import { useMemo, useState } from 'react';
import {
  ExternalLink, FileText, ListPlus, MessageSquare, Play,
} from 'lucide-react';

import { SaveButton } from '../ui/ItemActions.jsx';
import { compact, splitKind } from '../../lib/format.js';
import { timeAgo } from '../../lib/time.js';
import { usePlayer } from '../../state.jsx';
import e from '../../pages/edition.module.css';

export const ROOM = {
  youtube: { name: 'Screening Room', c: 'var(--c-youtube)' },
  reddit: { name: 'The Dispatch', c: 'var(--c-reddit)' },
  hackernews: { name: 'The Wire', c: 'var(--c-hn)' },
};
export const roomOf = (it) => ROOM[it?.platform] || ROOM.hackernews;

/** "The Wire · spectrum.ieee.org", "Screening Room · Eve", "The Dispatch · r/rust". */
function kickerOf(item) {
  if (!item) return '';
  const where = item.platform === 'hackernews'
    ? (splitKind(item.title).kind || item.extra?.domain || 'Hacker News')
    : item.source;
  return `${roomOf(item).name}${where ? ` · ${where}` : ''}`;
}

/** A tick that draws itself the moment a story is read. */
export function ReadTick({ on, size = 12 }) {
  if (!on) return null;
  return (
    <svg className={e.tick} width={size} height={size} viewBox="0 0 12 12" aria-label="read" role="img">
      <path d="M2 6.4 4.8 9 10 3" />
    </svg>
  );
}

/** The numbers line a wire story shows where the dek would go. */
function Numbers({ item }) {
  if (!item) return null;
  const bits = [];
  if (item.platform === 'youtube') {
    if (item.source) bits.push(item.source);
  } else {
    if (item.score != null) bits.push(`▲ ${compact(item.score)} points`);
    if (item.comments_count != null) bits.push(`${compact(item.comments_count)} comments`);
  }
  if (item.published_at) bits.push(`${timeAgo(item.published_at)} ago`);
  return <p className={e.numbers}>{bits.map((b) => <span key={b}>{b}</span>)}</p>;
}

/** Source text a wire story was built from, minus the links and tags that make a
 *  video description unreadable as prose. */
function cleanExcerpt(text) {
  return (text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(^|\s)#\S+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(\s*[—·|-]\s*){2,}/g, ' — ')
    .trim();
}

const EXCERPT_FROM = { youtube: 'From the description', reddit: 'From the post', hackernews: 'From the thread' };

/** A wire story's excerpt: three lines, with a way to read the rest. */
function Excerpt({ text, item }) {
  const [open, setOpen] = useState(false);
  const clean = useMemo(() => cleanExcerpt(text), [text]);
  if (clean.length < 24) return null;
  const long = clean.length > 220;
  return (
    <div className={e.excerpt}>
      <span className={e.excerptFrom}>{EXCERPT_FROM[item?.platform] || 'Excerpt'}</span>
      <p className={open ? e.excerptOpen : undefined}>{clean}</p>
      {long && (
        <button type="button" className={e.excerptMore} onClick={() => setOpen((o) => !o)}>
          {open ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

/** A story's copy: the written body (a drop cap on the lead), or a wire excerpt. */
function Copy({ story, item, lead = false }) {
  if (!story.body) return null;
  if (story.synthesized) return <p className={`${e.body} ${lead ? e.ledeBody : ''}`}>{story.body}</p>;
  return <Excerpt text={story.body} item={item} />;
}

/** What you can do with a story's top item. The lead gets buttons; everything
 *  else a quiet line of text actions, so a page of them doesn't shout. */
function Acts({ item, on, big = false }) {
  const { enqueue } = usePlayer();
  if (!item) return null;
  const cls = big ? e.act : e.link;
  const main = `${cls} ${big ? e.actMain : e.linkMain}`;
  if (item.platform === 'youtube') {
    return (
      <div className={big ? e.acts : e.links}>
        <button type="button" className={main} onClick={() => on.play(item)}><Play size={big ? 14 : 12} fill="currentColor" /> Watch</button>
        <button type="button" className={cls} onClick={() => { on.touched(item); enqueue(item); }} title="Add to Up next"><ListPlus size={big ? 15 : 13} /> Up next</button>
        <SaveButton item={item} className={e.save} />
      </div>
    );
  }
  if (item.platform === 'reddit') {
    return (
      <div className={big ? e.acts : e.links}>
        <button type="button" className={main} onClick={() => on.post(item)}><FileText size={big ? 14 : 12} /> Read the post</button>
        {item.comments_count != null && (
          <button type="button" className={cls} onClick={() => on.post(item)}><MessageSquare size={big ? 14 : 12} /> {compact(item.comments_count)}</button>
        )}
        <SaveButton item={item} className={e.save} />
      </div>
    );
  }
  const external = item.url && !item.url.includes('news.ycombinator.com/item');
  return (
    <div className={big ? e.acts : e.links}>
      {external && (
        <a className={main} href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => on.touched(item)}>
          Read <ExternalLink size={big ? 13 : 11} />
        </a>
      )}
      <button type="button" className={external ? cls : main} onClick={() => on.discuss(item)}>
        <MessageSquare size={big ? 14 : 12} /> {item.comments_count != null ? `${compact(item.comments_count)} comments` : 'Discussion'}
      </button>
      <SaveButton item={item} className={e.save} />
    </div>
  );
}

/** Where else the same story turned up (an edited paper clusters platforms). */
function AlsoOn({ items, on }) {
  const rest = items.slice(1);
  if (!rest.length) return null;
  return (
    <div className={e.also}>
      <span>also on</span>
      {rest.slice(0, 5).map((it) => (
        <button key={it.id} type="button" className={e.alsoChip} style={{ '--c': roomOf(it).c }} onClick={() => on.open(it)} title={it.title}>
          {roomOf(it).name}{it.platform === 'reddit' ? ` · ${it.source}` : ''}
        </button>
      ))}
    </div>
  );
}

/** The headline as the story's main door. */
function Headline({ story, item, on, as: Tag = 'h3', className }) {
  const text = story.headline || item?.title;
  const inner = <span className={e.ink}>{text}</span>;
  if (item?.platform === 'hackernews' && item.url && !item.url.includes('news.ycombinator.com/item')) {
    return (
      <Tag className={className}>
        <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => on.touched(item)}>{inner}</a>
      </Tag>
    );
  }
  return (
    <Tag className={className}>
      <button type="button" onClick={() => on.open(item)}>{inner}</button>
    </Tag>
  );
}

/** Props that make a story a stop for the reader: focusable, Enter opens it,
 *  `u` finds it while unread, and it settles in as it scrolls into view. */
function stop(story, on, read, i) {
  const top = story.items?.[0];
  return {
    'data-kbd-tile': true,
    'data-story': top?.id || '',
    'data-unread': read ? undefined : '',
    'data-reveal': '',
    tabIndex: 0,
    style: { '--c': roomOf(top).c, '--i': i },
    onKeyDown: (ev) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) on.open(top); },
  };
}

export function Story({ story, on, read, variant = 'column', index = 0 }) {
  const items = story.items || [];
  const top = items[0];
  const pic = items.find((i) => i.thumbnail);
  const [imgOk, setImgOk] = useState(true);
  const rail = variant === 'rail';
  return (
    <article className={`${e.story} ${rail ? e.railStory : e.column} ${read ? e.read : ''}`} {...stop(story, on, read, index)}>
      <span className={e.kicker}><ReadTick on={read} />{kickerOf(top)}</span>
      {pic && imgOk && !rail && (
        <button type="button" className={e.colPic} onClick={() => on.open(pic)} tabIndex={-1} aria-hidden="true">
          <img src={pic.thumbnail} alt="" loading="lazy" onError={() => setImgOk(false)} />
          {pic.platform === 'youtube' && <span className={e.playDot}><Play size={13} fill="currentColor" /></span>}
        </button>
      )}
      <div className={rail && pic && imgOk ? e.railTop : undefined}>
        <Headline story={story} item={top} on={on} className={e.headline} />
        {rail && pic && imgOk && (
          <button type="button" className={e.railPic} onClick={() => on.open(pic)} tabIndex={-1} aria-hidden="true">
            <img src={pic.thumbnail} alt="" loading="lazy" onError={() => setImgOk(false)} />
          </button>
        )}
      </div>
      {story.dek ? <p className={e.dek}>{story.dek}</p> : <Numbers item={top} />}
      {!rail && <Copy story={story} item={top} />}
      <AlsoOn items={items} on={on} />
      <Acts item={top} on={on} />
    </article>
  );
}

/** How long a headline reads: CJK and full-width characters count double. */
const reach = (s) => [...(s || '')].reduce((n, ch) => n + (/[\u2E80-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/.test(ch) ? 2 : 1), 0);

export function Lede({ story, on, read }) {
  const items = story.items || [];
  const top = items[0];
  const pic = items.find((i) => i.thumbnail);
  const [imgOk, setImgOk] = useState(true);
  const big = pic?.thumbnail?.replace('hqdefault', 'maxresdefault');
  const showPic = pic && imgOk;
  return (
    <article className={`${e.story} ${e.lede} ${read ? e.read : ''}`} {...stop(story, on, read, 0)}>
      <span className={e.kicker}>
        <em className={e.leadTag}>Lead story</em>
        <ReadTick on={read} />
        {kickerOf(top)}
      </span>
      <Headline
        story={story} item={top} on={on} as="h2"
        className={`${e.ledeHead} ${reach(story.headline || top?.title) > 84 ? e.ledeLong : ''}`}
      />
      <div className={`${e.ledeSpread} ${showPic ? '' : e.ledeSolo}`}>
        {showPic && (
          <button type="button" className={e.ledePic} onClick={() => on.open(pic)} aria-label={`Open ${pic.title}`}>
            <img
              src={big || pic.thumbnail}
              alt=""
              fetchPriority="high"
              onLoad={(ev) => { if (ev.currentTarget.naturalWidth <= 120 && ev.currentTarget.src !== pic.thumbnail) ev.currentTarget.src = pic.thumbnail; }}
              onError={(ev) => { if (ev.currentTarget.src !== pic.thumbnail) ev.currentTarget.src = pic.thumbnail; else setImgOk(false); }}
            />
            {pic.platform === 'youtube' && <span className={e.playMark}><Play size={22} fill="currentColor" /></span>}
          </button>
        )}
        <div className={e.ledeText}>
          {story.dek ? <p className={e.ledeDek}>{story.dek}</p> : <Numbers item={top} />}
          <Copy story={story} item={top} lead />
          {story.transcript_of && (
            <p className={e.fromTranscript}><FileText size={12} /> written from what was said in the video — its transcript is in The Archive</p>
          )}
          <AlsoOn items={items} on={on} />
          <Acts item={top} on={on} big />
        </div>
      </div>
    </article>
  );
}

const BRIEF_CAP = 8;

export function Briefs({ briefs, on, marks }) {
  const [openAll, setOpenAll] = useState({});
  const groups = useMemo(() => {
    const m = new Map();
    for (const b of briefs) {
      const p = b.items?.[0]?.platform || 'hackernews';
      if (!m.has(p)) m.set(p, []);
      m.get(p).push(b);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [briefs]);
  if (!briefs.length) return null;
  return (
    <section className={e.briefs} aria-label="In brief">
      <h2 className={e.section} data-reveal=""><span>In brief</span></h2>
      <div className={e.briefGroups}>
        {groups.map(([platform, list]) => {
          const room = ROOM[platform] || ROOM.hackernews;
          const cap = openAll[platform] ? list.length : BRIEF_CAP;
          const unread = list.filter((b) => !marks.has(b.items?.[0]?.id)).length;
          return (
            <div key={platform} className={e.briefGroup} style={{ '--c': room.c, '--n': list.length }}>
              <h3 className={e.briefRoom} data-reveal="">
                {room.name}
                <em>{unread ? `${unread} unread of ${list.length}` : `all ${list.length} read`}</em>
              </h3>
              <ol className={e.briefList}>
                {list.slice(0, cap).map((b, i) => {
                  const it = b.items?.[0];
                  const read = marks.has(it?.id);
                  return (
                    <li key={it?.id || b.headline} className={read ? e.read : undefined} data-reveal="" style={{ '--i': i % BRIEF_CAP }}>
                      <button
                        type="button"
                        className={e.briefLine}
                        onClick={() => on.open(it)}
                        data-kbd-tile
                        data-story={it?.id || ''}
                        data-unread={read ? undefined : ''}
                      >
                        <span className={e.briefHead}><ReadTick on={read} size={11} />{b.headline}</span>
                        <span className={e.briefMeta}>
                          {platform === 'hackernews'
                            ? [it?.extra?.domain, it?.score != null ? `▲ ${compact(it.score)}` : null, it?.comments_count ? `${compact(it.comments_count)} cmt` : null].filter(Boolean).join(' · ')
                            : it?.source}
                          {it?.published_at ? ` · ${timeAgo(it.published_at)}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              {list.length > BRIEF_CAP && (
                <button type="button" className={e.briefMore} onClick={() => setOpenAll((o) => ({ ...o, [platform]: !o[platform] }))}>
                  {openAll[platform] ? 'fewer' : `${list.length - BRIEF_CAP} more`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
