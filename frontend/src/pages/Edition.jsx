// The Edition — today's paper, composed on this machine from every room.
//
// It reads like a front page, not a feed. A nameplate with the issue and date in
// its ears, and under it the page-turns (the previous and next paper, any back
// issue from the drawer), how much of today you've read, and Recompose. Then the
// front: the lead story large with its picture, two more down a rail beside it,
// the rest of the columns ruled in a row, and In Brief — grouped by the room each
// line came from. Every story says where it's from and what you can do with it:
// watch it, read the article, open the discussion. Stories you've opened are
// ticked off, per paper, in this browser.
//
// When the local model wrote copy (an "edited" paper) stories carry a dek and
// body; a "wire" paper is headlines only, so each story shows its numbers — points,
// comments, age, source — in the dek's place, and still reads as a page.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, BookmarkCheck, Check, ExternalLink, FileText, ListPlus, MessageSquare, Play, RefreshCw,
} from 'lucide-react';

import { api, useApi } from '../api/client.js';
import { ErrorBox } from '../components/layout/Section.jsx';
import RedditPostModal from '../components/modals/RedditPostModal.jsx';
import { SaveButton } from '../components/ui/ItemActions.jsx';
import { ReaderSheet, splitKind } from '../components/wire/HNReader.jsx';
import { compact } from '../lib/format.js';
import { timeAgo } from '../lib/time.js';
import { useParamState } from '../lib/urlState.js';
import { usePlayer } from '../state.jsx';
import e from './edition.module.css';

const ROOM = {
  youtube: { name: 'Screening Room', c: 'var(--c-youtube)' },
  reddit: { name: 'The Dispatch', c: 'var(--c-reddit)' },
  hackernews: { name: 'The Wire', c: 'var(--c-hn)' },
};
const roomOf = (it) => ROOM[it?.platform] || ROOM.hackernews;

// ── what you've read, per paper ──────────────────────────────────────────────

const READ_KEY = 'tubcal.edition.read';
function readAll() {
  try { return JSON.parse(localStorage.getItem(READ_KEY)) || {}; } catch { return {}; }
}
function useReadMarks(date) {
  const [all, setAll] = useState(readAll);
  const marks = useMemo(() => new Set(all[date] || []), [all, date]);
  const mark = useCallback((key) => {
    if (!date || !key) return;
    setAll((prev) => {
      const cur = new Set(prev[date] || []);
      if (cur.has(key)) return prev;
      cur.add(key);
      const next = { ...prev, [date]: [...cur] };
      // Keep a month of papers; older ticks don't matter.
      Object.keys(next).sort().slice(0, -31).forEach((d) => delete next[d]);
      try { localStorage.setItem(READ_KEY, JSON.stringify(next)); } catch { /* fine */ }
      return next;
    });
  }, [date]);
  return [marks, mark];
}

// ── bits of a story ──────────────────────────────────────────────────────────

/** "The Wire · spectrum.ieee.org", "Screening Room · Eve", "The Dispatch · r/rust". */
function kickerOf(item) {
  if (!item) return '';
  const where = item.platform === 'hackernews'
    ? (splitKind(item.title).kind || item.extra?.domain || 'Hacker News')
    : item.source;
  return `${roomOf(item).name}${where ? ` · ${where}` : ''}`;
}

/** The numbers line a wire paper shows where the dek would go. */
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

/** What you can do with a story's top item, as a row of small buttons. */
function Acts({ item, on, big = false }) {
  const { enqueue } = usePlayer();
  if (!item) return null;
  const cls = `${e.act} ${big ? e.actBig : ''}`;
  if (item.platform === 'youtube') {
    return (
      <div className={e.acts}>
        <button type="button" className={`${cls} ${e.actMain}`} onClick={() => on.play(item)}><Play size={13} fill="currentColor" /> Watch</button>
        <button type="button" className={cls} onClick={() => enqueue(item)} title="Add to Up next"><ListPlus size={14} /> Up next</button>
        <SaveButton item={item} className={e.save} />
      </div>
    );
  }
  if (item.platform === 'reddit') {
    return (
      <div className={e.acts}>
        <button type="button" className={`${cls} ${e.actMain}`} onClick={() => on.post(item)}><FileText size={13} /> Read the post</button>
        {item.comments_count != null && <button type="button" className={cls} onClick={() => on.post(item)}><MessageSquare size={13} /> {compact(item.comments_count)}</button>}
        <SaveButton item={item} className={e.save} />
      </div>
    );
  }
  const external = item.url && !item.url.includes('news.ycombinator.com/item');
  return (
    <div className={e.acts}>
      {external && (
        <a className={`${cls} ${e.actMain}`} href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => on.touched(item)}>
          Read <ExternalLink size={12} />
        </a>
      )}
      <button type="button" className={`${cls} ${external ? '' : e.actMain}`} onClick={() => on.discuss(item)}>
        <MessageSquare size={13} /> {item.comments_count != null ? `${compact(item.comments_count)} comments` : 'Discussion'}
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
  if (item?.platform === 'hackernews' && item.url && !item.url.includes('news.ycombinator.com/item')) {
    return (
      <Tag className={className}>
        <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={() => on.touched(item)}>{text}</a>
      </Tag>
    );
  }
  return (
    <Tag className={className}>
      <button type="button" onClick={() => on.open(item)}>{text}</button>
    </Tag>
  );
}

function Story({ story, on, read, variant = 'column', index = 0 }) {
  const items = story.items || [];
  const top = items[0];
  const pic = variant !== 'rail' ? items.find((i) => i.thumbnail) : null;
  const [imgOk, setImgOk] = useState(true);
  return (
    <article
      className={`${e.story} ${variant === 'rail' ? e.railStory : e.column} ${read ? e.read : ''}`}
      style={{ '--c': roomOf(top).c, '--i': index }}
      data-kbd-tile
      tabIndex={0}
      onKeyDown={(ev) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) on.open(top); }}
    >
      <span className={e.kicker}>
        {read && <Check size={12} className={e.tick} />}
        {kickerOf(top)}
      </span>
      {pic && imgOk && variant === 'column' && (
        <button type="button" className={e.colPic} onClick={() => on.open(pic)} tabIndex={-1} aria-hidden="true">
          <img src={pic.thumbnail} alt="" loading="lazy" onError={() => setImgOk(false)} />
        </button>
      )}
      <Headline story={story} item={top} on={on} className={e.headline} />
      {story.dek ? <p className={e.dek}>{story.dek}</p> : <Numbers item={top} />}
      {story.body && variant !== 'rail' && <p className={e.body}>{story.body}</p>}
      <AlsoOn items={items} on={on} />
      <Acts item={top} on={on} />
    </article>
  );
}

function Lede({ story, on, read }) {
  const items = story.items || [];
  const top = items[0];
  const pic = items.find((i) => i.thumbnail);
  const [imgOk, setImgOk] = useState(true);
  const big = pic?.thumbnail?.replace('hqdefault', 'maxresdefault');
  return (
    <article className={`${e.story} ${e.lede} ${read ? e.read : ''}`} style={{ '--c': roomOf(top).c }}>
      <span className={e.kicker}>
        <em className={e.leadTag}>Lead story</em>
        {read && <Check size={12} className={e.tick} />}
        {kickerOf(top)}
      </span>
      <Headline story={story} item={top} on={on} as="h2" className={e.ledeHead} />
      {pic && imgOk && (
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
      {story.dek ? <p className={e.ledeDek}>{story.dek}</p> : <Numbers item={top} />}
      {story.body && <p className={`${e.body} ${e.ledeBody}`}>{story.body}</p>}
      {story.transcript_of && <p className={e.fromTranscript}><FileText size={12} /> written from what was said in the video — its transcript is in The Archive</p>}
      <AlsoOn items={items} on={on} />
      <Acts item={top} on={on} big />
    </article>
  );
}

function Briefs({ briefs, on, marks }) {
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
      <h2 className={e.section}><span>In brief</span></h2>
      <div className={e.briefGroups}>
        {groups.map(([platform, list]) => {
          const room = ROOM[platform] || ROOM.hackernews;
          const cap = openAll[platform] ? list.length : 8;
          return (
            <div key={platform} className={e.briefGroup} style={{ '--c': room.c }}>
              <h3 className={e.briefRoom}>{room.name} <em>{list.length}</em></h3>
              <ol className={e.briefList}>
                {list.slice(0, cap).map((b) => {
                  const it = b.items?.[0];
                  const read = marks.has(it?.id);
                  return (
                    <li key={it?.id || b.headline} className={read ? e.read : undefined}>
                      <button type="button" className={e.briefLine} onClick={() => on.open(it)} data-kbd-tile>
                        <span className={e.briefHead}>{read && <Check size={11} className={e.tick} />}{b.headline}</span>
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
              {list.length > 8 && (
                <button type="button" className={e.briefMore} onClick={() => setOpenAll((o) => ({ ...o, [platform]: !o[platform] }))}>
                  {openAll[platform] ? 'fewer' : `${list.length - 8} more`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── the nameplate ────────────────────────────────────────────────────────────

function longDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function shortDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function Nameplate({ paper, archive, onDate, isLatest, onRecompose, recomposing, read, total }) {
  const dates = (archive || []).map((x) => x.date);
  const idx = dates.indexOf(paper.date);
  const older = idx >= 0 ? dates[idx + 1] : null;
  const newer = idx > 0 ? dates[idx - 1] : null;
  const edited = paper.status === 'edited';
  return (
    <header className={e.nameplate}>
      <div className={e.plate}>
        <div className={e.ear}>
          <b>No {paper.issue}</b>
          <span>{longDate(paper.date)}</span>
        </div>
        <h1 className={e.title}>The <i>Edition</i></h1>
        <div className={`${e.ear} ${e.earRight}`}>
          <b>{paper.sources} sources</b>
          <span className={edited ? undefined : e.wireMark}>
            {edited ? `written by ${paper.model}` : 'wire edition · headlines only'}
          </span>
        </div>
      </div>
      <div className={e.strip}>
        <button type="button" className={e.turn} onClick={() => older && onDate(older, dates)} disabled={!older} title="The paper before this one">
          <ArrowLeft size={14} /> {older ? shortDate(older) : 'first issue'}
        </button>
        <label className={e.issues}>
          <span>Back issues</span>
          <select value={paper.date} onChange={(ev) => onDate(ev.target.value, dates)}>
            {(archive?.length ? archive : [{ date: paper.date }]).map((x) => (
              <option key={x.date} value={x.date}>{shortDate(x.date)}{x.status === 'edited' ? '' : ' · wire'}</option>
            ))}
          </select>
        </label>
        <button type="button" className={e.turn} onClick={() => newer && onDate(newer, dates)} disabled={!newer} title="The paper after this one">
          {newer ? shortDate(newer) : 'latest'} <ArrowRight size={14} />
        </button>
        <span className={e.progress} title="Stories you've opened from this paper">
          <span className={e.progressBar}><i style={{ width: `${total ? (read / total) * 100 : 0}%` }} /></span>
          {read === total && total > 0 ? <><BookmarkCheck size={13} /> all read</> : `${read} of ${total} read`}
        </span>
        {isLatest && (
          <button type="button" className={e.recompose} onClick={onRecompose} disabled={recomposing} title="Compose today's paper again from the latest signals">
            <RefreshCw size={14} className={recomposing ? e.spin : ''} /> {recomposing ? 'Recomposing…' : 'Recompose'}
          </button>
        )}
      </div>
    </header>
  );
}

function PressesWarming({ hour, onCompose, composing }) {
  return (
    <div className={e.warming}>
      <h1 className={e.title}>The <i>Edition</i></h1>
      <p className={e.warmingSlug}><span className={e.warmingDot} /> the presses are warming</p>
      <p className={e.warmingLine}>
        Your first paper is composed from today's signals{hour != null ? ` after ${String(hour).padStart(2, '0')}:00` : ''}.
      </p>
      <button type="button" className={e.recompose} onClick={onCompose} disabled={composing}>
        <RefreshCw size={14} className={composing ? e.spin : ''} /> {composing ? 'Composing…' : 'Compose now'}
      </button>
    </div>
  );
}

function Skeleton() {
  return (
    <div className={e.skel} aria-hidden="true">
      <div className={e.skelPlate} />
      <div className={e.skelFront}>
        <div><i style={{ width: '30%' }} /><b /><b style={{ width: '70%' }} /><div className={e.skelPic} /></div>
        <div><i /><i style={{ width: '80%' }} /><i /><i style={{ width: '60%' }} /></div>
      </div>
    </div>
  );
}

// ── the paper ────────────────────────────────────────────────────────────────

export default function Edition() {
  const [date, setDate] = useParamState('d', '');
  const paperReq = useApi(date ? `/edition/${date}` : '/edition/latest');
  const archive = useApi('/edition/archive');
  const { open: playVideo } = usePlayer();
  const [post, setPost] = useState(null);
  const [thread, setThread] = useState(null);
  const [recomposing, setRecomposing] = useState(false);
  const [buildHour, setBuildHour] = useState(null);

  const paper = paperReq.data;
  const noPaper = paperReq.error === 'no edition yet';
  const archiveList = archive.data?.editions;
  const isLatest = !date || date === archiveList?.[0]?.date;
  const [marks, mark] = useReadMarks(paper?.date);

  const touched = (it) => mark(it?.id);
  const on = {
    touched,
    play: (it) => { touched(it); playVideo(it); },
    post: (it) => { touched(it); setPost(it); },
    discuss: (it) => { touched(it); setThread(it); },
    open: (it) => {
      if (!it) return;
      touched(it);
      if (it.platform === 'youtube') playVideo(it);
      else if (it.platform === 'reddit') setPost(it);
      else setThread(it);
    },
  };

  const recompose = async () => {
    try {
      await api('/edition/rebuild', { method: 'POST' });
      setRecomposing(true);
    } catch { /* best-effort */ }
  };

  // While a build is in flight (or the first paper hasn't landed), watch the
  // presses; when they stop, the fresh paper cross-fades in.
  const reload = paperReq.reload;
  const reloadArchive = archive.reload;
  useEffect(() => {
    if (!recomposing && !noPaper) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const st = await api('/edition/status');
        if (!alive) return;
        if (st.hour != null) setBuildHour(st.hour);
        if (!st.building && st.latest) {
          setRecomposing(false);
          reload();
          reloadArchive();
        }
      } catch { /* keep watching */ }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [recomposing, noPaper, reload, reloadArchive]);

  const goDate = (d, dates) => setDate(d === dates[0] ? '' : d);

  const columns = paper?.columns || [];
  const rail = columns.slice(0, 2);
  const row = columns.slice(2);
  const everyStory = paper ? [paper.lede, ...columns, ...(paper.briefs || [])].filter(Boolean) : [];
  const readCount = everyStory.filter((st) => marks.has(st.items?.[0]?.id)).length;
  const isRead = (st) => marks.has(st?.items?.[0]?.id);

  return (
    <div className={e.room}>
      {paperReq.error && !noPaper && <ErrorBox message={paperReq.error} />}
      {noPaper && <PressesWarming hour={buildHour} onCompose={recompose} composing={recomposing} />}
      {paperReq.loading && !paper && !noPaper && <Skeleton />}

      {paper && (
        <div key={paper.generated_at} className={e.paper}>
          <Nameplate
            paper={paper}
            archive={archiveList}
            onDate={goDate}
            isLatest={isLatest}
            onRecompose={recompose}
            recomposing={recomposing}
            read={readCount}
            total={everyStory.length}
          />

          <div className={`${e.front} ${rail.length ? '' : e.frontSolo}`}>
            {paper.lede && <Lede story={paper.lede} on={on} read={isRead(paper.lede)} />}
            {rail.length > 0 && (
              <aside className={e.rail} aria-label="Also on the front">
                <h2 className={e.railHead}>Also on the front</h2>
                {rail.map((st, i) => (
                  <Story key={st.items?.[0]?.id || i} story={st} on={on} read={isRead(st)} variant="rail" index={i} />
                ))}
              </aside>
            )}
          </div>

          {row.length > 0 && (
            <div className={e.row} data-n={Math.min(row.length, 3)}>
              {row.map((st, i) => (
                <Story key={st.items?.[0]?.id || i} story={st} on={on} read={isRead(st)} index={i} />
              ))}
            </div>
          )}

          <Briefs briefs={paper.briefs || []} on={on} marks={marks} />

          <footer className={e.colophon}>
            <span>No {paper.issue} · composed {new Date(paper.generated_at * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} in {(paper.build_ms / 1000).toFixed(1)}s from the last {paper.window_h || 36} hours</span>
            <span>set in Fraunces &amp; Schibsted Grotesk · nothing left this machine</span>
          </footer>
        </div>
      )}

      <RedditPostModal item={post} onClose={() => setPost(null)} />
      {thread && <ReaderSheet item={thread} onClose={() => setThread(null)} onItem={(id) => setThread({ id: `hn:${id}`, platform: 'hackernews', extra: { hn_id: id } })} />}
    </div>
  );
}
